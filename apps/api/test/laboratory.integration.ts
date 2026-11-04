import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { labBatchResponse, unknownUsage } from '@ferweb/contracts';
import { readConfig } from '../src/config.js';
import { createPool } from '../src/database.js';
import { createDatabaseAdmin } from './database-admin.js';
import { loadMigrations, applyMigrations } from '../src/migrations.js';
import { inspectDatabase } from '../src/health.js';
import { createApp } from '../src/app.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { AiClient } from '../src/modules/chat/client.js';
import { LaboratoryService } from '../src/modules/laboratory/service.js';
import { estimateCost } from '../src/modules/laboratory/analysis.js';
import { GitHubService } from '../src/modules/github/service.js';
import { CredentialCipher } from '../src/modules/github/crypto.js';
import { RetrievalService } from '../src/modules/retrieval/service.js';
import { VectorStore } from '../src/modules/retrieval/vector-store.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { retrievalCorpus } from '../../../tests/fixtures/retrieval.mjs';

test('laboratory: frozen comparisons, reported metrics, dated cost, human reviews and isolation', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    prefix = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    pool = createPool({ ...config, POSTGRES_DB: database });
  const ai = new AiClient(process.env.AI_TEST_URL!, process.env.AI_TEST_TOKEN!),
    fixture = retrievalCorpus(githubFixture()),
    github = new GitHubService(pool, fixture.config, fixture.transport),
    retrieval = new RetrievalService(pool, github, ai, new VectorStore(config.QDRANT_URL, prefix)),
    lab = new LaboratoryService(pool, ai, retrieval);
  let created = false,
    server: import('node:http').Server | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'lab-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'lab-other@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
        await pool.query(
          "INSERT INTO projects(owner_id,name) VALUES($1,'Laboratory') RETURNING id",
          [owner.id],
        )
      ).rows[0].id,
      second = (
        await pool.query(
          "INSERT INTO projects(owner_id,name) VALUES($1,'Other project') RETURNING id",
          [owner.id],
        )
      ).rows[0].id;
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      appOrigin: origin,
      secureCookies: false,
      laboratory: lab,
      github,
      retrieval,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    async function request(method: string, path: string, body?: unknown, cookie?: string) {
      return fetch(base + path, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-FerWeb-Request': '1',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    const cookie = (await request('POST', '/auth/login', { email: owner.email, password })).headers
        .get('set-cookie')!
        .split(';')[0]!,
      foreign = (
        await request('POST', '/auth/login', { email: 'lab-other@ferweb.test', password })
      ).headers
        .get('set-cookie')!
        .split(';')[0]!;
    const root = `/projects/${project}/lab`,
      caseInput = {
        title: 'Authentication',
        question: '¿Cómo funciona la autenticación?',
        context: 'Las contraseñas se protegen con scrypt y la cookie es HttpOnly.',
        criteria: [
          { description: 'Explica la protección de la contraseña', expectedText: 'scrypt' },
        ],
        repositoryContext: false,
      };
    let caseId = '',
      batchId = '';
    const targets: any[] = [];
    async function getBatch(id: string) {
      const response = await request('GET', `${root}/batches/${id}`, undefined, cookie);
      assert.equal(response.status, 200);
      return labBatchResponse.parse(await response.json());
    }
    async function finished(id: string) {
      for (let n = 0; n < 120; n++) {
        const value = await getBatch(id);
        if (!['draft', 'running'].includes(value.batch.status)) return value;
        await delay(50);
      }
      throw Error('Batch did not finish');
    }
    const batchBody = (id = caseId, selected = targets, repetitions = 2) => ({
      requestId: randomUUID(),
      title: 'Frozen comparison',
      caseIds: [id],
      targets: selected,
      repetitions,
      environment: 'Synthetic provider; no real prices or model inference',
      allowExternal: true,
    });
    await t.test(
      'case ownership, strict inputs, immutable snapshot and dated tariff validation',
      async () => {
        assert.equal((await request('GET', root)).status, 401);
        assert.equal((await request('GET', root, undefined, foreign)).status, 404);
        assert.equal(
          (await request('POST', root + '/cases', { ...caseInput, sources: [] }, cookie)).status,
          400,
        );
        const response = await request('POST', root + '/cases', caseInput, cookie);
        assert.equal(response.status, 201);
        const value = await response.json();
        caseId = value.id;
        assert.equal(value.version, 1);
        assert.equal(value.context, caseInput.context);
        assert.equal(value.contextHash.length, 64);
        assert.equal(
          (await request('GET', `/projects/${second}/lab/cases/${caseId}`, undefined, cookie))
            .status,
          404,
        );
        for (const provider of ['ollama', 'openai']) {
          const response = await request(
            'POST',
            root + '/tariffs',
            {
              provider,
              model: 'fixture-chat',
              effectiveFrom: '2020-01-01',
              effectiveTo: null,
              verifiedOn: '2026-11-02',
              source: 'https://example.com/synthetic-tariff',
              inputPerMillion: 2,
              cachedInputPerMillion: 1,
              outputPerMillion: 4,
              notes: 'Synthetic test fixture only; text token charges',
            },
            cookie,
          );
          assert.equal(response.status, 201);
          const tariff = await response.json();
          targets.push({
            provider,
            model: 'fixture-chat',
            configuration: { maxOutputTokens: 128 },
            tariffId: tariff.id,
            cacheLabel: 'unspecified',
          });
        }
        const prices = (await (await request('GET', root, undefined, cookie)).json()).tariffs;
        const tariff = prices[0];
        assert.equal(
          estimateCost(
            { ...unknownUsage(), inputTokens: 100, outputTokens: 20, cachedTokens: 50 },
            tariff,
            '2026-11-02',
          ).amount,
          0.00023,
        );
        assert.equal(
          estimateCost(
            { ...unknownUsage(), inputTokens: 100, outputTokens: 20 },
            tariff,
            '2026-11-02',
          ).amount,
          null,
        );
        assert.equal(
          estimateCost(
            { ...unknownUsage(), inputTokens: 100, outputTokens: 20, cachedTokens: 101 },
            tariff,
            '2026-11-02',
          ).reason,
          'inconsistent_usage',
        );
        assert.equal(
          estimateCost(
            { ...unknownUsage(), inputTokens: 100, outputTokens: 20, cachedTokens: 0 },
            { ...tariff, effectiveTo: '2021-01-01' },
            '2026-11-02',
          ).amount,
          null,
        );
      },
    );
    await t.test(
      'explicit external selection, batch idempotency, repetitions and exact frozen conditions',
      async () => {
        const input = batchBody();
        assert.equal(
          (await request('POST', root + '/batches', { ...input, allowExternal: false }, cookie))
            .status,
          422,
        );
        assert.equal(
          (
            await request(
              'POST',
              root + '/batches',
              { ...input, repetitions: 5, caseIds: [caseId, randomUUID()] },
              cookie,
            )
          ).status,
          404,
        );
        const response = await request('POST', root + '/batches', input, cookie);
        assert.equal(response.status, 201);
        let value = labBatchResponse.parse(await response.json());
        batchId = value.batch.id;
        assert.equal(value.batch.runs.length, 4);
        assert.equal(value.batch.status, 'draft');
        const duplicate = await request('POST', root + '/batches', input, cookie);
        assert.equal((await duplicate.json()).batch.id, batchId);
        assert.equal(
          (await request('POST', root + '/batches', { ...input, title: 'Different' }, cookie))
            .status,
          409,
        );
        assert.equal(
          (await request('POST', `${root}/batches/${batchId}/execute`, {}, foreign)).status,
          404,
        );
        assert.equal(
          (await request('POST', `${root}/batches/${batchId}/execute`, {}, cookie)).status,
          202,
        );
        await request('POST', `${root}/batches/${batchId}/execute`, {}, cookie);
        value = await finished(batchId);
        assert.equal(value.batch.status, 'completed');
        assert.ok(value.batch.runs.every((r) => r.status === 'completed'));
        assert.deepEqual(
          value.batch.runs.map((r) => [r.target, r.repetition]),
          [
            [0, 1],
            [1, 1],
            [0, 2],
            [1, 2],
          ],
        );
        assert.equal(value.batch.conditions.cases[0]!.context, caseInput.context);
        assert.equal(Object.keys(value.batch.conditions.messagesHash).length, 1);
        for (const run of value.batch.runs) {
          assert.ok(run.firstTokenMs !== null && run.firstTokenMs >= 0);
          assert.ok(run.durationMs! >= run.firstTokenMs!);
          assert.equal(run.usage.inputTokens, 100);
          assert.equal(run.catalogRevision, 'fixture-revision');
          assert.equal(run.reportedModel, 'fixture-lab-reported');
          assert.equal(run.estimatedCostUsd, run.target === 0 ? 0.00028 : 0.00023);
          assert.equal(run.cacheObserved, run.target === 0 ? 'no_hit' : 'hit');
          assert.equal(run.automatic!.provisionalAccepted, true);
        }
        assert.ok(value.summary.every((s) => s.accepted === 0 && s.costPerAcceptedUsd === null));
        const persisted = await new LaboratoryService(pool, ai, retrieval).detail(
          owner.id,
          project,
          batchId,
        );
        assert.equal(persisted.batch.runs.length, 4);
        assert.deepEqual(persisted.batch.conditions, value.batch.conditions);
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM lab_runs WHERE batch_id=$1', [batchId]))
            .rows[0].n,
          4,
        );
      },
    );
    await t.test(
      'automatic suggestions remain provisional; manual overrides, audit history and version conflicts',
      async () => {
        const value = await getBatch(batchId),
          run = value.batch.runs[0]!,
          path = `${root}/batches/${batchId}/runs/${run.id}/reviews`;
        const rejected = await request(
          'POST',
          path,
          {
            version: 0,
            accepted: false,
            score: 1,
            verdicts: ['fail'],
            notes: 'Human review disagrees with substring suggestion',
          },
          cookie,
        );
        assert.equal(rejected.status, 200);
        let result = labBatchResponse.parse(await rejected.json());
        assert.equal(result.batch.runs[0]!.automatic!.provisionalAccepted, true);
        assert.equal(result.summary[0]!.accepted, 0);
        assert.equal(
          (
            await request(
              'POST',
              path,
              { version: 0, accepted: true, score: 5, verdicts: ['pass'], notes: '' },
              cookie,
            )
          ).status,
          409,
        );
        const accepted = await request(
          'POST',
          path,
          { version: 1, accepted: true, score: 5, verdicts: ['pass'], notes: 'Reviewed again' },
          cookie,
        );
        result = labBatchResponse.parse(await accepted.json());
        assert.equal(result.batch.runs[0]!.reviews.length, 2);
        assert.equal(result.summary[0]!.accepted, 1);
        assert.equal(result.summary[0]!.costPerAcceptedUsd, 0.00056);
        assert.equal(result.summary[0]!.meanQuality, 5);
        assert.ok(result.summary[0]!.timePerAcceptedMs! > 0);
        assert.equal(
          (
            await request(
              'POST',
              path,
              { version: 2, accepted: true, score: 5, verdicts: ['fail'], notes: '' },
              cookie,
            )
          ).status,
          422,
        );
      },
    );
    await t.test(
      'JSON and CSV exports preserve conditions and reviews, defend spreadsheet formulas and enforce scope',
      async () => {
        for (const format of ['json', 'csv']) {
          assert.equal(
            (
              await request(
                'GET',
                `${root}/batches/${batchId}/export?format=${format}`,
                undefined,
                foreign,
              )
            ).status,
            404,
          );
          const response = await request(
            'GET',
            `${root}/batches/${batchId}/export?format=${format}`,
            undefined,
            cookie,
          );
          assert.equal(response.status, 200);
          assert.match(response.headers.get('content-disposition')!, /attachment/);
          const text = await response.text();
          assert.match(text, /contextHash|context_hash/);
          assert.match(text, /scrypt/);
          assert.match(text, /Synthetic/);
          assert.match(text, /Reviewed again/);
          assert.doesNotMatch(text, /AI_SERVICE_TOKEN|Bearer /);
        }
        const formula = await lab.createCase(owner.id, project, {
          ...caseInput,
          title: 'CSV formula',
          question: '=HYPERLINK("https://example.com")',
          context: '+formula',
        });
        const made = await lab.createBatch(
          owner.id,
          project,
          batchBody(formula.id, [targets[0]], 1),
        );
        const csv = await lab.export(owner.id, project, made.batch.id, 'csv');
        assert.match(csv, /'=HYPERLINK/);
        assert.match(csv, /'\+formula/);
      },
    );
    await t.test(
      'provider errors and unknown usage remain visible; cancellation keeps partial and skips repetitions',
      async () => {
        for (const [question, expected] of [
          ['fixture-lab-error', 'error'],
          ['fixture-lab-unknown', 'completed'],
        ] as const) {
          const c = await lab.createCase(owner.id, project, { ...caseInput, question });
          const made = await lab.createBatch(owner.id, project, batchBody(c.id, [targets[0]], 1));
          await request('POST', `${root}/batches/${made.batch.id}/execute`, {}, cookie);
          const value = await finished(made.batch.id),
            run = value.batch.runs[0]!;
          assert.equal(run.status, expected);
          assert.equal(run.estimatedCostUsd, null);
          assert.equal(run.cacheObserved, 'unknown');
          if (expected === 'error') {
            assert.equal(run.errorCode, 'provider_rate_limit');
            assert.match(run.response, /Respuesta de laboratorio/);
            assert.equal(
              (
                await request(
                  'POST',
                  `${root}/batches/${made.batch.id}/runs/${run.id}/reviews`,
                  { version: 0, accepted: true, score: 5, verdicts: ['pass'], notes: '' },
                  cookie,
                )
              ).status,
              422,
            );
          }
        }
        const c = await lab.createCase(owner.id, project, {
            ...caseInput,
            question: 'fixture-lab-cancel',
          }),
          made = await lab.createBatch(owner.id, project, batchBody(c.id, [targets[0]], 2));
        await request('POST', `${root}/batches/${made.batch.id}/execute`, {}, cookie);
        for (let n = 0; n < 70; n++) {
          const value = await getBatch(made.batch.id);
          if (value.batch.runs[0]!.response) break;
          await delay(50);
        }
        assert.equal(
          (await request('POST', `${root}/batches/${made.batch.id}/cancel`, {}, cookie)).status,
          200,
        );
        const ended = await finished(made.batch.id);
        assert.equal(ended.batch.status, 'cancelled');
        assert.equal(ended.batch.runs[0]!.status, 'cancelled');
        assert.match(ended.batch.runs[0]!.response, /Respuesta/);
        assert.equal(ended.batch.runs[1]!.status, 'skipped');
        assert.equal(ended.batch.runs[1]!.startedAt, null);
      },
    );
    await t.test(
      'frozen repository sources keep old commit after sync; revoked access blocks execution and export',
      async () => {
        await pool.query(
          "INSERT INTO github_connections(owner_id,github_user_id,login,encrypted_token) VALUES($1,501,'fixture',$2)",
          [
            owner.id,
            new CredentialCipher(fixture.config.encryptionKey).encrypt(
              'ghu_fixture_only',
              owner.id,
            ),
          ],
        );
        await github.connect(owner.id, 71);
        const linked = await github.link(owner.id, project, {
          installationId: 71,
          repositoryId: 101,
          version: 0,
        });
        await github.sync(owner.id, project, linked.link.version);
        await retrieval.index(owner.id, project);
        const c = await lab.createCase(owner.id, project, {
          ...caseInput,
          question: 'autenticación cookie',
          repositoryContext: true,
        });
        assert.equal(c.sources[0]!.commit, 'a'.repeat(40));
        const made = await lab.createBatch(owner.id, project, batchBody(c.id, [targets[0]], 1));
        fixture.state.commit = 'd'.repeat(40);
        const old = await github.read(owner.id, project);
        await github.sync(owner.id, project, old.link!.version);
        await request('POST', `${root}/batches/${made.batch.id}/execute`, {}, cookie);
        const value = await finished(made.batch.id);
        assert.equal(value.batch.runs[0]!.status, 'completed');
        assert.equal(value.batch.conditions.cases[0]!.sources[0]!.commit, 'a'.repeat(40));
        assert.equal(value.batch.conditions.cases[0]!.contextHash, c.contextHash);
        fixture.state.denied = true;
        assert.equal(
          (
            await request(
              'GET',
              `${root}/batches/${made.batch.id}/export?format=json`,
              undefined,
              cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (await request('GET', `${root}/cases/${c.id}`, undefined, cookie)).status,
          409,
        );
      },
    );
    await t.test(
      'expired leases recover without generation; archived project is read only',
      async () => {
        const made = await lab.createBatch(owner.id, project, batchBody(caseId, [targets[0]], 2));
        await pool.query(
          "UPDATE lab_batches SET status='running',lease_until=now()-interval '1 second' WHERE id=$1",
          [made.batch.id],
        );
        await pool.query(
          "UPDATE lab_runs SET status='running',started_at=now(),response='saved partial' WHERE id=$1",
          [made.batch.runs[0]!.id],
        );
        const value = await getBatch(made.batch.id);
        assert.equal(value.batch.status, 'interrupted');
        assert.equal(value.batch.runs[0]!.status, 'interrupted');
        assert.equal(value.batch.runs[0]!.durationMs, null);
        assert.equal(value.batch.runs[0]!.usage.totalTokens, null);
        assert.equal(value.batch.runs[1]!.status, 'skipped');
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [project]);
        assert.equal((await request('POST', root + '/cases', caseInput, cookie)).status, 409);
        assert.equal(
          (await request('GET', `${root}/batches/${batchId}/export?format=json`, undefined, cookie))
            .status,
          200,
        );
      },
    );
  } finally {
    lab.shutdown();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    const collections = await (await fetch(`${config.QDRANT_URL}/collections`)).json();
    for (const entry of collections.result.collections)
      if (entry.name.startsWith(prefix + '_'))
        await fetch(`${config.QDRANT_URL}/collections/${entry.name}`, { method: 'DELETE' });
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
