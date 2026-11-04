import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { inspectDatabase } from '../src/health.js';
import { loadMigrations, applyMigrations } from '../src/migrations.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { tokenHash } from '../src/modules/identity/sessions.js';
import { createDatabaseAdmin } from './database-admin.js';

test('workspace HTTP with real PostgreSQL and two isolated users', async (t) => {
  const config = readConfig();
  const database = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const admin = createDatabaseAdmin(config);
  const pool = createPool({ ...config, POSTGRES_DB: database });
  const origin = 'http://127.0.0.1:5173';
  const password = randomBytes(20).toString('hex');
  let created = false;
  let server: import('node:http').Server | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const owner = await provisionOwner(pool, { email: 'owner@ferweb.test', password });
    const second = await pool.query(
      'INSERT INTO app_users (email,password_hash) VALUES ($1,$2) RETURNING id',
      ['other@ferweb.test', await hashPassword(password)],
    );
    const otherId = second.rows[0].id as string;
    await assert.rejects(provisionOwner(pool, { email: 'extra@ferweb.test', password }), /already/);
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      appOrigin: origin,
      secureCookies: false,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    async function request(
      method: string,
      path: string,
      body?: unknown,
      cookie?: string,
      extra: Record<string, string> = {},
    ) {
      return fetch(base + '/api' + path, {
        method,
        headers: {
          Origin: origin,
          'X-FerWeb-Request': '1',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    }
    async function login(email: string, cookie?: string) {
      const response = await request('POST', '/auth/login', { email, password }, cookie);
      assert.equal(response.status, 200);
      const header = response.headers.get('set-cookie');
      assert.ok(header);
      assert.match(header, /HttpOnly/);
      assert.match(header, /SameSite=Strict/);
      return header.split(';')[0]!;
    }
    let a = await login('owner@ferweb.test');
    const b = await login('other@ferweb.test');
    const projectInput = { name: 'Calendario', description: 'Proyecto de integración' };
    let project: import('@ferweb/contracts').Project;
    let task: import('@ferweb/contracts').Task;
    const taskInput = {
      title: 'Revisar sincronización',
      description: 'Verificar el recorrido completo.',
      priority: 'high',
      status: 'todo',
      acceptanceCriteria: ['Persistir cambios', 'Comprobar permisos'],
    };

    await t.test(
      'unauthenticated access, CSRF, invalid JSON and payload limits are rejected',
      async () => {
        for (const [method, path, body] of [
          ['GET', '/projects', undefined],
          ['POST', '/projects', projectInput],
          ['GET', `/projects/${randomUUID()}`, undefined],
        ] as const)
          assert.equal((await request(method, path, body)).status, 401);
        assert.equal(
          (
            await request('POST', '/auth/login', { email: owner.email, password }, undefined, {
              Origin: 'http://untrusted.test',
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request('POST', '/auth/login', { email: owner.email, password }, undefined, {
              'X-FerWeb-Request': '',
            })
          ).status,
          403,
        );
        const malformed = await fetch(base + '/api/projects', {
          method: 'POST',
          headers: {
            Origin: origin,
            'X-FerWeb-Request': '1',
            'Content-Type': 'application/json',
            Cookie: a,
          },
          body: '{',
        });
        assert.equal(malformed.status, 400);
        assert.equal(
          (await request('POST', '/projects', { name: 'A', description: 'x'.repeat(200000) }, a))
            .status,
          413,
        );
        const wrong = await request('POST', '/auth/login', {
          email: owner.email,
          password: 'wrong',
        });
        assert.equal(wrong.status, 401);
        const unknown = await request('POST', '/auth/login', {
          email: 'unknown@ferweb.test',
          password: 'wrong',
        });
        assert.deepEqual(await unknown.json(), await wrong.json());
      },
    );
    await t.test('session introspection, token hashing and rotation', async () => {
      assert.equal(
        (await (await request('GET', '/auth/session', undefined, a)).json()).user.id,
        owner.id,
      );
      const raw = a.split('=')[1]!;
      const stored = await pool.query('SELECT token_hash FROM sessions WHERE user_id=$1', [
        owner.id,
      ]);
      assert.equal(stored.rows[0].token_hash, tokenHash(raw));
      assert.notEqual(stored.rows[0].token_hash, raw);
      const previous = a;
      a = await login(owner.email, a);
      assert.notEqual(a, previous);
      assert.equal((await request('GET', '/projects', undefined, previous)).status, 401);
    });
    await t.test(
      'project/task creation, detail, filters and validation persist real records',
      async () => {
        assert.equal(
          (await request('POST', '/projects', { ...projectInput, ownerId: otherId }, a)).status,
          400,
        );
        assert.equal(
          (await request('POST', '/projects', { name: ' ', description: '' }, a)).status,
          400,
        );
        const response = await request('POST', '/projects', projectInput, a);
        assert.equal(response.status, 201);
        project = (await response.json()).project;
        const taskResponse = await request('POST', `/projects/${project.id}/tasks`, taskInput, a);
        assert.equal(taskResponse.status, 201);
        task = (await taskResponse.json()).task;
        assert.deepEqual(task.acceptanceCriteria, taskInput.acceptanceCriteria);
        assert.equal(
          (
            await (
              await request('GET', `/projects/${project.id}/tasks/${task.id}`, undefined, a)
            ).json()
          ).task.id,
          task.id,
        );
        const match = await request(
          'GET',
          `/projects/${project.id}/tasks?priority=high&status=todo&q=sincron`,
          undefined,
          a,
        );
        assert.equal((await match.json()).tasks.length, 1);
        assert.equal(
          (
            await (
              await request('GET', `/projects/${project.id}/tasks?priority=low`, undefined, a)
            ).json()
          ).tasks.length,
          0,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${project.id}/tasks`,
              { ...taskInput, status: 'invalid' },
              a,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${project.id}/tasks`,
              { ...taskInput, acceptanceCriteria: ['x'.repeat(501)] },
              a,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await pool.query('SELECT count(*)::int AS count FROM tasks WHERE project_id=$1', [
              project.id,
            ])
          ).rows[0].count,
          1,
        );
      },
    );
    await t.test(
      'other user cannot list, read, change, archive or create tasks in foreign projects',
      async () => {
        assert.deepEqual(
          (await (await request('GET', '/projects', undefined, b)).json()).projects,
          [],
        );
        const cases: [string, string, unknown?][] = [
          ['GET', `/projects/${project.id}`],
          ['PATCH', `/projects/${project.id}`, { name: 'Stolen', version: project.version }],
          ['PATCH', `/projects/${project.id}`, { archived: true, version: project.version }],
          ['GET', `/projects/${project.id}/tasks`],
          ['POST', `/projects/${project.id}/tasks`, taskInput],
          ['GET', `/projects/${project.id}/tasks/${task.id}`],
          [
            'PATCH',
            `/projects/${project.id}/tasks/${task.id}`,
            { ...taskInput, version: task.version },
          ],
        ];
        for (const [method, path, body] of cases)
          assert.equal((await request(method, path, body, b)).status, 404, `${method} ${path}`);
        const own = await (
          await request('POST', '/projects', { name: 'Other project', description: '' }, a)
        ).json();
        assert.equal(
          (
            await request(
              'PATCH',
              `/projects/${own.project.id}/tasks/${task.id}`,
              { ...taskInput, version: task.version },
              a,
            )
          ).status,
          404,
        );
        assert.equal(
          (await pool.query('SELECT name FROM projects WHERE id=$1', [project.id])).rows[0].name,
          'Calendario',
        );
      },
    );
    await t.test('edits, optimistic conflicts, archival read-only and restoration', async () => {
      const changed = await request(
        'PATCH',
        `/projects/${project.id}/tasks/${task.id}`,
        { ...taskInput, status: 'done', priority: 'urgent', version: task.version },
        a,
      );
      assert.equal(changed.status, 200);
      task = (await changed.json()).task;
      assert.equal(task.status, 'done');
      assert.equal(
        (
          await request(
            'PATCH',
            `/projects/${project.id}/tasks/${task.id}`,
            { ...taskInput, version: 1 },
            a,
          )
        ).status,
        409,
      );
      const simultaneous = await Promise.all(
        ['Name A', 'Name B'].map((name) =>
          request('PATCH', `/projects/${project.id}`, { name, version: project.version }, a),
        ),
      );
      assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 409]);
      project = (await (await request('GET', `/projects/${project.id}`, undefined, a)).json())
        .project;
      project = (
        await (
          await request(
            'PATCH',
            `/projects/${project.id}`,
            { archived: true, version: project.version },
            a,
          )
        ).json()
      ).project;
      assert.ok(project.archivedAt);
      assert.equal(
        (await request('GET', `/projects/${project.id}/tasks`, undefined, a)).status,
        200,
      );
      assert.equal(
        (await request('POST', `/projects/${project.id}/tasks`, taskInput, a)).status,
        409,
      );
      assert.equal(
        (
          await request(
            'PATCH',
            `/projects/${project.id}/tasks/${task.id}`,
            { ...taskInput, version: task.version },
            a,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            'PATCH',
            `/projects/${project.id}`,
            { description: 'overwrite', version: project.version },
            a,
          )
        ).status,
        409,
      );
      project = (
        await (
          await request(
            'PATCH',
            `/projects/${project.id}`,
            { archived: false, version: project.version },
            a,
          )
        ).json()
      ).project;
      assert.equal(project.archivedAt, null);
      assert.equal(
        (
          await request(
            'POST',
            `/projects/${project.id}/tasks`,
            { ...taskInput, title: 'After restoration' },
            a,
          )
        ).status,
        201,
      );
    });
    await t.test('logout and expiry revoke access; login attempts are limited', async () => {
      const response = await request('POST', '/auth/logout', {}, a);
      assert.equal(response.status, 204);
      assert.equal((await request('GET', '/projects', undefined, a)).status, 401);
      assert.equal((await (await request('GET', '/auth/session', undefined, a)).json()).user, null);
      await pool.query(
        "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [otherId],
      );
      assert.equal((await request('GET', '/projects', undefined, b)).status, 401);
      for (let i = 0; i < 10; i++)
        assert.equal(
          (
            await request('POST', '/auth/login', {
              email: 'limited@ferweb.test',
              password: 'wrong',
            })
          ).status,
          401,
        );
      assert.equal(
        (await request('POST', '/auth/login', { email: 'limited@ferweb.test', password: 'wrong' }))
          .status,
        429,
      );
    });
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
