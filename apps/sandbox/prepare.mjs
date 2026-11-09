import { readFile, writeFile, mkdir, chmod, lstat } from 'node:fs/promises';
import { protectedDirectories, protectedPlaceholders, protectedPath } from './protected-paths.mjs';
const input = JSON.parse(await readFile('/control/input.json', 'utf8'));
const protect = process.argv.includes('--protect');
const hold = process.argv.includes('--hold');
const directories = new Set();
const workspace = '/workspace';

if (protect) {
  const stat = await lstat(workspace);
  if (process.getuid() !== 0 || stat.uid !== 0 || (stat.mode & 0o7777) !== 0o1777)
    throw Error('protected_workspace_mount_invalid');
}
for (const file of input.files) {
  if (!hold && protectedPath(file.path) !== protect) continue;
  const path = workspace + '/' + file.path;
  const parent = path.slice(0, path.lastIndexOf('/'));
  await mkdir(parent, { recursive: true, mode: 0o755 });
  await writeFile(path, file.content, { mode: protect ? 0o444 : 0o644, flag: 'wx' });
  if (protect)
    for (let dir = parent; dir !== workspace; dir = dir.slice(0, dir.lastIndexOf('/')))
      directories.add(dir);
}
if (protect) {
  for (const name of protectedDirectories) {
    if (input.files.some((file) => file.path === name)) continue;
    const dir = workspace + '/' + name;
    await mkdir(dir, { recursive: true, mode: 0o755 });
    directories.add(dir);
  }
  for (const name of protectedPlaceholders)
    if (!input.files.some((file) => file.path === name || file.path.startsWith(name + '/')))
      await writeFile(workspace + '/' + name, '', { mode: 0o444, flag: 'wx' });
  for (const dir of [...directories].sort((a, b) => b.length - a.length)) await chmod(dir, 0o555);
}
// Docker's tmpfs volume must remain mounted until the read-only consumer starts.
if (hold) {
  console.log('ferweb_snapshot_ready');
  setInterval(() => {}, 1000);
}
