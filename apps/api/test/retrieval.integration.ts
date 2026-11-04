import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { createDatabaseAdmin } from './database-admin.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { GitHubService } from '../src/modules/github/service.js';
import { CredentialCipher } from '../src/modules/github/crypto.js';
import { AiClient } from '../src/modules/chat/client.js';
import { ChatService } from '../src/modules/chat/service.js';
import { RetrievalService } from '../src/modules/retrieval/service.js';
import { VectorStore } from '../src/modules/retrieval/vector-store.js';
import { fragment, indexable } from '../src/modules/retrieval/chunking.js';
import { inspectDatabase } from '../src/health.js';
import { createApp } from '../src/app.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { retrievalCorpus, addSource } from '../../../tests/fixtures/retrieval.mjs';

test('repository retrieval: real Qdrant, PostgreSQL and Python with simulated upstream providers', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool({ ...config, POSTGRES_DB: database }),
    prefix = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const vectors = new VectorStore(config.QDRANT_URL, prefix),
    ai = new AiClient(process.env.AI_TEST_URL!, process.env.AI_TEST_TOKEN!);
  const fixture = retrievalCorpus(githubFixture()),
    github = new GitHubService(pool, fixture.config, fixture.transport);
  const retrieval = new RetrievalService(pool, github, ai, vectors),
    chats = new ChatService(pool, ai, retrieval);
  let created = false,
    server: import('node:http').Server | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'retrieval@ferweb.test', password });
    const other = (
      await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2) RETURNING id', [
        'foreign@ferweb.test',
        await hashPassword(password),
      ])
    ).rows[0].id;
    const project = (
      await pool.query("INSERT INTO projects(owner_id,name) VALUES($1,'Retrieval') RETURNING id", [
        owner.id,
      ])
    ).rows[0].id;
    const second = (
      await pool.query("INSERT INTO projects(owner_id,name) VALUES($1,'Separate') RETURNING id", [
        owner.id,
      ])
    ).rows[0].id;
    await pool.query(
      "INSERT INTO github_connections(owner_id,github_user_id,login,encrypted_token) VALUES($1,501,'fixture',$2)",
      [
        owner.id,
        new CredentialCipher(fixture.config.encryptionKey).encrypt('ghu_fixture_only', owner.id),
      ],
    );
    await github.connect(owner.id, 71);
    const link = await github.link(owner.id, project, {
      installationId: 71,
      repositoryId: 101,
      version: 0,
    });
    await github.sync(owner.id, project, link.link.version);
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      appOrigin: origin,
      secureCookies: false,
      github,
      retrieval,
      chats,
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
          'X-FerWeb-Request': '1',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    const signed = await request('POST', '/auth/login', { email: owner.email, password });
    const cookie = signed.headers.get('set-cookie')!.split(';')[0]!;
    const foreign = (
      await request('POST', '/auth/login', { email: 'foreign@ferweb.test', password })
    ).headers
      .get('set-cookie')!
      .split(';')[0]!;
    const root = `/projects/${project}/context`;
    let firstIds: string[] = [];
    await t.test(
      'permissions, deterministic chunks, exclusions and durable publication',
      async () => {
        assert.equal((await request('POST', root + '/index', {})).status, 401);
        assert.equal((await request('POST', root + '/index', {}, foreign)).status, 404);
        assert.equal(
          (await request('POST', root + '/search', { query: 'secret' }, foreign)).status,
          404,
        );
        for (const path of [
          '.env.local',
          'secrets/a.md',
          'dist/a.ts',
          'credentials.json',
          'node_modules/a.js',
          'key.pem',
        ])
          assert.equal(indexable(path), false, path);
        const parts = fragment('header\n' + 'x'.repeat(5000) + '\nfooter');
        assert.ok(parts.every((c) => c.content.length <= 2400));
        assert.equal(parts.at(-1)!.endLine, 3);
        const indexed = await request('POST', root + '/index', {}, cookie);
        assert.equal(indexed.status, 200);
        const result = await indexed.json();
        assert.equal(result.documents, 6);
        assert.equal(result.embeddedChunks, 6);
        assert.equal(result.stale, false);
        const docs = (
          await pool.query('SELECT path FROM repository_documents WHERE project_id=$1', [project])
        ).rows;
        assert.equal(
          docs.some((row) => /secret|dist\/|credentials|\.env/.test(row.path)),
          false,
        );
        firstIds = (
          await pool.query(
            'SELECT c.id FROM repository_chunks c JOIN repository_documents d ON d.id=c.document_id WHERE d.project_id=$1 ORDER BY c.id',
            [project],
          )
        ).rows.map((r) => r.id);
        const restored = new RetrievalService(pool, github, ai, vectors);
        assert.equal((await restored.status(owner.id, project)).documents, 6);
      },
    );
    await t.test(
      'evaluation questions: expected source at rank 1, no evidence abstention, project and repository filters',
      async () => {
        const cases = JSON.parse(
          await readFile(
            new URL('../../../tests/fixtures/retrieval-evaluation.json', import.meta.url),
            'utf8',
          ),
        ) as { question: string; expectedPaths: string[] }[];
        let hits = 0;
        for (const item of cases) {
          const result = await retrieval.search(owner.id, project, item.question);
          if (item.expectedPaths.length) {
            assert.ok(
              item.expectedPaths.includes(result.sources[0]?.path ?? ''),
              JSON.stringify(result),
            );
            hits++;
          } else {
            assert.equal(result.insufficient, true);
          }
        }
        assert.equal(hits, 4);
        const linked = await github.link(owner.id, second, {
          installationId: 71,
          repositoryId: 101,
          version: 0,
        });
        await github.sync(owner.id, second, linked.link.version);
        await retrieval.index(owner.id, second);
        const result = await retrieval.search(owner.id, second, 'autenticación cookie');
        assert.ok(result.sources.length);
        assert.ok(result.sources.every((s) => s.projectId === second));
        const status = await retrieval.status(owner.id, project);
        assert.equal(status.documents, 6);
        assert.equal(
          (await request('GET', `/projects/${randomUUID()}/context`, undefined, cookie)).status,
          404,
        );
        assert.equal(
          (await request('POST', root + '/search', { query: 'hola', projectId: second }, cookie))
            .status,
          400,
        );
      },
    );
    await t.test(
      'unchanged sync reuses embeddings; changed file and issue only, deletes stale chunks and rejects stale indexes',
      async () => {
        const again = await retrieval.index(owner.id, project);
        assert.equal(again.embeddedChunks, 0);
        assert.equal(again.reusedDocuments, 6);
        fixture.state.commit = 'd'.repeat(40);
        fixture.state.issueBody = 'Los permisos de acceso se validan en servidor.';
        addSource(
          fixture,
          'docs/auth.md',
          '# Autenticación nueva\nLa sesión usa una cookie HttpOnly y expira en ocho horas.\nLa contraseña usa scrypt.',
        );
        fixture.state.extraFiles = fixture.state.extraFiles.filter(
          (f: { path: string }) => f.path !== 'src/tasks.ts',
        );
        const current = await github.read(owner.id, project);
        await github.sync(owner.id, project, current.link!.version);
        await assert.rejects(
          retrieval.search(owner.id, project, 'cookie'),
          (e: any) => e.code === 'context_stale',
        );
        const result = await retrieval.index(owner.id, project);
        assert.equal(result.embeddedChunks, 2);
        assert.equal(result.reusedDocuments, 3);
        assert.equal(result.documents, 5);
        const sources = await retrieval.search(owner.id, project, 'autenticación cookie');
        assert.match(sources.sources[0]!.excerpt, /ocho horas/);
        assert.equal(sources.sources[0]!.commit, 'd'.repeat(40));
        assert.equal(
          (await retrieval.search(owner.id, project, 'tarea prioridad')).insufficient,
          true,
        );
        const collections = await (await fetch(`${config.QDRANT_URL}/collections`)).json();
        const collection = collections.result.collections.find((c: { name: string }) =>
          c.name.startsWith(prefix + '_'),
        ).name;
        const persisted = await (
          await fetch(`${config.QDRANT_URL}/collections/${collection}/points`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: firstIds, with_payload: false, with_vector: false }),
          })
        ).json();
        // Three unaffected points remain; modified/deleted document points have been removed.
        assert.equal(persisted.result.length, 3);
      },
    );
    let conversation = '';
    await t.test(
      'chat saves sources, uses untrusted data roles, persists citations and abstains without generation',
      async () => {
        const made = await chats.create(owner.id, project, {
          title: 'Grounded chat',
          provider: 'ollama',
          model: 'fixture-chat',
          configuration: { maxOutputTokens: 128 },
        });
        conversation = made.conversation.id;
        const run = async (content: string, version: number) => {
          const res = await request(
            'POST',
            `/projects/${project}/conversations/${conversation}/turns`,
            { requestId: randomUUID(), content, version, repositoryContext: true },
            cookie,
          );
          assert.equal(res.status, 200);
          const events = (await res.text())
            .split('\n\n')
            .filter((x) => x.startsWith('data:'))
            .map((x) => JSON.parse(x.slice(5)));
          assert.equal(events.at(-1).type, 'done');
          return events.at(-1).turn;
        };
        const response = await run('autenticación cookie', 0);
        assert.equal(response.grounding, 'retrieved');
        assert.match(response.response, /\[F1\]/);
        assert.ok(response.sources.length);
        const detail = await new ChatService(pool, ai, retrieval).detail(
          owner.id,
          project,
          conversation,
        );
        assert.equal(detail.turns[0]!.sources[0]!.path, 'docs/auth.md');
        const none = await run('¿Cómo se calcula la factura mensual?', 1);
        assert.equal(none.grounding, 'insufficient');
        assert.match(none.response, /información suficiente/);
        assert.equal(none.usage.inputTokens, null);
        assert.equal(none.finishReason, 'insufficient_context');
        const candidate = await chats.begin(owner.id, project, conversation, {
          content: 'hola',
          requestId: randomUUID(),
          version: 2,
          repositoryContext: false,
        });
        assert.equal(candidate.messages.length, 1);
        await chats.cancel(owner.id, project, conversation, candidate.turn.id);
      },
    );
    await t.test(
      'failed update and webhook invalidation never publish stale or partial results',
      async () => {
        const initial = await github.read(owner.id, project);
        addSource(fixture, 'docs/race.md', 'Docker: actualización concurrente de contexto.');
        await github.sync(owner.id, project, initial.link!.version);
        const previousIndex = await retrieval.status(owner.id, project);
        fixture.state.beforeBlob = async () => {
          fixture.state.beforeBlob = null;
          await pool.query(
            'UPDATE github_links SET stale=true,generation=generation+1 WHERE project_id=$1',
            [project],
          );
        };
        await assert.rejects(
          retrieval.index(owner.id, project),
          (error: any) => error.code === 'context_stale',
        );
        assert.equal(
          (await retrieval.status(owner.id, project)).indexedAt,
          previousIndex.indexedAt,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM repository_documents WHERE project_id=$1 AND path='docs/race.md'",
              [project],
            )
          ).rowCount,
          0,
        );
        fixture.state.extraFiles = fixture.state.extraFiles.filter(
          (file: { path: string }) => file.path !== 'docs/race.md',
        );
        const fresh = await github.read(owner.id, project);
        await github.sync(owner.id, project, fresh.link!.version);
        await retrieval.index(owner.id, project);
        const before = await retrieval.status(owner.id, project);
        addSource(fixture, 'docs/oversized.md', 'Docker '.repeat(30000));
        fixture.state.extraFiles.find(
          (f: { path: string }) => f.path === 'docs/oversized.md',
        ).size = 100;
        const current = await github.read(owner.id, project);
        await github.sync(owner.id, project, current.link!.version);
        await assert.rejects(
          retrieval.index(owner.id, project),
          (e: any) => e.code === 'index_limit',
        );
        assert.equal((await retrieval.status(owner.id, project)).indexedAt, before.indexedAt);
        fixture.state.extraFiles = fixture.state.extraFiles.filter(
          (f: { path: string }) => f.path !== 'docs/oversized.md',
        );
        const live = await github.read(owner.id, project);
        await github.sync(owner.id, project, live.link!.version);
        await retrieval.index(owner.id, project);
        // Emulate the atomic invalidation performed by a signed E3 webhook; E3 tests validate signatures/dedup.
        await pool.query(
          'UPDATE github_links SET stale=true,generation=generation+1 WHERE project_id=$1',
          [project],
        );
        await assert.rejects(
          retrieval.search(owner.id, project, 'cookie'),
          (e: any) => e.code === 'context_stale',
        );
      },
    );
    await t.test(
      'revocation hides cached sources AND derived answers; archive blocks indexing',
      async () => {
        const live = await github.read(owner.id, project);
        await github.sync(owner.id, project, live.link!.version);
        await retrieval.index(owner.id, project);
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [project]);
        assert.equal((await request('POST', root + '/index', {}, cookie)).status, 409);
        await pool.query('UPDATE projects SET archived_at=NULL WHERE id=$1', [project]);
        fixture.state.denied = true;
        await assert.rejects(retrieval.search(owner.id, project, 'cookie'));
        const detail = await chats.detail(owner.id, project, conversation);
        assert.equal(detail.turns[0]!.grounding, 'unavailable');
        assert.equal(detail.turns[0]!.sources.length, 0);
        assert.doesNotMatch(detail.turns[0]!.response, /simulada|scrypt/);
        assert.equal(
          (await pool.query('SELECT 1 FROM repository_documents WHERE project_id=$1', [project]))
            .rowCount,
          0,
        );
        const cancelled = await request(
          'POST',
          `/projects/${project}/conversations/${conversation}/turns/${detail.turns[0]!.id}/cancel`,
          {},
          cookie,
        );
        assert.equal(cancelled.status, 200);
        assert.equal((await cancelled.json()).turn.grounding, 'unavailable');
        assert.equal(
          (
            await request(
              'GET',
              `/projects/${project}/conversations/${conversation}`,
              undefined,
              foreign,
            )
          ).status,
          404,
        );
      },
    );
  } finally {
    chats.shutdown();
    if (server) {
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    }
    // Delete only collections with this test's random prefix; production collections are untouched.
    const result = await (await fetch(`${config.QDRANT_URL}/collections`)).json();
    for (const entry of result.result.collections)
      if (entry.name.startsWith(prefix + '_'))
        await fetch(`${config.QDRANT_URL}/collections/${entry.name}`, { method: 'DELETE' });
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
