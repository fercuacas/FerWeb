import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const template = await readFile(new URL('.env.example', root), 'utf8');
try {
  await writeFile(
    new URL('.env', root),
    template.replace('replace-with-a-random-local-password', randomBytes(24).toString('hex')),
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created .env with a generated local password. Values were not printed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
const envFile = new URL('.env', root);
let configuration = await readFile(envFile, 'utf8');
if (!/^AI_SERVICE_TOKEN=/m.test(configuration))
  configuration += `\nAI_SERVICE_TOKEN=${randomBytes(32).toString('hex')}\n`;
else
  configuration = configuration.replace(
    /^AI_SERVICE_TOKEN=replace-with-a-random-internal-token$/m,
    `AI_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
  );
if (!/^RUNNER_SERVICE_TOKEN=/m.test(configuration))
  configuration += `\nRUNNER_SERVICE_TOKEN=${randomBytes(32).toString('hex')}\n`;
else
  configuration = configuration.replace(
    /^RUNNER_SERVICE_TOKEN=replace-with-a-random-runner-token$/m,
    `RUNNER_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
  );
await writeFile(envFile, configuration, { mode: 0o600 });
console.log(`Project: ${fileURLToPath(root)}`);
