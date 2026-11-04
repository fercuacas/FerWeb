import { createHash } from 'node:crypto';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function safePath(path) {
  return (
    typeof path === 'string' &&
    path.length <= 220 &&
    !/[\x00-\x1f\x7f\\]/.test(path) &&
    !path.startsWith('/') &&
    path.split('/').every((p) => p && p !== '.' && p !== '..') &&
    !path.split('/').some((p) => /^\.(git|codex|env)(\.|$)/i.test(p)) &&
    !/(^|\/)(AGENTS\.md|node_modules|secrets|backups|\.local)(\/|$)|\.(pem|key|p12|pfx)$/i.test(
      path,
    )
  );
}
export function validateFiles(files, allowEmpty = false) {
  if (!Array.isArray(files) || (!allowEmpty && !files.length) || files.length > 100)
    throw new Error('source_file_limit');
  const paths = new Set();
  let size = 0;
  for (const f of files) {
    if (
      !safePath(f.path) ||
      paths.has(f.path) ||
      typeof f.content !== 'string' ||
      f.content.includes('\0') ||
      Buffer.byteLength(f.content) > 200000
    )
      throw new Error('source_file_invalid');
    paths.add(f.path);
    size += Buffer.byteLength(f.content);
  }
  if (size > 1000000) throw new Error('source_byte_limit');
}
export function differences(before, after) {
  const a = new Map(before.map((f) => [f.path, f.content])),
    b = new Map(after.map((f) => [f.path, f.content]));
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .filter((p) => a.get(p) !== b.get(p))
    .map((path) => {
      const old = a.get(path),
        next = b.get(path);
      const lines = (s) =>
        s === undefined || s === ''
          ? []
          : s.split('\n').slice(0, s.endsWith('\n') ? -1 : undefined);
      const minus = lines(old),
        plus = lines(next);
      const blob = (s) =>
        s === undefined
          ? '0'.repeat(40)
          : createHash('sha1')
              .update('blob ' + Buffer.byteLength(s) + '\0')
              .update(s)
              .digest('hex');
      const text = (s, prefix) =>
        lines(s)
          .map(
            (l, i, all) =>
              prefix +
              l +
              '\n' +
              (i === all.length - 1 && !s.endsWith('\n') ? '\\ No newline at end of file\n' : ''),
          )
          .join('');
      return {
        path,
        beforeHash: old === undefined ? null : hash(old),
        afterHash: next === undefined ? null : hash(next),
        patch: `diff --git ${JSON.stringify('a/' + path)} ${JSON.stringify('b/' + path)}\n${old === undefined ? 'new file mode 100644\n' : next === undefined ? 'deleted file mode 100644\n' : ''}index ${blob(old)}..${blob(next)}\n${!minus.length && !plus.length ? '' : `--- ${old === undefined ? '/dev/null' : JSON.stringify('a/' + path)}\n+++ ${next === undefined ? '/dev/null' : JSON.stringify('b/' + path)}\n@@ -${minus.length ? 1 : 0},${minus.length} +${plus.length ? 1 : 0},${plus.length} @@\n${text(old, '-')}${text(next, '+')}`}`,
      };
    });
}
