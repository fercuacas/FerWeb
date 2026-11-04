const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
assert.equal(process.getuid(), 1000);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
for (const name of [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'POSTGRES_PASSWORD',
  'RUNNER_SERVICE_TOKEN',
  'AI_SERVICE_TOKEN',
])
  assert.equal(process.env[name], undefined);
assert.throws(() => fs.writeFileSync('/etc/ferweb-escape', 'blocked'));
assert.throws(() => fs.writeFileSync('/control/input.json', 'blocked'));
assert.throws(() => fs.readdirSync('/runner'));
assert.equal(JSON.parse(fs.readFileSync('/control/input.json', 'utf8')).fence, undefined);
const workspaceFs = fs.statfsSync('/workspace');
assert.equal(workspaceFs.blocks * workspaceFs.bsize, 67108864);
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /CapEff:\s+0+\n/);
assert.match(fs.readFileSync('/proc/self/status', 'utf8'), /NoNewPrivs:\s+1/);
assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(), '128');
assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), '805306368');
assert.match(fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8'), /^100000 100000/);
const socket = net.connect({ host: '1.1.1.1', port: 443 });
socket.setTimeout(1000);
socket.once('connect', () => {
  throw new Error('Unexpected general network access');
});
socket.once('error', () => {
  console.log(
    'ISOLATION_OK: no credentials, host socket, root writes, privileges or general network; cgroup limits observed.',
  );
});
socket.once('timeout', () => {
  socket.destroy();
  console.log('ISOLATION_OK: external network timed out; other isolation assertions passed.');
});
