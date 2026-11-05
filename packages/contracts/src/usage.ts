import { z } from 'zod';
const metric = z.number().nonnegative().nullable();
export const usageSchema = z.strictObject({
  inputTokens: metric,
  outputTokens: metric,
  totalTokens: metric,
  cachedTokens: metric,
  reasoningTokens: metric,
  costUsd: metric,
  providerDurationMs: metric,
  loadDurationMs: metric,
  evaluationDurationMs: metric,
});
export const unknownUsage = (): z.infer<typeof usageSchema> => ({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedTokens: null,
  reasoningTokens: null,
  costUsd: null,
  providerDurationMs: null,
  loadDurationMs: null,
  evaluationDurationMs: null,
});

export const executionBudgetLimits = z.strictObject({
  maxRequests: z.number().int().min(1).max(20),
  timeoutMs: z.number().int().min(10000).max(1200000),
  concurrency: z.literal(1),
});
export const usageAttribution = z.enum([
  'agent',
  'coordinator',
  'selection',
  'summary',
  'reviewer',
]);
export const executionBudgetInput = z.strictObject({
  requestId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  limits: executionBudgetLimits,
});
const count = z.number().int().nonnegative();
export const providerRequestUsage = z.strictObject({
  inputTokens: count.nullable(),
  cachedInputTokens: count.nullable(),
  outputTokens: count.nullable(),
  reasoningTokens: count.nullable(),
});
export const requestAdmissionInput = z.strictObject({
  fence: z.uuid(),
  requestId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const requestUsageInput = requestAdmissionInput.omit({ payloadHash: true }).extend({
  usage: providerRequestUsage.nullable(),
});
export const executionBudgetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  limits: executionBudgetLimits,
  deadlineAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  stopReason: z.enum(['cancelled', 'timeout']).nullable(),
  reservedRequests: count,
  admittedRequests: count,
  availableRequests: count,
  reportedRequests: count,
  knownInputTokens: count.nullable(),
  knownOutputTokens: count.nullable(),
  costUsd: z.null(),
  steps: z.array(
    z.object({
      jobId: z.uuid(),
      attribution: usageAttribution,
      requestLimit: count,
      admittedRequests: count,
      released: z.boolean(),
      stopReason: z.string().nullable(),
    }),
  ),
});
export const executionBudgetsResponse = z.object({ budgets: z.array(executionBudgetSchema) });
export const executionBudgetResponse = z.object({ budget: executionBudgetSchema });
