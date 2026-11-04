import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from '../src/database.js';
import { createDatabaseAdmin } from './database-admin.js';
import { readConfig } from '../src/config.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { inspectDatabase } from '../src/health.js';
import { createApp } from '../src/app.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { GitHubService } from '../src/modules/github/service.js';
import { CredentialCipher, validSignature } from '../src/modules/github/crypto.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';

test('GitHub App: simulated provider with real HTTP, ownership, SQL and signed webhooks', async (t) => {
  const config = readConfig();
  const admin = createDatabaseAdmin(config);
  const database = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool({ ...config, POSTGRES_DB: database });
  let created = false;
  let server: import('node:http').Server | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(20).toString('hex');
    const owner = await provisionOwner(pool, { email: 'github-owner@ferweb.test', password });
    const other = (
      await pool.query('INSERT INTO app_users(email,password_hash) VALUES ($1,$2) RETURNING id', [
        'github-other@ferweb.test',
        await hashPassword(password),
      ])
    ).rows[0].id;
    const project = (
      await pool.query(
        "INSERT INTO projects(owner_id,name) VALUES ($1,'GitHub integration') RETURNING id",
        [owner.id],
      )
    ).rows[0].id;
    const fixture = githubFixture();
    const github = new GitHubService(pool, fixture.config, fixture.transport);
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      appOrigin: origin,
      secureCookies: false,
      github,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api`;
    async function request(method: string, path: string, body?: unknown, cookie?: string) {
      if (path.includes('/github/file?') && !path.includes('&version='))
        path += `&version=${version}`;
      return fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {
          Origin: origin,
          'X-FerWeb-Request': '1',
          'Content-Type': 'application/json',
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
    const foreign = await login('github-other@ferweb.test');
    async function authorize() {
      const r = await request('POST', '/github/authorize', {}, cookie);
      assert.equal(r.status, 200);
      return new URL((await r.json()).url);
    }
    async function callback(url: URL) {
      return request(
        'GET',
        `/github/callback?state=${url.searchParams.get('state')}&code=fixture-code`,
      );
    }
    async function webhook(
      event: string,
      payload: unknown,
      delivery = randomUUID(),
      signature?: string,
    ) {
      const raw = JSON.stringify(payload);
      return fetch(base + '/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': event,
          'X-GitHub-Delivery': delivery,
          'X-Hub-Signature-256':
            signature ??
            'sha256=' +
              createHmac('sha256', fixture.config.webhookSecret).update(raw).digest('hex'),
        },
        body: raw,
      });
    }
    const linkedPath = `/projects/${project}/github`;
    let version = 1;
    await t.test(
      'AES-GCM, official HMAC vector and authenticated OAuth state/PKCE with single use',
      async () => {
        const cipher = new CredentialCipher(fixture.config.encryptionKey);
        const encrypted = cipher.encrypt('credential-value', owner.id);
        assert.ok(!encrypted.includes('credential-value'));
        assert.equal(cipher.decrypt(encrypted, owner.id), 'credential-value');
        assert.throws(() => cipher.decrypt(encrypted, other));
        assert.equal(
          validSignature(
            "It's a Secret to Everybody",
            Buffer.from('Hello, World!'),
            'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
          ),
          true,
        );
        assert.equal((await request('POST', '/github/authorize', {})).status, 401);
        const url = await authorize();
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        const persisted = (await pool.query('SELECT * FROM github_oauth_states')).rows[0];
        assert.notEqual(persisted.state_hash, url.searchParams.get('state'));
        assert.notEqual(persisted.encrypted_verifier, url.searchParams.get('code_challenge'));
        assert.equal(
          (await callback(url)).headers.get('location'),
          origin + '/#/github?authorization=connected',
        );
        assert.equal(
          (await callback(url)).headers.get('location'),
          origin + '/#/github?authorization=failed',
        );
        assert.equal(fixture.state.exchanges.length, 1);
        assert.equal(
          createHash('sha256').update(fixture.state.exchanges[0].code_verifier).digest('base64url'),
          url.searchParams.get('code_challenge'),
        );
        const row = (
          await pool.query('SELECT * FROM github_connections WHERE owner_id=$1', [owner.id])
        ).rows[0];
        assert.ok(!row.encrypted_token.includes('ghu_fixture_only'));
        const status = await (await request('GET', '/github/status', undefined, cookie)).text();
        assert.ok(!status.includes('ghu_'));
        assert.ok(!status.includes(fixture.config.clientSecret));
      },
    );
    await t.test(
      'only this App installations, paginated repositories and installation ownership',
      async () => {
        const data = await (
          await request('GET', '/github/installations', undefined, cookie)
        ).json();
        assert.deepEqual(
          data.installations.map((i: { id: number }) => i.id),
          [71],
        );
        assert.equal(
          (await request('POST', '/github/installations', { installationId: 92 }, cookie)).status,
          403,
        );
        assert.equal(
          (await request('POST', '/github/installations', { installationId: 71 }, cookie)).status,
          204,
        );
        assert.equal(
          (await request('GET', '/github/installations/71/repositories', undefined, foreign))
            .status,
          409,
        );
        const repos = await (
          await request('GET', '/github/installations/71/repositories', undefined, cookie)
        ).json();
        assert.equal(repos.nextPage, 2);
        assert.equal(
          (
            await (
              await request(
                'GET',
                '/github/installations/71/repositories?page=2',
                undefined,
                cookie,
              )
            ).json()
          ).repositories[0].id,
          102,
        );
        assert.equal(
          (
            await request(
              'POST',
              linkedPath,
              { installationId: 71, repositoryId: 999, version: 0 },
              cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              'POST',
              linkedPath,
              { installationId: 71, repositoryId: 101, branch: 'main', version: 0 },
              cookie,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      'snapshot commit, filtered tree, content, issues separated from PR and foreign resource protection',
      async () => {
        const sync = await request('POST', linkedPath + '/sync', { version }, cookie);
        assert.equal(sync.status, 200);
        const link = (await sync.json()).link;
        version = link.version;
        assert.equal(link.snapshot.commit, 'a'.repeat(40));
        assert.equal(link.snapshot.branch, 'main');
        assert.equal(link.snapshot.issues.length, 1);
        assert.equal(link.snapshot.pullRequests.length, 1);
        assert.ok(
          !link.snapshot.tree.some(
            (entry: { path: string }) =>
              entry.path.includes('.env') || entry.path.includes('secrets'),
          ),
        );
        const file = await (
          await request('GET', linkedPath + '/file?path=src%2Fdemo.ts', undefined, cookie)
        ).json();
        assert.equal(file.commit, link.snapshot.commit);
        assert.match(file.content, /export const demo/);
        assert.equal(
          (
            await request(
              'GET',
              linkedPath + '/file?path=src%2Fdemo.ts&version=1',
              undefined,
              cookie,
            )
          ).status,
          409,
        );
        for (const path of ['.env', 'secrets/key.pem', 'missing.ts'])
          assert.equal(
            (
              await request(
                'GET',
                linkedPath + '/file?path=' + encodeURIComponent(path),
                undefined,
                cookie,
              )
            ).status,
            404,
          );
        for (const path of ['link', 'binary.bin', 'large.txt'])
          assert.equal(
            (await request('GET', linkedPath + '/file?path=' + path, undefined, cookie)).status,
            415,
          );
        assert.equal(
          (await request('GET', linkedPath + '/file?path=..%2F.env', undefined, cookie)).status,
          400,
        );
        const before = fixture.state.requests.length;
        for (const [method, suffix, body] of [
          ['GET', '', undefined],
          ['GET', '/file?path=src%2Fdemo.ts', undefined],
          ['POST', '/sync', { version }],
          ['DELETE', '', { version }],
          ['POST', '', { installationId: 71, repositoryId: 101, version }],
        ] as const)
          assert.equal((await request(method, linkedPath + suffix, body, foreign)).status, 404);
        assert.equal(fixture.state.requests.length, before);
        assert.equal(
          (await request('POST', linkedPath + '/sync', { version: 1 }, cookie)).status,
          409,
        );
      },
    );
    await t.test(
      'bad signatures and malformed bodies do not create receipts; duplicates are atomic and body-bound',
      async () => {
        const payload = {
          installation: { id: 71 },
          repository: { id: 101 },
          ref: 'refs/heads/main',
        };
        const delivery = randomUUID();
        assert.equal(
          (await webhook('push', payload, delivery, 'sha256=' + '0'.repeat(64))).status,
          401,
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM github_deliveries')).rows[0].n,
          0,
        );
        assert.equal((await webhook('push', {}, randomUUID())).status, 400);
        const compressed = await fetch(base + '/github/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
          body: 'invalid',
        });
        assert.equal(compressed.status, 415);
        assert.equal(
          (await webhook('push', { ...payload, padding: 'x'.repeat(2_100_000) })).status,
          413,
        );
        const responses = await Promise.all([
          webhook('push', payload, delivery),
          webhook('push', payload, delivery),
        ]);
        const bodies = await Promise.all(responses.map((r) => r.json()));
        assert.deepEqual(bodies.map((b) => b.duplicate).sort(), [false, true]);
        assert.equal(
          (await pool.query('SELECT generation FROM github_links WHERE project_id=$1', [project]))
            .rows[0].generation,
          1,
        );
        const restarted = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
          pool,
          appOrigin: origin,
          secureCookies: false,
          github: new GitHubService(pool, fixture.config, fixture.transport),
        }).listen(0, '127.0.0.1');
        try {
          await once(restarted, 'listening');
          const endpoint = restarted.address();
          assert.ok(endpoint && typeof endpoint !== 'string');
          const raw = JSON.stringify(payload);
          const replay = await fetch(`http://127.0.0.1:${endpoint.port}/api/github/webhook`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-GitHub-Event': 'push',
              'X-GitHub-Delivery': delivery,
              'X-Hub-Signature-256':
                'sha256=' +
                createHmac('sha256', fixture.config.webhookSecret).update(raw).digest('hex'),
            },
            body: raw,
          });
          assert.equal((await replay.json()).duplicate, true);
          assert.equal(
            (await pool.query('SELECT generation FROM github_links WHERE project_id=$1', [project]))
              .rows[0].generation,
            1,
          );
        } finally {
          await new Promise<void>((resolve) => restarted.close(() => resolve()));
        }
        assert.equal((await webhook('push', { ...payload, ref: 'changed' }, delivery)).status, 409);
        const link = (await (await request('GET', linkedPath, undefined, cookie)).json()).link;
        assert.equal(link.stale, true);
        assert.equal(link.snapshot.commit, 'a'.repeat(40));
      },
    );
    await t.test(
      'in-flight sync cannot clear a newer webhook; a later manual sync updates commit',
      async () => {
        fixture.state.commit = 'c'.repeat(40);
        fixture.state.beforeTree = async () => {
          fixture.state.beforeTree = null;
          await webhook('issues', {
            installation: { id: 71 },
            repository: { id: 101 },
            action: 'edited',
          });
        };
        assert.equal(
          (await request('POST', linkedPath + '/sync', { version }, cookie)).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT snapshot->>'commit' AS sha FROM github_links WHERE project_id=$1",
              [project],
            )
          ).rows[0].sha,
          'a'.repeat(40),
        );
        fixture.state.treeTruncated = true;
        const response = await request('POST', linkedPath + '/sync', { version }, cookie);
        assert.equal(response.status, 200);
        const link = (await response.json()).link;
        version = link.version;
        assert.equal(link.snapshot.commit, 'c'.repeat(40));
        assert.equal(link.snapshot.treeTruncated, true);
        assert.equal(link.stale, false);
      },
    );
    await t.test(
      'rate limits are sanitized and do not revoke credentials; missing repo access hides cached content',
      async () => {
        fixture.state.rateLimited = true;
        const limited = await request('GET', linkedPath, undefined, cookie);
        assert.equal(limited.status, 429);
        assert.ok(!(await limited.text()).includes('fixture-upstream-secret'));
        assert.equal(
          (
            await pool.query(
              'SELECT encrypted_token IS NOT NULL AS valid FROM github_connections WHERE owner_id=$1',
              [owner.id],
            )
          ).rows[0].valid,
          true,
        );
        fixture.state.rateLimited = false;
        fixture.state.denied = true;
        assert.equal((await request('GET', linkedPath, undefined, cookie)).status, 403);
        assert.equal(
          (await pool.query('SELECT snapshot FROM github_links WHERE project_id=$1', [project]))
            .rows[0].snapshot,
          null,
        );
        fixture.state.denied = false;
        await request('POST', '/github/installations', { installationId: 71 }, cookie);
        const result = await request('POST', linkedPath + '/sync', { version }, cookie);
        assert.equal(result.status, 200);
        version = (await result.json()).link.version;
      },
    );
    await t.test(
      'permission removal, repository removal and installation suspension discard snapshots',
      async () => {
        fixture.state.permissions = false;
        assert.equal((await request('GET', linkedPath, undefined, cookie)).status, 403);
        assert.equal(
          (await pool.query('SELECT snapshot FROM github_links WHERE project_id=$1', [project]))
            .rows[0].snapshot,
          null,
        );
        fixture.state.permissions = true;
        await request('POST', '/github/installations', { installationId: 71 }, cookie);
        let result = await request('POST', linkedPath + '/sync', { version }, cookie);
        version = (await result.json()).link.version;
        await webhook('installation_repositories', {
          installation: { id: 71 },
          action: 'removed',
          repositories_removed: [{ id: 101 }],
        });
        assert.equal(
          (await (await request('GET', linkedPath, undefined, cookie)).json()).link.snapshot,
          null,
        );
        await request('POST', '/github/installations', { installationId: 71 }, cookie);
        result = await request('POST', linkedPath + '/sync', { version }, cookie);
        version = (await result.json()).link.version;
        await webhook('installation', { installation: { id: 71 }, action: 'suspend' });
        assert.equal(
          (await (await request('GET', linkedPath, undefined, cookie)).json()).link.snapshot,
          null,
        );
      },
    );
    await t.test(
      'archived projects are read-only; authorization revocation erases tokens and disconnect removes local bindings',
      async () => {
        await request('POST', '/github/installations', { installationId: 71 }, cookie);
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [project]);
        assert.equal(
          (await request('POST', linkedPath + '/sync', { version }, cookie)).status,
          409,
        );
        assert.equal((await request('DELETE', linkedPath, { version }, cookie)).status, 409);
        assert.equal(
          (
            await request(
              'POST',
              linkedPath,
              { installationId: 71, repositoryId: 101, version },
              cookie,
            )
          ).status,
          409,
        );
        await pool.query('UPDATE projects SET archived_at=NULL WHERE id=$1', [project]);
        await webhook('github_app_authorization', { action: 'revoked', sender: { id: 501 } });
        assert.equal(
          (
            await pool.query('SELECT encrypted_token FROM github_connections WHERE owner_id=$1', [
              owner.id,
            ])
          ).rows[0].encrypted_token,
          null,
        );
        assert.equal(
          (await request('GET', linkedPath + '/file?path=src%2Fdemo.ts', undefined, cookie)).status,
          409,
        );
        assert.equal((await request('POST', '/github/disconnect', {}, cookie)).status, 204);
        assert.equal(
          (await (await request('GET', linkedPath, undefined, cookie)).json()).link,
          null,
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM projects WHERE id=$1', [project]))
            .rows[0].n,
          1,
        );
      },
    );
    await t.test('expired state and revoked FerWeb session cannot finish OAuth', async () => {
      let url = await authorize();
      await pool.query("UPDATE github_oauth_states SET expires_at=now()-interval '1 second'");
      assert.match((await callback(url)).headers.get('location')!, /failed$/);
      url = await authorize();
      await request('POST', '/auth/logout', {}, cookie);
      assert.match((await callback(url)).headers.get('location')!, /failed$/);
      assert.equal(
        (
          await pool.query('SELECT count(*)::int AS n FROM github_connections WHERE owner_id=$1', [
            owner.id,
          ])
        ).rows[0].n,
        0,
      );
      cookie = await login(owner.email);
      url = await authorize();
      fixture.state.expired = false;
      await callback(url);
      fixture.state.expired = true;
      assert.equal((await request('GET', '/github/installations', undefined, cookie)).status, 409);
      assert.equal(
        (
          await pool.query('SELECT encrypted_token FROM github_connections WHERE owner_id=$1', [
            owner.id,
          ])
        ).rows[0].encrypted_token,
        null,
      );
    });
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
