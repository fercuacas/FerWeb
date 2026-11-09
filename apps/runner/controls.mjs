import { hash } from './files.mjs';
import { protectedPath, protectedRoots, protectedPlaceholders } from './protected-paths.mjs';

export function createControls(input) {
  const started = performance.now();
  const files = input.files.map(({ path, content }) => [path, hash(content)]).sort();
  const receipt = input.task.projectContext?.receiptId;
  const receiptId =
    typeof receipt === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt)
      ? receipt
      : null;
  return {
    version: 'ferweb-controls-v1',
    inputHash: hash(JSON.stringify([input.commit, files, receiptId])),
    files: files.length,
    receiptId,
    protectedRoots,
    events: [
      {
        id: 'impact',
        stage: 'before_agent',
        status: 'passed',
        code: receiptId ? 'receipt_reused' : 'snapshot_recorded',
        durationMs: Math.round(performance.now() - started),
        paths: [],
      },
      ...[
        ['configuration', 'before_agent'],
        ['verification', 'after_agent'],
        ['artifact', 'before_delivery'],
      ].map(([id, stage]) => ({
        id,
        stage,
        status: 'not_run',
        code: 'not_reached',
        durationMs: null,
        paths: [],
      })),
    ],
  };
}

export function control(run, id, status, code, started, paths = []) {
  const event = run.report.controls.events.find((item) => item.id === id);
  Object.assign(event, {
    status,
    code,
    durationMs: started === undefined ? null : Math.round(performance.now() - started),
    paths,
  });
}

export function removePlaceholders(input, collected) {
  if (input.workspaceAccess === 'read-only') return collected;
  return collected.filter(
    (file) =>
      !protectedPlaceholders.includes(file.path) ||
      file.content !== '' ||
      input.files.some((original) => original.path === file.path),
  );
}

export function protectedChanges(before, after) {
  const original = new Map(before.map(({ path, content }) => [path, content]));
  const result = new Map(after.map(({ path, content }) => [path, content]));
  return [...new Set([...original.keys(), ...result.keys()])]
    .filter((path) => protectedPath(path) && original.get(path) !== result.get(path))
    .sort();
}
