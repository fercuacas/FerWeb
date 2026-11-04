import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, writeFile, readFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import net from 'node:net';
import { docker, root, releaseOptions } from './release-lib.mjs';
import { backup, restore } from './release-storage.mjs';

const suffix = randomBytes(5).toString('hex');
const directory = resolve(root, '.local', `release-check-${suffix}`);
const source = resolve(directory, 'source');
await mkdir(source, { recursive: true });
// Build from only Git-visible public inputs, with no node_modules, dist, env or credentials.
const inventory = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
);
if (inventory.status !== 0) throw new Error('Cannot enumerate clean source inputs.');
const sourceHash = createHash('sha256');
for (const file of inventory.stdout.split('\0').filter(Boolean)) {
  assert.ok(!/^(?:\.local|secrets|node_modules|\.artifacts|\.git)\//.test(file));
  assert.ok(
    !/^\.env(?:\.|$)/.test(file) || /\.example$/.test(file),
    'Private environment files are forbidden in clean source',
  );
  sourceHash
    .update(file)
    .update('\0')
    .update(await readFile(resolve(root, file)))
    .update('\0');
  await mkdir(dirname(resolve(source, file)), { recursive: true });
  await copyFile(resolve(root, file), resolve(source, file));
}
const testPassword = randomBytes(24).toString('hex');
const port = async () => {
  const socket = net.createServer();
  await new Promise((resolvePromise) => socket.listen(0, '127.0.0.1', resolvePromise));
  const result = socket.address().port;
  await new Promise((resolvePromise) => socket.close(resolvePromise));
  return result;
};
const environmentFile = resolve(directory, 'test.env');
await mkdir(resolve(source, '.artifacts/docker-tests'), { recursive: true });
await chmod(resolve(source, '.artifacts/docker-tests'), 0o777);
await writeFile(
  environmentFile,
  [
    'POSTGRES_DB=ferweb_release_check',
    'POSTGRES_USER=ferweb_check',
    `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`,
    `AI_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
    `RUNNER_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
    `METRICS_TOKEN=${randomBytes(32).toString('hex')}`,
    `WEB_PORT=${await port()}`,
    'APP_ORIGIN=http://web:5173',
    'COOKIE_SECURE=false',
    `FERWEB_RELEASE_TAG=check-${suffix}`,
    'SOURCE_DATE_EPOCH=0',
    '',
  ].join('\n'),
  { mode: 0o600, flag: 'wx' },
);
const environment = {
  ...process.env,
  FERWEB_TEST_PASSWORD: testPassword,
  FERWEB_URL: 'http://web:5173',
};
// Prevent ambient local credentials/provider files from entering acceptance containers.
for (const key of [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'AI_SERVICE_TOKEN',
  'RUNNER_SERVICE_TOKEN',
  'METRICS_TOKEN',
  'APP_ORIGIN',
  'COOKIE_SECURE',
  'WEB_PORT',
  'FERWEB_RELEASE_TAG',
  'FERWEB_GITHUB_CONFIG_FILE',
  'FERWEB_AI_CONFIG_FILE',
  'FERWEB_CODEX_CONFIG_FILE',
])
  delete environment[key];
const options = releaseOptions({
  project: `ferweb-releasecheck-${suffix}`,
  envFile: environmentFile,
  cwd: source,
  env: environment,
});
const restored = releaseOptions({
  project: `ferweb-restorecheck-${suffix}`,
  envFile: environmentFile,
  cwd: source,
  env: environment,
});
const hashSource = `
import { createHash } from 'node:crypto'; import pg from 'pg';
const p = new pg.Pool({host:process.env.PGHOST,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB});
const tables = (await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
const result = {};
for (const {tablename} of tables) { const rows = (await p.query('SELECT to_jsonb(t) AS row FROM "'+tablename+'" t')).rows.map(r=>JSON.stringify(r.row)).sort(); result[tablename]={count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}; }
console.log(JSON.stringify(result)); await p.end();`;
const fingerprint = async (stack) =>
  JSON.parse(
    await stack.run(['run', '--rm', '--no-deps', '-T', 'api', 'node', '--input-type=module'], {
      input: hashSource,
      capture: true,
    }),
  );
const report = {
  createdAt: new Date().toISOString(),
  cleanSourceFiles: inventory.stdout.split('\0').filter(Boolean).length,
  checks: [],
  sourceSha256: sourceHash.digest('hex'),
};
try {
  await options.run(['--profile', 'build-sandbox', 'build', 'sandbox-image']);
  await options.run(['build', 'api', 'web', 'ai', 'runner', 'tools']);
  const inspectRuntime = async () => {
    const [image] = JSON.parse(
      await docker(['image', 'inspect', `ferweb-web:check-${suffix}`], { capture: true }),
    );
    return {
      config: image.Config,
      layers: image.RootFS.Layers,
      created: image.Created,
      architecture: image.Architecture,
      os: image.Os,
    };
  };
  const beforeImage = await inspectRuntime();
  await options.run(['build', 'web']);
  assert.deepEqual(await inspectRuntime(), beforeImage);
  report.checks.push(
    'unchanged-input cached rebuild runtime layers/config stable; provenance index may change',
  );
  await options.run(['run', '--rm', '--no-deps', '-T', 'web', 'node', '--input-type=module'], {
    input: await readFile(resolve(source, 'tests/release-proxy.mjs'), 'utf8'),
  });
  report.checks.push('compiled web proxy streaming/cancellation with fake local upstream');
  await options.run(['up', '--detach', '--wait', '--wait-timeout', '180', '--no-build']);
  const vectorCollection = `release_recovery_${suffix}`;
  const vector = {
    id: 42,
    vector: [0.1, 0.2, 0.3],
    payload: { source: 'simulated-recovery-fixture', commit: 'a'.repeat(40) },
  };
  await options.run(['exec', '-T', 'api', 'node', '--input-type=module'], {
    input: `const base='http://qdrant:6333/collections/${vectorCollection}';for(const [url,body] of [[base,{vectors:{size:3,distance:'Cosine'}}],[base+'/points?wait=true',{points:[${JSON.stringify(vector)}]}]]){const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Vector fixture failed');}`,
  });
  await options.run(
    ['exec', '-T', '--env', 'FERWEB_TEST_PASSWORD', 'api', 'node', '--input-type=module'],
    {
      input: `import {createPool} from './dist/database.js'; import {readConfig} from './dist/config.js'; import {provisionOwner} from './dist/modules/identity/provision.js'; import {hashPassword} from './dist/modules/identity/passwords.js'; const p=createPool(readConfig()); await provisionOwner(p,{email:'release@ferweb.test',password:process.env.FERWEB_TEST_PASSWORD}); await p.query('INSERT INTO app_users(email,password_hash) VALUES($1,$2)',['other@ferweb.test',await hashPassword(process.env.FERWEB_TEST_PASSWORD)]); await p.end();`,
    },
  );
  await options.run([
    '--profile',
    'tools',
    'run',
    '--rm',
    '--no-deps',
    '--env',
    'FERWEB_TEST_PASSWORD',
    '--env',
    'FERWEB_URL',
    'tools',
    'node',
    'scripts/release-journey.mjs',
  ]);
  report.journey = JSON.parse(
    await readFile(resolve(source, '.artifacts/docker-tests/release-journey.json'), 'utf8'),
  );
  report.conditions = JSON.parse(
    await docker(
      [
        'info',
        '--format',
        '{"os":"{{.OSType}}","architecture":"{{.Architecture}}","cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}}}',
      ],
      { capture: true },
    ),
  );
  report.checks.push(
    'fresh volumes + 10 migrations + compiled Chromium journey + cross-owner authorization + simulated worker + load',
  );
  // Freeze writers before hashing so timestamps/leases do not change between checkpoints.
  await options.run(['stop', 'web', 'api', 'worker', 'runner', 'ai', 'qdrant']);
  const original = await fingerprint(options);
  const backupDirectory = resolve(directory, 'backup');
  await backup(options, backupDirectory);
  await options.run(['down']); // preserve source volumes until final scoped cleanup
  await restored.run(['up', '--detach', '--wait', 'db']);
  const manifestPath = resolve(backupDirectory, 'manifest.json');
  const originalManifest = await readFile(manifestPath, 'utf8');
  const invalidManifest = JSON.parse(originalManifest);
  invalidManifest.files['database.dump'].sha256 = '0'.repeat(64);
  try {
    await writeFile(manifestPath, JSON.stringify(invalidManifest));
    await assert.rejects(restore(restored, backupDirectory), /integrity mismatch/);
  } finally {
    await writeFile(manifestPath, originalManifest);
  }
  await restore(restored, backupDirectory);
  assert.deepEqual(
    await fingerprint(restored),
    original,
    'Every public SQL table must survive recovery',
  );
  report.restoredTables = Object.keys(original).length;
  await assert.rejects(restore(restored, backupDirectory), /existing database tables/);
  report.checks.push(
    'offline paired backup integrity + tampered checksum rejected + empty-target restore + all-table hashes + overwrite refused',
  );
  await restored.run(['up', '--detach', '--wait', '--wait-timeout', '180', '--no-build']);
  await restored.run(['exec', '-T', 'api', 'node', '--input-type=module'], {
    input: `const r=await fetch('http://qdrant:6333/collections/${vectorCollection}/points/42');const body=await r.json();if(!r.ok||body.result?.payload?.commit!=='${'a'.repeat(40)}'||body.result?.payload?.source!=='simulated-recovery-fixture')throw Error('Restored vector mismatch');console.log('PASS: nonempty Qdrant recovery fixture.');`,
  });
  report.checks.push('nonempty Qdrant collection and source-version payload recovered');
  await restored.run([
    '--profile',
    'tools',
    'run',
    '--rm',
    '--no-deps',
    '--env',
    'FERWEB_TEST_PASSWORD',
    '--env',
    'FERWEB_URL',
    '--env',
    'FERWEB_VERIFY_RESTORE=true',
    'tools',
    'node',
    'scripts/release-journey.mjs',
  ]);
  await restored.run(['restart', 'db']);
  // Readiness retries are bounded and run inside the container, with no host server.
  await restored.run(['exec', '-T', 'api', 'node', '--input-type=module'], {
    input: `for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:3001/api/health/ready');if(r.ok)process.exit(0);}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1);`,
  });
  await restored.run([
    '--profile',
    'tools',
    'run',
    '--rm',
    '--no-deps',
    '--env',
    'FERWEB_TEST_PASSWORD',
    '--env',
    'FERWEB_URL',
    '--env',
    'FERWEB_VERIFY_RESTORE=true',
    'tools',
    'node',
    'scripts/release-journey.mjs',
  ]);
  report.checks.push(
    'restored login/project/task + idempotent migration rerun + database restart persistence',
  );
  await restored.run(['exec', '-T', 'api', 'node', '--input-type=module'], {
    input: `const r=await fetch('http://127.0.0.1:3001/internal/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN}});const t=await r.text();if(!r.ok||!t.includes('ferweb_http_requests_total'))process.exit(1);console.log('PASS: protected internal Prometheus metrics.');`,
  });
  report.checks.push('internal token-protected metrics, public entry point denies metrics');
  await backup(restored, resolve(directory, 'automatic-pause-backup'));
  await restored.run(['up', '--detach', '--wait', '--wait-timeout', '180', '--no-build']);
  report.checks.push(
    'backup initiated from healthy running services pauses and resumes those services',
  );
  report.images = {};
  for (const service of ['api', 'web', 'ai', 'runner'])
    report.images[service] = {
      tag: `ferweb-${service}:check-${suffix}`,
      id: await docker(
        ['image', 'inspect', `ferweb-${service}:check-${suffix}`, '--format', '{{.Id}}'],
        { capture: true },
      ),
    };
  report.images.sandbox = {
    tag: 'ferweb-codex-sandbox:0.166.0',
    id: await docker(['image', 'inspect', 'ferweb-codex-sandbox:0.166.0', '--format', '{{.Id}}'], {
      capture: true,
    }),
  };
  report.passed = true;
} finally {
  for (const stack of [options, restored]) {
    // Only random projects created by this invocation may be removed, including their test volumes.
    assert.match(stack.project, /^ferweb-(releasecheck|restorecheck)-[a-f0-9]{10}$/);
    await stack.run(['logs', '--tail', '15', 'api', 'worker']);
    await stack.run(['down', '--volumes', '--remove-orphans']);
  }
  await writeFile(
    resolve(root, '.local/release-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  'PASS: clean release acceptance and recovery; report in .local/release-verification.json.',
);
