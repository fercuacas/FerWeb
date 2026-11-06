import { z } from 'zod';
import { sourceSchema } from './retrieval.js';
import { usageSchema } from './usage.js';
import { memoryEntry } from './memory.js';
import { hybridResponse } from './retrieval.js';

export const contextStrategy = z.enum([
  'wide-v1',
  'retrieval-v1',
  'summary-v1',
  'reuse-v1',
  'hybrid-v1',
  'hybrid-memory-v1',
]);
export const contextCorpus = z.object({
  fingerprint: z.string(),
  commit: z.string(),
  linkVersion: z.number(),
  repositoryId: z.number(),
  embeddingSpace: z.string(),
  simulated: z.boolean(),
  sources: z.array(sourceSchema).max(60),
});
export const contextPlan = z.object({
  policyRevision: z.string(),
  providerConfigurationRevision: z.string().nullable(),
  protocol: z.enum(['ferweb-context-v1', 'ferweb-context-p10-v1']),
  memoryCases: z.record(z.uuid(), z.array(memoryEntry).max(3)).optional(),
  memoryInventoryHash: z.string().optional(),
  memoryComplete: z.boolean().optional(),
  corpus: contextCorpus,
  simulated: z.boolean(),
  summaryMaxOutputTokens: z.literal(512),
  maxRetries: z.literal(0),
  cacheScope: z.literal('experiment'),
});
export const contextOperation = z.object({
  response: z.string().max(20000).default(''),
  reportedModel: z.string().nullable().default(null),
  id: z.uuid(),
  kind: z.enum([
    'validation',
    'retrieval',
    'summary',
    'answer',
    'result_cache',
    'memory_lookup',
    'source_lookup',
  ]),
  status: z.enum(['running', 'completed', 'error']),
  attempt: z.literal(1),
  startedAt: z.string(),
  durationMs: z.number().nonnegative().nullable(),
  usage: usageSchema,
  inference: z.boolean(),
  estimatedTextCostUsd: z.number().nonnegative().nullable(),
  costReason: z.string(),
  messagesHash: z.string().nullable(),
  messages: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }))
    .nullable(),
  errorCode: z.string().nullable(),
});
export const contextMetrics = z.object({
  retrieval: hybridResponse.optional(),
  memory: z.array(memoryEntry).max(3).optional(),
  memoryComplete: z.boolean().optional(),
  citationAudit: z
    .object({
      validLabels: z.array(z.string()),
      invalidLabels: z.array(z.string()),
      currentMetadata: z.boolean(),
    })
    .optional(),
  strategy: contextStrategy,
  fingerprint: z.string(),
  simulated: z.boolean(),
  operations: z.array(contextOperation),
  sources: z.array(sourceSchema),
  reusedFrom: z.uuid().nullable(),
  reuseStatus: z.enum(['disabled', 'miss', 'hit', 'unsupported_revision']),
  elapsedMs: z.number().nonnegative().nullable(),
});
export const contextAdoptionInput = z.strictObject({
  batchId: z.uuid(),
  target: z.number().int().min(1).max(3),
  metric: z.enum(['latency', 'generation_tokens', 'text_cost']),
  version: z.number().int().nonnegative(),
});
export const contextPolicy = z.object({
  version: z.number().int().positive(),
  batchId: z.uuid(),
  target: z.number(),
  strategy: contextStrategy,
  metric: z.enum(['latency', 'generation_tokens', 'text_cost']),
  fingerprint: z.string(),
  adoptedAt: z.string(),
});
const nullableMetric = z.number().nullable();
export const contextComparisonResponse = z.object({
  valid: z.boolean(),
  report: z.object({
    protocol: z.string(),
    simulated: z.boolean(),
    sourceFingerprint: z.string().nullable(),
    rows: z.array(
      z.object({
        target: z.number(),
        strategy: contextStrategy.nullable(),
        attempts: z.number(),
        completed: z.number(),
        reviewed: z.number(),
        accepted: z.number(),
        meanQuality: nullableMetric,
        generationTokens: nullableMetric,
        baselineGenerationTokens: nullableMetric,
        generationTokenDelta: nullableMetric,
        tokenReductionRatio: nullableMetric,
        providerCachedTokens: nullableMetric,
        latencyMs: nullableMetric,
        baselineLatencyMs: nullableMetric,
        estimatedTextCostUsd: nullableMetric,
        totalCostUsd: nullableMetric,
        costPerAcceptedUsd: nullableMetric,
        knownTextCostSubtotalUsd: z.number(),
        auxiliaryCalls: z.number(),
        summaryCalls: z.number(),
        resultCacheHits: z.number(),
        creationCostsIncluded: z.boolean(),
        estimatedCacheReadDiscountUsd: nullableMetric,
        expectedPathCoverage: nullableMetric.optional(),
        citationValidity: nullableMetric.optional(),
        searchLatencyMs: nullableMetric.optional(),
        retrievalStrategies: z.array(z.string()).optional(),
      }),
    ),
  }),
  adoption: z.array(
    z.object({
      eligible: z.boolean(),
      reasons: z.array(z.string()),
      metric: z.string(),
      before: nullableMetric,
      after: nullableMetric,
      scope: z.string(),
    }),
  ),
});
export const contextPolicyResponse = z.object({
  policy: contextPolicy.nullable(),
  version: z.number().int().nonnegative(),
});
export type ContextPlan = z.infer<typeof contextPlan>;
export type ContextMetrics = z.infer<typeof contextMetrics>;
export type ContextStrategy = z.infer<typeof contextStrategy>;
