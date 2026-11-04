import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import {
  codingCapabilities,
  codingReport,
  codingComparisons,
  reviewResponse,
} from '@ferweb/contracts';
import { createPool } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { createDatabaseAdmin } from './database-admin.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { inspectDatabase } from '../src/health.js';
import { createApp } from '../src/app.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { GitHubService } from '../src/modules/github/service.js';
import { CodingService } from '../src/modules/jobs/coding-service.js';
import { ReviewService } from '../src/modules/jobs/review-service.js';
import { RunnerClient } from '../src/modules/jobs/runner-client.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { publicationFixture } from '../../../tests/fixtures/publication.mjs';
import { codingCorpus } from '../../../tests/fixtures/coding.mjs';
import { differences } from '../../runner/files.mjs';

test('review/publication: real HTTP and SQL, GitHub write double (reports explicitly seeded)', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    pool = createPool({ ...config, POSTGRES_DB: database }),
    fixture = publicationFixture(codingCorpus(githubFixture())),
    github = new GitHubService(pool, fixture.config, fixture.transport),
    runner = new RunnerClient('', ''),
    coding = new CodingService(pool, github, runner);
  const environment = {
    image: 'sha256:fixture-pinned-image',
    profile: 'node-test',
    tools: ['node', 'shell'],
    policyHash: 'fixed',
  };
  runner.capabilities = async () => ({
    ...codingCapabilities.parse({
      available: true,
      simulated: true,
      models: ['fixture-a', 'fixture-b'],
      environment,
    }),
    reason: null,
  });
  let server: import('node:http').Server | undefined,
    created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'review-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'review-other@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
      await pool.query(
        "INSERT INTO projects(owner_id,name) VALUES($1,'Review fixture') RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;
    const task = (
      await pool.query(
        "INSERT INTO tasks(project_id,title,description,priority,status,acceptance_criteria) VALUES($1,'Fix addition','Preserve tests','high','todo',$2) RETURNING id,version",
        [project, JSON.stringify(['Add correctly'])],
      )
    ).rows[0]!;
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      github,
      coding,
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
        redirect: 'manual',
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
      foreign = await login('review-other@ferweb.test');
    const auth = await github.start(owner.id, cookie.split('=')[1]!);
    await github.callback(new URL(auth.url).searchParams.get('state')!, 'fixture-code');
    await github.connect(owner.id, 71);
    await github.link(owner.id, project, { installationId: 71, repositoryId: 101, version: 0 });
    await github.sync(owner.id, project, 1);
    const path = (id: string) => `/projects/${project}/coding/${id}`;
    async function run() {
      const job = await coding.create(owner.id, project, {
        requestId: randomUUID(),
        taskId: task.id,
        taskVersion: task.version,
        commit: 'a'.repeat(40),
        model: 'fixture-a',
        timeoutMs: 60000,
        maxRequests: 8,
        maxOutputTokens: 1024,
      });
      const source = (
        await pool.query('SELECT files FROM coding_runs WHERE job_id=$1', [job.job.id])
      ).rows[0]!;
      const final = source.files.map((f: { path: string; content: string }) =>
        f.path === 'src/add.cjs' ? { ...f, content: 'exports.add = (a, b) => a + b;\n' } : f,
      );
      const report = codingReport.parse({
        kind: 'codex-v1',
        jobId: job.job.id,
        commit: 'a'.repeat(40),
        repository: 'demo/ferweb',
        task: {},
        model: 'fixture-a',
        cliVersion: 'fixture',
        simulated: true,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        summary: 'Seeded report; this test does not execute code.',
        commands: [],
        tests: [
          { command: 'node --test', output: 'seeded success', exitCode: 0, origin: 'fixture' },
        ],
        diff: differences(source.files, final),
        diffComplete: true,
        usage: null,
        cost: null,
        durationMs: 100,
        modelRequests: 1,
        terminationConfirmed: true,
        limitations: ['Seeded test report'],
      });
      await pool.query("UPDATE jobs SET state='completed',finished_at=now() WHERE id=$1", [
        job.job.id,
      ]);
      await pool.query('UPDATE coding_runs SET report=$2 WHERE job_id=$1', [
        job.job.id,
        JSON.stringify(report),
      ]);
      return job.job.id;
    }
    const input = (id: string, version = 0, approved = true) => ({
      version,
      title: 'Correct addition',
      body: 'Reviewed test fixture change.',
      branch: `ferweb/test-${id}`,
      approved,
      notes: 'Human fixture review',
    });
    async function save(id: string, version = 0, approved = true) {
      const r = await request('PUT', path(id) + '/review', input(id, version, approved), cookie);
      assert.equal(r.status, 200, await r.clone().text());
      return reviewResponse.parse(await r.json()).review!;
    }
    const publish = (id: string, version = 1, session = cookie) =>
      request('POST', path(id) + '/review/publish', { version }, session);

    await t.test(
      'review is durable/versioned, human approval is explicit, reads and saves never write GitHub; foreign scopes are denied',
      async () => {
        const id = await run();
        const before = fixture.state.writes.length;
        assert.equal((await request('GET', path(id) + '/review', undefined, cookie)).status, 200);
        await save(id, 0, false);
        assert.equal((await publish(id)).status, 409);
        assert.equal((await request('PUT', path(id) + '/review', input(id), cookie)).status, 409);
        await save(id, 1);
        assert.equal((await publish(id, 1)).status, 409);
        assert.equal(
          (await new ReviewService(coding).read(owner.id, project, id)).review?.notes,
          'Human fixture review',
        );
        for (const [method, suffix, body] of [
          ['GET', '/review', undefined],
          ['PUT', '/review', input(id)],
          ['POST', '/review/publish', { version: 2 }],
          ['GET', '/comparisons', undefined],
          ['POST', '/repeat', { requestId: randomUUID(), model: 'fixture-b' }],
        ] as const)
          assert.equal((await request(method, path(id) + suffix, body, foreign)).status, 404);
        assert.equal(fixture.state.writes.length, before);
        assert.equal(
          (await request('PUT', path(id) + '/review', { ...input(id, 2), branch: 'main' }, cookie))
            .status,
          400,
        );
      },
    );
    await t.test(
      'remote write permissions, user push rights, archive and current base are checked before writes',
      async () => {
        const id = await run();
        await save(id);
        const before = fixture.state.writes.length;
        fixture.state.writePermissions = false;
        assert.equal((await publish(id)).status, 403);
        fixture.state.writePermissions = true;
        fixture.state.pushPermission = false;
        assert.equal((await publish(id)).status, 403);
        fixture.state.pushPermission = true;
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [project]);
        assert.equal((await publish(id)).status, 409);
        await pool.query('UPDATE projects SET archived_at=NULL WHERE id=$1', [project]);
        fixture.state.commit = 'b'.repeat(40);
        const stale = await publish(id);
        assert.equal(stale.status, 409);
        assert.equal((await stale.json()).error.code, 'review_base_changed');
        fixture.state.commit = 'a'.repeat(40);
        assert.equal(fixture.state.writes.length, before);
      },
    );
    await t.test(
      'lost commit/ref/PR responses reconcile deterministically; repeated publication creates one branch and PR',
      async () => {
        for (const endpoint of ['/git/commits', '/git/refs', '/pulls']) {
          const id = await run();
          await save(id);
          fixture.state.failAfter = '/repos/demo/ferweb' + endpoint;
          const beforeRefs = fixture.state.refs.size,
            beforePulls = fixture.state.publishedPulls.length;
          assert.equal((await publish(id)).status, 502);
          // PR already exists despite the missing response; the base may move afterwards.
          if (endpoint === '/pulls') fixture.state.commit = 'c'.repeat(40);
          const again = await publish(id);
          assert.equal(again.status, 200, await again.clone().text());
          const review = reviewResponse.parse(await again.json()).review!;
          assert.equal(review.state, 'published');
          assert.equal(review.baseChanged, endpoint === '/pulls');
          assert.equal((await publish(id)).status, 200);
          assert.equal(fixture.state.refs.size, beforeRefs + 1);
          assert.equal(fixture.state.publishedPulls.length, beforePulls + 1);
          assert.equal(fixture.state.commits.get(review.commit).parents[0], 'a'.repeat(40));
          const tree = fixture.state.trees.get(fixture.state.commits.get(review.commit).tree);
          assert.equal(tree.base_tree, 'e'.repeat(40));
          assert.equal(tree.tree.length, 1);
          assert.equal(tree.tree[0].content, 'exports.add = (a, b) => a + b;\n');
          assert.match(fixture.state.publishedPulls.at(-1).body, new RegExp(id));
          assert.equal(
            (await request('PUT', path(id) + '/review', input(id, 1), cookie)).status,
            409,
          );
          fixture.state.commit = 'a'.repeat(40);
        }
      },
    );
    await t.test(
      'concurrent publishes reserve one durable attempt and expired reservations can be recovered',
      async () => {
        const id = await run();
        await save(id);
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>((r) => {
            enter = r;
          }),
          barrier = new Promise<void>((r) => {
            release = r;
          });
        fixture.state.beforeWrite = async (remote: string) => {
          if (remote.endsWith('/git/trees')) {
            enter();
            await barrier;
          }
        };
        const first = publish(id);
        try {
          await entered;
          assert.equal((await publish(id)).status, 409);
        } finally {
          fixture.state.beforeWrite = null;
          release();
        }
        assert.equal((await first).status, 200);
        const lost = await run();
        await save(lost);
        await pool.query(
          "UPDATE coding_reviews SET state='publishing',attempt_token=$2,lease_until=now()+interval '10 seconds',attempted_at=now() WHERE job_id=$1",
          [lost, randomUUID()],
        );
        assert.equal((await publish(lost)).status, 409);
        await pool.query(
          "UPDATE coding_reviews SET lease_until=now()-interval '1 second' WHERE job_id=$1",
          [lost],
        );
        assert.equal((await publish(lost)).status, 200);
      },
    );
    await t.test(
      'remote branch collision, changed reviewed report, incomplete artifacts and revocation fail closed',
      async () => {
        const collision = await run();
        const review = await save(collision);
        fixture.state.refs.set('refs/heads/' + review.branch, 'f'.repeat(40));
        assert.equal((await publish(collision)).status, 409);
        assert.equal(fixture.state.refs.get('refs/heads/' + review.branch), 'f'.repeat(40));
        const changed = await run();
        await save(changed);
        await pool.query(
          "UPDATE coding_runs SET report=jsonb_set(report,'{summary}','\"changed\"') WHERE job_id=$1",
          [changed],
        );
        assert.equal((await publish(changed)).status, 409);
        const incomplete = await run();
        await pool.query(
          "UPDATE coding_runs SET report=jsonb_set(report,'{diffComplete}','false') WHERE job_id=$1",
          [incomplete],
        );
        assert.equal(
          (await request('PUT', path(incomplete) + '/review', input(incomplete), cookie)).status,
          422,
        );
        const denied = await run();
        await save(denied);
        fixture.state.denied = true;
        assert.equal((await publish(denied)).status, 403);
        fixture.state.denied = false;
        // Reconnect explicitly after the access check invalidated the local snapshot.
        await github.link(owner.id, project, { installationId: 71, repositoryId: 101, version: 2 });
        await github.sync(owner.id, project, 3);
      },
    );
    await t.test(
      'base movement between branch and PR blocks writes; race during PR is recorded as requiring a new review',
      async () => {
        const id = await run();
        await save(id);
        const before = fixture.state.publishedPulls.length;
        fixture.state.beforeWrite = async (remote: string) => {
          if (remote.endsWith('/git/refs')) fixture.state.commit = 'd'.repeat(40);
        };
        assert.equal((await publish(id)).status, 409);
        assert.equal(fixture.state.publishedPulls.length, before);
        fixture.state.beforeWrite = null;
        fixture.state.commit = 'a'.repeat(40);
        assert.equal((await publish(id)).status, 200);
        const race = await run();
        await save(race);
        fixture.state.beforeWrite = async (remote: string) => {
          if (remote.endsWith('/pulls')) fixture.state.commit = 'd'.repeat(40);
        };
        const published = await publish(race);
        assert.equal(published.status, 200);
        assert.equal(reviewResponse.parse(await published.json()).review?.baseChanged, true);
        fixture.state.beforeWrite = null;
        fixture.state.commit = 'a'.repeat(40);
      },
    );
    await t.test(
      'comparisons preserve frozen task/criteria/files/tools/limits; model alone can change and differences are disclosed',
      async () => {
        const id = await run(),
          source = await coding.read(owner.id, project, id);
        await pool.query(
          "UPDATE tasks SET title='Edited after freezing',acceptance_criteria='[\"different\"]',version=version+1 WHERE id=$1",
          [task.id],
        );
        const body = { requestId: randomUUID(), model: 'fixture-b' };
        const response = await request('POST', path(id) + '/repeat', body, cookie);
        assert.equal(response.status, 202);
        const repeated = (await response.json()).job;
        assert.equal(repeated.configuration.model, 'fixture-b');
        assert.deepEqual((await coding.read(owner.id, project, repeated.id)).task, source.task);
        assert.deepEqual(
          (await coding.read(owner.id, project, repeated.id)).manifest,
          source.manifest,
        );
        assert.equal(
          (await (await request('POST', path(id) + '/repeat', body, cookie)).json()).job.id,
          repeated.id,
        );
        const compare = async () => {
          const r = await request('GET', path(id) + '/comparisons', undefined, cookie);
          assert.equal(r.status, 200, await r.clone().text());
          return codingComparisons.parse(await r.json());
        };
        assert.equal((await compare()).runs.find((r) => r.jobId === repeated.id)?.comparable, true);
        await pool.query(
          "UPDATE jobs SET configuration=jsonb_set(configuration,'{maxRequests}','2') WHERE id=$1",
          [repeated.id],
        );
        assert.ok(
          (await compare()).runs
            .find((r) => r.jobId === repeated.id)
            ?.differences.includes('configuration'),
        );
        await pool.query('UPDATE coding_runs SET environment=NULL WHERE job_id=$1', [repeated.id]);
        assert.ok(
          (await compare()).runs
            .find((r) => r.jobId === repeated.id)
            ?.differences.includes('unrecordedEnvironment'),
        );
        runner.capabilities = async () => ({
          ...codingCapabilities.parse({
            available: true,
            simulated: true,
            models: ['fixture-b'],
            environment: { ...environment, image: 'different-image' },
          }),
          reason: null,
        });
        assert.equal(
          (
            await request(
              'POST',
              path(id) + '/repeat',
              { requestId: randomUUID(), model: 'fixture-b' },
              cookie,
            )
          ).status,
          409,
        );
      },
    );
  } finally {
    fixture.state.beforeWrite = null;
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((e) => (e ? reject(e) : resolve())),
      );
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
