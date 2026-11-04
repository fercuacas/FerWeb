import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  codingCapabilitiesResponse,
  codingRunSchema,
  executionCatalogSchema,
  jobDetailSchema,
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
import { RunnerClient } from '../src/modules/jobs/runner-client.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { codingCorpus } from '../../../tests/fixtures/coding.mjs';

test('Codex CLI with simulated Responses: isolated real containers, immutable input, reports and cancellation', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    pool = createPool({ ...config, POSTGRES_DB: database });
  const runner = new RunnerClient(process.env.RUNNER_URL!, process.env.RUNNER_SERVICE_TOKEN!);
  let created = false,
    server: import('node:http').Server | undefined,
    worker: ChildProcess | undefined;
  const fixture = codingCorpus(githubFixture()),
    github = new GitHubService(pool, fixture.config, fixture.transport),
    coding = new CodingService(pool, github, runner);
  async function waitFor<T>(action: () => Promise<T | false>, timeout = 40000): Promise<T> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = await action();
      if (result) return result;
      await delay(100);
    }
    throw Error('Coding fixture timed out');
  }
  async function stopWorker(signal: NodeJS.Signals = 'SIGTERM') {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const exit = once(worker, 'exit');
      worker.kill(signal);
      await exit;
    }
  }
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'coding-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'coding-other@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
      await pool.query(
        "INSERT INTO projects(owner_id,name) VALUES($1,'Coding fixture') RETURNING id",
        [owner.id],
      )
    ).rows[0].id as string;
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      github,
      coding,
      runnerToken: process.env.RUNNER_SERVICE_TOKEN!,
      appOrigin: origin,
      secureCookies: false,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (method: string, path: string, body?: unknown, cookie?: string) =>
      fetch(base + '/api' + path, {
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
    async function login(email: string) {
      const r = await request('POST', '/auth/login', { email, password });
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie')!.split(';')[0]!;
    }
    const cookie = await login(owner.email),
      foreign = await login('coding-other@ferweb.test');
    const auth = await github.start(owner.id, cookie.split('=')[1]!);
    const state = new URL(auth.url).searchParams.get('state')!;
    await github.callback(state, 'fixture-code');
    await github.connect(owner.id, 71);
    await github.link(owner.id, project, { installationId: 71, repositoryId: 101, version: 0 });
    await github.sync(owner.id, project, 1);
    async function task(title: string) {
      return (
        await pool.query(
          "INSERT INTO tasks(project_id,title,description,priority,status) VALUES($1,$2,$3,'medium','todo') RETURNING id,version",
          [project, title, 'Fix add without changing tests. Return evidence.'],
        )
      ).rows[0];
    }
    async function enqueue(title = 'Fix addition', extra: Record<string, unknown> = {}) {
      const taskRow = await task(title);
      const body = {
        requestId: randomUUID(),
        taskId: taskRow.id,
        taskVersion: taskRow.version,
        commit: 'a'.repeat(40),
        model: 'fixture-codex',
        timeoutMs: 60000,
        maxRequests: 8,
        maxOutputTokens: 1024,
        ...extra,
      };
      const r = await request('POST', `/projects/${project}/coding`, body, cookie);
      assert.equal(r.status, 202, await r.clone().text());
      return { job: jobDetailSchema.parse(await r.json()).job, body };
    }
    async function detail(id: string) {
      const r = await request('GET', `/projects/${project}/jobs/${id}`, undefined, cookie);
      assert.equal(r.status, 200);
      return jobDetailSchema.parse(await r.json());
    }
    async function report(id: string) {
      const r = await request('GET', `/projects/${project}/coding/${id}`, undefined, cookie);
      assert.equal(r.status, 200);
      return codingRunSchema.parse(await r.json());
    }
    const terminal = (id: string) =>
      waitFor(async () => {
        const d = await detail(id);
        return !['pending', 'running'].includes(d.job.state) ? d : false;
      });
    async function startWorker() {
      worker = spawn(process.execPath, ['apps/api/dist/job-worker.js'], {
        env: {
          ...process.env,
          POSTGRES_DB: database,
          JOB_WORKER_HEALTH_PORT: '0',
          JOB_WORKER_LEASE_MS: '6000',
          FERWEB_INTERNAL_API_URL: base,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      worker.stdout!.on('data', (d) => {
        text += d.toString();
      });
      worker.stderr!.on('data', () => {});
      await waitFor(async () => text.includes('job_worker_ready'));
    }
    await t.test(
      'execution diagnostics require a session and keep capabilities project-scoped',
      async () => {
        assert.equal((await request('GET', '/execution/capabilities')).status, 401);
        const status = await request('GET', '/execution/capabilities', undefined, cookie);
        assert.equal(status.status, 200);
        const { options } = executionCatalogSchema.parse(await status.json());
        const codex = options.find((item) => item.id === 'codex-v1');
        assert.ok(codex);
        assert.equal(codex.destination, 'simulated');
        assert.equal(codex.available, true);
        assert.match(codex.configurationRevision ?? '', /^[a-f0-9]{64}$/);
        assert.equal(codex.capabilities.toolCalls, 'supported');
        assert.equal(codex.capabilities.usage, 'unknown');
        const ollama = options.find((item) => item.id === 'ollama-chat');
        assert.ok(ollama);
        assert.equal(ollama.reason, 'ai_unconfigured');
        assert.equal(ollama.destination, 'unknown');
        assert.equal(ollama.simulated, null);
        assert.equal(ollama.capabilities.workspaceWrite, 'unsupported');
        const path = `/projects/${project}/coding/capabilities`;
        assert.equal((await request('GET', path, undefined, foreign)).status, 404);
        const allowed = await request('GET', path, undefined, cookie);
        assert.equal(allowed.status, 200);
        const payload = codingCapabilitiesResponse.parse(await allowed.json());
        assert.deepEqual(payload.execution, codex);
        assert.deepEqual(payload.models, ['fixture-codex']);
      },
    );
    await t.test(
      'strict task/commit admission, scope, immutable snapshots, real Codex tools and independent diff/tests',
      async () => {
        assert.equal((await runner.capabilities()).simulated, true);
        const { job, body } = await enqueue();
        const repeated = await request('POST', `/projects/${project}/coding`, body, cookie);
        assert.equal(repeated.status, 202);
        assert.equal((await repeated.json()).job.id, job.id);
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${project}/coding`,
              { ...body, model: 'other' },
              cookie,
            )
          ).status,
          409,
        );
        const forbiddenModel = await request(
          'POST',
          `/projects/${project}/coding`,
          { ...body, requestId: randomUUID(), model: 'other' },
          cookie,
        );
        assert.equal(forbiddenModel.status, 503);
        assert.match((await forbiddenModel.json()).error.message, /modelo no está permitido/i);
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${project}/coding`,
              {
                ...body,
                requestId: randomUUID(),
                provider: 'ollama',
              },
              cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${project}/coding`,
              { ...body, requestId: randomUUID(), command: 'echo unsafe' },
              cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request('GET', `/projects/${project}/coding/${job.id}`, undefined, foreign))
            .status,
          404,
        );
        assert.equal(
          (await request('POST', `/projects/${project}/jobs/${job.id}/cancel`, {}, foreign)).status,
          404,
        );
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${project}/coding`,
              { ...body, requestId: randomUUID(), commit: 'b'.repeat(40) },
              cookie,
            )
          ).status,
          409,
        );
        await pool.query(
          "UPDATE tasks SET title='Later edited task',version=version+1 WHERE id=$1",
          [body.taskId],
        );
        await startWorker();
        const done = await terminal(job.id);
        assert.equal(done.job.state, 'completed', `Terminal error: ${done.job.errorCode}`);
        assert.equal(done.job.attempt, 1);
        const run = await report(job.id),
          r = run.report!;
        assert.equal(run.task.title, 'Fix addition');
        assert.equal(run.commit, 'a'.repeat(40));
        assert.equal(r.simulated, true);
        assert.equal(r.terminationConfirmed, true);
        assert.equal(r.diffComplete, true);
        assert.equal(r.diff.length, 1);
        assert.equal(r.diff[0]!.path, 'src/add.cjs');
        assert.match(r.diff[0]!.patch, /-exports.add = \(a, b\) => a - b/);
        assert.match(r.diff[0]!.patch, /\+exports.add = \(a, b\) => a \+ b/);
        assert.match(r.commands.map((x) => x.output).join('\n'), /ISOLATION_OK/);
        assert.match(r.commands.map((x) => x.output).join('\n'), /fail 1/);
        assert.equal(r.tests[0]!.exitCode, 0);
        assert.equal(r.tests[0]!.origin, 'controller-verification');
        assert.ok(r.durationMs! > 0);
        assert.ok(r.usage!.inputTokens! > 0);
        assert.equal(r.cost, null);
        assert.ok(run.excluded.includes('link'));
        assert.ok(!run.manifest.some((x) => /\.env|AGENTS|credentials/.test(x.path)));
        assert.deepEqual(
          (await new CodingService(pool, github, runner).read(owner.id, project, job.id)).report,
          r,
        );
      },
    );
    await t.test(
      'web cancellation stops the container and descendants and conserves partial evidence',
      async () => {
        const { job } = await enqueue('Cancel long command');
        await waitFor(async () => {
          const r = await report(job.id);
          return r.report?.modelRequests! >= 1 ? r : false;
        });
        assert.equal(
          (await request('POST', `/projects/${project}/jobs/${job.id}/cancel`, {}, cookie)).status,
          200,
        );
        const stopped = await terminal(job.id);
        assert.equal(stopped.job.state, 'cancelled');
        assert.equal(stopped.attempts[0]!.terminationConfirmed, true);
        assert.equal((await report(job.id)).report!.terminationConfirmed, true);
      },
    );
    await t.test(
      'model call cap and provider failures are terminal, never blindly retried',
      async () => {
        const limited = await enqueue('Fix with capped calls', { maxRequests: 1 });
        assert.equal((await terminal(limited.job.id)).job.state, 'failed');
        assert.equal((await report(limited.job.id)).report!.modelRequests, 1);
        const failed = await enqueue('Provider failure');
        const done = await terminal(failed.job.id);
        assert.equal(done.job.state, 'failed');
        assert.equal(done.job.attempt, 1);
        assert.equal((await report(failed.job.id)).report!.usage, null);
      },
    );
    await t.test(
      'deadline reaches the sandbox; executor loss expires its lease without resuming code',
      async () => {
        const timed = await enqueue('Timeout long command', { timeoutMs: 10000 });
        const expired = await terminal(timed.job.id);
        assert.equal(expired.job.state, 'failed');
        assert.equal(expired.job.attempt, 1);
        const lost = await enqueue('Lease long command');
        const live = await waitFor(async () => {
          const r = await report(lost.job.id);
          return r.report?.modelRequests! >= 1 ? r : false;
        });
        assert.ok(live);
        const fence = (await pool.query('SELECT fence FROM jobs WHERE id=$1', [lost.job.id]))
          .rows[0].fence;
        await stopWorker('SIGKILL');
        const done = await terminal(lost.job.id);
        assert.equal(done.job.state, 'failed');
        assert.equal(done.job.attempt, 1);
        assert.equal(done.attempts[0]!.terminationConfirmed, null);
        const status = await waitFor(async () => {
          const s = await runner.request('/runs/' + lost.job.id, undefined, fence);
          return s.done ? s : false;
        });
        assert.equal(status.report.terminationConfirmed, true);
        await startWorker();
      },
    );
    await t.test(
      'revoked repository permissions hide saved reports and stop active work',
      async () => {
        const run = await enqueue('Lease permission removal');
        await waitFor(async () => {
          const r = await report(run.job.id);
          return r.report?.modelRequests! >= 1 ? r : false;
        });
        fixture.state.denied = true;
        const done = await terminal(run.job.id);
        assert.equal(done.job.state, 'failed');
        assert.equal(done.attempts[0]!.terminationConfirmed, true);
        assert.notEqual(
          (await request('GET', `/projects/${project}/coding/${run.job.id}`, undefined, cookie))
            .status,
          200,
        );
      },
    );
  } finally {
    await stopWorker();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
    await admin.end();
  }
});
