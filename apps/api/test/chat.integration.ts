import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chatStreamEvent, executionCatalogSchema, type ChatTurn } from '@ferweb/contracts';
import { createApp } from '../src/app.js';
import { createPool } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { createDatabaseAdmin } from './database-admin.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { inspectDatabase } from '../src/health.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { ChatService } from '../src/modules/chat/service.js';
import { AiClient } from '../src/modules/chat/client.js';

test('persistent project conversations through Node, Python simulated provider and real PostgreSQL', async (t) => {
  const config = readConfig(),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    admin = createDatabaseAdmin(config),
    pool = createPool({ ...config, POSTGRES_DB: database });
  const ai = new AiClient(process.env.AI_TEST_URL!, process.env.AI_TEST_TOKEN!),
    chats = new ChatService(pool, ai);
  let created = false,
    server: import('node:http').Server | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex');
    const owner = await provisionOwner(pool, { email: 'chat-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES ($1,$2)', [
      'chat-other@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
      await pool.query("INSERT INTO projects(owner_id,name) VALUES ($1,'Chat test') RETURNING id", [
        owner.id,
      ])
    ).rows[0].id;
    const secondProject = (
      await pool.query(
        "INSERT INTO projects(owner_id,name) VALUES ($1,'Separate project') RETURNING id",
        [owner.id],
      )
    ).rows[0].id;
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      appOrigin: origin,
      secureCookies: false,
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
          'Content-Type': 'application/json',
          'X-FerWeb-Request': '1',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function login(email: string) {
      const r = await request('POST', '/auth/login', { email, password });
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie')!.split(';')[0]!;
    }
    let cookie = await login(owner.email);
    const foreign = await login('chat-other@ferweb.test');
    await t.test('the status catalog distinguishes local chat from a code executor', async () => {
      const response = await request('GET', '/execution/capabilities', undefined, cookie);
      assert.equal(response.status, 200);
      const { options } = executionCatalogSchema.parse(await response.json());
      const ollama = options.find((option) => option.id === 'ollama-chat');
      assert.ok(ollama);
      assert.equal(ollama.available, true);
      assert.equal(ollama.runtime, 'ferweb-chat');
      assert.equal(ollama.destination, 'simulated');
      assert.equal(ollama.configurationRevision, 'fixture-config-v1');
      assert.equal(ollama.capabilities.toolCalls, 'unsupported');
      assert.equal(ollama.capabilities.usage, 'unknown');
      assert.equal(
        options.find((option) => option.id === 'codex-v1')?.reason,
        'runner_unconfigured',
      );
    });
    let id = '',
      version = 0;
    const root = `/projects/${project}/conversations`;
    let firstTurn: ChatTurn;
    async function start(content: string, requestId = randomUUID()) {
      const res = await request(
        'POST',
        `${root}/${id}/turns`,
        { content, requestId, version },
        cookie,
      );
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type')!, /text\/event-stream/);
      let startedResolve!: (turn: ChatTurn) => void, deltaResolve!: () => void;
      const started = new Promise<ChatTurn>((resolve) => (startedResolve = resolve)),
        delta = new Promise<void>((resolve) => (deltaResolve = resolve));
      const events: ReturnType<typeof chatStreamEvent.parse>[] = [];
      const done = (async () => {
        const reader = res.body!.getReader(),
          decoder = new TextDecoder();
        let pending = '',
          last: ChatTurn | undefined;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            pending += decoder.decode(part.value, { stream: true });
            let index: number;
            while ((index = pending.indexOf('\n\n')) >= 0) {
              const frame = pending.slice(0, index);
              pending = pending.slice(index + 2);
              if (!frame.startsWith('data:')) continue;
              const event = chatStreamEvent.parse(JSON.parse(frame.slice(5)));
              events.push(event);
              if (event.type === 'started') {
                version = event.turn.sequence;
                startedResolve(event.turn);
              }
              if (event.type === 'delta') deltaResolve();
              if (event.type === 'done') last = event.turn;
              if (event.type === 'error') throw Error(event.message);
            }
          }
          assert.ok(last);
          return last;
        } finally {
          reader.releaseLock();
        }
      })();
      return { started, delta, done, events, requestId };
    }
    await t.test(
      'model catalog, validation, immutable provider configuration and project ownership',
      async () => {
        assert.equal(
          (await request('GET', `/projects/${project}/ai/models?provider=ollama`)).status,
          401,
        );
        assert.equal((await request('GET', root, undefined, foreign)).status, 404);
        const catalog = await (
          await request('GET', `/projects/${project}/ai/models?provider=ollama`, undefined, cookie)
        ).json();
        assert.equal(catalog.models[0].id, 'fixture-chat');
        const input = {
          title: 'Persisted local chat',
          provider: 'ollama',
          model: 'fixture-chat',
          configuration: { maxOutputTokens: 256 },
        };
        assert.equal(
          (await request('POST', root, { ...input, ownerId: owner.id }, cookie)).status,
          400,
        );
        assert.equal(
          (await request('POST', root, { ...input, model: 'missing' }, cookie)).status,
          422,
        );
        const created = await request('POST', root, input, cookie);
        assert.equal(created.status, 201);
        const data = await created.json();
        id = data.conversation.id;
        assert.equal(data.conversation.catalogRevision, 'fixture-revision');
        assert.equal(data.conversation.provider, 'ollama');
        assert.equal(
          (await request('PATCH', `${root}/${id}`, { provider: 'openai' }, cookie)).status,
          404,
        );
      },
    );
    await t.test(
      'streamed text, recorded configuration, usage and history survive a fresh service instance',
      async () => {
        const live = await start('hola');
        await live.started;
        await live.delta;
        firstTurn = await live.done;
        assert.equal(firstTurn.status, 'completed');
        assert.match(firstTurn.response, /1 mensajes/);
        assert.equal(firstTurn.usage.inputTokens, 11);
        assert.equal(firstTurn.usage.costUsd, null);
        assert.equal(firstTurn.reportedModel, 'fixture-reported');
        assert.ok(firstTurn.firstTokenMs !== null);
        assert.ok(firstTurn.durationMs! >= firstTurn.firstTokenMs!);
        assert.equal(live.events.filter((event) => event.type === 'delta').length, 2);
        const restored = new ChatService(pool, ai);
        const detail = await restored.detail(owner.id, project, id);
        assert.equal(detail.turns[0]!.response, firstTurn.response);
        assert.equal(detail.conversation.configuration.maxOutputTokens, 256);
        const next = await (await start('segundo')).done;
        assert.match(next.response, /3 mensajes/);
        assert.deepEqual(next.contextTurnIds, [firstTurn.id]);
      },
    );
    await t.test(
      'cross-user and cross-project reads, generations and cancellation are rejected',
      async () => {
        assert.equal((await request('GET', `${root}/${id}`, undefined, foreign)).status, 404);
        assert.equal(
          (
            await request(
              'POST',
              `${root}/${id}/turns`,
              { content: 'secret', requestId: randomUUID(), version },
              foreign,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request('POST', `${root}/${id}/turns/${firstTurn.id}/cancel`, {}, foreign)).status,
          404,
        );
        assert.equal(
          (
            await request(
              'GET',
              `/projects/${secondProject}/conversations/${id}`,
              undefined,
              cookie,
            )
          ).status,
          404,
        );
        assert.deepEqual(
          (
            await (
              await request('GET', `/projects/${secondProject}/conversations`, undefined, cookie)
            ).json()
          ).conversations,
          [],
        );
      },
    );
    await t.test(
      'concurrent/duplicate sends cannot call the provider twice; cancellation retains partial text',
      async () => {
        const live = await start('fixture-cancel');
        const running = await live.started;
        await live.delta;
        assert.equal(
          (
            await request(
              'POST',
              `${root}/${id}/turns`,
              { content: 'fixture-cancel', requestId: live.requestId, version },
              cookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              'POST',
              `${root}/${id}/turns`,
              { content: 'another', requestId: randomUUID(), version },
              cookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (await request('POST', `${root}/${id}/turns/${running.id}/cancel`, {}, cookie)).status,
          200,
        );
        const ended = await live.done;
        assert.equal(ended.status, 'cancelled');
        assert.match(ended.response, /Respuesta/);
        assert.equal(ended.cancelMode, 'connection_closed');
        assert.equal(ended.remoteCancellationConfirmed, null);
        let remaining = 1;
        for (let attempt = 0; attempt < 30; attempt++) {
          remaining = (await (await fetch(process.env.AI_TEST_URL! + '/fixture/active')).json())
            .active;
          if (remaining === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(remaining, 0, 'Python must release the cancelled provider iterator');
        assert.ok(Object.values(ended.usage).every((value) => value === null));
        assert.equal(
          (await request('POST', `${root}/${id}/turns/${running.id}/cancel`, {}, cookie)).status,
          200,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM chat_turns WHERE conversation_id=$1',
              [id],
            )
          ).rows[0].count,
          3,
        );
      },
    );
    await t.test(
      'provider errors and missing metrics are persisted; failed/cancelled turns are excluded from context',
      async () => {
        const failed = await (await start('fixture-error')).done;
        assert.equal(failed.status, 'error');
        assert.equal(failed.errorCode, 'provider_rate_limit');
        assert.match(failed.response, /Respuesta/);
        const unknown = await (await start('fixture-unknown')).done;
        assert.equal(unknown.status, 'completed');
        assert.ok(Object.values(unknown.usage).every((value) => value === null));
        assert.match(unknown.response, /5 mensajes/);
        assert.equal(unknown.contextTurnIds.length, 2);
      },
    );
    await t.test(
      'archived project cannot create/send; an active generation is stopped after session revocation',
      async () => {
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [project]);
        assert.equal(
          (
            await request(
              'POST',
              root,
              {
                title: 'not allowed',
                provider: 'ollama',
                model: 'fixture-chat',
                configuration: { maxOutputTokens: 20 },
              },
              cookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              'POST',
              `${root}/${id}/turns`,
              { content: 'not allowed', requestId: randomUUID(), version },
              cookie,
            )
          ).status,
          409,
        );
        assert.equal((await request('GET', `${root}/${id}`, undefined, cookie)).status, 200);
        await pool.query('UPDATE projects SET archived_at=NULL WHERE id=$1', [project]);
        const live = await start('fixture-cancel');
        await live.delta;
        await request('POST', '/auth/logout', {}, cookie);
        const ended = await live.done;
        assert.equal(ended.status, 'cancelled');
        cookie = await login(owner.email);
      },
    );
    await t.test(
      'abandoned lease recovers as interrupted without retrying or inventing usage',
      async () => {
        const initial = await chats.begin(owner.id, project, id, {
          content: 'orphan',
          requestId: randomUUID(),
          version,
        });
        version = initial.turn.sequence;
        await pool.query(
          "UPDATE chat_turns SET response='saved fragment',lease_until=now()-interval '1 second' WHERE id=$1",
          [initial.turn.id],
        );
        const recovered = await chats.detail(owner.id, project, id);
        const last = recovered.turns.at(-1)!;
        assert.equal(last.status, 'interrupted');
        assert.equal(last.response, 'saved fragment');
        assert.equal(last.durationMs, null);
        assert.equal(last.usage.totalTokens, null);
      },
    );
  } finally {
    chats.shutdown();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
