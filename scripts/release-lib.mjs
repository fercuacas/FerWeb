import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export async function docker(args, { env = process.env, input, capture = false, cwd = root } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, {
      cwd,
      env,
      windowsHide: true,
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise(output.trim())
        : reject(new Error(`Docker operation failed (${code}); no environment values logged.`)),
    );
  });
}
export function releaseOptions({
  envFile = process.env.FERWEB_RELEASE_ENV ?? '.env.release',
  project = process.env.FERWEB_RELEASE_PROJECT ?? 'ferweb-release',
  cwd = root,
  env = process.env,
} = {}) {
  if (!/^ferweb-[a-z0-9-]+$/.test(project) || project === 'ferweb')
    throw new Error('Use an isolated ferweb-* project; the development project is forbidden.');
  const environment = { ...env, COMPOSE_PROJECT_NAME: project };
  const args = [
    'compose',
    '--project-directory',
    cwd,
    '-f',
    resolve(cwd, 'compose.yaml'),
    '-f',
    resolve(cwd, 'compose.release.yaml'),
  ];
  const ca =
    environment.FERWEB_BUILD_CA_FILE ??
    (existsSync(resolve(root, '.local/build-ca.pem'))
      ? resolve(root, '.local/build-ca.pem')
      : undefined);
  if (ca) {
    environment.FERWEB_BUILD_CA_FILE = ca;
    args.push('-f', resolve(cwd, 'compose.ca.yaml'));
  }
  // Release credentials are opt-in; development provider files are never auto-loaded.
  for (const [kind, variable] of [
    ['github', 'FERWEB_GITHUB_CONFIG_FILE'],
    ['ai', 'FERWEB_AI_CONFIG_FILE'],
    ['codex', 'FERWEB_CODEX_CONFIG_FILE'],
  ]) {
    if (!environment[variable]) continue;
    const path = realpathSync(environment[variable]);
    const within = relative(cwd, path);
    if (
      !isAbsolute(within) &&
      within !== '..' &&
      !within.startsWith(`..${sep}`) &&
      !['.local', 'secrets'].includes(within.split(sep)[0])
    )
      throw new Error('Keep release provider configuration outside the public build context.');
    environment[variable] = path;
    args.push('-f', resolve(cwd, `compose.${kind}.yaml`));
    if (ca) args.push('-f', resolve(cwd, `compose.${kind}-ca.yaml`));
  }
  args.push('--env-file', resolve(cwd, envFile), '-p', project);
  return {
    env: environment,
    args,
    project,
    cwd,
    run: (command, options = {}) =>
      docker([...args, ...command], { env: environment, cwd: root, ...options }),
  };
}
