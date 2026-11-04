import { createHash } from 'node:crypto';
import { visiblePath } from '../github/client.js';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function stableId(value: string) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function indexable(path: string) {
  return (
    visiblePath(path) &&
    !path
      .split('/')
      .some((part) =>
        /^(\.ssh|\.aws|\.azure|\.venv|venv|dist|build|coverage|vendor|\.artifacts)$/i.test(part),
      ) &&
    (/\.(md|mdx|txt|rst|ts|tsx|js|jsx|mjs|cjs|py|json|ya?ml|toml|sql|go|rs|java|c|cpp|h|css|html|sh)$/i.test(
      path,
    ) ||
      /(^|\/)(Dockerfile|Makefile|README|LICENSE)$/i.test(path)) &&
    !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|uv\.lock|Cargo\.lock|credentials.*|id_rsa.*|\.npmrc|\.pypirc)$/i.test(
      path,
    )
  );
}
// Line-preserving deterministic windows, at most 2400 UTF-16 chars; no source execution.
export function fragment(content: string) {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const chunks: { content: string; startLine: number; endLine: number }[] = [];
  let buffer = '',
    start = 1,
    end = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.length && buffer.length < 2400 && buffer.length) {
      buffer += '\n';
      end = i + 1;
      continue;
    }
    if (buffer && buffer.length + line.length + 1 > 2400) {
      chunks.push({ content: buffer, startLine: start, endLine: end });
      buffer = '';
      start = i + 1;
    }
    for (let offset = 0; offset < line.length; offset += 2400) {
      const part = line.slice(offset, offset + 2400);
      if (part.length === 2400) {
        if (buffer) chunks.push({ content: buffer, startLine: start, endLine: end });
        chunks.push({ content: part, startLine: i + 1, endLine: i + 1 });
        buffer = '';
        start = i + 1;
      } else {
        if (!buffer) start = i + 1;
        buffer += (buffer ? '\n' : '') + part;
      }
    }
    end = i + 1;
  }
  if (buffer.trim()) chunks.push({ content: buffer, startLine: start, endLine: end });
  return chunks;
}
