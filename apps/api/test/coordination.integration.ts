import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { CodingService } from '../src/modules/jobs/coding-service.js';
import { RunnerClient } from '../src/modules/jobs/runner-client.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { codingCorpus } from '../../../tests/fixtures/coding.mjs';
import { publicationFixture } from '../../../tests/fixtures/publication.mjs';
import { coordinationFixture } from '../../../tests/fixtures/coordination.mjs';

test('P18 coordination: project authority, local DAG and explicit reconciled GitHub effects', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config);
  const database = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool({ ...config, POSTGRES_DB: database });
  let created = false,
    server: import('node:http').Server | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(20).toString('hex');
    const owner = await provisionOwner(pool, { email: 'coordination@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES ($1,$2)', [
      'foreign@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
      await pool.query("INSERT INTO projects(owner_id,name) VALUES($1,'P18') RETURNING id", [
        owner.id,
      ])
    ).rows[0].id;
    const otherProject = (
      await pool.query("INSERT INTO projects(owner_id,name) VALUES($1,'Other P18') RETURNING id", [
        owner.id,
      ])
    ).rows[0].id;
    const fixture = coordinationFixture(publicationFixture(codingCorpus(githubFixture())));
    const github = new GitHubService(pool, fixture.config, fixture.transport);
    const coding = new CodingService(
      pool,
      github,
      new RunnerClient(process.env.RUNNER_URL, process.env.RUNNER_SERVICE_TOKEN),
    );
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      appOrigin: origin,
      secureCookies: false,
      github,
      coding,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    let cookie = '';
    const request = (method: string, path: string, body?: unknown, session = cookie) =>
      fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method,
        redirect: 'manual',
        headers: {
          Origin: origin,
          'X-FerWeb-Request': '1',
          'Content-Type': 'application/json',
          ...(session ? { Cookie: session } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function ok(method: string, path: string, body?: unknown, status = 200) {
      const r = await request(method, path, body);
      assert.equal(r.status, status, await r.clone().text());
      return r.json();
    }
    async function login(email: string) {
      const r = await request('POST', '/auth/login', { email, password }, '');
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie')!.split(';')[0]!;
    }
    cookie = await login(owner.email);
    const foreign = await login('foreign@ferweb.test');
    const root = `/projects/${project}`,
      gh = root + '/github',
      work = gh + '/work';
    const auth = new URL((await ok('POST', '/github/authorize', {})).url);
    assert.equal(
      (
        await request(
          'GET',
          `/github/callback?state=${auth.searchParams.get('state')}&code=fixture-code`,
        )
      ).status,
      303,
    );
    assert.equal(
      (await request('POST', '/github/installations', { installationId: 71 })).status,
      204,
    );
    await ok('POST', gh, { installationId: 71, repositoryId: 101, version: 0 });
    let linkVersion = (await ok('POST', gh + '/sync', { version: 1 })).link.version;
    async function sync() {
      const data = await ok('POST', gh + '/sync', { version: linkVersion });
      linkVersion = data.link.version;
      return data;
    }
    async function task(title: string, p = project) {
      return (
        await ok(
          'POST',
          `/projects/${p}/tasks`,
          {
            title,
            description: 'Local authoritative text',
            priority: 'medium',
            status: 'todo',
            acceptanceCriteria: [],
          },
          201,
        )
      ).task;
    }
    const current = async (id: string) => (await ok('GET', root + `/tasks/${id}`)).task;
    async function coordinate(id: string, changes = {}) {
      const row = await current(id);
      return ok('PATCH', root + `/tasks/${id}/coordination`, {
        version: row.version,
        kind: 'task',
        parentEpicId: null,
        dependsOn: [],
        blocker: null,
        claim: { kind: 'none' },
        ...changes,
      });
    }
    async function status(id: string, value: string, expected = 200) {
      const row = await current(id);
      const { title, description, priority, acceptanceCriteria, version } = row;
      return ok(
        'PATCH',
        root + `/tasks/${id}`,
        { title, description, priority, acceptanceCriteria, version, status: value },
        expected,
      );
    }
    const epic = await task('P18 epic'),
      child = await task('P18 child'),
      prerequisite = await task('P18 prerequisite');
    let action: any;
    const prepare = async (id: string, title = 'P18 reviewed issue') =>
      ok(
        'POST',
        work + '/issues/prepare',
        {
          requestId: randomUUID(),
          taskId: id,
          taskVersion: (await current(id)).version,
          linkVersion,
          title,
          body: 'Explicit reviewed content',
        },
        201,
      );
    const effect = (a: any, suffix: string, hash = a.hash) =>
      request('POST', work + `/actions/${a.id}/${suffix}`, { hash });

    await t.test(
      'local hierarchy, claims, DAG, optimistic conflicts and isolation are enforced',
      async () => {
        await coordinate(epic.id, { kind: 'epic' });
        const before = await current(child.id);
        let graph = await coordinate(child.id, {
          parentEpicId: epic.id,
          dependsOn: [prerequisite.id],
          claim: { kind: 'owner' },
        });
        const node = graph.tasks.find((r: any) => r.id === child.id);
        assert.equal(node.claim.owner, owner.email);
        assert.deepEqual(node.blockedBy, [prerequisite.id]);
        assert.equal(
          (
            await request('PATCH', root + `/tasks/${child.id}/coordination`, {
              version: before.version,
              kind: 'task',
              parentEpicId: null,
              dependsOn: [],
              blocker: null,
              claim: { kind: 'none' },
            })
          ).status,
          409,
        );
        assert.equal(
          (await request('GET', root + '/coordination', undefined, foreign)).status,
          404,
        );
        assert.equal((await request('GET', work, undefined, foreign)).status, 404);
        const foreignTask = await task('Other project task', otherProject);
        for (const changes of [{ dependsOn: [foreignTask.id] }, { parentEpicId: foreignTask.id }]) {
          const r = await request('PATCH', root + `/tasks/${child.id}/coordination`, {
            version: node.version,
            kind: 'task',
            parentEpicId: null,
            dependsOn: [],
            blocker: null,
            claim: { kind: 'none' },
            ...changes,
          });
          assert.equal(r.status, 409);
        }
        for (const changes of [
          { dependsOn: [child.id] },
          { dependsOn: [epic.id], parentEpicId: epic.id },
        ]) {
          const r = await request('PATCH', root + `/tasks/${child.id}/coordination`, {
            version: node.version,
            kind: 'task',
            parentEpicId: null,
            dependsOn: [],
            blocker: null,
            claim: { kind: 'none' },
            ...changes,
          });
          assert.equal(r.status, 422);
          assert.equal((await r.json()).error.code, 'dependency_cycle');
        }
        await status(child.id, 'in_progress', 409);
        await status(epic.id, 'done', 409);
        await status(prerequisite.id, 'done');
        await status(child.id, 'in_progress');
        await status(child.id, 'done');
        await status(epic.id, 'done');
        graph = await ok('GET', root + '/coordination');
        assert.deepEqual(graph.tasks.find((r: any) => r.id === epic.id).blockedBy, []);
      },
    );
    await t.test(
      'repeated stable-identity sync preserves FerWeb ownership, text and dependencies',
      async () => {
        const row = await current(child.id);
        const input = {
          taskId: child.id,
          taskVersion: row.version,
          linkVersion,
          kind: 'issue',
          itemId: 1001,
        };
        await ok('POST', work + '/link', input);
        await ok('POST', work + '/link', input);
        assert.equal((await ok('GET', work)).links.length, 1);
        fixture.state.workIssueState = 'closed';
        fixture.state.workIssueNumber = 9;
        await sync();
        await sync();
        const data = await ok('GET', work);
        assert.equal(data.links.length, 1);
        assert.equal(data.links[0].itemId, 1001);
        assert.equal(data.links[0].number, 9);
        assert.equal(data.links[0].observation.state, 'closed');
        assert.deepEqual(data.links[0].observation.labels, ['untrusted-owner-label']);
        assert.deepEqual(await current(child.id), row);
        const graph = await ok('GET', root + '/coordination'),
          node = graph.tasks.find((r: any) => r.id === child.id);
        assert.equal(node.claim.owner, owner.email);
        assert.deepEqual(node.dependsOn, [prerequisite.id]);
        const duplicate = {
          ...input,
          taskId: prerequisite.id,
          taskVersion: (await current(prerequisite.id)).version,
          linkVersion,
        };
        assert.equal((await request('POST', work + '/link', duplicate)).status, 409);
        fixture.state.workIssuesMissing = true;
        await sync();
        assert.equal((await ok('GET', work)).links[0].state, 'missing');
        fixture.state.workIssuesPartial = true;
        await sync();
        assert.equal((await ok('GET', work)).links[0].state, 'unconfirmed');
        fixture.state.workIssuesMissing = false;
        fixture.state.workIssuesPartial = false;
        await sync();
        assert.equal((await ok('GET', work)).links[0].state, 'present');
      },
    );
    await t.test(
      'blockers stop admission without jobs; matching team claim is required and invalid claims cannot grant access',
      async () => {
        const blocked = await task('P18 blocked code');
        await coordinate(blocked.id, { blocker: 'Human decision required' });
        const before = (
          await pool.query('SELECT count(*)::int AS n FROM jobs WHERE project_id=$1', [project])
        ).rows[0].n;
        const row = await current(blocked.id);
        const r = await request('POST', root + '/coding', {
          requestId: randomUUID(),
          taskId: row.id,
          taskVersion: row.version,
          commit: 'a'.repeat(40),
          model: 'fixture-codex',
          timeoutMs: 60000,
          maxRequests: 4,
          maxOutputTokens: 1024,
        });
        assert.equal(r.status, 409, await r.clone().text());
        assert.equal((await r.json()).error.code, 'task_blocked');
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM jobs WHERE project_id=$1', [project]))
            .rows[0].n,
          before,
        );
        const invalid = await request('PATCH', root + `/tasks/${blocked.id}/coordination`, {
          version: row.version,
          kind: 'task',
          parentEpicId: null,
          dependsOn: [],
          blocker: null,
          claim: { kind: 'team', templateId: randomUUID(), templateVersion: 1 },
        });
        assert.equal(invalid.status, 409);
        // Planning metadata may be reviewed while a task remains blocked; it never advances execution.
        assert.equal((await prepare(blocked.id)).action.state, 'prepared');
        const roles = [];
        for (const template of ['implementer', 'reviewer'])
          roles.push((await ok('POST', root + '/agents', { template }, 201)).role);
        const definition = {
          name: 'P18 claiming team',
          description: 'Claims fixture',
          maxIterations: 1,
          limits: { maxRequests: 6, timeoutMs: 120000, concurrency: 1 },
          steps: [
            {
              key: 'implement',
              title: 'Implement',
              role: { id: roles[0].id, version: 1 },
              dependsOn: [],
              exitCriteria: ['Changed'],
              requiredCapabilities: ['text', 'workspaceWrite'],
              maxRequests: 3,
            },
            {
              key: 'review',
              title: 'Review',
              role: { id: roles[1].id, version: 1 },
              dependsOn: ['implement'],
              exitCriteria: ['Reviewed'],
              requiredCapabilities: ['text'],
              maxRequests: 2,
            },
          ],
        };
        const template = (await ok('POST', root + '/team-templates', { definition }, 201)).template;
        const other = (
          await ok(
            'POST',
            root + '/team-templates',
            { definition: { ...definition, name: 'Other P18 team' } },
            201,
          )
        ).template;
        await coordinate(blocked.id, {
          claim: { kind: 'team', templateId: template.id, templateVersion: 1 },
        });
        const claimed = await current(blocked.id);
        const denied = await request('POST', root + '/coding', {
          requestId: randomUUID(),
          taskId: claimed.id,
          taskVersion: claimed.version,
          commit: 'a'.repeat(40),
          model: 'fixture-codex',
          timeoutMs: 60000,
          maxRequests: 4,
          maxOutputTokens: 1024,
        });
        assert.equal(denied.status, 409);
        assert.equal((await denied.json()).error.code, 'task_claimed');
        for (const [id, expected] of [
          [other.id, 409],
          [template.id, 202],
        ] as const) {
          const plan = (
            await ok(
              'POST',
              root + '/team-plans',
              {
                requestId: randomUUID(),
                taskId: claimed.id,
                taskVersion: claimed.version,
                templateId: id,
                templateVersion: 1,
                mode: 'team',
                executionId: 'codex-v1',
                model: 'fixture-codex',
              },
              201,
            )
          ).plan;
          await ok('POST', root + `/team-plans/${plan.id}/approve`, {
            hash: plan.hash,
            version: 1,
          });
          const started = await request('POST', root + `/team-plans/${plan.id}/execute`, {
            requestId: randomUUID(),
            hash: plan.hash,
            version: 1,
            commit: 'a'.repeat(40),
          });
          assert.equal(started.status, expected, await started.clone().text());
          if (expected === 409) assert.equal((await started.json()).error.code, 'task_claimed');
        }
      },
    );
    await t.test(
      'preview content/version/hash, explicit Issues permission and idempotency are enforced before writes',
      async () => {
        const row = await task('P18 issue owner');
        const input = {
          requestId: randomUUID(),
          taskId: row.id,
          taskVersion: row.version,
          linkVersion,
          title: 'Reviewed title',
          body: 'Reviewed body',
        };
        action = (await ok('POST', work + '/issues/prepare', input, 201)).action;
        assert.equal((await ok('POST', work + '/issues/prepare', input, 201)).action.id, action.id);
        assert.equal(
          (await request('POST', work + '/issues/prepare', { ...input, body: 'Changed' })).status,
          409,
        );
        assert.equal(fixture.state.issueWrites.length, 0);
        assert.match(action.snapshot.body, new RegExp(`ferweb-issue:${action.id}`));
        assert.equal((await effect(action, 'execute', '0'.repeat(64))).status, 409);
        assert.equal(
          (await request('GET', work + `/actions/${action.id}`, undefined, foreign)).status,
          404,
        );
        fixture.state.issueWritePermission = false;
        assert.equal((await effect(action, 'execute')).status, 403);
        assert.equal(fixture.state.issueWrites.length, 0);
        fixture.state.issueWritePermission = true;
      },
    );
    await t.test(
      'lost write response stays uncertain; reconciliation recovers the same issue once without POST retry',
      async () => {
        fixture.state.loseIssueResponse = true;
        fixture.state.pushPermission = false;
        assert.equal((await effect(action, 'execute')).status, 409);
        assert.equal((await ok('GET', work + `/actions/${action.id}`)).action.state, 'uncertain');
        assert.equal(fixture.state.issueWrites.length, 1);
        assert.equal((await effect(action, 'execute')).status, 409);
        const alternate = (await prepare(action.taskId)).action;
        assert.equal((await effect(alternate, 'execute')).status, 409);
        await pool.query(
          "UPDATE github_issue_actions SET state='sending',lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",
          [action.id],
        );
        assert.equal((await effect(action, 'reconcile')).status, 409);
        await pool.query(
          "UPDATE github_issue_actions SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
          [action.id],
        );
        fixture.state.workIssuesMissing = true;
        assert.equal((await effect(action, 'reconcile')).status, 409);
        fixture.state.workIssuesPartial = true;
        assert.equal((await effect(action, 'reconcile')).status, 409);
        fixture.state.workIssuesMissing = false;
        fixture.state.workIssuesPartial = false;
        const remoteIssue = fixture.state.createdIssues[0];
        const reviewedBody = remoteIssue.body;
        remoteIssue.body = reviewedBody.padEnd(20001, 'x');
        const access = await github.issueAccess(owner.id, project, 101, linkVersion, false);
        const candidates = await access.api.issueCandidates(access.token, access.fullName);
        assert.equal(
          candidates.items.find((item) => item.id === remoteIssue.id)?.body.length,
          20001,
        );
        assert.equal((await effect(action, 'reconcile')).status, 409);
        remoteIssue.body = reviewedBody;
        const published = await effect(action, 'reconcile');
        assert.equal(published.status, 200, await published.clone().text());
        const recovered = (await published.json()).action;
        assert.equal(recovered.state, 'published');
        assert.equal(recovered.item.id, fixture.state.createdIssues[0].id);
        assert.equal((await effect(action, 'reconcile')).status, 200);
        assert.equal((await effect(action, 'execute')).status, 200);
        assert.equal(fixture.state.issueWrites.length, 1);
        fixture.state.pushPermission = true;
        const data = await ok('GET', work);
        assert.equal(data.links.filter((r: any) => r.taskId === action.taskId).length, 1);
        assert.equal(data.links.find((r: any) => r.taskId === action.taskId).origin, 'created');
      },
    );
    await t.test(
      'stale versions, archive and revocation block new effects and sensitive reads',
      async () => {
        const row = await task('P18 stale preview'),
          draft = (await prepare(row.id)).action;
        await coordinate(row.id, { claim: { kind: 'owner' } });
        assert.equal((await effect(draft, 'execute')).status, 409);
        assert.equal(
          (await ok('GET', work + `/actions/${draft.id}`)).action.conditionsCurrent,
          false,
        );
        const fresh = (await prepare(row.id)).action;
        const p = (await ok('GET', root)).project;
        await ok('PATCH', root, { version: p.version, archived: true });
        assert.equal((await effect(fresh, 'execute')).status, 409);
        assert.equal(
          (
            await request('POST', work + '/issues/prepare', {
              requestId: randomUUID(),
              taskId: row.id,
              taskVersion: (await current(row.id)).version,
              linkVersion,
              title: 'Archived',
              body: '',
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request('PATCH', root + `/tasks/${row.id}/coordination`, {
              version: (await current(row.id)).version,
              kind: 'task',
              parentEpicId: null,
              dependsOn: [],
              blocker: null,
              claim: { kind: 'none' },
            })
          ).status,
          409,
        );
        assert.equal(
          (await ok('GET', work + `/actions/${fresh.id}`)).action.conditionsCurrent,
          false,
        );
        await ok('PATCH', root, { version: p.version + 1, archived: false });
        fixture.state.denied = true;
        assert.equal((await request('GET', work)).status, 403);
        assert.equal((await request('GET', work + `/actions/${action.id}`)).status, 403);
        assert.equal((await effect(fresh, 'execute')).status, 403);
        assert.equal((await request('GET', root + '/coordination')).status, 200);
        assert.equal(fixture.state.issueWrites.length, 1);
      },
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
