import { z } from 'zod';
import { usageSchema, executionBudgetLimits } from './usage.js';
export const localReadDelivery = z.strictObject({
  summary: z.string().trim().min(1).max(6000),
  evidence: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(300),
        line: z.number().int().min(1),
        quote: z.string().min(1).max(1000),
      }),
    )
    .max(20),
  limitations: z.array(z.string().min(1).max(600)).max(12),
});
export const localReadConfiguration = z.strictObject({
  model: z.string().min(1).max(100),
  workspaceAccess: z.literal('read-only'),
  limits: z.object({
    timeoutMs: z.number().int().min(10000).max(1200000),
    maxAttempts: z.literal(1),
    maxUnits: z.literal(1),
    maxCostMicros: z.literal(0),
  }),
  budgetLimits: executionBudgetLimits.optional(),
  budgetAttribution: z.enum(['agent', 'reviewer', 'summary']).optional(),
});
export const localReadReport = z.object({
  kind: z.literal('local-readonly-v1'),
  provider: z.literal('ollama'),
  model: z.string(),
  revision: z.string(),
  configurationRevision: z.string(),
  reportedModel: z.string().nullable(),
  simulated: z.boolean(),
  inputHash: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  delivery: localReadDelivery.nullable(),
  rawOutput: z.string().max(24000),
  localChecks: z.array(z.enum(['schema', 'source_citations', 'input_hash', 'no_tools'])),
  usage: usageSchema,
  remoteCancellationConfirmed: z.null(),
  errorCode: z.string().nullable(),
});
export const localReadResponse = z.object({ jobId: z.uuid(), report: localReadReport.nullable() });
