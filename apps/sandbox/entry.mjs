import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Trusted root supervisor. Repository processes have uid/gid 1000, no capabilities,
// no-new-privileges and cannot signal this supervisor or read its process memory.
const input = JSON.parse(await readFile('/control/input.json', 'utf8'));
if (input.workspaceAccess !== 'read-only') {
  const protect = spawn(process.execPath, ['/opt/ferweb/prepare.mjs', '--protect'], {
    env: {},
    stdio: 'ignore',
  });
  if (
    (await new Promise((resolve) => {
      protect.once('exit', resolve);
      protect.once('error', () => resolve(2));
    })) !== 0
  )
    process.exit(2);
  const prepare = spawn(process.execPath, ['/opt/ferweb/prepare.mjs'], {
    uid: 1000,
    gid: 1000,
    env: {},
    stdio: 'ignore',
  });
  if (
    (await new Promise((resolve) => {
      prepare.once('exit', resolve);
      prepare.once('error', () => resolve(2));
    })) !== 0
  )
    process.exit(2);
}
const proxy = http.createServer((req, res) => {
  const upstream = http.request(
    {
      socketPath: '/control/model.sock',
      path: req.url,
      method: req.method,
      headers: { 'content-type': 'application/json' },
    },
    (reply) => {
      res.writeHead(reply.statusCode, {
        'content-type': reply.headers['content-type'] ?? 'application/json',
      });
      reply.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(503);
    res.end('{}');
  });
  req.pipe(upstream);
  res.on('close', () => upstream.destroy());
});
await new Promise((resolve) => proxy.listen(9040, '127.0.0.1', resolve));
let checking = false;
setInterval(() => {
  if (checking) return;
  checking = true;
  const req = http.get(
    { socketPath: '/control/model.sock', path: '/lease', timeout: 1500 },
    (res) => {
      res.resume();
      if (res.statusCode !== 200) process.exit(70);
      checking = false;
    },
  );
  req.on('timeout', () => req.destroy());
  req.on('error', () => process.exit(70));
}, 500);
setTimeout(() => process.exit(124), Math.max(1, Date.parse(input.deadlineAt) - Date.now()) + 1000);
// The agent is a separate Docker exec process. PID 1 stays alive until the
// trusted controller has collected a frozen filesystem and stopped the container.
process.on('SIGTERM', () => process.exit(0));
