import { z } from 'zod';
import { sourceSchema, hybridResponse } from './retrieval.js';
import { memorySelection, memorySelections, memoryEntry } from './memory.js';
import { agentSelection } from './agents.js';
import { skillReference, skillVersion } from './skills.js';
import { executionOptionSchema } from './execution.js';
const text = z.string().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = z
  .array(z.uuid())
  .max(50)
  .refine((a) => new Set(a.map((x) => x.toLowerCase())).size === a.length);
export const contextProfile = z.enum(['lean', 'full']);
export const contextMode = z.enum(['manual', 'suggested', 'automatic']);
export const contextLimits = {
  lean: {
    initialSources: 4,
    expansions: 2,
    expansionSources: 2,
    expansionBytes: 6000,
    totalBytes: 24000,
  },
  full: {
    initialSources: 8,
    expansions: 4,
    expansionSources: 4,
    expansionBytes: 12000,
    totalBytes: 64000,
  },
} as const;
export const contextSkillRule = z.strictObject({
  id: z.uuid(),
  profiles: z.array(contextProfile).min(1).max(2),
  explicitOnly: z.boolean(),
  dependsOn: ids,
  excludes: ids,
  keywordsEs: z.array(text.trim().min(1).max(80)).max(10),
  keywordsEn: z.array(text.trim().min(1).max(80)).max(10),
});
export const contextPackPolicyInput = z
  .strictObject({ version: z.number().int().min(0), rules: z.array(contextSkillRule).max(100) })
  .refine((v) => new Set(v.rules.map((x) => x.id)).size === v.rules.length);
export const projectMapInput = z.strictObject({
  version: z.number().int().min(0),
  markdown: text.trim().min(1).max(8000),
  paths: z.array(text.min(1).max(300)).max(5),
});
export const projectMap = z.object({
  version: z.number().int().positive(),
  hash,
  markdown: text,
  sources: z.array(sourceSchema).max(5),
  recordedAt: z.string(),
});
export const contextPackPolicy = z.object({
  version: z.number().int().min(0),
  hash,
  rules: z.array(contextSkillRule).max(100),
});
export const contextReceiptReference = z.strictObject({ id: z.uuid(), hash });
export const contextPackPrepare = z.strictObject({
  model: text.trim().min(1).max(100).optional(),
  readOnly: z.boolean().default(false),
  requestId: z.uuid(),
  taskId: z.uuid(),
  taskVersion: z.number().int().positive(),
  agent: agentSelection.optional(),
  phase: text.trim().min(1).max(80).default('coding'),
  profile: contextProfile,
  mode: contextMode,
  query: text.trim().min(1).max(4000).optional(),
  explicitSkillIds: ids,
  excludedSkillIds: ids,
  memory: memorySelections,
  includeMemory: z.boolean(),
});
export const contextSkillChoice = z.object({
  skill: skillReference,
  reason: z.enum(['mandatory_role', 'manual', 'lexical', 'dependency']),
  score: z.number().finite(),
  matched: z.array(z.string()),
  applied: z.boolean(),
});
export const contextPackPayload = z.object({
  notice: z.string(),
  map: projectMap,
  skills: z.array(skillVersion).max(3),
  memory: z.array(memoryEntry).max(3),
  sources: z.array(sourceSchema).max(8),
});
export const contextPackSnapshot = z.object({
  sourceHashes: z.record(z.uuid(), hash),
  model: z.string().nullable(),
  protocol: z.literal('ferweb-context-pack-v1'),
  implementation: hash,
  task: z.object({ id: z.uuid(), version: z.number().int(), hash }),
  agent: agentSelection.nullable(),
  agentHash: hash.nullable(),
  phase: z.string(),
  query: z.string(),
  profile: contextProfile,
  mode: contextMode,
  policy: contextPackPolicy,
  catalogHash: hash,
  sourceFingerprint: hash,
  execution: executionOptionSchema,
  memory: z.array(memorySelection).max(3),
  choices: z.array(contextSkillChoice).max(53),
  diagnostics: z.array(z.string()).max(200),
  retrieval: hybridResponse,
  payload: contextPackPayload,
  initialBytes: z.number().int(),
  baseSkillBytes: z.number().int().nonnegative(),
  complete: z.boolean(),
});
export const contextExpansionInput = z
  .strictObject({
    requestId: z.uuid(),
    kind: z.enum(['dependency', 'contract', 'test']),
    reason: text.trim().min(1).max(500),
    path: text.trim().min(1).max(300).optional(),
    query: text.trim().min(1).max(1000).optional(),
  })
  .refine((x) => !!x.path !== !!x.query, 'Indica una ruta o una consulta.');
export const contextExpansion = z.object({
  sourceHashes: z.record(z.uuid(), hash),
  id: z.uuid(),
  requestId: z.uuid(),
  selector: contextExpansionInput,
  status: z.enum(['pending', 'completed', 'error']),
  sources: z.array(sourceSchema).max(4),
  retrieval: hybridResponse.nullable(),
  errorCode: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative().nullable(),
  startedAt: z.string(),
});
export const contextReceipt = z.object({
  id: z.uuid(),
  hash,
  parentId: z.uuid().nullable(),
  jobId: z.uuid().nullable(),
  snapshot: contextPackSnapshot,
  expansions: z.array(contextExpansion).max(4),
  finalHash: hash,
  bytes: z.number().int().nonnegative(),
  remainingExpansions: z.number().int().nonnegative(),
  valid: z.boolean(),
  invalidReasons: z.array(z.string()),
  phase: z.enum(['preview', 'running', 'final']),
  observedTokens: z.object({
    input: z.number().nullable(),
    output: z.number().nullable(),
    cached: z.number().nullable(),
  }),
  knownCostUsd: z.number().nullable(),
  recordedAt: z.string(),
});
export const contextReceiptResponse = z.object({ receipt: contextReceipt });
export const contextPackOverview = z.object({
  map: projectMap.nullable(),
  policy: contextPackPolicy,
  receipts: z
    .array(
      z.object({
        id: z.uuid(),
        hash,
        taskId: z.uuid(),
        phase: z.string(),
        jobId: z.uuid().nullable(),
        createdAt: z.string(),
      }),
    )
    .max(100),
});
export const contextPackConfigure = z.strictObject({
  profile: contextProfile,
  mode: contextMode,
  explicitSkillIds: ids,
  excludedSkillIds: ids,
  includeMemory: z.boolean(),
});
export type ContextPackSnapshot = z.infer<typeof contextPackSnapshot>;
export type ContextReceiptReference = z.infer<typeof contextReceiptReference>;
