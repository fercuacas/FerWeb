// Executed over stdin inside a fresh compiled web image, with a fake local upstream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

let ended = false;
let closed;
const disconnected = new Promise((resolve) => {
  closed = resolve;
});
const upstream = createServer((request, response) => {
  assert.equal(request.url, '/api/test-stream');
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'X-Request-Id': 'fixture-request',
  });
  response.write('data: first\n\n');
  const timer = setTimeout(() => {
    ended = true;
    response.end('data: last\n\n');
  }, 1000);
  response.on('close', () => {
    clearTimeout(timer);
    closed();
  });
});
upstream.listen(4444, '127.0.0.1');
await once(upstream, 'listening');
process.env.API_PROXY_TARGET = 'http://127.0.0.1:4444';
await import('./serve.mjs');
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    if ((await fetch('http://127.0.0.1:5173/')).ok) {
      ready = true;
      break;
    }
  } catch {
    /* bounded startup */
  }
  await delay(20);
}
assert.ok(ready);
const response = await fetch('http://127.0.0.1:5173/api/test-stream');
assert.equal(response.headers.get('x-request-id'), 'fixture-request');
const reader = response.body.getReader();
assert.match(new TextDecoder().decode((await reader.read()).value), /data: first/);
assert.equal(ended, false, 'Streaming must arrive before the upstream finishes');
await reader.cancel();
await Promise.race([
  disconnected,
  delay(2000).then(() => {
    throw new Error('Cancellation did not reach upstream');
  }),
]);
assert.equal(ended, false);
assert.equal((await fetch('http://127.0.0.1:5173/internal/metrics')).status, 404);
assert.equal((await fetch('http://127.0.0.1:5173/assets/absent.js')).status, 404);
console.log(
  'PASS: compiled release proxy streams immediately, propagates cancellation and blocks internal paths.',
);
upstream.close();
process.exit(0);
