import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { checkSmoke } from './smoke.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `ferweb-check-${randomBytes(5).toString('hex')}`;
const envFile = `.local/${project}.env`;
async function run(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`docker exited with ${code}`)),
    );
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Preflight before creating any test resources.
try {
  await run(['info', '--format', '{{.OSType}}']);
} catch {
  console.error(
    'Docker CLI/engine unavailable. Install and start Docker Desktop with Linux containers, then retry npm run check:compose.',
  );
  process.exit(1);
}
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
const webPort = await freePort();
let apiPort = await freePort();
while (apiPort === webPort) apiPort = await freePort();
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
await writeFile(
  new URL(`../${envFile}`, import.meta.url),
  template.replace('replace-with-a-random-local-password', randomBytes(24).toString('hex')),
  { flag: 'wx', mode: 0o600 },
);
// Shell settings must not redirect the isolated test into an application database.
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  POSTGRES_DB: 'ferweb_check',
  POSTGRES_USER: 'ferweb_check',
  POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  AI_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  RUNNER_SERVICE_TOKEN: randomBytes(32).toString('hex'),
  API_PORT: String(apiPort),
  WEB_PORT: String(webPort),
};
const args = ['compose', '-f', 'compose.yaml'];
if (env.FERWEB_BUILD_CA_FILE) args.push('-f', 'compose.ca.yaml');
args.push('--env-file', envFile, '-p', project);
let started = false;
try {
  started = true;
  await run([...args, 'up', '--build', '--detach', '--wait', '--wait-timeout', '180'], env);
  const url = `http://127.0.0.1:${webPort}`;
  const before = await checkSmoke(url);
  await run([...args, 'restart', 'db'], env);
  let after;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      after = await checkSmoke(url);
      break;
    } catch {
      await delay(1000);
    }
  }
  assert.equal(
    after?.installation?.id,
    before.installation.id,
    'Installation must survive database restart',
  );
  await run([...args, 'down'], env);
  await run([...args, 'up', '--detach', '--wait', '--wait-timeout', '180'], env);
  const recreated = await checkSmoke(url);
  assert.equal(
    recreated.installation?.id,
    before.installation.id,
    'Installation must survive container recreation',
  );
  console.log('PASS: isolated Compose startup, migration and volume persistence.');
} finally {
  if (started) {
    // Only this newly generated test project and its disposable volume are removed.
    try {
      await run([...args, 'logs', '--tail', '30'], env);
    } finally {
      await run([...args, 'down', '--volumes'], env);
    }
  }
  await rm(new URL(`../${envFile}`, import.meta.url), { force: true });
}
