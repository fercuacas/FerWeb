import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

test('metrics require a server token and never retain arbitrary URLs or query secrets', async () => {
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
    assert.match(body, /le="\+Inf"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
