import http from 'node:http';
import { mkdir, writeFile, chmod, rm, readdir, readFile } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { connectDocker, demux } from './docker.mjs';
import { validateFiles, differences, hash } from './files.mjs';
import { modelPayload, attachUsageMeter, providerUsage } from './policy.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function body(req, limit = 1200000) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Error('input_limit');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString());
}
const safeEqual = (a, b) =>
  typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const safeText = (value, limit = 8000) => (typeof value === 'string' ? value.slice(0, limit) : '');
const number = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

export async function createController({ token, configuration, fakeProvider, namespace, volume }) {
  if (!token || token.length < 32) throw Error('runner_token_missing');
  if (!/^[a-z0-9][a-z0-9_-]{1,80}$/.test(namespace) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(volume))
    throw Error('runner_scope_invalid');
  const { docker, json, apiVersion } = await connectDocker();
  // Resolve the tag once. A rebuild must never change tools mid-run.
  const image = (await json('GET', '/images/ferweb-codex-sandbox:0.166.0/json')).Id;
  const environment = {
    image,
    dockerApi: apiVersion,
    cli: '0.166.0',
    profile: 'node-isolated-v1',
    readOnlyWorkspace: 'mount-v1',
    simulated: !!fakeProvider,
    budgetAuthority: 'postgres-v1',
    policyHash: hash(
      (
        await Promise.all(
          ['controller.mjs', 'policy.mjs', 'files.mjs', 'docker.mjs'].map((file) =>
            readFile(new URL(file, import.meta.url), 'utf8'),
          ),
        )
      ).join('\n'),
    ),
    tools: ['shell', 'node', 'npm', 'git', 'rg'],
    cpu: 1,
    memoryBytes: 805306368,
    pids: 128,
    network: 'none',
    independentTest: 'node --test',
  };
  const label = `ferweb.codex.controller=${namespace}`;
  const root = '/runtime';
  await mkdir(root, { recursive: true });
  // Fail closed after controller restart; never attach a new owner to orphan compute.
  for (const c of await json(
    'GET',
    '/containers/json?all=1&filters=' + encodeURIComponent(JSON.stringify({ label: [label] })),
  ))
    await docker('DELETE', `/containers/${c.Id}?force=1&v=1`);
  const oldVolumes = await json(
    'GET',
    '/volumes?filters=' + encodeURIComponent(JSON.stringify({ label: [label] })),
  );
  for (const old of oldVolumes.Volumes ?? [])
    if (/^ferweb_code_[a-f0-9]{32}$/.test(old.Name)) await docker('DELETE', '/volumes/' + old.Name);
  for (const old of await readdir(root, { withFileTypes: true }))
    if (old.isDirectory() && uuid.test(old.name))
      await rm(root + '/' + old.name, { recursive: true, force: true });
  const runs = new Map();
  async function collect(run) {
    const c = await json('POST', '/containers/create', {
      Image: image,
      Entrypoint: ['node', '/opt/ferweb/collect.mjs'],
      User: '1000:1000',
      WorkingDir: '/',
      NetworkDisabled: true,
      Labels: { 'ferweb.codex.controller': namespace },
      HostConfig: {
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Memory: 134217728,
        MemorySwap: 134217728,
        NanoCpus: 500000000,
        PidsLimit: 16,
        Mounts: [
          {
            Type: 'volume',
            Source: run.workspace,
            Target: '/workspace',
            ReadOnly: true,
            VolumeOptions: { NoCopy: true },
          },
        ],
        LogConfig: { Type: 'local', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
    });
    try {
      await docker('POST', `/containers/${c.Id}/start`);
      const state = await json('POST', `/containers/${c.Id}/wait?condition=not-running`);
      if (state.StatusCode !== 0) throw Error('collector_failed');
      const files = JSON.parse(
        demux(
          await docker('GET', `/containers/${c.Id}/logs?stdout=1&stderr=1`, undefined, 2000000),
        ),
      );
      validateFiles(files, true);
      return files;
    } finally {
      await docker('DELETE', `/containers/${c.Id}?force=1&v=1`).catch(() => {});
    }
  }
  async function seedReadOnly(run) {
    const c = await json('POST', '/containers/create', {
      Image: image,
      Entrypoint: ['node', '/opt/ferweb/prepare.mjs', '--hold'],
      User: '1000:1000',
      WorkingDir: '/workspace',
      NetworkDisabled: true,
      Labels: { 'ferweb.codex.controller': namespace },
      HostConfig: {
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Memory: 134217728,
        MemorySwap: 134217728,
        NanoCpus: 500000000,
        PidsLimit: 16,
        Mounts: [
          {
            Type: 'volume',
            Source: run.workspace,
            Target: '/workspace',
            VolumeOptions: { NoCopy: true },
          },
          {
            Type: 'volume',
            Source: volume,
            Target: '/control',
            ReadOnly: true,
            VolumeOptions: { Subpath: run.key, NoCopy: true },
          },
        ],
        LogConfig: { Type: 'local', Config: { 'max-size': '1m', 'max-file': '2' } },
      },
    });
    run.seeder = c.Id;
    await docker('POST', `/containers/${c.Id}/start`);
    for (let i = 0; i < 50; i++) {
      const logs = demux(
        await docker('GET', `/containers/${c.Id}/logs?stdout=1&stderr=1`, undefined, 8000),
      );
      if (logs.split(/\r?\n/).includes('ferweb_snapshot_ready')) return;
      const state = await json('GET', `/containers/${c.Id}/json`);
      if (!state.State.Running) throw Error('readonly_seed_failed');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('readonly_seed_timeout');
  }
  async function exec(run, cmd, capture) {
    const e = await json('POST', `/containers/${run.container}/exec`, {
      Cmd: cmd,
      User: '1000:1000',
      WorkingDir: '/workspace',
      Env: ['HOME=/tmp', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      AttachStdout: true,
      AttachStderr: true,
    });
    let pending = Buffer.alloc(0),
      lines = '';
    const raw = await docker(
      'POST',
      `/exec/${e.Id}/start`,
      { Detach: false, Tty: false },
      512000,
      capture
        ? (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 8 && pending.length >= 8 + pending.readUInt32BE(4)) {
              const length = pending.readUInt32BE(4),
                stream = pending[0];
              if (stream === 1) {
                lines += pending.subarray(8, 8 + length).toString('utf8');
                while (lines.includes('\n')) {
                  const n = lines.indexOf('\n');
                  const line = lines.slice(0, n);
                  lines = lines.slice(n + 1);
                  capture(line);
                }
              }
              pending = pending.subarray(8 + length);
            }
          }
        : undefined,
    );
    const status = await json('GET', `/exec/${e.Id}/json`);
    return { exitCode: status.ExitCode, output: safeText(demux(raw), 30000) };
  }
  function observe(run, line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'turn.completed') {
      const u = event.usage ?? {};
      run.report.usage = {
        inputTokens: number(u.input_tokens),
        cachedInputTokens: number(u.cached_input_tokens),
        outputTokens: number(u.output_tokens),
        reasoningTokens: number(u.reasoning_output_tokens),
      };
      run.report.turnCompleted = true;
    }
    if (event.type === 'turn.failed' || event.type === 'error') run.report.agentError = true;
    if (event.type === 'item.completed') {
      const item = event.item ?? {};
      if (item.type === 'agent_message') run.report.summary = safeText(item.text, 16000);
      if (item.type === 'command_execution' && run.report.commands.length < 50)
        run.report.commands.push({
          command: safeText(item.command, 4000),
          output: safeText(item.aggregated_output, 8000),
          exitCode: number(item.exit_code),
          status: safeText(item.status, 80),
          origin: 'codex-event',
        });
      run.phase = 'agent: ' + safeText(item.type, 60);
    }
  }
  async function finish(run, reason) {
    if (run.finishing) return run.finished;
    run.finishing = true;
    run.finished = (async () => {
      run.reason = ['cancelled', 'timeout', 'lease_lost'].includes(reason)
        ? reason
        : (run.budgetReason ?? reason);
      run.phase = 'collecting';
      for (const abort of run.upstreams) abort.abort();
      try {
        await docker('POST', `/containers/${run.container}/pause`);
        const collected = await collect(run);
        run.report.diff = differences(run.input.files, collected);
        if (JSON.stringify(run.report.diff).length > 600000) throw Error('diff_limit');
        run.report.diffComplete = true;
        if (run.input.captureWorkspace === true) run.outputFiles = collected;
      } catch (error) {
        if (fakeProvider)
          console.error(
            JSON.stringify({ event: 'fixture_artifact_error', message: error.message }),
          );
        run.report.diff = [];
        run.report.diffComplete = false;
        run.report.limitations.push(
          'No se pudo obtener una instantánea completa y segura de los archivos finales.',
        );
      }
      try {
        const state = await json('GET', `/containers/${run.container}/json`);
        if (state.State.Paused) await docker('POST', `/containers/${run.container}/unpause`);
        // Kill the container's entire PID namespace, including detached descendants.
        await docker('POST', `/containers/${run.container}/kill?signal=KILL`).catch(() => {});
        const stopped = await json('GET', `/containers/${run.container}/json`);
        run.report.terminationConfirmed = !stopped.State.Running;
        run.report.oomKilled = !!stopped.State.OOMKilled;
      } catch {
        run.report.terminationConfirmed = null;
      }
      if (!run.report.terminationConfirmed) {
        run.reason = 'stop_unconfirmed';
        run.report.limitations.push('No se ha confirmado la parada física del contenedor.');
      }
      run.report.finishedAt = new Date().toISOString();
      if (run.reason === 'completed' && !run.report.diffComplete) run.reason = 'artifact_failed';
      run.report.durationMs = Date.now() - run.started;
      run.report.modelRequests = run.requests;
      run.report.reason = run.reason;
      run.phase = 'finished';
      if (run.seeder)
        await docker('DELETE', `/containers/${run.seeder}?force=1&v=1`).catch(() => {});
      await docker('DELETE', `/containers/${run.container}?force=1&v=1`).catch(() => {});
      if (run.workspace) await docker('DELETE', `/volumes/${run.workspace}`).catch(() => {});
      run.gateway?.close();
      await rm(`${root}/${run.key}`, { recursive: true, force: true });
      run.input.files = [];
    })();
    return run.finished;
  }
  async function budgetCall(run, operation, data) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `${run.controlOrigin}/internal/coding/${run.input.jobId}/${operation}`,
          {
            method: 'POST',
            headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({ fence: run.input.fence, ...data }),
            signal: AbortSignal.timeout(2000),
            redirect: 'error',
          },
        );
        if (response.ok) return await response.json();
        const result = await response.json().catch(() => ({}));
        const code = result.error?.code;
        const error = new Error(
          [
            'request_budget_exhausted',
            'budget_cancelled',
            'budget_timeout',
            'lease_lost',
            'request_conflict',
          ].includes(code)
            ? code
            : 'budget_unavailable',
        );
        if (response.status < 500) throw Object.assign(error, { definitive: true });
      } catch (error) {
        if (error.definitive) throw error;
      }
    }
    throw Error('budget_unavailable');
  }
  async function gateway(run, req, res) {
    if (req.url === '/lease' && req.method === 'GET') {
      res.writeHead(
        // Keep PID 1 alive while the trusted controller freezes/collects the
        // workspace. Model calls are already blocked by run.finishing. Returning
        // 410 here used to race pause(): the supervisor could exit first.
        (!run.finishing || run.phase === 'collecting') &&
          Date.now() < run.lease &&
          Date.now() < run.deadline
          ? 200
          : 410,
      );
      res.end();
      return;
    }
    if (['/team/messages', '/team/inbox'].includes(req.url) && req.method === 'POST') {
      if (
        !run.input.teamMessaging ||
        run.input.workspaceAccess !== 'read-only' ||
        run.finishing ||
        Date.now() >= run.lease ||
        Date.now() >= run.deadline
      ) {
        res.writeHead(403);
        res.end('{}');
        return;
      }
      const data = await body(req, 16000);
      const operation = req.url === '/team/messages' ? 'messages' : 'inbox';
      const response = await fetch(
        `${run.controlOrigin}/internal/coding/${run.input.jobId}/${operation}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(
            operation === 'messages'
              ? { fence: run.input.fence, message: data }
              : { ...data, fence: run.input.fence },
          ),
          signal: AbortSignal.timeout(4000),
          redirect: 'error',
        },
      );
      const text = await response.text();
      if (text.length > 800000) throw Error('message_response_limit');
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(text);
      return;
    }
    if (
      req.url !== '/v1/responses' ||
      req.method !== 'POST' ||
      run.finishing ||
      Date.now() >= run.lease ||
      Date.now() >= run.deadline ||
      run.requests >= run.input.maxRequests
    ) {
      if (run.requests >= run.input.maxRequests) run.budgetReason ??= 'request_budget_exhausted';
      res.writeHead(403);
      res.end('{"error":{"message":"FerWeb execution limit or unsupported route"}}');
      return;
    }
    let value = await body(req);
    try {
      value = modelPayload(value, run);
    } catch (error) {
      if (fakeProvider)
        console.error(
          JSON.stringify({
            event: 'fixture_policy_error',
            message: error.message,
            keys: Object.keys(value),
            tools: value.tools?.map((t) => ({ type: t.type, name: t.name })),
            inputTypes: value.input?.map((i) => ({
              type: i.type,
              role: i.role,
              contentTypes: Array.isArray(i.content)
                ? i.content.map((c) => c.type)
                : typeof i.content,
            })),
          }),
        );
      throw error;
    }
    // The SQL reservation is the authority. Retries reuse one request ID.
    if (
      run.finishing ||
      Date.now() >= run.lease ||
      Date.now() >= run.deadline ||
      run.requests >= run.input.maxRequests
    ) {
      if (run.requests >= run.input.maxRequests) run.budgetReason ??= 'request_budget_exhausted';
      throw Error('execution_limit');
    }
    const requestId = randomUUID();
    try {
      await budgetCall(run, 'admit', { requestId, payloadHash: hash(JSON.stringify(value)) });
    } catch (error) {
      run.budgetReason ??= error.message;
      throw error;
    }
    run.requests++;
    const slot = attachUsageMeter(run, res);
    if (run.finishing || Date.now() >= run.lease || Date.now() >= run.deadline)
      throw Error('execution_limit');
    try {
      if (fakeProvider) {
        await fakeProvider(run, value, res);
        return;
      }
      const abort = new AbortController();
      run.upstreams.add(abort);
      const timer = setTimeout(() => abort.abort(), Math.min(120000, run.deadline - Date.now()));
      res.on('close', () => abort.abort());
      try {
        const reply = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + configuration.apiKey,
          },
          body: JSON.stringify(value),
          signal: abort.signal,
          redirect: 'error',
        });
        if (!reply.ok) {
          await reply.body?.cancel();
          res.writeHead(reply.status);
          res.end('{"error":{"message":"OpenAI request failed; upstream content withheld"}}');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let size = 0;
        for await (const chunk of reply.body) {
          size += chunk.length;
          if (size > 4000000) throw Error('model_output_limit');
          if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
        }
        res.end();
      } finally {
        clearTimeout(timer);
        run.upstreams.delete(abort);
      }
    } finally {
      // A cancelled request may still report usage. Failure leaves coverage unknown.
      await budgetCall(run, 'usage', { requestId, usage: run.meters[slot] ?? null }).catch(
        () => {},
      );
    }
  }
  async function start(input) {
    const control = new URL(input.controlOrigin);
    if (
      !['http:', 'https:'].includes(control.protocol) ||
      control.username ||
      control.password ||
      control.pathname !== '/' ||
      control.search ||
      control.hash
    )
      throw Error('invalid_control_origin');
    const environmentKeys = Object.keys(environment).sort();
    if (
      JSON.stringify(input.environment, environmentKeys) !==
      JSON.stringify(environment, environmentKeys)
    )
      throw Error('execution_environment_changed');
    if (
      !uuid.test(input.jobId) ||
      !uuid.test(input.fence) ||
      !/^[a-f0-9]{40}$/.test(input.commit) ||
      !configuration.models.includes(input.model)
    )
      throw Error('invalid_run');
    validateFiles(input.files);
    if (input.workspaceAccess !== undefined && input.workspaceAccess !== 'read-only')
      throw Error('invalid_profile');
    for (const [key, min, max] of [
      ['maxRequests', 1, 20],
      ['maxOutputTokens', 64, 8192],
    ])
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)
        throw Error('invalid_limit');
    const deadline = Date.parse(input.deadlineAt),
      lease = Date.parse(input.leaseExpiresAt);
    if (
      !Number.isFinite(deadline) ||
      deadline <= Date.now() ||
      deadline > Date.now() + 1200000 ||
      !Number.isFinite(lease) ||
      lease > Date.now() + 35000
    )
      throw Error('invalid_deadline');
    const previous = runs.get(input.jobId),
      digest = hash(JSON.stringify({ ...input, leaseExpiresAt: null }));
    if (previous) {
      if (previous.digest !== digest || previous.input.fence !== input.fence)
        throw Error('run_conflict');
      return previous;
    }
    if (runs.size >= 1000 || [...runs.values()].filter((r) => !r.finishing).length >= 2)
      throw Error('runner_limit');
    const key = randomUUID(),
      dir = `${root}/${key}`;
    await mkdir(dir, { mode: 0o755 });
    const publicInput = {
      jobId: input.jobId,
      repository: input.repository,
      commit: input.commit,
      task: input.task,
      role: input.role,
      files: input.files,
      workspaceAccess: input.workspaceAccess,
      model: input.model,
      deadlineAt: input.deadlineAt,
    };
    await writeFile(dir + '/input.json', JSON.stringify(publicInput), { mode: 0o644 });
    const run = {
      key,
      input,
      controlOrigin: control.origin,
      budgetReason: null,
      digest,
      lease,
      deadline,
      started: Date.now(),
      requests: 0,
      meters: [],
      phase: 'preparing',
      upstreams: new Set(),
      report: {
        kind: 'codex-v1',
        jobId: input.jobId,
        commit: input.commit,
        repository: input.repository,
        task: input.task,
        model: input.model,
        cliVersion: '0.166.0',
        simulated: !!fakeProvider,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        summary: '',
        commands: [],
        tests: [],
        diff: [],
        diffComplete: false,
        usage: null,
        cost: null,
        durationMs: null,
        modelRequests: 0,
        terminationConfirmed: null,
        limitations: [
          'Snapshot filtrado del commit, sin historial Git ni dependencias instaladas.',
          'El diff cubre texto UTF-8, sin comparar permisos; se rechazan enlaces y archivos especiales.',
          'Solo perfil Node: verificación fija node --test, sin instalación ni red general.',
          'Consumo ausente es desconocido; no se estima factura ni se garantiza cancelación remota de facturación.',
        ],
      },
    };
    runs.set(input.jobId, run);
    const server = http.createServer((req, res) => {
      void gateway(run, req, res).catch(() => {
        if (!res.headersSent) res.writeHead(502);
        res.end('{"error":{"message":"FerWeb model gateway rejected the request"}}');
      });
    });
    await new Promise((resolve) => server.listen(dir + '/model.sock', resolve));
    await chmod(dir + '/model.sock', 0o666);
    run.gateway = server;
    try {
      run.workspace = 'ferweb_code_' + key.replaceAll('-', '');
      await json('POST', '/volumes/create', {
        Name: run.workspace,
        Driver: 'local',
        Labels: { 'ferweb.codex.controller': namespace },
        DriverOpts: {
          type: 'tmpfs',
          device: 'tmpfs',
          o: 'size=67108864,uid=1000,gid=1000,mode=0700,noexec,nosuid',
        },
      });
      if (input.workspaceAccess === 'read-only') await seedReadOnly(run);
      const c = await json('POST', '/containers/create', {
        Image: image,
        Env: [],
        Labels: { 'ferweb.codex.controller': namespace, 'ferweb.codex.job': input.jobId },
        User: '0:0',
        WorkingDir: '/workspace',
        NetworkDisabled: true,
        HostConfig: {
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          CapDrop: ['ALL'],
          CapAdd: ['SETUID', 'SETGID'],
          SecurityOpt: ['no-new-privileges:true'],
          PidsLimit: 128,
          Memory: 805306368,
          MemorySwap: 805306368,
          NanoCpus: 1000000000,
          Init: true,
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=134217728,mode=1777',
            '/home/node': 'rw,noexec,nosuid,size=67108864,uid=1000,gid=1000,mode=0700',
          },
          Mounts: [
            {
              Type: 'volume',
              Source: run.workspace,
              Target: '/workspace',
              ReadOnly: input.workspaceAccess === 'read-only',
              VolumeOptions: { NoCopy: true },
            },
            {
              Type: 'volume',
              Source: volume,
              Target: '/control',
              ReadOnly: true,
              VolumeOptions: { Subpath: key, NoCopy: true },
            },
          ],
          LogConfig: { Type: 'local', Config: { 'max-size': '1m', 'max-file': '2' } },
          RestartPolicy: { Name: 'no' },
          Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 1024 }],
        },
      });
      run.container = c.Id;
      await docker('POST', `/containers/${c.Id}/start`);
      if (run.seeder) {
        await docker('DELETE', `/containers/${run.seeder}?force=1&v=1`);
        run.seeder = null;
      }
      void (async () => {
        try {
          // Wait for root supervisor preparation before executing anything as uid 1000.
          for (let i = 0; i < 50; i++) {
            const probe = await exec(run, [
              'node',
              '-e',
              "fetch('http://127.0.0.1:9040/lease').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ]);
            if (probe.exitCode === 0) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          if (run.finishing) return;
          run.phase = 'codex';
          const agent = await exec(run, ['node', '/opt/ferweb/agent.mjs'], (line) =>
            observe(run, line),
          );
          run.report.agentExitCode = agent.exitCode;
          if (agent.exitCode !== 0)
            run.report.limitations.push(
              'Diagnóstico Codex sin credenciales: ' + agent.output.slice(-4000),
            );
          if (run.finishing) return;
          if (agent.exitCode !== 0 || !run.report.turnCompleted || run.report.agentError) {
            await finish(run, 'agent_failed');
            return;
          }
          run.phase = 'verification';
          const readOnly = input.workspaceAccess === 'read-only';
          run.report.tests.push(
            await exec(
              run,
              readOnly
                ? ['timeout', '--signal=KILL', '20s', 'node', '/opt/ferweb/verify-readonly.mjs']
                : ['timeout', '--signal=KILL', '20s', 'node', '--test'],
            ),
          );
          run.report.tests[0].command = readOnly ? 'verify-readonly-snapshot' : 'node --test';
          run.report.tests[0].origin = readOnly
            ? 'controller-readonly-verification'
            : 'controller-verification';
          if (!run.finishing)
            await finish(run, run.report.tests[0].exitCode === 0 ? 'completed' : 'tests_failed');
        } catch {
          if (!run.finishing) await finish(run, 'executor_failed');
        }
      })();
    } catch (error) {
      if (fakeProvider)
        console.error(
          JSON.stringify({
            event: 'fixture_container_error',
            message: error.message,
            detail: error.detail,
          }),
        );
      await finish(run, 'container_start_failed');
    }
    return run;
  }
  const timer = setInterval(() => {
    for (const run of runs.values())
      if (!run.finishing && (Date.now() >= run.lease || Date.now() >= run.deadline))
        void finish(run, Date.now() >= run.deadline ? 'timeout' : 'lease_lost');
  }, 250);
  const server = http.createServer((req, res) => {
    void (async () => {
      const reply = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/health') {
        reply(200, { status: 'ready' });
        return;
      }
      if (!safeEqual(req.headers.authorization, 'Bearer ' + token)) {
        reply(401, {});
        return;
      }
      if (req.url === '/capabilities') {
        reply(200, {
          available: !!fakeProvider || !!configuration.apiKey,
          models: configuration.models,
          simulated: !!fakeProvider,
          environment,
        });
        return;
      }
      if (req.url === '/runs' && req.method === 'POST') {
        if (!fakeProvider && !configuration.apiKey) {
          reply(503, {});
          return;
        }
        const run = await start(await body(req));
        reply(202, { jobId: run.input.jobId });
        return;
      }
      const match = /^\/runs\/([a-f0-9-]{36})(\/heartbeat|\/cancel|\/release|\/files)?$/.exec(
        req.url,
      );
      const run = match && runs.get(match[1]);
      if (!run || !safeEqual(req.headers['x-run-fence'], run.input.fence)) {
        reply(404, {});
        return;
      }
      if (match[2] === '/files') {
        if (
          req.method !== 'GET' ||
          run.phase !== 'finished' ||
          run.reason !== 'completed' ||
          !run.outputFiles
        )
          reply(409, {});
        else reply(200, run.outputFiles);
        return;
      }
      if (match[2] === '/release' && req.method === 'POST') {
        if (run.phase !== 'finished') {
          reply(409, {});
          return;
        }
        runs.delete(match[1]);
        reply(200, { released: true });
        return;
      }
      if (match[2] === '/heartbeat' && req.method === 'POST') {
        const b = await body(req, 1000),
          next = Date.parse(b.leaseExpiresAt);
        if (
          !run.finishing &&
          (!Number.isFinite(next) || next > Date.now() + 35000 || next < run.lease)
        ) {
          reply(409, {});
          return;
        }
        if (!run.finishing) run.lease = next;
      } else if (match[2] === '/cancel' && req.method === 'POST') await finish(run, 'cancelled');
      else if (req.method !== 'GET') {
        reply(405, {});
        return;
      }
      reply(200, {
        done: run.phase === 'finished',
        phase: run.phase,
        reason: run.reason ?? null,
        containerId: run.container ?? null,
        report: {
          ...run.report,
          providerUsage: providerUsage(run),
          modelRequests: run.requests,
          durationMs: run.phase === 'finished' ? run.report.durationMs : Date.now() - run.started,
        },
      });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end('{}');
    });
  });
  const close = async () => {
    clearInterval(timer);
    await Promise.allSettled([...runs.values()].map((r) => finish(r, 'controller_shutdown')));
    server.close();
  };
  return { server, close };
}
