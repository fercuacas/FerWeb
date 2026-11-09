import { readdir, lstat, readFile } from 'node:fs/promises';
import { protectedPlaceholders } from './protected-paths.mjs';
const files = [];
let size = 0,
  entries = 0;
setTimeout(() => process.exit(124), 4000).unref();
async function visit(dir, depth = 0) {
  if (depth > 20) throw Error('directory_depth_limit');
  for (const entry of await readdir('/workspace' + dir, { withFileTypes: true })) {
    if (++entries > 300) throw Error('entry_limit');
    const path = dir + '/' + entry.name,
      stat = await lstat('/workspace' + path);
    if (
      stat.isSymbolicLink() ||
      (stat.isFile() && stat.nlink !== 1) ||
      (!stat.isDirectory() && !stat.isFile())
    )
      throw Error('special_file_rejected');
    if (stat.isDirectory()) await visit(path, depth + 1);
    else {
      if (
        stat.size > 200000 ||
        files.length >= 100 + protectedPlaceholders.length ||
        (size += stat.size) > 1000000
      )
        throw Error('artifact_size_limit');
      const data = await readFile('/workspace' + path);
      files.push({
        path: path.slice(1),
        content: new TextDecoder('utf8', { fatal: true }).decode(data),
      });
    }
  }
}
try {
  await visit('');
  console.log(JSON.stringify(files));
} catch {
  process.exit(2);
}
