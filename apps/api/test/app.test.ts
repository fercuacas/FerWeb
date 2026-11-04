import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { readinessSchema } from '@ferweb/contracts';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import type { DatabaseSnapshot } from '../src/health.js';

const snapshot: DatabaseSnapshot = {
  checks: { database: 'ready', migrations: 'ready', appliedMigrations: 1, requiredMigrations: 1 },
  installation: {
    id: '3bb173b4-1fa3-4c63-b471-1b001f38b80f',
    createdAt: '2026-11-01T12:00:00.000Z',
  },
};
let mode: 'ready' | 'pending' | 'down' = 'ready';
let server: Server;
let base: string;
before(async () => {
  server = createApp(async () => {
    if (mode === 'down') throw new Error('secret-connection-string');
    if (mode === 'pending')
      return {
        ...snapshot,
        checks: { ...snapshot.checks, migrations: 'pending' },
        installation: null,
      };
    return snapshot;
  }, 1).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
});
after(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

test('readiness returns the validated contract and does not cache status', async () => {
  mode = 'ready';
  const response = await fetch(`${base}/api/health/ready`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
  const value = readinessSchema.parse(await response.json());
  assert.equal(value.installation?.id, snapshot.installation?.id);
  assert.equal(value.status, 'ready');
});
test('pending migrations return 503 even with a database connection', async () => {
  mode = 'pending';
  const response = await fetch(`${base}/api/health/ready`);
  assert.equal(response.status, 503);
  const value = readinessSchema.parse(await response.json());
  assert.equal(value.checks.database, 'ready');
  assert.equal(value.checks.migrations, 'pending');
});
test('database outage is safe and does not affect liveness', async () => {
  mode = 'down';
  const response = await fetch(`${base}/api/health/ready`);
  assert.equal(response.status, 503);
  const raw = await response.text();
  assert.ok(!raw.includes('secret-connection-string'));
  const value = readinessSchema.parse(JSON.parse(raw));
  assert.equal(value.checks.database, 'unavailable');
  assert.equal(value.checks.appliedMigrations, null);
  assert.equal((await fetch(`${base}/api/health/live`)).status, 200);
});
test('unknown endpoints return JSON 404', async () => {
  const response = await fetch(`${base}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});
test('configuration rejects invalid ports and placeholder credentials without leaking values', () => {
  assert.throws(
    () =>
      readConfig({
        PORT: '70000',
        PGHOST: 'localhost',
        POSTGRES_DB: 'db',
        POSTGRES_USER: 'user',
        POSTGRES_PASSWORD: 'private-value',
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('PORT'));
      assert.ok(!error.message.includes('private-value'));
      return true;
    },
  );
  assert.throws(() =>
    readConfig({
      PGHOST: 'localhost',
      POSTGRES_DB: 'db',
      POSTGRES_USER: 'user',
      POSTGRES_PASSWORD: 'replace-with-a-random-local-password',
    }),
  );
});
