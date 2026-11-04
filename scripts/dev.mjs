import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error('Missing .env. Run npm run setup first.');
  process.exit(1);
}
const children = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'apps/api/src/server.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    detached: process.platform !== 'win32',
    windowsHide: true,
  }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    // Watchers own child processes: terminate only the tree/group started here.
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
