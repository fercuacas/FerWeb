import {
  codingWorkspace,
  integrationArtifact,
  type resolveTeamIntegrationInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { posix } from 'node:path';
import { canonical, digest } from '../jobs/review-artifacts.js';
import { HttpError } from '../../http-error.js';

type Files = z.infer<typeof codingWorkspace>;
export type WriterBranch = { step: string; paths: string[]; files: Files };
function references(branch: WriterBranch, path: string, targets: string[]) {
  const content = branch.files.find((file) => file.path === path)?.content ?? '';
  const imports = content.matchAll(
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"\r\n]+)['"]/g,
  );
  for (const match of imports) {
    const target = posix.normalize(posix.join(posix.dirname(path), match[1]!));
    if (
      targets.some(
        (candidate) =>
          candidate === target ||
          ['.js', '.ts', '.tsx', '.cjs', '.mjs', '/index.js', '/index.ts'].some(
            (suffix) => candidate === target + suffix,
          ),
      )
    )
      return true;
  }
  return false;
}
export const workspaceHash = (files: Files) =>
  digest(
    JSON.stringify(
      files.map((f) => [f.path, digest(f.content)]).sort(([a], [b]) => a!.localeCompare(b!)),
    ),
  );
const changed = () =>
  new HttpError(
    409,
    'team_integration_changed',
    'La integración o sus archivos han cambiado. Prepara otro equipo.',
  );

// Whole-file three-way comparison. Never execute a patch supplied by an agent.
export function integrate(
  baseInput: Files,
  branches: WriterBranch[],
  choices?: z.infer<typeof resolveTeamIntegrationInput>['choices'],
  previousHash: string | null = null,
) {
  const base = codingWorkspace.parse(baseInput),
    original = new Map(base.map((f) => [f.path, f.content]));
  const candidates = new Map<string, { step: string; content: string | undefined }[]>();
  const warnings: string[] = [];
  const summaries = branches.map((branch) => {
    const files = codingWorkspace.parse(branch.files),
      result = new Map(files.map((f) => [f.path, f.content]));
    const changes = [...new Set([...original.keys(), ...result.keys()])]
      .sort()
      .filter((path) => original.get(path) !== result.get(path))
      .map((path) => {
        if (!branch.paths.includes(path)) throw changed();
        const entries = candidates.get(path) ?? [];
        entries.push({ step: branch.step, content: result.get(path) });
        candidates.set(path, entries);
        return {
          path,
          beforeHash: original.has(path) ? digest(original.get(path)!) : null,
          afterHash: result.has(path) ? digest(result.get(path)!) : null,
        };
      });
    return {
      step: branch.step,
      inputHash: workspaceHash(base),
      outputHash: workspaceHash(files),
      changes,
    };
  });
  for (let i = 0; i < branches.length; i++)
    for (const b of branches.slice(i + 1)) {
      const a = branches[i]!;
      const overlap = a.paths.filter((path) => b.paths.includes(path));
      if (overlap.length)
        warnings.push(
          `Solapamiento declarado entre ${a.step} y ${b.step}: ${overlap.join(', ')}.`.slice(
            0,
            600,
          ),
        );
      const aChanges = summaries[i]!.changes;
      const bChanges = summaries.find((s) => s.step === b.step)!.changes;
      if (
        aChanges.some((change) =>
          references(
            a,
            change.path,
            bChanges.map((file) => file.path),
          ),
        ) ||
        bChanges.some((change) =>
          references(
            b,
            change.path,
            aChanges.map((file) => file.path),
          ),
        )
      )
        warnings.push(
          `Dependencia relativa orientativa entre archivos modificados por ${a.step} y ${b.step}; requiere revisar su contrato compartido.`,
        );
      if (
        aChanges.some((x) =>
          bChanges.some(
            (y) =>
              x.path.split('/').slice(0, -1).join('/') === y.path.split('/').slice(0, -1).join('/'),
          ),
        )
      )
        warnings.push(
          `Proximidad de archivos entre ${a.step} y ${b.step}; revisa las dependencias y los contratos compartidos.`,
        );
    }
  const conflicts = [...candidates]
    .filter(([, items]) => new Set(items.map((x) => x.content)).size > 1)
    .map(([path, items]) => ({ path, steps: items.map((x) => x.step) }));
  for (const conflict of conflicts) {
    const before = (original.get(conflict.path) ?? '').split('\n');
    const ranges = candidates.get(conflict.path)!.map((candidate) => {
      const after = (candidate.content ?? '').split('\n');
      let start = 0,
        end = before.length,
        tail = after.length;
      while (start < end && start < tail && before[start] === after[start]) start++;
      while (end > start && tail > start && before[end - 1] === after[tail - 1]) {
        end--;
        tail--;
      }
      return `${candidate.step}: líneas base ${start + 1}–${Math.max(start + 1, end)}`;
    });
    warnings.push(
      `Proximidad orientativa en ${conflict.path}: ${ranges.join('; ')}. El conflicto se resuelve por archivo completo.`.slice(
        0,
        600,
      ),
    );
  }
  if (
    choices &&
    (choices.length !== conflicts.length ||
      new Set(choices.map((c) => c.path)).size !== choices.length ||
      choices.some(
        (c) =>
          !conflicts.some(
            (f) => f.path === c.path && (c.step === null || f.steps.includes(c.step)),
          ),
      ))
  )
    throw changed();
  const merged = new Map(original);
  for (const [path, items] of candidates) {
    const conflict = conflicts.some((c) => c.path === path),
      choice = choices?.find((c) => c.path === path);
    if (conflict && !choice) continue;
    const content = conflict
      ? choice!.step === null
        ? original.get(path)
        : items.find((x) => x.step === choice!.step)!.content
      : items[0]!.content;
    if (content === undefined) merged.delete(path);
    else merged.set(path, content);
  }
  const files = codingWorkspace.parse(
    [...merged]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({ path, content })),
  );
  if (files.some((f) => files.some((other) => other.path.startsWith(f.path + '/'))))
    throw changed();
  const unresolved = conflicts.length > 0 && !choices;
  const artifact = integrationArtifact.parse({
    version: choices ? 2 : 1,
    baseHash: workspaceHash(base),
    resultHash: unresolved ? null : workspaceHash(files),
    branches: summaries,
    conflicts,
    warnings: warnings.slice(0, 100),
    resolution: choices ?? [],
    previousHash,
  });
  return {
    artifact,
    hash: digest(canonical(artifact)),
    state: unresolved ? 'conflict' : 'ready',
    files: unresolved ? null : files,
  };
}
