import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { LocalProvider, localRequest, validateLocalStream } from '../../runner/local-provider.mjs';
import { describeLocalCoding } from '../src/execution-capabilities.js';
import { createLocalFixture } from '../../runner/local-fixture.mjs';

const request = (input: any[] = []) => ({
  model: 'local',
  stream: true,
  input,
  max_output_tokens: 100,
  tools: [{ type: 'function', name: 'exec_command' }, { type: 'web_search' }],
});
const call = (
  id = 'one',
  name = 'exec_command',
  args = JSON.stringify({ cmd: 'printf same' }),
) => ({ type: 'function_call', id: 'fc_' + id, call_id: 'call_' + id, name, arguments: args });
const stream = (output: any[], extra = '') =>
  extra +
  'data: ' +
  JSON.stringify({
    type: 'response.completed',
    response: { id: 'response', status: 'completed', model: 'local', output },
  }) +
  '\n\n';

test('local coding refuses nonlocal destinations before transport and preserves local availability without an API key', () => {
  for (const url of [
    'https://api.openai.com',
    'http://ollama.com',
    'http://localhost/redirect',
    'http://user:secret@localhost',
    'http://localhost?q=x',
    'https://localhost',
  ])
    assert.throws(() => new LocalProvider({ url, models: ['local'] }));
  assert.throws(() => new LocalProvider({ url: 'http://localhost', models: ['model-cloud'] }));
  const option = describeLocalCoding({
    available: false,
    models: [],
    simulated: false,
    reason: null,
    environment: { image: 'sha256:' + 'a'.repeat(64) },
    typescriptEnvironment: null,
    local: {
      available: true,
      models: [{ id: 'local', revision: 'digest' }],
      simulated: false,
      version: '0.13.4',
      reason: null,
      configurationRevision: 'revision',
    },
  });
  assert.equal(option.available, true);
  assert.equal(option.provider, 'ollama');
  assert.equal(option.destination, 'local-ollama');
});

test('native catalogue rejects missing tools, remote model metadata, old versions and redirects without inference or downloads', async () => {
  let version = '0.13.4',
    tools = true,
    remote = false,
    redirect = false,
    targetCalls = 0;
  const paths: string[] = [];
  const target = http
    .createServer((_req, res) => {
      targetCalls++;
      res.end('{}');
    })
    .listen(0, '127.0.0.1');
  await once(target, 'listening');
  const targetAddress = target.address() as import('node:net').AddressInfo;
  const server = http
    .createServer((req, res) => {
      paths.push(req.url!);
      if (redirect) {
        res.writeHead(307, { Location: `http://127.0.0.1:${targetAddress.port}` });
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/api/version'
            ? { version }
            : req.url === '/api/tags'
              ? {
                  models: [
                    { name: 'local', digest: 'digest', ...(remote && { remote_model: 'cloud' }) },
                  ],
                }
              : { capabilities: tools ? ['tools', 'completion'] : ['completion'] },
        ),
      );
    })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const provider = new LocalProvider({
      url: `http://127.0.0.1:${address.port}`,
      models: ['local'],
    });
    assert.equal((await provider.capabilities()).available, true);
    tools = false;
    assert.equal((await provider.capabilities()).available, false);
    tools = true;
    remote = true;
    assert.equal((await provider.capabilities()).available, false);
    remote = false;
    version = '0.12.0';
    assert.equal((await provider.capabilities()).reason, 'local_server_incompatible');
    version = '0.13.4';
    redirect = true;
    assert.equal((await provider.capabilities()).available, false);
    assert.equal(targetCalls, 0);
    assert.ok(paths.every((path) => ['/api/version', '/api/tags', '/api/show'].includes(path)));
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ]);
  }
});

