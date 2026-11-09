import { z } from 'zod';
import { codingToolProfile, executionOptionSchema, type CodingToolProfile } from './execution.js';
import { agentSelection, agentSnapshot } from './agents.js';
import { skillVersion } from './skills.js';
import { executionBudgetLimits, executionBudgetSchema, usageAttribution } from './usage.js';
import { memorySelections, memoryEntry } from './memory.js';
import { contextReceiptReference } from './context-packs.js';

export const codingAgentSnapshot = agentSnapshot.extend({
  materials: z.array(skillVersion).max(3).optional(),
});
export const codingConfiguration = z.strictObject({
  toolProfile: codingToolProfile.optional(),
  contextReceipt: contextReceiptReference.optional(),
  memory: memorySelections.optional(),
  workspaceAccess: z.literal('read-only').optional(),
  taskId: z.uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  model: z.string().min(1).max(100),
  maxRequests: z.number().int().min(1).max(20),
  maxOutputTokens: z.number().int().min(64).max(8192),
  budgetLimits: executionBudgetLimits.optional(),
  budgetAttribution: usageAttribution.optional(),
  limits: z.strictObject({
    timeoutMs: z.number().int().min(10000).max(1200000),
    maxAttempts: z.literal(1),
  }),
});
export const codingInput = z.strictObject({
  toolProfile: codingToolProfile.optional(),
  contextReceipt: contextReceiptReference.optional(),
  memory: memorySelections.optional(),
  requestId: z.uuid(),
  taskId: z.uuid(),
  taskVersion: z.number().int().positive(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  model: z.string().min(1).max(100),
  timeoutMs: z.number().int().min(10000).max(1200000),
  maxRequests: z.number().int().min(1).max(20),
  maxOutputTokens: z.number().int().min(64).max(8192),
  agent: agentSelection.optional(),
  budgetId: z.uuid().optional(),
  attribution: usageAttribution.optional(),
});
export const codingCapabilities = z.object({
  available: z.boolean(),
  models: z.array(z.string()),
  simulated: z.boolean(),
  environment: z.record(z.string(), z.unknown()).nullable().default(null),
  typescriptEnvironment: z
    .looseObject({
      profile: z.literal('typescript-react-v1'),
      image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      policyHash: z.string().regex(/^[a-f0-9]{64}$/),
      versions: z.array(z.string()).min(1),
      independentTest: z.string(),
      verificationTimeoutMs: z.literal(20000),
    })
    .nullable()
    .default(null),
});
export const codingCapabilitiesResponse = codingCapabilities.extend({
  execution: executionOptionSchema,
  readOnlyExecution: executionOptionSchema,
  typescriptExecution: executionOptionSchema,
});
export function codingOption(
  caps: z.infer<typeof codingCapabilitiesResponse>,
  profile?: CodingToolProfile,
  readOnly?: boolean,
) {
  if (readOnly) return caps.readOnlyExecution;
  return profile === 'typescript-react-v1' ? caps.typescriptExecution : caps.execution;
}
const nullableCount = z.number().int().nonnegative().nullable();
const command = z.object({
  command: z.string(),
  output: z.string(),
  exitCode: z.number().nullable(),
  origin: z.string(),
  status: z.string().optional(),
});
export const codingReport = z.object({
  providerUsage: z
    .object({
      reportedRequests: z.number().int(),
      totalRequests: z.number().int(),
      inputTokens: nullableCount,
      cachedInputTokens: nullableCount,
      outputTokens: nullableCount,
      reasoningTokens: nullableCount,
    })
    .optional(),
  kind: z.literal('codex-v1'),
  jobId: z.uuid(),
  commit: z.string(),
  repository: z.string(),
  task: z.record(z.string(), z.unknown()),
  model: z.string(),
  cliVersion: z.string(),
  simulated: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  summary: z.string(),
  commands: z.array(command),
  tests: z.array(command),
  diff: z.array(
    z.object({
      path: z.string(),
      patch: z.string(),
      beforeHash: z.string().nullable(),
      afterHash: z.string().nullable(),
    }),
  ),
  diffComplete: z.boolean(),
  usage: z
    .object({
      inputTokens: nullableCount,
      cachedInputTokens: nullableCount,
      outputTokens: nullableCount,
      reasoningTokens: nullableCount,
    })
    .nullable(),
  cost: z.null(),
  durationMs: z.number().nullable(),
  modelRequests: z.number().int(),
  terminationConfirmed: z.boolean().nullable(),
  limitations: z.array(z.string()),
  reason: z.string().optional(),
  agentExitCode: z.number().nullable().optional(),
  turnCompleted: z.boolean().optional(),
  agentError: z.boolean().optional(),
  oomKilled: z.boolean().optional(),
});
export const codingRunSchema = z.object({
  contextReceipt: contextReceiptReference.nullable(),
  memory: z.array(memoryEntry).max(3),
  teamExecutionId: z.uuid().nullable().optional(),
  jobId: z.uuid(),
  task: z.record(z.string(), z.unknown()),
  commit: z.string(),
  repository: z.string(),
  baseBranch: z.string().nullable(),
  environment: z.record(z.string(), z.unknown()).nullable(),
  manifest: z.array(z.object({ path: z.string(), sha: z.string(), contentHash: z.string() })),
  excluded: z.array(z.string()),
  report: codingReport.nullable(),
  agent: codingAgentSnapshot.nullable(),
  budget: executionBudgetSchema.nullable(),
});
export function codingPath(path: string) {
  return (
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
export const codingWorkspace = z
  .array(
    z.strictObject({
      path: z.string().refine(codingPath),
      content: z
        .string()
        .max(200000)
        .refine(
          (value) => !value.includes('\0') && new TextEncoder().encode(value).length <= 200000,
        ),
    }),
  )
  .max(100)
  .superRefine((files, ctx) => {
    if (
      new Set(files.map((file) => file.path)).size !== files.length ||
      files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0) > 1000000
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid workspace snapshot' });
  });
