import { createHash } from 'node:crypto';
import { codingPath, codingReport } from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// PostgreSQL jsonb key order differs from insertion order. Hash canonical JSON.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const invalid = () =>
  new HttpError(
    422,
    'review_artifact_invalid',
    'No se puede publicar este diff. Requiere una captura completa y verificable.',
  );

// The trusted collector emits whole-file replacement hunks. Do not invoke Git,
// shell or a general patch interpreter on repository-controlled input.
export function publicationTree(
  report: Pick<z.infer<typeof codingReport>, 'diff' | 'diffComplete'>,
  files: { path: string; content: string }[],
  sourceTree: { path: string; mode: string; type: string }[],
) {
  if (!report.diffComplete || !report.diff.length || report.diff.length > 100) throw invalid();
  const originals = new Map(files.map((f) => [f.path, f.content])),
    entries = new Map(sourceTree.map((f) => [f.path, f])),
    seen = new Set<string>();
  let bytes = 0;
  return report.diff.map((file) => {
    if (!codingPath(file.path) || /^\.github\/workflows\//i.test(file.path) || seen.has(file.path))
      throw invalid();
    seen.add(file.path);
    const old = originals.get(file.path),
      entry = entries.get(file.path);
    if (
      entry &&
      (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || old === undefined)
    )
      throw invalid();
    // A new path cannot replace a directory or introduce a file under a blob/symlink.
    const segments = file.path.split('/');
    for (let n = 1; n < segments.length; n++) {
      const parent = entries.get(segments.slice(0, n).join('/'));
      if (parent && parent.type !== 'tree') throw invalid();
    }
    if ((old === undefined ? null : digest(old)) !== file.beforeHash) throw invalid();
    const hunk = /@@ -(\d+),(\d+) \+(\d+),(\d+) @@\n/.exec(file.patch);
    let minus = '',
      plus = '',
      minusCount = 0,
      plusCount = 0,
      last = '';
    if (hunk) {
      const lines = file.patch.slice(hunk.index + hunk[0].length).split('\n');
      if (lines.pop() !== '') throw invalid();
      for (const line of lines) {
        if (line === '\\ No newline at end of file') {
          if (last === '-') minus = minus.slice(0, -1);
          else if (last === '+') plus = plus.slice(0, -1);
          else throw invalid();
          last = '';
        } else if (line.startsWith('-')) {
          minus += line.slice(1) + '\n';
          minusCount++;
          last = '-';
        } else if (line.startsWith('+')) {
          plus += line.slice(1) + '\n';
          plusCount++;
          last = '+';
        } else throw invalid();
      }
      if (minusCount !== Number(hunk[2]) || plusCount !== Number(hunk[4])) throw invalid();
    }
    if (
      minus !== (old ?? '') ||
      (file.afterHash !== null && digest(plus) !== file.afterHash) ||
      (file.afterHash === null && plus !== '')
    )
      throw invalid();
    bytes += Buffer.byteLength(plus);
    if (bytes > 1000000 || Buffer.byteLength(plus) > 200000 || plus.includes('\0')) throw invalid();
    return {
      path: file.path,
      mode: entry?.mode ?? '100644',
      type: 'blob' as const,
      ...(file.afterHash === null ? { sha: null } : { content: plus }),
    };
  });
}
