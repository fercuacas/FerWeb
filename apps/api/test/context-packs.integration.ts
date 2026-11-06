import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  contextReceiptResponse,
  hybridResponse,
  contextCatalog,
  skillManifest,
  contextComparisonResponse,
  type ContextReceiptReference,
} from '@ferweb/contracts';
import { createPool } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { inspectDatabase } from '../src/health.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { GitHubService } from '../src/modules/github/service.js';
import { RetrievalService } from '../src/modules/retrieval/service.js';
import { VectorStore } from '../src/modules/retrieval/vector-store.js';
import { AiClient } from '../src/modules/chat/client.js';
import { CodingService } from '../src/modules/jobs/coding-service.js';
import { RunnerClient } from '../src/modules/jobs/runner-client.js';
import { LaboratoryService } from '../src/modules/laboratory/service.js';
import { SkillLibrary } from '../src/modules/skills/library.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { retrievalCorpus, addSource } from '../../../tests/fixtures/retrieval.mjs';
import { skillManifestFixture } from '../../../tests/fixtures/skills.mjs';
import { createDatabaseAdmin } from './database-admin.js';
test('P10 context packs: hybrid catalog, deterministic selection, immutable receipts and paired evaluation', async (t) => {
  const config = readConfig(),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    prefix = `ferweb_p10_${randomUUID().replaceAll('-', '')}`,
    admin = createDatabaseAdmin(config),
    pool = createPool({ ...config, POSTGRES_DB: database }),
    ai = new AiClient(process.env.AI_TEST_URL!, process.env.AI_TEST_TOKEN!);
  const fixture = retrievalCorpus(githubFixture()),
    github = new GitHubService(pool, fixture.config, fixture.transport),
    retrieval = new RetrievalService(pool, github, ai, new VectorStore(config.QDRANT_URL, prefix)),
    coding = new CodingService(
      pool,
      github,
      new RunnerClient(process.env.RUNNER_URL!, process.env.RUNNER_SERVICE_TOKEN!),
    ),
    lab = new LaboratoryService(pool, ai, retrieval),
    library = new SkillLibrary(pool),
    origin = 'http://127.0.0.1:5173';
  addSource(
    fixture,
    'docs/development.md',
    '# Project map\nPurpose: test authenticated user lookups.\nModules: src/query.ts.\nTests: tests/query.test.ts.',
  );
  addSource(
    fixture,
    'src/query.ts',
    'export function buildFindUserQuery(id) { return id; }\n// connection refused: local database is required.',
  );
  addSource(
    fixture,
    'tests/query.test.ts',
    '// Verify buildFindUserQuery with a project-scoped user.',
  );
  let server: import('node:http').Server | undefined,
    created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'packs@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'foreign-packs@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
      await pool.query(
        "INSERT INTO projects(owner_id,name,description) VALUES($1,'P10 project','Authenticated user lookup service') RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;
    const second = (
      await pool.query(
        "INSERT INTO projects(owner_id,name) VALUES($1,'P10 isolated') RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      github,
      retrieval,
      coding,
      laboratory: lab,
      runnerToken: process.env.RUNNER_SERVICE_TOKEN!,
      appOrigin: origin,
      secureCookies: false,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    const request = (method: string, path: string, body?: unknown, cookie?: string) =>
      fetch(base + path, {
        method,
        headers: {
          Origin: origin,
          'X-FerWeb-Request': '1',
          'Content-Type': 'application/json',
          ...(cookie && { Cookie: cookie }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    async function login(email: string) {
      const r = await request('POST', '/auth/login', { email, password });
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie')!.split(';')[0]!;
    }
    const cookie = await login(owner.email),
      foreign = await login('foreign-packs@ferweb.test');
    const auth = await github.start(owner.id, cookie.split('=')[1]!);
    await github.callback(new URL(auth.url).searchParams.get('state')!, 'fixture-code');
    await github.connect(owner.id, 71);
    await github.link(owner.id, project, { installationId: 71, repositoryId: 101, version: 0 });
    await github.sync(owner.id, project, 1);
    const path = `/projects/${project}/context-packs`,
      packs = coding.contextPacks!;
    const task = (
      await pool.query(
        "INSERT INTO tasks(project_id,title,description,priority,status,acceptance_criteria) VALUES($1,'Find users in TypeScript','Implement authenticated user lookup.','medium','todo','[\"Use a scoped query\"]') RETURNING id,version",
        [project],
      )
    ).rows[0];
    const manifest = skillManifestFixture('TypeScript user lookup reference.');
    const ts = await library.import(owner.id, project, {
      manifest: skillManifest.parse({
        ...manifest,
        slug: 'typescript',
        name: 'TypeScript',
        technologies: ['typescript'],
        description: 'Typed functions and user lookups.',
      }),
    });
    await library.review(owner.id, project, ts.id, { sha256: ts.sha256, state: 'approved' });
    let first: ContextReceiptReference;
    const prepare = async (extra: Record<string, unknown> = {}) => {
      const response = await request(
        'POST',
        path + '/prepare',
        {
          requestId: randomUUID(),
          taskId: task.id,
          taskVersion: task.version,
          profile: 'lean',
          mode: 'suggested',
          explicitSkillIds: [],
          excludedSkillIds: [],
          memory: [],
          includeMemory: false,
          query: 'typescript user lookup',
          ...extra,
        },
        cookie,
      );
      assert.equal(response.status, 201, await response.clone().text());
      return contextReceiptResponse.parse(await response.json()).receipt;
    };
    await t.test(
      'incremental SQL catalog exports hashes, excludes private files and ranks identifiers, errors and meaning',
      async () => {
        await retrieval.index(owner.id, project);
        const again = await retrieval.index(owner.id, project);
        assert.equal(again.embeddedChunks, 0);
        assert.ok(again.reusedDocuments > 0);
        const exported = await request(
          'POST',
          `/projects/${project}/context/catalog/export`,
          {},
          cookie,
        );
        assert.equal(exported.status, 200);
        const catalog = contextCatalog.parse(await exported.json());
        assert.ok(catalog.documents.some((d) => d.path === 'docs/development.md'));
        assert.ok(
          !catalog.documents.some(
            (d) =>
              d.path.includes('.env') ||
              d.path === 'credentials.json' ||
              d.path.startsWith('dist/'),
          ),
        );
        assert.ok(
          catalog.documents
            .flatMap((d) => d.chunks)
            .every((c) => c.hash.length === 64 && c.content !== undefined),
        );
        for (const query of ['`buildFindUserQuery`', 'src/query.ts', '"connection refused"']) {
          const found = hybridResponse.parse(
            await (
              await request('POST', `/projects/${project}/context/hybrid/search`, { query }, cookie)
            ).json(),
          );
          assert.equal(found.strategy, 'hybrid-rrf-v1');
          if (query === '`buildFindUserQuery`') {
            // Both the definition and its test contain the exact identifier.
            assert.ok(found.sources.some((source) => source.path === 'src/query.ts'));
            assert.ok(found.hits[0]!.reason.some((reason) => reason.startsWith('exact')));
          } else assert.equal(found.sources[0]!.path, 'src/query.ts');
          assert.equal(found.sources[0]!.commit, 'a'.repeat(40));
        }
        const semantic = await retrieval.hybrid(
          owner.id,
          project,
          'How is login authenticated with a cookie?',
        );
        assert.ok(semantic.sources.some((s) => s.path === 'docs/auth.md'));
        assert.ok(semantic.hits.some((h) => h.reason.includes('vector')));
        assert.equal(semantic.simulated, true);
        const unavailable = new RetrievalService(
          pool,
          github,
          new AiClient('', ''),
          new VectorStore(config.QDRANT_URL, prefix),
        );
        const lexical = await unavailable.hybrid(owner.id, project, '`buildFindUserQuery`');
        assert.equal(lexical.strategy, 'lexical-v1');
        assert.equal(lexical.fallback, 'embedding_unavailable');
        assert.equal(lexical.sources[0]!.path, 'src/query.ts');
        assert.equal(lexical.embeddingUsed, false);
      },
    );
    await t.test(
      'map reuses versioned documentation and suggested skills are never silently applied',
      async () => {
        const draft = await packs.draftMap(owner.id, project);
        assert.ok(draft.paths.includes('docs/development.md'));
        assert.match(draft.markdown, /Propósito/);
        await packs.saveMap(owner.id, project, {
          version: 0,
          markdown: draft.markdown,
          paths: draft.paths,
        });
        const suggested = await prepare();
        assert.equal(suggested.snapshot.payload.skills.length, 0);
        assert.ok(suggested.snapshot.choices.some((c) => c.skill.id === ts.id && !c.applied));
        assert.ok(
          suggested.snapshot.payload.map.sources.some((s) => s.path === 'docs/development.md'),
        );
        assert.equal(suggested.observedTokens.input, null);
        assert.equal(suggested.knownCostUsd, null);
        assert.ok(suggested.bytes <= 24000);
        first = { id: suggested.id, hash: suggested.hash };
        const automatic = await prepare({ mode: 'automatic' });
        assert.ok(automatic.snapshot.choices.some((c) => c.skill.id === ts.id && c.applied));
        const again = await prepare({ mode: 'automatic' });
        assert.deepEqual(
          again.snapshot.choices.map((c) => [c.skill.id, c.applied]),
          automatic.snapshot.choices.map((c) => [c.skill.id, c.applied]),
        );
        assert.ok(automatic.snapshot.sourceHashes[automatic.snapshot.payload.sources[0]!.id]);
        assert.equal(
          (await request('GET', path + '/receipts/' + first.id, undefined, foreign)).status,
          404,
        );
        assert.equal(
          (
            await request(
              'GET',
              `/projects/${second}/context-packs/receipts/${first.id}`,
              undefined,
              cookie,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'explicit-only and exclusions survive automatic ranking; policy and map updates invalidate reuse',
      async () => {
        const policy = await packs.policy(owner.id, project);
        await packs.savePolicy(owner.id, project, {
          version: policy.version,
          rules: [
            {
              id: ts.id,
              profiles: ['lean', 'full'],
              explicitOnly: true,
              dependsOn: [],
              excludes: [],
              keywordsEs: ['usuarios'],
              keywordsEn: ['users'],
            },
          ],
        });
        assert.equal((await packs.read(owner.id, project, first.id)).valid, false);
        await assert.rejects(packs.assertCurrent(owner.id, project, first));
        const automatic = await prepare({ mode: 'automatic' });
        assert.ok(!automatic.snapshot.choices.some((c) => c.skill.id === ts.id && c.applied));
        const explicit = await prepare({ mode: 'manual', explicitSkillIds: [ts.id] });
        assert.ok(explicit.snapshot.payload.skills.some((s) => s.id === ts.id));
        const excluded = await prepare({ mode: 'automatic', excludedSkillIds: [ts.id] });
        assert.ok(!excluded.snapshot.payload.skills.length);
        const map = (await packs.map(owner.id, project))!;
        await packs.saveMap(owner.id, project, {
          version: map.version,
          markdown: map.markdown + '\nAdditional test entry.',
          paths: map.sources.map((s) => s.path),
        });
        assert.equal((await packs.read(owner.id, project, explicit.id)).valid, false);
        const r = await request(
          'PUT',
          path + '/map',
          { version: map.version, markdown: 'Old concurrent edit', paths: [] },
          cookie,
        );
        assert.equal(r.status, 409);
      },
    );
    await t.test(
      'current memory is delivered with revisions; corrections and task edits invalidate receipts',
      async () => {
        const entry = {
          kind: 'handoff' as const,
          title: 'TypeScript user lookup handoff',
          content: 'Use the scoped TypeScript user lookup. Unreviewed handoff marker.',
          observedAt: new Date().toISOString(),
          status: 'active' as const,
          tags: ['typescript'],
          targets: ['implementer'],
          lesson: null,
          sources: [],
        };
        const saved = await coding.memory.create(owner.id, project, randomUUID(), entry);
        const receipt = await prepare({ mode: 'automatic', includeMemory: true });
        assert.equal(receipt.snapshot.payload.memory[0]!.id, saved.selection.id);
        await coding.memory.correct(owner.id, project, saved.selection.id, 1, {
          ...entry,
          content: 'Corrected TypeScript user lookup handoff.',
        });
        assert.equal((await packs.read(owner.id, project, receipt.id)).valid, false);
        await assert.rejects(
          packs.assertCurrent(owner.id, project, { id: receipt.id, hash: receipt.hash }),
        );
        const corrected = await prepare({ mode: 'automatic', includeMemory: true });
        assert.equal(corrected.snapshot.payload.memory[0]!.revision, 2);
        await pool.query('UPDATE tasks SET version=version+1 WHERE id=$1', [task.id]);
        assert.equal((await packs.read(owner.id, project, corrected.id)).valid, false);
        await pool.query('UPDATE tasks SET version=version-1 WHERE id=$1', [task.id]);
      },
    );
    await t.test(
      'E10 pairs vector/hybrid/hybrid-memory conditions and never adopts simulated improvements',
      async () => {
        const cases = [];
        for (const question of [
          '`buildFindUserQuery`',
          'How is login authenticated with a cookie?',
        ])
          cases.push(
            await lab.createCase(owner.id, project, {
              title: question,
              question,
              context: 'Compare the frozen repository.',
              criteria: [
                {
                  description: 'Relevant source and test references',
                  expectedText: '',
                  expectedPaths: question.startsWith('`')
                    ? ['src/query.ts', 'tests/query.test.ts']
                    : ['docs/auth.md'],
                },
              ],
              repositoryContext: false,
            }),
          );
        const catalog = await ai.catalog('ollama'),
          model = catalog.models[0]!.id;
        const batch = await lab.createBatch(owner.id, project, {
          requestId: randomUUID(),
          title: 'P10 hybrid evaluation',
          caseIds: cases.map((c) => c.id),
          contextExperiment: 'ferweb-context-p10-v1',
          targets: (['retrieval-v1', 'hybrid-v1', 'hybrid-memory-v1'] as const).map(
            (contextStrategy) => ({
              provider: 'ollama' as const,
              model,
              configuration: { maxOutputTokens: 256 },
              tariffId: null,
              cacheLabel: 'unspecified' as const,
              contextStrategy,
            }),
          ),
          repetitions: 1,
          environment: 'Simulated local providers; real SQL and Qdrant.',
          allowExternal: false,
        });
        const session = cookie.split('=')[1]!;
        const { tokenHash } = await import('../src/modules/identity/sessions.js');
        await lab.start(owner.id, project, batch.batch.id, tokenHash(session));
        let done = await lab.detail(owner.id, project, batch.batch.id);
        const deadline = Date.now() + 30000;
        while (done.batch.status === 'running' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          done = await lab.detail(owner.id, project, batch.batch.id);
        }
        assert.equal(
          done.batch.status,
          'completed',
          JSON.stringify(done.batch.runs.map((r) => ({ status: r.status, code: r.errorCode }))),
        );
        assert.ok(
          done.batch.runs.every((r) => r.status === 'completed'),
          JSON.stringify(done.batch.runs.map((r) => ({ status: r.status, code: r.errorCode }))),
        );
        assert.equal(done.batch.runs.length, 6);
        assert.ok(done.batch.runs.every((r) => r.contextMetrics?.retrieval));
        assert.ok(
          done.batch.runs
            .filter((r) => r.target === 2)
            .every((r) => r.contextMetrics?.operations.some((o) => o.kind === 'memory_lookup')),
        );
        const comparison = contextComparisonResponse.parse(
          await lab.contextComparison(owner.id, project, batch.batch.id),
        );
        assert.equal(comparison.report.simulated, true);
        assert.equal(comparison.report.rows[0]!.strategy, 'retrieval-v1');
        assert.equal(comparison.report.rows[1]!.totalCostUsd, null);
        assert.ok(comparison.report.rows[1]!.expectedPathCoverage !== null);
        assert.ok(comparison.adoption.every((a) => !a.eligible));
        const memories = (await coding.memory.search(owner.id, project, { query: '', cursor: 0 }))
          .entries;
        const m = memories.find((m) => m.kind === 'handoff')!;
        await coding.memory.correct(owner.id, project, m.id, m.revision, {
          kind: m.kind,
          title: m.title,
          content: 'Another corrected user lookup note.',
          observedAt: m.observedAt,
          status: m.status,
          tags: m.tags,
          targets: m.targets,
          lesson: m.lesson,
          sources: m.sources,
        });
        assert.equal((await lab.contextComparison(owner.id, project, batch.batch.id)).valid, false);
      },
    );
    await t.test(
      'source withdrawal hides receipts and archive forbids preparing or updating context',
      async () => {
        const receipt = await prepare({ query: '`buildFindUserQuery`' });
        fixture.state.extraFiles = fixture.state.extraFiles.filter(
          (f) => f.path !== 'src/query.ts',
        );
        const link = (await github.read(owner.id, project)).link!;
        await github.sync(owner.id, project, link.version);
        assert.equal(
          (await request('GET', path + '/receipts/' + receipt.id, undefined, cookie)).status,
          403,
        );
        fixture.state.denied = true;
        assert.equal(
          (await request('GET', path + '/receipts/' + first.id, undefined, cookie)).status,
          403,
        );
        fixture.state.denied = false;
        await github.connect(owner.id, 71);
        const restored = (await github.read(owner.id, project)).link!;
        await github.sync(owner.id, project, restored.version);
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [project]);
        const overview = await request('GET', path, undefined, cookie);
        assert.equal(overview.status, 200);
        const denied = await request(
          'POST',
          path + '/prepare',
          {
            requestId: randomUUID(),
            taskId: task.id,
            taskVersion: 1,
            profile: 'lean',
            mode: 'manual',
            explicitSkillIds: [],
            excludedSkillIds: [],
            memory: [],
            includeMemory: false,
          },
          cookie,
        );
        assert.equal(denied.status, 409);
      },
    );
  } finally {
    lab.shutdown();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((e) => (e ? reject(e) : resolve())),
      );
    const collections = await (await fetch(config.QDRANT_URL + '/collections')).json();
    for (const c of collections.result.collections)
      if (c.name.startsWith(prefix + '_'))
        await fetch(config.QDRANT_URL + '/collections/' + c.name, { method: 'DELETE' });
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
