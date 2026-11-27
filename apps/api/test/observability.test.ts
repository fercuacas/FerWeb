import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { attemptFields } from '../src/modules/jobs/telemetry.js';
import type { Claim } from '../src/modules/jobs/queue.js';

test('metrics and logs exclude untrusted paths, bodies and authorization values', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const server = createApp(
    async () => {
      throw new Error('not used');
    },
    0,
    undefined,
    'test-metrics-token',
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${url}/internal/metrics`)).status, 404);
    assert.equal(
      (await fetch(`${url}/internal/metrics`, { headers: { Authorization: 'Bearer incorrect' } }))
        .status,
      404,
    );
    await fetch(`${url}/private-user-uuid?token=secret-query`);
    await fetch(`${url}/private-user-uuid`, {
      method: 'POST',
      body: JSON.stringify({ content: 'private-request-marker' }),
    });
    const result = await fetch(`${url}/internal/metrics`, {
      headers: { Authorization: 'Bearer test-metrics-token' },
    });
    assert.equal(result.status, 200);
    const body = await result.text();
    assert.match(
      body,
      /ferweb_http_requests_total\{method="GET",route="unmatched",status="404"\} 1/,
    );
    assert.ok(!body.includes('secret-query') && !body.includes('private-user-uuid'));
    assert.doesNotMatch(
      JSON.stringify(log.mock.calls.map(({ arguments: args }) => args)),
      /secret-query|private-user-uuid|private-request-marker|test-metrics-token/,
    );
    assert.match(body, /le="\+Inf"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('worker correlation admits only durable identifiers, a role version and a fixed runtime', () => {
  const id = 'f7b94e72-2938-4e35-b85c-471c5e67dba0';
  const step = 'cbaee0d0-5fcd-4aed-bc69-0c469fc54773';
  const correlation = attemptFields({
    id,
    attempt: 1,
    executor_id: id,
    kind: 'codex-v1',
    configuration: { executionId: 'codex-local-v1', model: 'private-model-name' },
    correlation: { parent: id, step, agent: 'private-role-name', version: '2' },
  } as Claim);
  assert.deepEqual(correlation, {
    jobId: id,
    executorId: id,
    attempt: 1,
    runtime: 'codex_local',
    teamId: id,
    teamStepId: step,
    agentId: null,
    agentVersion: 2,
  });
  assert.doesNotMatch(JSON.stringify(correlation), /private/);
});
