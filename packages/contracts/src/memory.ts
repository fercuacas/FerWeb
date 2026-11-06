import { z } from 'zod';
const text = z.string().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const tag = text.trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const memorySelection = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().min(1).max(50),
  hash,
});
export const memorySelections = z
  .array(memorySelection)
  .max(3)
  .refine((a) => new Set(a.map((x) => x.id)).size === a.length);
export const memorySourceInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('code'),
    path: text.min(1).max(300),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    startLine: z.number().int().min(1).max(100000),
    endLine: z.number().int().min(1).max(100000),
    canonical: z.boolean(),
    expectedHash: hash.optional(),
  }),
  z.strictObject({ kind: z.literal('task'), id: z.uuid(), version: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('job'), id: z.uuid(), expectedHash: hash.optional() }),
  z.strictObject({
    kind: z.literal('delivery'),
    executionId: z.uuid(),
    stepId: z.uuid(),
    expectedHash: hash.optional(),
  }),
]);
export const memoryDraft = z
  .strictObject({
    kind: z.enum(['fact', 'decision', 'lesson', 'handoff', 'note']),
    title: text.trim().min(1).max(160),
    content: text.trim().min(1).max(4000),
    observedAt: z.iso.datetime(),
    status: z.enum(['active', 'retired']),
    tags: z.array(tag).max(10),
    targets: z.array(tag).max(10),
    lesson: z
      .strictObject({
        failure: text.trim().min(1).max(1000),
        decision: text.trim().min(1).max(1000),
        validation: text.trim().min(1).max(1000).nullable(),
      })
      .nullable(),
    sources: z.array(memorySourceInput).max(8),
  })
  .refine(
    (d) => (d.kind === 'lesson') === (d.lesson !== null),
    'Una lección requiere fallo observado, decisión y validación conocida o null.',
  );
export const memorySource = z.object({
  input: memorySourceInput,
  hash,
  repositoryId: z.number().int().positive().nullable(),
  linkVersion: z.number().int().positive().nullable(),
  blobSha: z.string().nullable(),
  url: z.string().url().nullable(),
});
export const memoryReported = z.object({
  revision: z.number().int().min(1).max(50).nullable(),
  previousRevision: z.number().int().min(1).max(49).nullable(),
  hash: hash.nullable(),
  recordedAt: z.iso.datetime().nullable(),
  links: z.array(text.max(100)).max(10),
});
export const memoryEntry = memoryDraft.safeExtend({
  id: z.uuid(),
  projectId: z.uuid(),
  revision: z.number().int().positive(),
  previousRevision: z.number().int().positive().nullable(),
  hash,
  recordedAt: z.iso.datetime(),
  validUntil: z.iso.datetime().nullable(),
  current: z.boolean(),
  validity: z.enum(['current', 'historical']),
  trust: z.literal('unreviewed'),
  evidenceState: z.enum(['referenced', 'none']),
  origin: z.object({
    kind: z.enum(['operator', 'import']),
    userId: z.uuid(),
    label: text.max(100),
    externalId: text.max(100).nullable(),
    reported: memoryReported.nullable(),
  }),
  evidence: z.array(memorySource).max(8),
});
export const memoryMutation = z.strictObject({ requestId: z.uuid(), entry: memoryDraft });
export const memoryCorrection = z.strictObject({
  version: z.number().int().min(1).max(49),
  entry: memoryDraft,
});
export const memoryWriteResponse = z.object({ selection: memorySelection });
export const memoryReadResponse = z.object({ entry: memoryEntry });
export const memorySearchInput = z.strictObject({
  query: text.trim().max(300),
  target: tag.optional(),
  asOf: z.iso.datetime().optional(),
  cursor: z.number().int().min(0).max(25000).default(0),
});
export const memorySearchResponse = z.object({
  entries: z.array(memoryEntry).max(20),
  complete: z.boolean(),
  state: z.enum(['results', 'empty', 'incomplete', 'unavailable']),
  issues: z.array(
    z.enum([
      'source_stale',
      'source_unavailable',
      'provenance_limit',
      'scan_limit',
      'revision_changed',
    ]),
  ),
  nextCursor: z.number().int().nullable(),
  notice: z.string(),
});
export const memoryHistoryResponse = z.object({
  entries: z.array(memoryEntry).max(50),
  complete: z.boolean(),
  unavailable: z.boolean(),
});
export const memoryImportInput = z.strictObject({
  requestId: z.uuid(),
  format: z.enum(['json', 'markdown']),
  content: z.string().min(1).max(32000),
});
export const memoryImportResponse = z.object({
  selections: z.array(memorySelection).min(1).max(10),
});
export const memoryExportInput = z.strictObject({
  selections: z.array(memorySelection).min(1).max(10),
  format: z.enum(['json', 'markdown']),
});
export const memoryExportResponse = z.object({
  filename: z.string(),
  mime: z.string(),
  content: z.string(),
  complete: z.literal(true),
  scope: z.literal('selection'),
});
export const portableMemory = z.strictObject({
  externalId: text.min(1).max(100),
  sourceHarness: tag,
  reported: memoryReported,
  entry: memoryDraft,
});
export const memoryBundle = z.strictObject({
  schema: z.literal('ferweb.memory.v1'),
  scope: z.literal('selection'),
  complete: z.literal(true),
  entries: z.array(portableMemory).min(1).max(10),
});
