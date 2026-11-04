import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { jobDetailSchema, jobEventsSchema, jobInput } from '@ferweb/contracts';
import { readConfig } from '../src/config.js';
import { createPool } from '../src/database.js';
import { createDatabaseAdmin } from './database-admin.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { provisionOwner } from '../src/modules/identity/provision.js';
import { hashPassword } from '../src/modules/identity/passwords.js';
import { JobQueue, type Claim } from '../src/modules/jobs/queue.js';

test('persistent queue: real separate API/executor/process, restart, budgets, fencing and cancellation', async (t) => {
  const config = readConfig(),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`,
    admin = createDatabaseAdmin(config),
    pool = createPool({ ...config, POSTGRES_DB: database }),
    queue = new JobQueue(pool, 2000);
  const children: ChildProcess[] = [];
  let created = false,
    api: ChildProcess | undefined;
  const logs = new Map<ChildProcess, string>();
  async function waitFor<T>(
    action: () => Promise<T | false | null | undefined>,
    timeout = 15000,
  ): Promise<T> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await action();
      if (result) return result;
      await delay(50);
    }
    throw Error('Timed out waiting for simulated job condition');
  }
  function start(args: string[], extra: Record<string, string> = {}) {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        POSTGRES_DB: database,
        HOST: '127.0.0.1',
        JOB_WORKER_HEALTH_PORT: '0',
        JOB_WORKER_LEASE_MS: '2000',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    logs.set(child, '');
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (data) => logs.set(child, logs.get(child) + String(data)));
    return child;
  }
  async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill(signal);
    await exited;
  }
  async function worker() {
    const child = start(['apps/api/dist/job-worker.js']);
    await waitFor(async () => (logs.get(child)?.includes('job_worker_ready') ? true : false));
    return child;
  }
  async function alive(pid: number) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      return stat.split(') ')[1]?.[0] !== 'Z';
    } catch {
      return false;
    }
  }
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    await applyMigrations(pool, await loadMigrations());
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'jobs-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'jobs-other@ferweb.test',
      await hashPassword(password),
    ]);
    async function project(name: string) {
      return (
        await pool.query('INSERT INTO projects(owner_id,name) VALUES($1,$2) RETURNING id', [
          owner.id,
          name,
        ])
      ).rows[0].id as string;
    }
    const first = await project('Jobs'),
      second = await project('Second'),
      third = await project('Third');
    const socket = createServer().listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((r) => socket.close(() => r()));
    const origin = 'http://127.0.0.1:5173',
      base = `http://127.0.0.1:${port}/api`;
    async function startApi() {
      api = start(['tests/fixtures/jobs-server.mjs'], { PORT: String(port), APP_ORIGIN: origin });
      await waitFor(async () => (logs.get(api!)?.includes('jobs_test_api_ready') ? true : false));
    }
    await startApi();
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
        signal: AbortSignal.timeout(5000),
      });
    }
    const cookie = (await request('POST', '/auth/login', { email: owner.email, password })).headers
        .get('set-cookie')!
        .split(';')[0]!,
      foreign = (
        await request('POST', '/auth/login', { email: 'jobs-other@ferweb.test', password })
      ).headers
        .get('set-cookie')!
        .split(';')[0]!;
    const body = (
      title: string,
      simulation: Record<string, unknown> = {},
      limits: Record<string, unknown> = {},
    ) =>
      jobInput.parse({
        requestId: randomUUID(),
        title,
        simulation: {
          steps: 4,
          stepDelayMs: 150,
          unitsPerStep: 2,
          costMicrosPerStep: 100,
          failure: 'none',
          failureStep: 1,
          failuresBeforeSuccess: 1,
          ignoreTermination: false,
          ...simulation,
        },
        limits: {
          timeoutMs: 30000,
          maxAttempts: 3,
          budgetUnits: 1000,
          budgetMicros: 1000000,
          ...limits,
        },
      });
    async function enqueue(input = body('Simulation'), p = first) {
      const response = await request('POST', `/projects/${p}/jobs`, input, cookie);
      assert.equal(response.status, 202);
      const result = jobDetailSchema.parse(await response.json());
      assert.equal(response.headers.get('x-ferweb-job'), result.job.id);
      return result.job;
    }
    async function detail(id: string, p = first) {
      const response = await request('GET', `/projects/${p}/jobs/${id}`, undefined, cookie);
      assert.equal(response.status, 200);
      return jobDetailSchema.parse(await response.json());
    }
    async function completed(id: string, p = first) {
      return waitFor(async () => {
        const value = await detail(id, p);
        return !['pending', 'running'].includes(value.job.state) ? value : false;
      });
    }
    await t.test(
      'atomic enqueue, strict input, cross-owner scope, idempotent concurrent submissions and cancel pending',
      async () => {
        assert.equal((await request('GET', `/projects/${first}/jobs`)).status, 401);
        assert.equal(
          (await request('GET', `/projects/${first}/jobs`, undefined, foreign)).status,
          404,
        );
        const input = body('Idempotent');
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${first}/jobs`,
              { ...input, command: 'untrusted-command' },
              cookie,
            )
          ).status,
          400,
        );
        const jobs = await Promise.all([enqueue(input), enqueue(input)]);
        assert.equal(jobs[0]!.id, jobs[1]!.id);
        assert.equal(jobs[0]!.state, 'pending');
        assert.equal(
          (
            await request(
              'POST',
              `/projects/${first}/jobs`,
              { ...input, title: 'Different' },
              cookie,
            )
          ).status,
          409,
        );
        for (const suffix of ['', '/events'])
          assert.equal(
            (
              await request(
                'GET',
                `/projects/${first}/jobs/${jobs[0]!.id}${suffix}`,
                undefined,
                foreign,
              )
            ).status,
            404,
          );
        assert.equal(
          (await request('GET', `/projects/${second}/jobs/${jobs[0]!.id}`, undefined, cookie))
            .status,
          404,
        );
        assert.equal(
          (await request('POST', `/projects/${first}/jobs/${jobs[0]!.id}/cancel`, {}, foreign))
            .status,
          404,
        );
        await request('POST', `/projects/${first}/jobs/${jobs[0]!.id}/cancel`, {}, cookie);
        await request('POST', `/projects/${first}/jobs/${jobs[0]!.id}/cancel`, {}, cookie);
        const cancelled = await detail(jobs[0]!.id);
        assert.equal(cancelled.job.state, 'cancelled');
        assert.equal(cancelled.job.attempt, 0);
        assert.equal(cancelled.job.usedUnits, 0);
      },
    );
    await t.test(
      'checkpoint and budget transactions reject duplicate steps and stale executor results',
      async () => {
        const job = await enqueue(),
          executor = randomUUID();
        await queue.register(executor);
        const claim = await queue.claim(executor);
        assert.ok(claim);
        assert.equal(claim.id, job.id);
        await queue.reserve(claim, 1);
        await queue.reserve(claim, 1);
        await queue.commitStep(claim, 1);
        await queue.commitStep(claim, 1);
        assert.equal((await detail(job.id)).job.usedUnits, 2);
        await pool.query(
          "UPDATE jobs SET lease_until=clock_timestamp()-interval '2 seconds' WHERE id=$1",
          [job.id],
        );
        await queue.recover();
        await delay(550);
        const replacement = randomUUID();
        await queue.register(replacement);
        const newer = await queue.claim(replacement);
        assert.ok(newer);
        assert.notEqual(newer.fence, claim.fence);
        assert.equal(newer.completed_steps, 1);
        await assert.rejects(queue.commitStep(claim, 2), /lease_lost/);
        await queue.finish(newer, 'permanent_failure', 2, null, true);
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM job_effects WHERE job_id=$1', [job.id]))
            .rows[0].n,
          1,
        );
        await queue.stopExecutor(executor);
        await queue.stopExecutor(replacement);
      },
    );
    await t.test(
      'two real executors respect SQL global 2 and per-project 1; correlated events and isolated child environment',
      async () => {
        const a = await enqueue(body('Concurrent A', { steps: 8, stepDelayMs: 300 })),
          b = await enqueue(body('Same project', { steps: 4, stepDelayMs: 150 })),
          c = await enqueue(body('Concurrent C', { steps: 8, stepDelayMs: 300 }), second),
          d = await enqueue(body('Concurrent D', { steps: 4, stepDelayMs: 150 }), third);
        const w1 = await worker(),
          w2 = await worker();
        await waitFor(async () => {
          const value = (
            await pool.query("SELECT count(*)::int AS n FROM jobs WHERE state='running'")
          ).rows[0].n;
          return value === 2;
        });
        const live = await waitFor(async () => {
          const value = await detail(a.id);
          return value.attempts[0]?.processPid ? value : false;
        });
        const pid = live.attempts[0]!.processPid!;
        assert.notEqual(pid, w1.pid);
        assert.notEqual(pid, w2.pid);
        const env = await readFile(`/proc/${pid}/environ`, 'utf8');
        assert.doesNotMatch(env, /POSTGRES_PASSWORD|AI_SERVICE_TOKEN|GITHUB_CONFIG_FILE/);
        for (const [id, p] of [
          [a.id, first],
          [b.id, first],
          [c.id, second],
          [d.id, third],
        ])
          assert.equal((await completed(id!, p)).job.state, 'completed');
        const rows = (
          await pool.query(
            'SELECT a.started_at,a.finished_at,j.project_id FROM job_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.id=ANY($1::uuid[])',
            [[a.id, b.id, c.id, d.id]],
          )
        ).rows;
        const timeline = rows
          .flatMap((row) => [
            { time: row.started_at.getTime(), delta: 1, project: row.project_id },
            { time: row.finished_at.getTime(), delta: -1, project: row.project_id },
          ])
          .sort((x, y) => x.time - y.time || x.delta - y.delta);
        let active = 0;
        const perProject = new Map<string, number>();
        for (const event of timeline) {
          active += event.delta;
          const count = (perProject.get(event.project) ?? 0) + event.delta;
          perProject.set(event.project, count);
          assert.ok(active <= 2);
          assert.ok(count <= 1);
        }
        const events = jobEventsSchema.parse(
          await (
            await request(
              'GET',
              `/projects/${first}/jobs/${a.id}/events?after=0`,
              undefined,
              cookie,
            )
          ).json(),
        );
        assert.ok(events.events.some((e) => e.type === 'progress'));
        assert.ok(events.events.every((e) => e.jobId === a.id));
        assert.deepEqual(
          events.events.map((e) => e.sequence),
          events.events.map((_e, i) => i + 1),
        );
        const cursor = events.events[2]!.sequence;
        const replay = await (
          await request(
            'GET',
            `/projects/${first}/jobs/${a.id}/events?after=${cursor}`,
            undefined,
            cookie,
          )
        ).json();
        assert.ok(replay.events.every((e: { sequence: number }) => e.sequence > cursor));
        assert.match(logs.get(w1)! + logs.get(w2)!, new RegExp(a.id));
        assert.equal(
          (logs.get(w1)! + logs.get(w2)!).includes(config.POSTGRES_PASSWORD),
          false,
          'Worker logs must not contain the database credential',
        );
        await stop(w1);
        await stop(w2);
      },
    );
    await t.test(
      'API restart does not lose an active job, its identity or progress events',
      async () => {
        const job = await enqueue(body('API restart', { steps: 10, stepDelayMs: 300 })),
          w = await worker();
        await waitFor(async () => {
          const v = await detail(job.id);
          return v.job.completedSteps >= 1;
        });
        const before = await detail(job.id);
        await stop(api!);
        await startApi();
        const after = await detail(job.id);
        assert.equal(after.job.id, before.job.id);
        assert.ok(after.job.completedSteps >= before.job.completedSteps);
        const done = await completed(job.id);
        assert.equal(done.job.state, 'completed');
        assert.equal(done.job.attempt, 1);
        await stop(w);
      },
    );
    await t.test(
      'SIGKILL executor disconnects and stops the child; another executor resumes the checkpoint without duplicate effects',
      async () => {
        const job = await enqueue(body('Crash recovery', { steps: 5, stepDelayMs: 400 })),
          w = await worker();
        const running = await waitFor(async () => {
          const value = await detail(job.id);
          return value.job.completedSteps >= 1 && value.attempts[0]?.processPid ? value : false;
        });
        const old = (await pool.query('SELECT * FROM jobs WHERE id=$1', [job.id])).rows[0] as Claim,
          pid = running.attempts[0]!.processPid!;
        await stop(w, 'SIGKILL');
        await waitFor(async () => !(await alive(pid)));
        const replacement = await worker();
        const done = await completed(job.id);
        assert.equal(done.job.state, 'completed');
        assert.ok(done.job.attempt >= 2);
        assert.equal(done.attempts[0]!.state, 'lost');
        assert.equal(done.attempts[0]!.terminationConfirmed, null);
        assert.equal(done.job.completedSteps, 5);
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM job_effects WHERE job_id=$1', [job.id]))
            .rows[0].n,
          5,
        );
        await assert.rejects(queue.commitStep(old, 2), /lease_lost/);
        await stop(replacement);
      },
    );
    await t.test(
      'a paused client cannot retain the transactional queue lock past its idle limit',
      async () => {
        const holder = start([
          '--input-type=module',
          '-e',
          `import {JobQueue} from './apps/api/dist/modules/jobs/queue.js';import {readConfig} from './apps/api/dist/config.js';import {createPool} from './apps/api/dist/database.js';const p=createPool(readConfig());await new JobQueue(p).tx(async()=>{console.log('queue_lock_held');await new Promise(r=>setTimeout(r,30000));},true).catch(()=>{});await p.end();`,
        ]);
        await waitFor(async () => (logs.get(holder)?.includes('queue_lock_held') ? true : false));
        holder.kill('SIGSTOP');
        try {
          await queue.recover();
        } finally {
          holder.kill('SIGCONT');
          await stop(holder);
        }
      },
    );
    await t.test(
      'paused/disconnected executor cannot keep its child past the lease or publish after recovery',
      async () => {
        const job = await enqueue(body('Lease recovery', { steps: 5, stepDelayMs: 400 })),
          w = await worker();
        const running = await waitFor(async () => {
          const value = await detail(job.id);
          return value.job.completedSteps >= 1 && value.attempts[0]?.processPid ? value : false;
        });
        w.kill('SIGSTOP');
        const pid = running.attempts[0]!.processPid!;
        await waitFor(async () => !(await alive(pid)), 7000);
        const replacement = await worker();
        await waitFor(async () => {
          const value = await detail(job.id);
          return value.job.attempt >= 2;
        });
        w.kill('SIGCONT');
        const done = await completed(job.id);
        assert.equal(done.job.state, 'completed');
        assert.equal(done.job.completedSteps, 5);
        await stop(w);
        await stop(replacement);
      },
    );
    await t.test(
      'transient and after-commit failures retry safely; permanent failures and exhausted budgets never retry blindly',
      async () => {
        const w = await worker();
        for (const failure of ['transient', 'after_commit'] as const) {
          const job = await enqueue(body(failure, { failure, steps: 3, stepDelayMs: 100 }));
          const done = await completed(job.id);
          assert.equal(done.job.state, 'completed');
          assert.equal(done.job.attempt, 2);
          assert.equal(done.job.usedUnits, failure === 'after_commit' ? 6 : 8);
          assert.equal(
            (
              await pool.query('SELECT count(*)::int AS n FROM job_effects WHERE job_id=$1', [
                job.id,
              ])
            ).rows[0].n,
            3,
          );
        }
        const permanent = await enqueue(body('Permanent', { failure: 'permanent' }));
        const stopped = await completed(permanent.id);
        assert.equal(stopped.job.state, 'failed');
        assert.equal(stopped.job.attempt, 1);
        assert.equal(stopped.job.errorCode, 'permanent_failure');
        const exhausted = await enqueue(
          body(
            'Attempts exhausted',
            { failure: 'transient', failuresBeforeSuccess: 2 },
            { maxAttempts: 2 },
          ),
        );
        const exhaustedResult = await completed(exhausted.id);
        assert.equal(exhaustedResult.job.state, 'failed');
        assert.equal(exhaustedResult.job.attempt, 2);
        assert.equal(exhaustedResult.job.errorCode, 'attempts_exhausted');
        for (const limits of [{ budgetUnits: 3 }, { budgetMicros: 150 }]) {
          const job = await enqueue(body('Budget', {}, limits)),
            done = await completed(job.id);
          assert.equal(done.job.state, 'failed');
          assert.equal(done.job.errorCode, 'budget_exceeded');
          assert.ok(done.job.usedUnits <= done.job.configuration.limits.budgetUnits);
          assert.ok(done.job.usedCostMicros <= done.job.configuration.limits.budgetMicros);
        }
        const constrained = await enqueue(
          body(
            'Retry budget',
            { failure: 'transient', failuresBeforeSuccess: 2 },
            { budgetUnits: 3 },
          ),
        );
        const done = await completed(constrained.id);
        assert.equal(done.job.state, 'failed');
        assert.equal(done.job.attempt, 1);
        assert.equal(done.job.errorCode, 'budget_exceeded');
        await stop(w);
      },
    );
    await t.test(
      'deadline and cancellation reach the real process, including forced stop; archive prevents admission',
      async () => {
        const w = await worker(),
          timeout = await enqueue(
            body('Deadline', { steps: 20, stepDelayMs: 1000 }, { timeoutMs: 1000 }),
          );
        assert.equal((await completed(timeout.id)).job.errorCode, 'timeout');
        const job = await enqueue(
          body('Force stop', { steps: 30, stepDelayMs: 1000, ignoreTermination: true }),
        );
        const live = await waitFor(async () => {
          const v = await detail(job.id);
          return v.job.usedUnits > 0 && v.attempts[0]?.processPid ? v : false;
        });
        const pid = live.attempts[0]!.processPid!;
        await request('POST', `/projects/${first}/jobs/${job.id}/cancel`, {}, cookie);
        const done = await completed(job.id);
        assert.equal(done.job.state, 'cancelled');
        assert.equal(done.attempts[0]!.terminationConfirmed, true);
        assert.equal(done.attempts[0]!.exitSignal, 'SIGKILL');
        assert.equal(await alive(pid), false);
        const effects = done.job.completedSteps;
        await delay(300);
        assert.equal((await detail(job.id)).job.completedSteps, effects);
        await pool.query('UPDATE projects SET archived_at=now() WHERE id=$1', [first]);
        assert.equal(
          (await request('POST', `/projects/${first}/jobs`, body('Archived'), cookie)).status,
          409,
        );
        assert.equal(
          (await request('GET', `/projects/${first}/jobs/${job.id}`, undefined, cookie)).status,
          200,
        );
        await stop(w);
      },
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGCONT');
        await stop(child).catch(() => {});
      }
    }
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
