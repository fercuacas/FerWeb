import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createPool } from '../apps/api/dist/database.js';
import { readConfig } from '../apps/api/dist/config.js';
import { applyMigrations, loadMigrations } from '../apps/api/dist/migrations.js';
import { hashPassword } from '../apps/api/dist/modules/identity/passwords.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // Docker supplies database configuration through the process environment.
}
const root = fileURLToPath(new URL('../', import.meta.url));
const config = readConfig();
// Database lifecycle can wait for storage checkpoints; API pools retain short limits.
const admin = new pg.Pool({
  host: config.PGHOST,
  port: config.PGPORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30_000,
  query_timeout: 35_000,
  application_name: 'ferweb-browser-admin',
});
const database = `ferweb_browser_${randomBytes(6).toString('hex')}`;
const pool = createPool({ ...config, POSTGRES_DB: database });
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}
const apiPort = await freePort();
let webPort = await freePort();
while (webPort === apiPort) webPort = await freePort();
const url = `http://127.0.0.1:${webPort}`;
const password = randomBytes(24).toString('hex');
const otherPassword = randomBytes(24).toString('hex');
const env = {
  ...process.env,
  POSTGRES_DB: database,
  API_PORT: String(apiPort),
  PORT: String(apiPort),
  WEB_PORT: String(webPort),
  APP_ORIGIN: url,
  COOKIE_SECURE: 'false',
  HOST: '127.0.0.1',
  API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  FERWEB_URL: url,
  FERWEB_TEST_EMAIL: 'owner@ferweb.test',
  FERWEB_TEST_PASSWORD: password,
  FERWEB_OTHER_EMAIL: 'other@ferweb.test',
  FERWEB_OTHER_PASSWORD: otherPassword,
};
const children = [];
let created = false;
function start(args, environment = env, stdio = 'inherit') {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: environment,
    stdio,
    windowsHide: true,
  });
  return child;
}
async function run(args, environment = env) {
  const child = start(args, environment);
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Browser verification subprocess exited ${code}`);
}
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  await applyMigrations(pool, await loadMigrations());
  await run(['apps/api/dist/provision.js'], {
    ...env,
    FERWEB_OWNER_EMAIL: env.FERWEB_TEST_EMAIL,
    FERWEB_OWNER_PASSWORD: password,
  });
  const other = await pool.query(
    'INSERT INTO app_users (email,password_hash) VALUES ($1,$2) RETURNING id',
    [env.FERWEB_OTHER_EMAIL, await hashPassword(otherPassword)],
  );
  const foreign = await pool.query(
    'INSERT INTO projects (owner_id,name,description) VALUES ($1,$2,$3) RETURNING id',
    [other.rows[0].id, 'Proyecto reservado', 'Datos de otra cuenta'],
  );
  const foreignTask = await pool.query(
    "INSERT INTO tasks (project_id,title,priority,status) VALUES ($1,'Tarea reservada','high','todo') RETURNING id",
    [foreign.rows[0].id],
  );
  env.FERWEB_FOREIGN_PROJECT = foreign.rows[0].id;
  env.FERWEB_FOREIGN_TASK = foreignTask.rows[0].id;
  children.push(
    start(['tests/fixtures/server.mjs']),
    start(['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts']),
  );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url + '/api/health/ready', {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (children.some((child) => child.exitCode !== null)) break;
    await delay(250);
  }
  assert.ok(ready, 'Isolated browser stack did not become ready');
  await run(['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)]);
} finally {
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', resolve);
          child.kill();
        }),
    ),
  );
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
