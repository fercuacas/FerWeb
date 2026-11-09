import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
const args = ['compose', '-f', 'compose.yaml'];
const localCa = fileURLToPath(new URL('../.local/build-ca.pem', import.meta.url));
if (env.FERWEB_BUILD_CA_FILE || existsSync(localCa)) {
  env.FERWEB_BUILD_CA_FILE ||= localCa;
  args.push('-f', 'compose.ca.yaml');
}
const githubFile = fileURLToPath(new URL('../secrets/github-app.json', import.meta.url));
if (env.FERWEB_GITHUB_CONFIG_FILE || existsSync(githubFile)) {
  env.FERWEB_GITHUB_CONFIG_FILE ||= githubFile;
  const configurationPath = realpathSync(env.FERWEB_GITHUB_CONFIG_FILE);
  const within = relative(root, configurationPath);
  if (
    !isAbsolute(within) &&
    within !== '..' &&
    !within.startsWith(`..${sep}`) &&
    !['secrets', '.local'].includes(within.split(sep)[0] ?? '')
  ) {
    throw new Error(
      'Keep GitHub credentials in secrets/, .local/ or outside the repository so builds cannot copy them.',
    );
  }
  env.FERWEB_GITHUB_CONFIG_FILE = configurationPath;
  args.push('-f', 'compose.github.yaml');
  if (env.FERWEB_BUILD_CA_FILE) args.push('-f', 'compose.github-ca.yaml');
}
const commands = {
  up: ['up', '--build', '--detach', '--wait', '--wait-timeout', '180'],
  stop: ['stop'],
  restart: ['up', '--detach', '--wait', '--wait-timeout', '180', '--force-recreate'],
  status: ['ps', '--all'],
  logs: ['logs', '--tail', '100', 'api', 'web', 'migrate', 'ai', 'qdrant', 'worker', 'runner'],
  owner: ['run', '--rm', 'api', 'npm', 'run', 'owner:create'],
  migrate: ['run', '--rm', 'migrate'],
};
const aiFile = fileURLToPath(new URL('../secrets/ai-providers.json', import.meta.url));
if (env.FERWEB_AI_CONFIG_FILE || existsSync(aiFile)) {
  const configurationPath = realpathSync(env.FERWEB_AI_CONFIG_FILE || aiFile);
  const within = relative(root, configurationPath);
  if (
    !isAbsolute(within) &&
    within !== '..' &&
    !within.startsWith(`..${sep}`) &&
    !['secrets', '.local'].includes(within.split(sep)[0] ?? '')
  )
    throw new Error('Keep AI credentials in secrets/, .local/ or outside the repository.');
  env.FERWEB_AI_CONFIG_FILE = configurationPath;
  args.push('-f', 'compose.ai.yaml');
  if (env.FERWEB_BUILD_CA_FILE) args.push('-f', 'compose.ai-ca.yaml');
}
const ownerVariables = ['FERWEB_OWNER_EMAIL', 'FERWEB_OWNER_PASSWORD'].filter((key) => env[key]);
const codexFile = fileURLToPath(new URL('../secrets/codex.json', import.meta.url));
if (env.FERWEB_CODEX_CONFIG_FILE || existsSync(codexFile)) {
  const configurationPath = realpathSync(env.FERWEB_CODEX_CONFIG_FILE || codexFile);
  const within = relative(root, configurationPath);
  if (
    !isAbsolute(within) &&
    within !== '..' &&
    !within.startsWith(`..${sep}`) &&
    !['secrets', '.local'].includes(within.split(sep)[0] ?? '')
  )
    throw new Error('Keep Codex credentials in secrets/, .local/ or outside the repository.');
  env.FERWEB_CODEX_CONFIG_FILE = configurationPath;
  args.push('-f', 'compose.codex.yaml');
  if (env.FERWEB_BUILD_CA_FILE) args.push('-f', 'compose.codex-ca.yaml');
}
if (ownerVariables.length) {
  commands.owner = [
    'run',
    '--rm',
    ...ownerVariables.flatMap((key) => ['--env', key]),
    'api',
    'npm',
    'run',
    'owner:create',
  ];
}
async function run(command) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', [...args, ...command], {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Docker exited with ${code}`)),
    );
  });
}
const command = process.argv[2];
try {
  if (command === 'up' || command === 'check')
    await run(['--profile', 'build-sandbox', 'build', 'sandbox-image', 'sandbox-typescript-image']);
  if (command === 'check' || command === 'format') {
    if (command === 'check') await run(commands.up);
    await run(['--profile', 'tools', 'build', 'tools']);
    if (command === 'format') {
      await run([
        '--profile',
        'tools',
        'run',
        '--rm',
        '--no-deps',
        '--volume',
        `${root}:/workspace`,
        '--workdir',
        '/workspace',
        'tools',
        '/app/node_modules/.bin/prettier',
        '--write',
        'apps',
        'packages',
        'scripts',
        'tests',
        'compose*.yaml',
        'playwright.config.ts',
        'package.json',
        'tsconfig.base.json',
      ]);
    } else {
      await run(['--profile', 'tools', 'build', 'ai-test']);
      await run([
        '--profile',
        'tools',
        'run',
        '--rm',
        '--no-deps',
        'ai-test',
        'python',
        '-m',
        'unittest',
        'discover',
        '-s',
        'tests',
        '-v',
      ]);
      try {
        await run(['--profile', 'tools', 'up', '--build', '--detach', '--wait', 'runner-test']);
        await run(['--profile', 'tools', 'up', '--detach', '--wait', 'ai-test']);
        await run(['--profile', 'tools', 'run', '--rm', '--no-deps', 'tools']);
      } finally {
        await run(['--profile', 'tools', 'stop', 'runner-test']);
        await run(['--profile', 'tools', 'rm', '--force', 'runner-test']);
        await run(['--profile', 'tools', 'stop', 'ai-test']);
        await run(['--profile', 'tools', 'rm', '--force', 'ai-test']);
      }
    }
  } else if (commands[command]) {
    await run(commands[command]);
  } else {
    throw new Error(`Expected one of: ${Object.keys(commands).join(', ')}, check, format`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
