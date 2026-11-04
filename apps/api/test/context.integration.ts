import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, writeFile } from 'node:fs/promises';
import {
  labBatchInput,
  labBatchResponse,
  contextComparisonResponse,
  unknownUsage,
} from '@ferweb/contracts';
import { readConfig } from '../src/config.js';
import { createPool } from '../src/database.js';
import { createDatabaseAdmin } from './database-admin.js';
import { loadMigrations, applyMigrations } from '../src/migrations.js';
import { inspectDatabase } from '../src/health.js';
import { createApp } from '../src/app.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { AiClient } from '../src/modules/chat/client.js';
import { ChatService } from '../src/modules/chat/service.js';
import { LaboratoryService } from '../src/modules/laboratory/service.js';
import {
  contextReport,
  contextTotals,
  adoptionEvidence,
} from '../src/modules/laboratory/context-analysis.js';
import { GitHubService } from '../src/modules/github/service.js';
import { RetrievalService } from '../src/modules/retrieval/service.js';
import { VectorStore } from '../src/modules/retrieval/vector-store.js';
import { tokenHash } from '../src/modules/identity/sessions.js';
import { digest } from '../src/modules/laboratory/analysis.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { retrievalCorpus, addSource } from '../../../tests/fixtures/retrieval.mjs';

