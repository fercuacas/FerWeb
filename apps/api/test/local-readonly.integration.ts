import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { type AiProvider, type TeamDefinition } from '@ferweb/contracts';
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
import { AiClient, type GenerationRequest } from '../src/modules/chat/client.js';
import { RetrievalService } from '../src/modules/retrieval/service.js';
import { VectorStore } from '../src/modules/retrieval/vector-store.js';
import { githubFixture } from '../../../tests/fixtures/github.mjs';
import { codingCorpus } from '../../../tests/fixtures/coding.mjs';

test('P19 real queue/HTTP/SQL with simulated local inference, bounded sources and no external inference calls', async (t) => {
  const config = readConfig(),
    admin = createDatabaseAdmin(config),
    database = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool({ ...config, POSTGRES_DB: database }),
    vectorPrefix = `ferweb_local_${randomUUID().replaceAll('-', '')}`;
  let created = false,
    server: import('node:http').Server | undefined,
    worker: ChildProcess | undefined;
  let externalAttempts = 0;
  const admitted: GenerationRequest[] = [];
  class LocalAudit extends AiClient {
    override async catalog(provider: AiProvider, timeout = 35000) {
      if (provider !== 'ollama') {
        externalAttempts++;
        throw Error('External catalog forbidden');
      }
      return super.catalog(provider, timeout);
    }
    override async *generate(input: GenerationRequest, signal: AbortSignal) {
      if (input.provider !== 'ollama' || !input.localStructured) {
        externalAttempts++;
        throw Error('External inference forbidden');
      }
      admitted.push(input);
      yield* super.generate(input, signal);
    }
  }
  const ai = new LocalAudit(process.env.AI_TEST_URL!, process.env.AI_TEST_TOKEN!);
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    const password = randomBytes(24).toString('hex'),
      owner = await provisionOwner(pool, { email: 'local-owner@ferweb.test', password });
    await pool.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)', [
      'local-foreign@ferweb.test',
      await hashPassword(password),
    ]);
    const project = (
      await pool.query("INSERT INTO projects(owner_id,name) VALUES($1,'P19 local') RETURNING id", [
        owner.id,
      ])
    ).rows[0].id;
    const fixture = codingCorpus(githubFixture()),
      github = new GitHubService(pool, fixture.config, fixture.transport);
    const coding = new CodingService(pool, github, new RunnerClient('', ''));
    const retrieval = new RetrievalService(
      pool,
      github,
      ai,
      new VectorStore(config.QDRANT_URL, vectorPrefix),
    );
    const origin = 'http://127.0.0.1:5173';
    server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
      pool,
      github,
      coding,
      ai,
      retrieval,
      runnerToken: process.env.RUNNER_SERVICE_TOKEN!,
      appOrigin: origin,
      secureCookies: false,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`,
      root = `/projects/${project}`;
    let cookie = '';
    const request = (method: string, path: string, body?: unknown, session = cookie) =>
      fetch(base + '/api' + path, {
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
    const foreign = await login('local-foreign@ferweb.test');
    const auth = await github.start(owner.id, cookie.split('=')[1]!);
    await github.callback(new URL(auth.url).searchParams.get('state')!, 'fixture-code');
    await github.connect(owner.id, 71);
    await github.link(owner.id, project, { installationId: 71, repositoryId: 101, version: 0 });
    await github.sync(owner.id, project, 1);
    const roles = [];
    for (const name of ['P19 planner', 'P19 reviewer', 'P19 summary'])
      roles.push(
        (
          await ok(
            'POST',
            root + '/agents',
            {
              name,
              purpose: 'Read excerpts',
              instructions: 'Read the supplied excerpts and report uncertainty.',
              outputFormat: 'Structured local delivery',
              requiredCapabilities: ['text'],
              allowedToolProfiles: ['text-only'],
            },
            201,
          )
        ).role,
      );
    const definition: TeamDefinition = {
      name: 'P19 local workflow',
      description: 'Same specialist DAG, native local inference',
      inferenceMode: 'local-only',
      strategy: 'specialists',
      maxIterations: 1,
      limits: { maxRequests: 3, timeoutMs: 120000, concurrency: 1 },
      steps: roles.map((role, i) => ({
        key: ['plan', 'review', 'summary'][i]!,
        title: role.latest.name,
        role: { id: role.id, version: 1 },
        dependsOn: i === 2 ? ['plan', 'review'] : [],
        exitCriteria: ['Valid schema and actual citations'],
        requiredCapabilities: ['text'],
        maxRequests: 1,
      })),
    };
    const template = (await ok('POST', root + '/team-templates', { definition }, 201)).template;
    async function waitFor<T>(action: () => Promise<T | false>, timeout = 40000): Promise<T> {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const value = await action();
        if (value) return value;
        await delay(100);
      }
      throw Error('P19 fixture timed out');
    }
    worker = spawn(process.execPath, ['apps/api/dist/job-worker.js'], {
      env: {
        ...process.env,
        POSTGRES_DB: database,
        JOB_WORKER_HEALTH_PORT: '0',
        FERWEB_INTERNAL_API_URL: base,
        JOB_WORKER_LEASE_MS: '6000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    worker.stdout!.on('data', (chunk) => {
      output += chunk.toString();
    });
    worker.stderr!.on('data', () => {});
    await waitFor(async () => output.includes('job_worker_ready'));
    async function prepare(title: string, extra: Record<string, unknown> = {}) {
      const task = (
        await ok(
          'POST',
          root + '/tasks',
          {
            title,
            description: 'Read and plan without changing files',
            priority: 'medium',
            status: 'todo',
            acceptanceCriteria: [],
          },
          201,
        )
      ).task;
      const input = {
        requestId: randomUUID(),
        taskId: task.id,
        taskVersion: task.version,
        templateId: template.id,
        templateVersion: 1,
        mode: 'team',
        executionId: 'local-readonly-v1',
        model: 'fixture-chat',
        stepModels: definition.steps.map((s) => ({ step: s.key, model: 'fixture-chat' })),
        ...extra,
      };
      return { task, input, plan: (await ok('POST', root + '/team-plans', input, 201)).plan };
    }
    async function launch(title: string, extra = {}) {
      const prepared = await prepare(title, extra);
      await ok('POST', root + `/team-plans/${prepared.plan.id}/approve`, {
        hash: prepared.plan.hash,
        version: 1,
      });
      const input = {
        requestId: randomUUID(),
        hash: prepared.plan.hash,
        version: 1,
        commit: 'a'.repeat(40),
      };
      const execution = (
        await ok('POST', root + `/team-plans/${prepared.plan.id}/execute`, input, 202)
      ).execution;
      return { ...prepared, execution, input };
    }
    const terminal = (id: string) =>
      waitFor(async () => {
        const data = await ok('GET', root + `/team-executions/${id}`);
        return !['pending', 'running'].includes(data.execution.state) ? data : false;
      });
    await t.test(
      'local workflow preserves the DAG, bounded evidence, per-role revisions, budget and idempotent admission',
      async () => {
        const run = await launch('P19 successful local');
        const data = await terminal(run.execution.id);
        assert.equal(data.execution.state, 'completed');
        assert.equal(data.steps.length, 3);
        assert.ok(
          data.steps.every(
            (s: any) => s.delivery.verification === 'local-structure' && s.delivery.verified,
          ),
        );
        assert.match(data.steps[2].delivery.result, /2 entregas previas/);
        const jobs = (
          await pool.query(
            'SELECT j.id,j.kind,j.attempt,l.report,l.snapshot FROM jobs j JOIN local_read_runs l ON l.job_id=j.id ORDER BY j.created_at',
          )
        ).rows;
        assert.equal(jobs.length, 3);
        assert.ok(jobs.every((j) => j.kind === 'local-readonly-v1' && j.attempt === 1));
        assert.ok(
          jobs.every(
            (j) =>
              j.snapshot.sources.length <= 8 &&
              j.snapshot.sources.every((s: any) => s.excerpt.length <= 4000),
          ),
        );
        assert.equal(jobs[0].report.usage.costUsd, null);
        assert.equal(jobs[0].report.remoteCancellationConfirmed, null);
        assert.equal(data.taskStatus, 'todo');
        const attempts = (
          await pool.query(
            'SELECT exit_code,termination_confirmed FROM job_attempts a JOIN local_read_runs r ON r.job_id=a.job_id',
          )
        ).rows;
        assert.ok(
          attempts.every(
            (attempt) => attempt.exit_code === null && attempt.termination_confirmed === null,
          ),
        );
        const before = admitted.length;
        assert.equal(
          (await ok('POST', root + `/team-plans/${run.plan.id}/execute`, run.input, 202)).execution
            .id,
          run.execution.id,
        );
        assert.equal(admitted.length, before);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM coding_runs')).rows[0].n, 0);
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM execution_request_admissions')).rows[0]
            .n,
          3,
        );
        assert.equal(
          (await request('GET', root + `/local-read/${jobs[0].id}`, undefined, foreign)).status,
          404,
        );
        assert.equal(
          (await ok('GET', root + `/local-read/${jobs[0].id}`)).report.kind,
          'local-readonly-v1',
        );
        assert.equal(externalAttempts, 0);
      },
    );
    await t.test(
      'invalid JSON and fabricated citations fail visibly once and do not run dependent summaries',
      async () => {
        for (const [title, code] of [
          ['P19 bad JSON', 'local_delivery_invalid'],
          ['P19 bad citation', 'local_citation_invalid'],
        ]) {
          const before = admitted.length,
            run = await launch(title!);
          const data = await terminal(run.execution.id);
          assert.equal(data.execution.state, 'failed');
          const job = (
            await pool.query(
              'SELECT j.error_code,j.attempt FROM jobs j JOIN team_execution_steps s ON s.job_id=j.id WHERE s.execution_id=$1 ORDER BY s.position',
              [run.execution.id],
            )
          ).rows[0];
          assert.equal(job.error_code, code);
          assert.equal(job.attempt, 1);
          const requests = admitted.slice(before);
          assert.ok(
            requests.length >= 1 && requests.length <= 2,
            'Only independent specialists can have started; the dependent summary must not run.',
          );
          assert.equal(new Set(requests.map((item) => item.id)).size, requests.length);
          assert.equal(data.steps[2].jobId, null);
        }
      },
    );
    await t.test(
      'local P10 receipts use local embeddings and deterministic selectors with the same no-external-inference boundary',
      async () => {
        await retrieval.index(owner.id, project);
        const draft = await coding.contextPacks!.draftMap(owner.id, project);
        await coding.contextPacks!.saveMap(owner.id, project, {
          version: 0,
          markdown: draft.markdown,
          paths: draft.paths,
        });
        const run = await launch('P19 context receipt', {
          context: {
            profile: 'lean',
            mode: 'suggested',
            explicitSkillIds: [],
            excludedSkillIds: [],
            includeMemory: false,
          },
        });
        const data = await terminal(run.execution.id);
        assert.equal(data.execution.state, 'completed');
        assert.equal(data.plan.contexts.length, 3);
        assert.ok(
          (
            await pool.query('SELECT snapshot FROM context_pack_receipts WHERE project_id=$1', [
              project,
            ])
          ).rows.every((row) => row.snapshot.execution.id === 'local-readonly-v1'),
        );
        assert.equal(externalAttempts, 0);
      },
    );
    await t.test(
      'unsupported roles, unknown models, archive and cancellation do not grant tools or fall back',
      async () => {
        const incompatible = await request('POST', root + '/team-templates', {
          definition: {
            ...definition,
            steps: definition.steps.map((s, i) =>
              i ? s : { ...s, requiredCapabilities: ['workspaceWrite'] },
            ),
          },
        });
        assert.equal(incompatible.status, 400);
        const pending = await prepare('P19 invalid model');
        assert.equal(
          (
            await request('POST', root + '/team-plans', {
              ...pending.input,
              requestId: randomUUID(),
              model: 'cloud-model',
              stepModels: [],
            })
          ).status,
          422,
        );
        const before = admitted.length,
          waiting = await launch('P19 wait cancellation');
        await waitFor(async () => admitted.length > before);
        assert.equal(
          (await request('POST', root + `/team-executions/${waiting.execution.id}/cancel`, {}))
            .status,
          200,
        );
        const done = await terminal(waiting.execution.id);
        assert.equal(done.execution.state, 'cancelled');
        assert.equal(admitted.length, before + 1);
        const p = (await ok('GET', root)).project;
        await ok('PATCH', root, { version: p.version, archived: true });
        assert.equal(
          (
            await request('POST', root + `/team-plans/${pending.plan.id}/approve`, {
              hash: pending.plan.hash,
              version: 1,
            })
          ).status,
          409,
        );
        assert.equal(externalAttempts, 0);
      },
    );
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const closed = once(worker, 'exit');
      worker.kill('SIGTERM');
      await closed;
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    const collections = await (await fetch(config.QDRANT_URL + '/collections')).json();
    for (const collection of collections.result.collections)
      if (collection.name.startsWith(vectorPrefix + '_'))
        await fetch(config.QDRANT_URL + '/collections/' + collection.name, { method: 'DELETE' });
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
    await admin.end();
  }
});
