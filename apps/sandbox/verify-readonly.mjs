import { readFile, writeFile, unlink, rename, chmod, mkdir, symlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const input = JSON.parse(await readFile('/control/input.json', 'utf8'));
assert.equal(input.workspaceAccess, 'read-only');
for (const file of input.files)
  assert.equal(await readFile('/workspace/' + file.path, 'utf8'), file.content);
const existing = '/workspace/' + input.files[0].path;
for (const action of [
  () => writeFile(existing, 'modified'),
  () => writeFile('/workspace/.write-probe', 'new'),
  () => unlink(existing),
  () => rename(existing, existing + '.moved'),
  () => chmod(existing, 0o600),
  () => mkdir('/workspace/.directory-probe'),
  () => symlink('/tmp', '/workspace/.link-probe'),
])
  await assert.rejects(action, { code: 'EROFS' });
console.log(
  'Snapshot unchanged; write, create, unlink, rename, chmod, mkdir and symlink rejected by read-only mount.',
);