test('context strategies: existing evaluation cases, complete ledgers, invalidation and evidence gate (simulated inference)', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    prefix = `ferweb_context_${randomUUID().replaceAll('-', '')}`,
    pool = createPool({ ...config, POSTGRES_DB: database }),
    ai = new AiClient(process.env.AI_TEST_URL!, process.env.AI_TEST_TOKEN!),
    fixture = retrievalCorpus(githubFixture()),
    github = new GitHubService(pool, fixture.config, fixture.transport),
    retrieval = new RetrievalService(pool, github, ai, new VectorStore(config.QDRANT_URL, prefix)),
    lab = new LaboratoryService(pool, ai, retrieval),
    chat = new ChatService(pool, ai, retrieval);
  let server: import('node:http').Server | undefined,
    created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'context-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'context-other@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
        await pool.query(
          "INSERT INTO projects(owner_id,name) VALUES($1,'Context evaluation') RETURNING id",
          [owner.id],
        )
      ).rows[0].id as string,
      origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      github,
      retrieval,
      laboratory: lab,
      chats: chat,
      appOrigin: origin,
      secureCookies: false,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const request = (method: string, path: string, body?: unknown, cookie?: string) =>
      fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method,
        headers: {
          Origin: origin,
          'X-FerWeb-Request': '1',
          'content-type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const login = async (email: string) => {
      const r = await request('POST', '/auth/login', { email, password });
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie')!.split(';')[0]!;
    };
    const cookie = await login(owner.email),
      foreign = await login('context-other@ferweb.test'),
      sessionHash = tokenHash(cookie.split('=')[1]!);
    const auth = await github.start(owner.id, cookie.split('=')[1]!);
    await github.callback(new URL(auth.url).searchParams.get('state')!, 'fixture-code');
    await github.connect(owner.id, 71);
    await github.link(owner.id, project, { installationId: 71, repositoryId: 101, version: 0 });
    await github.sync(owner.id, project, 1);
    await retrieval.index(owner.id, project);
    const evaluation = JSON.parse(
      await readFile(
        new URL('../../../tests/fixtures/retrieval-evaluation.json', import.meta.url),
        'utf8',
      ),
    ) as { question: string; expectedPaths: string[]; expectedAnswer: string }[];
    const cases = [];
    for (const [i, c] of evaluation.entries())
      cases.push(
        await lab.createCase(owner.id, project, {
          title: `Evaluación existente ${i + 1}`,
          question: c.question,
          context: '',
          repositoryContext: false,
          criteria: [
            {
              description: `[EVAL_ONLY_${i}] ${c.expectedAnswer}`,
              expectedText: c.expectedPaths.length ? '' : c.expectedAnswer,
              expectedPaths: c.expectedPaths,
            },
          ],
        }),
      );
    const tariff = await lab.createTariff(owner.id, project, {
      provider: 'ollama',
      model: 'fixture-chat',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      verifiedOn: '2026-01-01',
      source: 'https://example.test/simulated-rate',
      inputPerMillion: 1,
      cachedInputPerMillion: 0.25,
      outputPerMillion: 2,
      notes: 'Synthetic fixture rate; not real billing.',
    });
    const make = (ids = cases.map((c) => c.id), repetitions = 2) =>
      labBatchInput.parse({
        requestId: randomUUID(),
        title: 'E10 simulated existing evaluation',
        caseIds: ids,
        contextExperiment: 'ferweb-context-v1',
        targets: ['wide-v1', 'retrieval-v1', 'summary-v1', 'reuse-v1'].map((contextStrategy) => ({
          provider: 'ollama',
          model: 'fixture-chat',
          configuration: { maxOutputTokens: 512 },
          tariffId: tariff.id,
          cacheLabel: 'unspecified',
          contextStrategy,
        })),
        repetitions,
        environment: 'Simulated; no model performance conclusion',
        allowExternal: false,
      });
    const finish = async (id: string) => {
      for (let n = 0; n < 500; n++) {
        const result = await lab.detail(owner.id, project, id);
        if (!['draft', 'running'].includes(result.batch.status)) return result;
        await delay(100);
      }
      throw Error('Context fixture timeout');
    };
    let primary: Awaited<ReturnType<typeof lab.detail>>;
    await t.test(
      'same existing cases/corpus/models, 40 paired runs; summaries and cache creation are charged, usage unknown stays unknown',
      async () => {
        const input = make(),
          created = await lab.createBatch(owner.id, project, input);
        assert.equal(created.batch.runs.length, 40);
        assert.equal(created.batch.conditions.contextPlan?.simulated, true);
        assert.equal((await lab.createBatch(owner.id, project, input)).batch.id, created.batch.id);
        assert.equal(
          created.batch.runs.every((r) => r.status === 'pending'),
          true,
        );
        await lab.start(owner.id, project, created.batch.id, sessionHash);
        primary = await finish(created.batch.id);
        assert.equal(primary.batch.status, 'completed');
        assert.ok(
          primary.batch.runs.every((r) => r.status === 'completed'),
          JSON.stringify(
            primary.batch.runs
              .filter((r) => r.status !== 'completed')
              .map((r) => ({ ordinal: r.ordinal, code: r.errorCode })),
          ),
        );
        const report = contextComparisonResponse.parse(
          await lab.contextComparison(owner.id, project, created.batch.id),
        );
        assert.equal(report.valid, true);
        assert.equal(report.report.simulated, true);
        assert.equal(report.report.rows.length, 4);
        assert.ok(report.report.rows[2]!.summaryCalls > 0);
        assert.ok(report.report.rows[3]!.resultCacheHits >= 4);
        assert.equal(report.report.rows[3]!.creationCostsIncluded, true);
        for (const row of report.report.rows) assert.equal(row.totalCostUsd, null);
        const summarized = primary.batch.runs.find(
          (r) => r.target === 2 && r.contextMetrics?.operations.some((o) => o.kind === 'summary'),
        )!;
        const total = contextTotals(summarized)!;
        assert.equal(total.allInferenceInputTokens, null);
        assert.ok(total.generationTokens! > summarized.usage.inputTokens!);
        assert.equal(total.estimatedTextCostUsd, null);
        const repeated = primary.batch.runs.find((r) => r.contextMetrics?.reuseStatus === 'hit')!;
        assert.equal(contextTotals(repeated)!.generationTokens, 0);
        assert.equal(repeated.usage.inputTokens, null);
        assert.ok(repeated.contextMetrics!.reusedFrom);
        const ledger = JSON.stringify(summarized.contextMetrics!.operations.map((o) => o.messages));
        for (const c of cases) assert.ok(!ledger.includes(c.criteria[0]!.description));
        const exported = JSON.parse(await lab.export(owner.id, project, created.batch.id, 'json'));
        assert.ok(exported.batch.runs[0].contextMetrics.operations.length);
        const csv = await lab.export(owner.id, project, created.batch.id, 'csv');
        assert.match(csv, /context_operations/);
        await writeFile(
          '/app/evaluations/e10-context-evaluation.json',
          JSON.stringify(
            {
              notice: 'SIMULATED ONLY. No measured real AI savings.',
              evaluation,
              report,
              batch: primary.batch,
            },
            null,
            2,
          ),
        );
      },
    );
    await t.test(
      'foreign scope, changed conditions and unreviewed/simulated evidence cannot adopt a policy',
      async () => {
        const root = `/projects/${project}/lab`;
        assert.equal(
          (
            await request(
              'GET',
              `${root}/batches/${primary.batch.id}/context-comparison`,
              undefined,
              foreign,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              'POST',
              `${root}/context-policy`,
              { batchId: primary.batch.id, target: 3, metric: 'latency', version: 0 },
              foreign,
            )
          ).status,
          404,
        );
        const invalid = make([cases[0]!.id], 1);
        invalid.targets[1]!.configuration.maxOutputTokens = 123;
        await assert.rejects(
          lab.createBatch(owner.id, project, invalid),
          (e: unknown) => (e as { code: string }).code === 'context_conditions',
        );
        for (const run of primary.batch.runs)
          await lab.review(owner.id, project, primary.batch.id, run.id, {
            version: 0,
            accepted: true,
            score: 4,
            verdicts: ['pass'],
            notes: 'Test-only review of synthetic answer/source.',
          });
        primary = await lab.detail(owner.id, project, primary.batch.id);
        const adoption = await request(
          'POST',
          `${root}/context-policy`,
          { batchId: primary.batch.id, target: 3, metric: 'generation_tokens', version: 0 },
          cookie,
        );
        assert.equal(adoption.status, 409);
        assert.match((await adoption.json()).error.message, /simulated_evidence/);
        assert.equal((await lab.contextPolicy(owner.id, project)).policy, null);
        const realShape = structuredClone(primary.batch);
        realShape.conditions.contextPlan!.simulated = false;
        assert.equal(adoptionEvidence(realShape, 3, 'generation_tokens').eligible, true);
        realShape.runs.find((r) => r.target === 3)!.reviews.at(-1)!.score = 1;
        assert.ok(
          adoptionEvidence(realShape, 3, 'generation_tokens').reasons.includes(
            'quality_regression_or_rejection',
          ),
        );
        assert.equal(adoptionEvidence(realShape, 3, 'text_cost').eligible, false);
      },
    );
    await t.test(
      'chat wiring uses only a server-approved policy and invalidates changed reviews; simulated policy is seeded only by this test',
      async () => {
        const target = 3,
          versions = primary.batch.runs
            .filter((r) => r.target === 0 || r.target === target)
            .map((r) => ({ id: r.id, review_version: r.reviewVersion, status: r.status }));
        await pool.query('INSERT INTO context_policies(project_id,selection) VALUES($1,$2)', [
          project,
          JSON.stringify({
            batchId: primary.batch.id,
            target,
            strategy: 'reuse-v1',
            metric: 'generation_tokens',
            fingerprint: primary.batch.conditions.contextPlan!.corpus.fingerprint,
            adoptedAt: new Date().toISOString(),
            reviewStateHash: digest(versions),
            plan: primary.batch.conditions.contextPlan,
            modelTarget: primary.batch.conditions.targets[target],
          }),
        ]);
        const conversation = await chat.create(owner.id, project, {
          title: 'Policy fixture',
          provider: 'ollama',
          model: 'fixture-chat',
          configuration: { maxOutputTokens: 512 },
        });
        const initial = await chat.begin(owner.id, project, conversation.conversation.id, {
          requestId: randomUUID(),
          version: 0,
          content: evaluation[0]!.question,
          repositoryContext: true,
        });
        assert.ok(initial.optimization);
        const answer = await chat.generate(
          owner.id,
          project,
          initial,
          sessionHash,
          () => {},
          () => false,
        );
        assert.equal(answer.status, 'completed');
        assert.equal(answer.contextMetrics?.strategy, 'reuse-v1');
        assert.ok(answer.contextMetrics?.operations.length);
        const r = primary.batch.runs.find((r) => r.target === target)!;
        await lab.review(owner.id, project, primary.batch.id, r.id, {
          version: 1,
          accepted: false,
          score: 1,
          verdicts: ['fail'],
          notes: 'Changed evidence',
        });
        await assert.rejects(
          chat.begin(owner.id, project, conversation.conversation.id, {
            requestId: randomUUID(),
            version: 1,
            content: evaluation[0]!.question,
            repositoryContext: true,
          }),
          (e: unknown) => (e as { code: string }).code === 'context_strategy_invalidated',
        );
        await lab.resetContextPolicy(owner.id, project, 1);
        assert.equal((await lab.contextPolicy(owner.id, project)).version, 2);
        await assert.rejects(lab.resetContextPolicy(owner.id, project, 1));
      },
    );
    await t.test(
      'unknown model revisions disable result reuse; failed summaries and missing usage remain in the ledger',
      async () => {
        const original = ai.catalog.bind(ai);
        ai.catalog = async (p) => ({
          ...(await original(p)),
          models: [{ id: 'fixture-chat', revision: null }],
        });
        try {
          const batch = await lab.createBatch(owner.id, project, make([cases[0]!.id], 2));
          await lab.start(owner.id, project, batch.batch.id, sessionHash);
          const result = await finish(batch.batch.id);
          assert.equal(
            result.batch.runs
              .filter((r) => r.target === 3)
              .every((r) => r.contextMetrics?.reuseStatus === 'unsupported_revision'),
            true,
          );
        } finally {
          ai.catalog = original;
        }
        const c = await lab.createCase(owner.id, project, {
          title: 'Summary failure',
          question: 'fixture-context-summary-error',
          context: 'Synthetic context for summarization.',
          repositoryContext: false,
          criteria: [{ description: 'Record failure', expectedText: '' }],
        });
        const batch = await lab.createBatch(owner.id, project, make([c.id], 1));
        await lab.start(owner.id, project, batch.batch.id, sessionHash);
        const result = await finish(batch.batch.id);
        const failed = result.batch.runs.find((r) => r.target === 2)!;
        assert.equal(failed.status, 'error');
        assert.equal(
          failed.contextMetrics?.operations.find((o) => o.kind === 'summary')?.usage.inputTokens,
          null,
        );
        assert.equal(contextTotals(failed)?.generationTokens, null);
      },
    );
    await t.test(
      'permission loss between remote access checks cannot expose the frozen corpus',
      async () => {
        let installations = 0;
        const transport = async (
          input: Parameters<typeof fetch>[0],
          options?: Parameters<typeof fetch>[1],
        ) => {
          const response = await fixture.transport(input, options);
          if (new URL(String(input)).pathname === '/user/installations' && ++installations === 2) {
            const data = await response.json();
            data.installations[0].permissions = { metadata: 'read' };
            return new Response(JSON.stringify(data), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return response;
        };
        const checked = new RetrievalService(
          pool,
          new GitHubService(pool, fixture.config, transport),
          ai,
          new VectorStore(config.QDRANT_URL, prefix),
        );
        await assert.rejects(
          checked.optimizationSnapshot(owner.id, project),
          (e: unknown) => (e as { code: string }).code === 'github_access_denied',
        );
      },
    );
    await t.test(
      'cancellation reaches an auxiliary summary and keeps unknown usage plus partial output',
      async () => {
        const c = await lab.createCase(owner.id, project, {
          title: 'Cancel summary',
          question: 'fixture-context-cancel',
          context: 'Manual context for an auxiliary summary.',
          repositoryContext: false,
          criteria: [{ description: 'Cancellation evidence', expectedText: '' }],
        });
        const value = await lab.createBatch(owner.id, project, make([c.id], 1));
        await lab.start(owner.id, project, value.batch.id, sessionHash);
        let observed = false;
        for (let n = 0; n < 100; n++) {
          const state = await lab.detail(owner.id, project, value.batch.id);
          if (
            state.batch.runs.some(
              (r) =>
                r.target === 2 &&
                r.contextMetrics?.operations.some(
                  (o) => o.kind === 'summary' && o.status === 'running',
                ),
            )
          ) {
            observed = true;
            break;
          }
          await delay(50);
        }
        assert.ok(observed);
        await lab.cancel(owner.id, project, value.batch.id);
        const stopped = await finish(value.batch.id);
        assert.equal(stopped.batch.status, 'cancelled');
        const op = stopped.batch.runs
          .find((r) => r.target === 2)!
          .contextMetrics!.operations.find((o) => o.kind === 'summary')!;
        assert.equal(op.status, 'error');
        assert.equal(op.usage.inputTokens, null);
        for (let n = 0; n < 40; n++) {
          const active = await (await fetch(process.env.AI_TEST_URL! + '/fixture/active')).json();
          if (active.active === 0) return;
          await delay(50);
        }
        assert.fail('Auxiliary generation still active after cancellation');
      },
    );
    await t.test(
      'source/config/permission changes invalidate warm results and adoption; new experiment starts cold',
      async () => {
        const fingerprint = primary.batch.conditions.contextPlan!.corpus.fingerprint;
        const original = ai.catalog.bind(ai);
        ai.catalog = async (p) => ({
          ...(await original(p)),
          configurationRevision: 'different-config',
        });
        try {
          const input = make([cases[0]!.id], 1),
            batch = await lab.createBatch(owner.id, project, input);
          ai.catalog = original;
          await assert.rejects(
            lab.start(owner.id, project, batch.batch.id, sessionHash),
            (e: unknown) => (e as { code: string }).code === 'context_configuration_changed',
          );
        } finally {
          ai.catalog = original;
        }
        addSource(fixture, 'docs/new.md', 'New context source; authentication cookie changed.');
        fixture.state.commit = 'b'.repeat(40);
        const link = (await github.read(owner.id, project)).link!;
        await github.sync(owner.id, project, link.version);
        await retrieval.index(owner.id, project);
        assert.notEqual(
          (await retrieval.optimizationSnapshot(owner.id, project)).fingerprint,
          fingerprint,
        );
        assert.equal(
          (await lab.contextComparison(owner.id, project, primary.batch.id)).valid,
          false,
        );
        const fresh = await lab.createBatch(owner.id, project, make([cases[0]!.id], 1));
        await lab.start(owner.id, project, fresh.batch.id, sessionHash);
        const result = await finish(fresh.batch.id);
        assert.equal(
          result.batch.runs.find((r) => r.target === 3)?.contextMetrics?.reuseStatus,
          'miss',
        );
        fixture.state.denied = true;
        await assert.rejects(lab.detail(owner.id, project, fresh.batch.id));
      },
    );
  } finally {
    lab.shutdown();
    chat.shutdown();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((e) => (e ? reject(e) : resolve())),
      );
    const collections = await (await fetch(`${config.QDRANT_URL}/collections`)).json();
    for (const c of collections.result.collections)
      if (c.name.startsWith(prefix + '_'))
        await fetch(`${config.QDRANT_URL}/collections/${c.name}`, { method: 'DELETE' });
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
