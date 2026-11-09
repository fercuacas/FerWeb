import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { releaseOptions } from './release-lib.mjs';
import { backup, restore } from './release-storage.mjs';

const command = process.argv[2];
try {
  if (command === 'setup') {
    const port = process.env.FERWEB_RELEASE_PORT ?? '8080';
    if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535)
      throw new Error('Invalid release port.');
    const file = process.env.FERWEB_RELEASE_ENV ?? '.env.release';
    await writeFile(
      file,
      [
        'POSTGRES_DB=ferweb',
        'POSTGRES_USER=ferweb',
        `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`,
        `AI_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
        `RUNNER_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
        `METRICS_TOKEN=${randomBytes(32).toString('hex')}`,
        `WEB_PORT=${port}`,
        `APP_ORIGIN=http://127.0.0.1:${port}`,
        'COOKIE_SECURE=false',
        'FERWEB_RELEASE_TAG=candidate',
        'SOURCE_DATE_EPOCH=0',
        '',
      ].join('\n'),
      { flag: 'wx', mode: 0o600 },
    );
    console.log('Private release configuration created; existing files are never overwritten.');
  } else {
    const options = releaseOptions();
    const commands = {
      build: ['build', 'api', 'web', 'ai', 'runner'],
      start: ['up', '--detach', '--wait', '--wait-timeout', '180', '--no-build'],
      stop: ['stop'],
      status: ['ps', '--all'],
      logs: ['logs', '--tail', '100'],
      migrate: ['run', '--rm', '--no-deps', 'migrate'],
      owner: ['exec', 'api', 'node', 'dist/provision.js'],
    };
    if (command === 'backup') await backup(options, process.argv[3]);
    else if (command === 'restore') await restore(options, process.argv[3]);
    else if (commands[command]) {
      if (command === 'build')
        await options.run([
          '--profile',
          'build-sandbox',
          'build',
          'sandbox-image',
          'sandbox-typescript-image',
        ]);
      await options.run(commands[command]);
    } else
      throw new Error(
        'Expected setup, build, start, stop, status, logs, migrate, owner, backup or restore.',
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
