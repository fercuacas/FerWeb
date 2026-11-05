import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  codingCapabilitiesResponse,
  codingRunSchema,
  agentMutationResponse,
  agentResponse,
  agentsResponse,
  executionCatalogSchema,
  jobDetailSchema,
  skillResponse,
  skillsResponse,
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
import { skillFixtureText, skillManifestFixture } from '../../../tests/fixtures/skills.mjs';

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
        const agentsPath = `/projects/${project}/agents`;
        const codingPath = `/projects/${project}/coding`;
        const list = await request('GET', agentsPath, undefined, cookie);
        assert.equal(list.status, 200);
        assert.equal(agentsResponse.parse(await list.json()).templates.length, 6);
        assert.equal((await request('GET', agentsPath)).status, 401);
        assert.equal((await request('GET', agentsPath, undefined, foreign)).status, 404);

        const definition = {
          name: 'Private coding role',
          purpose: 'Resolve the sum task.',
          instructions: 'P02 frozen prompt marker v1.',
          outputFormat: 'Summary and verified tests.',
          requiredCapabilities: ['text', 'workspaceWrite'],
          allowedToolProfiles: ['node-isolated-v1'],
        };
        async function createAgent(path: string, value: unknown) {
          const response = await request('POST', path, value, cookie);
          assert.equal(response.status, 201);
          return agentMutationResponse.parse(await response.json()).role;
        }
        const role = await createAgent(agentsPath, definition);
        const agentPath = `${agentsPath}/${role.id}`;
        const template = await createAgent(agentsPath, { template: 'reviewer' });
        assert.equal(template.latest.origin.kind, 'template');
        const incompatible = await createAgent(agentsPath, {
          ...definition,
          requiredCapabilities: ['text', 'structuredOutput'],
          allowedToolProfiles: ['text-only'],
        });
        const otherProject = await request(
          'POST',
          '/projects',
          { name: 'Other project', description: '' },
          cookie,
        );
        assert.equal(otherProject.status, 201);
        const other = (await otherProject.json()).project;
        const otherPath = `/projects/${other.id}/agents`;
        const otherRole = await createAgent(otherPath, definition);
        assert.equal(
          (await request('GET', `${otherPath}/${role.id}`, undefined, cookie)).status,
          404,
        );
        assert.equal((await request('GET', agentPath, undefined, foreign)).status, 404);
        const projectArchived = await request(
          'PATCH',
          `/projects/${other.id}`,
          { version: other.version, archived: true },
          cookie,
        );
        assert.equal(projectArchived.status, 200);
        assert.equal((await request('POST', otherPath, definition, cookie)).status, 409);
        assert.equal(
          (await request('GET', `${otherPath}/${otherRole.id}`, undefined, cookie)).status,
          200,
        );

        const { job, body } = await enqueue('Fix addition with agent role', {
          agent: { id: role.id, version: 1 },
        });
        const tryAgent = (id: string, version = 1) =>
          request(
            'POST',
            codingPath,
            { ...body, requestId: randomUUID(), agent: { id, version } },
            cookie,
          );
        assert.equal((await tryAgent(otherRole.id)).status, 404);
        assert.equal((await tryAgent(role.id, 99)).status, 404);
        assert.equal((await tryAgent(role.id, 2_147_483_648)).status, 400);
        const denied = await tryAgent(incompatible.id);
        assert.equal(denied.status, 422);
        assert.equal((await denied.json()).error.code, 'agent_incompatible');
        const edit = {
          version: 1,
          definition: { ...definition, instructions: 'Edited prompt v2.' },
        };
        const edits = await Promise.all([
          request('PATCH', agentPath, edit, cookie),
          request('PATCH', agentPath, edit, cookie),
        ]);
        assert.deepEqual(edits.map((result) => result.status).sort(), [200, 409]);
        const history = agentResponse.parse(
          await (await request('GET', agentPath, undefined, cookie)).json(),
        );
        assert.deepEqual(
          history.versions.map((v) => [v.version, v.instructions]),
          [
            [2, edit.definition.instructions],
            [1, definition.instructions],
          ],
        );
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
        assert.equal(
          (await request('POST', `${agentPath}/archive`, { version: 2 }, cookie)).status,
          200,
        );
        const archived = await tryAgent(role.id);
        assert.equal(archived.status, 409);
        assert.equal((await archived.json()).error.code, 'agent_archived');
        assert.equal((await report(job.id)).agent?.version, 1);
        const repeated = await request('POST', codingPath, body, cookie);
        assert.equal(repeated.status, 202);
        assert.equal((await repeated.json()).job.id, job.id);
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
        assert.equal(run.task.title, 'Fix addition with agent role');
        assert.deepEqual(run.agent, role.latest);
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
      'static skills require scoped review and remain frozen in Codex input',
      async () => {
        const library = `/projects/${project}/skills`;
        const post = (path: string, body: unknown) => request('POST', path, body, cookie);
        const manifest = skillManifestFixture();
        const [file] = manifest.files;
        const importSkill = async (body: unknown) => {
          const response = await post(library, body);
          assert.equal(response.status, 201);
          return skillResponse.parse(await response.json()).skill;
        };
        for (const unsafe of [
          { ...file, path: '../escape.md' },
          { ...file, path: 'agent/AGENTS.md' },
          { ...file, path: 'guide.md\n' },
          { ...file, path: 'hooks/install.sh' },
          { ...file, type: 'symlink' },
        ])
          assert.equal(
            (await post(library, { manifest: { ...manifest, files: [unsafe] } })).status,
            400,
          );
        for (const broken of [
          { ...manifest, files: [{ ...file, sha256: '0'.repeat(64) }] },
          { ...manifest, files: [file, { ...file, path: 'GUIDES/REVIEW.md' }] },
          { ...manifest, resources: [{ kind: 'file', name: 'missing.txt' }] },
          { ...manifest, files: [{ ...file, contentBase64: '/w==' }] },
        ])
          assert.equal((await post(library, { manifest: broken })).status, 422);
        const large = skillManifestFixture('a'.repeat(12288));
        assert.equal(
          (
            await post(library, {
              manifest: {
                ...large,
                files: [
                  large.files[0],
                  ...[1, 2, 3].map((n) => ({ ...large.files[0], path: `extra-${n}.md` })),
                ],
              },
            })
          ).status,
          422,
        );
        const seeded = await importSkill({ curated: 'ecc-research' });
        assert.equal(seeded.review, 'pending');
        assert.equal(seeded.origin.kind, 'ecc');
        assert.match(seeded.notice, /Copyright \(c\) 2026 Affaan Mustafa/);
        const blocked = await importSkill({ curated: 'ecc-mcp' });
        assert.equal(
          (
            await post(`${library}/${blocked.id}/review`, {
              sha256: blocked.sha256,
              state: 'approved',
            })
          ).status,
          422,
        );

        const material = await importSkill({ manifest });
        assert.equal(material.review, 'pending');
        assert.equal((await importSkill({ manifest })).id, material.id);
        const endpoint = `${library}/${material.id}`;
        assert.equal((await request('GET', endpoint, undefined, foreign)).status, 404);
        const otherProject = await post('/projects', { name: 'Otra biblioteca', description: '' });
        assert.equal(otherProject.status, 201);
        const other = (await otherProject.json()).project;
        const otherLibrary = `/projects/${other.id}/skills`;
        const otherImport = await post(otherLibrary, { manifest });
        assert.equal(otherImport.status, 201);
        const otherSkill = skillResponse.parse(await otherImport.json()).skill;
        assert.equal(
          (await request('GET', `${otherLibrary}/${material.id}`, undefined, cookie)).status,
          404,
        );
        assert.equal(
          (
            await request(
              'PATCH',
              `/projects/${other.id}`,
              { version: other.version, archived: true },
              cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await post(`${otherLibrary}/${otherSkill.id}/review`, {
              sha256: otherSkill.sha256,
              state: 'approved',
            })
          ).status,
          409,
        );
        const list = await request('GET', library, undefined, cookie);
        const catalog = skillsResponse.parse(await list.json());
        assert.ok(catalog.versions.some((entry) => entry.id === material.id));
        assert.ok(!JSON.stringify(catalog).includes(skillFixtureText));
        assert.equal(
          (await post(`${endpoint}/review`, { sha256: '0'.repeat(64), state: 'approved' })).status,
          409,
        );

        const agents = `/projects/${project}/agents`;
        const definition = {
          name: 'Material review role',
          purpose: 'Review the task.',
          instructions: 'Report evidence.',
          outputFormat: 'Summary.',
          requiredCapabilities: ['text'],
          allowedToolProfiles: ['node-isolated-v1'],
        };
        const created = await post(agents, definition);
        assert.equal(created.status, 201);
        const role = agentMutationResponse.parse(await created.json()).role;
        const patch = (version: number, skillIds: string[]) =>
          request('PATCH', `${agents}/${role.id}`, { version, definition, skillIds }, cookie);
        assert.equal((await patch(1, [otherSkill.id])).status, 404);
        assert.equal((await patch(1, [material.id])).status, 422);
        assert.equal(
          (await post(`${endpoint}/review`, { sha256: material.sha256, state: 'approved' })).status,
          200,
        );
        const linked = await patch(1, [material.id]);
        assert.equal(linked.status, 200);
        assert.equal(
          agentMutationResponse.parse(await linked.json()).role.latest.skills?.[0]?.sha256,
          material.sha256,
        );

        const next = await importSkill({
          manifest: skillManifestFixture('New material that must stay out of the run.'),
        });
        assert.equal(next.version, 2);
        assert.equal((await patch(2, [])).status, 200);
        const { job } = await enqueue('Fix addition with skill material', {
          agent: { id: role.id, version: 2 },
        });
        assert.equal((await terminal(job.id)).job.state, 'completed');
        const frozen = (await report(job.id)).agent;
        assert.equal(frozen?.materials?.[0]?.sha256, material.sha256);
        assert.equal(frozen?.materials?.[0]?.files[0]?.text, skillFixtureText);
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
