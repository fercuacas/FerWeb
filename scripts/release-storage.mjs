import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { docker, root } from './release-lib.mjs';

const writers = ['web', 'api', 'worker', 'runner', 'ai', 'qdrant'];
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const activeWork = `SELECT (SELECT count(*) FROM jobs WHERE state IN ('pending','running'))
  + (SELECT count(*) FROM team_executions WHERE state IN ('pending','running'))
  + (SELECT count(*) FROM chat_turns WHERE status='streaming')
  + (SELECT count(*) FROM lab_batches WHERE status='running')
  + (SELECT count(*) FROM coding_reviews WHERE state='publishing');`;
const sql = (options, statement) =>
  options.run(
    [
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA',
    ],
    { input: statement, capture: true },
  );
async function image(options) {
  const id = await options.run(['ps', '-q', 'db'], { capture: true });
  if (!id) throw new Error('Start the target database first.');
  return docker(['inspect', '--format', '{{.Image}}', id], { capture: true });
}
function folderPath(folder) {
  if (!folder) throw new Error('Provide an explicit private backup directory.');
  const path = resolve(folder);
  if (path.includes(',')) throw new Error('Backup paths must not contain commas.');
  const within = relative(root, path);
  if (
    !isAbsolute(within) &&
    within !== '..' &&
    !within.startsWith(`..${sep}`) &&
    !['.local', 'backups', 'secrets'].includes(within.split(sep)[0])
  )
    throw new Error('Keep backups in an ignored private directory or outside the repository.');
  return path;
}
const volume = (options) => `${options.project}_qdrant_data`;
async function databaseContainer(options) {
  const id = await options.run(['ps', '-q', 'db'], { capture: true });
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Start the selected database first.');
  const mounts = JSON.parse(
    await docker(['inspect', '--format', '{{json .Mounts}}', id], { capture: true }),
  );
  const database = mounts.filter(({ Destination }) => Destination === '/var/lib/postgresql');
  if (
    database.length !== 1 ||
    database[0].Type !== 'volume' ||
    database[0].Name !== `${options.project}_postgres_data`
  )
    throw new Error('The PostgreSQL volume is outside the selected Compose project.');
  return id;
}
async function volumeTool(options, folder, mode) {
  const reading = mode === 'backup';
  return docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'FOWNER',
    '--mount',
    `type=volume,source=${volume(options)},target=/data${reading ? ',readonly' : ''}`,
    '--mount',
    `type=bind,source=${folder},target=/backup${reading ? '' : ',readonly'}`,
    '--entrypoint',
    'sh',
    await image(options),
    '-c',
    reading
      ? 'tar -czf /backup/qdrant.tar.gz -C /data .'
      : 'tar -xzf /backup/qdrant.tar.gz -C /data',
  ]);
}

export async function backup(options, directory) {
  const folder = folderPath(directory);
  const id = await databaseContainer(options);
  if (+(await sql(options, activeWork)) !== 0)
    throw new Error(
      'Drain/cancel active jobs, teams, generations, batches and publications before backup.',
    );
  await mkdir(folder, { recursive: false, mode: 0o700 });
  const running = (
    await options.run(['ps', '--services', '--status', 'running'], { capture: true })
  )
    .split(/\r?\n/)
    .filter((name) => writers.includes(name));
  // Refuse downtime during executing/queued work; the operator must drain/cancel first.
  const temp = `/tmp/ferweb-backup-${randomBytes(8).toString('hex')}.dump`;
  try {
    if (running.length) await options.run(['stop', ...running]);
    const active = await sql(options, activeWork);
    if (+active !== 0)
      throw new Error(
        'Drain or cancel pending/running jobs before making an offline recovery point.',
      );
    await docker(['volume', 'inspect', volume(options)], { capture: true });
    await options.run([
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges --file="$1"',
      '--',
      temp,
    ]);
    await docker(['cp', `${id}:${temp}`, resolve(folder, 'database.dump')]);
    await volumeTool(options, folder, 'backup');
    const files = {};
    for (const name of ['database.dump', 'qdrant.tar.gz'])
      files[name] = {
        sha256: await fileHash(resolve(folder, name)),
        bytes: (await stat(resolve(folder, name))).size,
      };
    await writeFile(
      resolve(folder, 'manifest.json'),
      JSON.stringify(
        {
          format: 1,
          createdAt: new Date().toISOString(),
          project: options.project,
          databaseImage: await image(options),
          migrations: await sql(options, 'SELECT count(*) FROM schema_migrations;'),
          files,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      'PASS: offline PostgreSQL + Qdrant recovery point written; protect and encrypt it off-host.',
    );
  } finally {
    try {
      await options.run(['exec', '-T', 'db', 'rm', '-f', temp]);
    } finally {
      if (running.length) await options.run(['start', ...running]);
    }
  }
}

export async function restore(options, directory) {
  const folder = folderPath(directory);
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || manifest.project === options.project)
    throw new Error('Restore requires a different, empty Compose project.');
  for (const name of ['database.dump', 'qdrant.tar.gz']) {
    if (
      (await fileHash(resolve(folder, name))) !== manifest.files?.[name]?.sha256 ||
      (await stat(resolve(folder, name))).size !== manifest.files[name].bytes
    )
      throw new Error('Backup integrity mismatch.');
  }
  const services = (await options.run(['ps', '--all', '--services'], { capture: true }))
    .split(/\r?\n/)
    .filter(Boolean);
  if (services.some((name) => name !== 'db'))
    throw new Error(
      'Restore only into a new target with db alone; no existing application containers.',
    );
  const id = await databaseContainer(options);
  if (+(await sql(options, "SELECT count(*) FROM pg_tables WHERE schemaname='public';")) !== 0)
    throw new Error('Refusing to restore over existing database tables.');
  // A pre-existing Qdrant volume is refused even if empty: no overwrite path exists.
  const existing = await docker(
    ['volume', 'ls', '--filter', `name=^${volume(options)}$`, '--format', '{{.Name}}'],
    { capture: true },
  );
  if (existing) throw new Error('Refusing to restore over an existing Qdrant volume.');
  await docker(
    [
      'volume',
      'create',
      '--label',
      `com.docker.compose.project=${options.project}`,
      '--label',
      'com.docker.compose.volume=qdrant_data',
      volume(options),
    ],
    { capture: true },
  );
  const temp = `/tmp/ferweb-restore-${randomBytes(8).toString('hex')}.dump`;
  try {
    await docker(['cp', resolve(folder, 'database.dump'), `${id}:${temp}`]);
    await options.run([
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --no-owner --no-privileges "$1"',
      '--',
      temp,
    ]);
    await volumeTool(options, folder, 'restore');
    console.log(
      'PASS: restored into a new target. Validate migrations, data and retrieval before any traffic switch.',
    );
  } finally {
    await options.run(['exec', '-T', 'db', 'rm', '-f', temp]);
  }
}