test('local tool sequences reject unknown calls, malformed arguments, contradictions, replay and fabricated history', () => {
  const value = localRequest(request());
  assert.deepEqual(
    value.tools.map((tool: any) => tool.name),
    ['exec_command'],
  );
  assert.throws(
    () => validateLocalStream(stream([call('one', 'spawn_agent')]), value, {}),
    /local_tool_unknown/,
  );
  assert.throws(
    () => validateLocalStream(stream([call('one', 'exec_command', '{broken')]), value, {}),
    /local_tool_arguments/,
  );
  assert.throws(
    () =>
      validateLocalStream(
        stream([
          call(
            'one',
            'exec_command',
            JSON.stringify({ cmd: 'true', sandbox_permissions: 'require_escalated' }),
          ),
        ]),
        value,
        {},
      ),
    /local_tool_arguments/,
  );
  assert.throws(() => validateLocalStream('data: {}\n\n', value, {}), /local_stream_incomplete/);
  const badDelta =
    'data: ' +
    JSON.stringify({
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_one',
      delta: 'other',
    }) +
    '\n\n';
  assert.throws(
    () => validateLocalStream(stream([call()], badDelta), value, {}),
    /local_stream_invalid/,
  );
  const run = {};
  validateLocalStream(stream([call()]), value, run);
  assert.throws(() => validateLocalStream(stream([call()]), value, run), /local_tool_replay/);
  assert.throws(
    () =>
      localRequest(
        request([{ type: 'function_call_output', call_id: 'invented', output: 'success' }]),
        run,
      ),
    /local_history_invalid/,
  );
});

test('repeated tools without a new observed result stop before a third identical execution', () => {
  const run = {},
    value = localRequest(request());
  validateLocalStream(stream([call('one')]), value, run);
  const first = {
    type: 'function_call_output',
    call_id: 'call_one',
    output: 'Chunk ID: a\nWall time: 0.1 seconds\nProcess exited with code 0\nFinal output:\nsame',
  };
  const second = {
    ...first,
    call_id: 'call_two',
    output: first.output.replace('ID: a', 'ID: b').replace('0.1 seconds', '0.2 seconds'),
  };
  const next = localRequest(request([call('one'), first]), run);
  validateLocalStream(stream([call('two')]), next, run);
  const repeated = localRequest(request([call('one'), first, call('two'), second]), run);
  assert.throws(
    () => validateLocalStream(stream([call('three')]), repeated, run),
    /local_no_progress/,
  );
});

test('native HTTP fixture keeps cumulative observations after its bounded request sample fills', async () => {
  const fixture = await createLocalFixture(() => 0, 'fixture-counter-token');
  const base = 'http://127.0.0.1:8011';
  try {
    for (let index = 0; index < 2001; index++) await (await fetch(base + '/api/version')).json();
    const response = await fetch(base + '/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fixture-local',
        stream: true,
        tools: [{ type: 'function', name: 'exec_command' }],
        input: [
          {
            role: 'user',
            content: 'Task snapshot:' + JSON.stringify({ title: 'P20 counter regression' }),
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /response.completed/);
    const observed = await (
      await fetch(base + '/test/state', {
        headers: { authorization: 'Bearer fixture-counter-token' },
      })
    ).json();
    assert.equal(observed.requests.length, 2000);
    assert.equal(observed.requests.at(-1).path, '/v1/responses');
    assert.equal(observed.responseRequests, 1);
    assert.equal(observed.authorizationRequests, 0);
  } finally {
    await fixture.close();
  }
});

test('an interrupted native HTTP response closes transport and returns a normalized provider failure', async () => {
  let started!: () => void, closed!: () => void;
  const receiving = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stopped = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = http
    .createServer((req, res) => {
      req.resume();
      if (req.url === '/v1/responses') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        res.on('close', closed);
        started();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/api/version'
            ? { version: '0.13.4' }
            : req.url === '/api/tags'
              ? { models: [{ name: 'local', digest: 'digest' }] }
              : { capabilities: ['tools', 'completion'] },
        ),
      );
    })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const provider = new LocalProvider({
      url: `http://127.0.0.1:${address.port}`,
      models: ['local'],
    });
    const catalog = await provider.capabilities();
    const run = {
      input: {
        environment: { localRevision: catalog.configurationRevision },
        modelRevision: 'digest',
      },
      deadline: Date.now() + 5000,
      lease: Date.now() + 5000,
      report: { execution: {} },
      upstreams: new Set<AbortController>(),
    };
    const generation = provider.generate(run, localRequest(request()), new EventEmitter());
    const rejected = assert.rejects(
      generation,
      (error: any) => error.code === 'local_provider_failed',
    );
    await receiving;
    for (const abort of run.upstreams) abort.abort();
    await rejected;
    await stopped;
    assert.equal(run.upstreams.size, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
