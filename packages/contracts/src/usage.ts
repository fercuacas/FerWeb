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
