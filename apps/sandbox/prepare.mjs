import { readFile, writeFile, mkdir } from 'node:fs/promises';
const input = JSON.parse(await readFile('/control/input.json', 'utf8'));
for (const file of input.files) {
  const path = '/workspace/' + file.path;
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, file.content, { mode: 0o644 });
}
