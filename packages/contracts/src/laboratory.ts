import { z } from 'zod';
import { aiProviderSchema, aiConfiguration, usageSchema } from './chat.js';
import { sourceSchema } from './retrieval.js';
import { contextStrategy, contextPlan, contextMetrics } from './context-strategies.js';
export const labCriterion = z.strictObject({
  expectedPaths: z.array(z.string().min(1).max(220)).max(5).optional(),
  description: z.string().trim().min(1).max(500),
  expectedText: z.string().trim().max(300),
});
export const labCaseInput = z.strictObject({
  title: z.string().trim().min(1).max(160),
  question: z.string().trim().min(1).max(4000),
  context: z.string().max(20000),
  criteria: z.array(labCriterion).min(1).max(10),
  repositoryContext: z.boolean(),
});
export const labCaseSchema = labCaseInput.omit({ repositoryContext: true }).extend({
  id: z.uuid(),
  projectId: z.uuid(),
  version: z.literal(1),
  sources: z.array(sourceSchema).max(5),
  contextHash: z.string(),
  createdAt: z.iso.datetime(),
});
export const tariffInput = z
  .strictObject({
    provider: aiProviderSchema,
    model: z.string().min(1).max(200),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    verifiedOn: z.iso.date(),
    source: z.url().refine((value) => new URL(value).protocol === 'https:'),
    inputPerMillion: z.number().finite().min(0).max(100000),
    cachedInputPerMillion: z.number().finite().min(0).max(100000),
    outputPerMillion: z.number().finite().min(0).max(100000),
    notes: z.string().trim().min(1).max(1000),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom);
export const tariffSchema = tariffInput.safeExtend({ id: z.uuid(), createdAt: z.iso.datetime() });
export const labTargetInput = z.strictObject({
  contextStrategy: contextStrategy.optional(),
  provider: aiProviderSchema,
  model: z.string().min(1).max(200),
  configuration: aiConfiguration,
  tariffId: z.uuid().nullable(),
  cacheLabel: z.enum(['unspecified', 'cold', 'warm']),
});
export const labBatchInput = z
  .strictObject({
    contextExperiment: z.enum(['ferweb-context-v1', 'ferweb-context-p10-v1']).optional(),
    requestId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    caseIds: z.array(z.uuid()).min(1).max(5),
    targets: z.array(labTargetInput).min(1).max(4),
    repetitions: z.number().int().min(1).max(5),
    environment: z.string().trim().max(2000),
    allowExternal: z.boolean(),
  })
  .refine(
    (value) =>
      value.caseIds.length * value.targets.length * value.repetitions <=
      (value.contextExperiment ? 40 : 20),
    'Máximo 20 ejecuciones por lote.',
  )
  .refine((value) => new Set(value.caseIds).size === value.caseIds.length, 'No repitas casos.');
export const labTargetSchema = labTargetInput.extend({
  tariff: tariffSchema.nullable(),
  catalogRevision: z.string().nullable(),
});
export const labConditionsSchema = z.object({
  contextPlan: contextPlan.nullable().default(null),
  title: z.string(),
  cases: z.array(labCaseSchema),
  targets: z.array(labTargetSchema),
  repetitions: z.number(),
  environment: z.string(),
  allowExternal: z.boolean(),
  protocol: z.literal('ferweb-lab-v1'),
  order: z.enum(['repetition_case_target', 'counterbalanced_context_v1']),
  timeoutMs: z.literal(120000),
  messagesHash: z.record(z.string(), z.string()),
  messages: z.record(
    z.string(),
    z
      .array(
        z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string().max(100000),
        }),
      )
      .length(3),
  ),
  costScope: z.literal('text_tokens_only'),
});
export const labReviewInput = z.strictObject({
  version: z.number().int().nonnegative(),
  accepted: z.boolean(),
  score: z.number().int().min(0).max(5),
  verdicts: z
    .array(z.enum(['pass', 'fail', 'uncertain']))
    .min(1)
    .max(10),
  notes: z.string().trim().max(2000),
});
export const labReviewSchema = labReviewInput.extend({
  reviewerId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const labAutomaticSchema = z.object({
  method: z.enum(['substring-v1', 'substring-source-v2']),
  verdicts: z.array(z.enum(['pass', 'fail', 'unknown'])),
  provisionalAccepted: z.boolean().nullable(),
});
const nullableMetric = z.number().finite().nonnegative().nullable();
export const labRunSchema = z.object({
  contextMetrics: contextMetrics.nullable().default(null),
  id: z.uuid(),
  caseId: z.uuid(),
  target: z.number().int(),
  repetition: z.number().int(),
  ordinal: z.number().int(),
  status: z.enum([
    'pending',
    'running',
    'completed',
    'incomplete',
    'error',
    'cancelled',
    'interrupted',
    'skipped',
  ]),
  response: z.string(),
  reportedModel: z.string().nullable(),
  catalogRevision: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  firstTokenMs: nullableMetric,
  durationMs: nullableMetric,
  usage: usageSchema,
  estimatedCostUsd: nullableMetric,
  costReason: z.string(),
  cacheObserved: z.enum(['hit', 'no_hit', 'unknown']),
  automatic: labAutomaticSchema.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  reviewVersion: z.number().int(),
  reviews: z.array(labReviewSchema),
});
export const labBatchSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  requestId: z.uuid(),
  conditions: labConditionsSchema,
  status: z.enum(['draft', 'running', 'completed', 'cancelled', 'interrupted']),
  cancelRequested: z.boolean(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  runs: z.array(labRunSchema),
});
export const labSummarySchema = z.object({
  target: z.number(),
  attempted: z.number(),
  completed: z.number(),
  errors: z.number(),
  reviewed: z.number(),
  accepted: z.number(),
  pendingReview: z.number(),
  acceptanceRate: nullableMetric,
  meanQuality: nullableMetric,
  meanFirstTokenMs: nullableMetric,
  firstTokenSamples: z.number(),
  meanDurationMs: nullableMetric,
  durationSamples: z.number(),
  knownCostSubtotalUsd: z.number(),
  pricedAttempts: z.number(),
  estimatedTotalCostUsd: nullableMetric,
  costPerAcceptedUsd: nullableMetric,
  timePerAcceptedMs: nullableMetric,
  cacheHits: z.number(),
  cacheMisses: z.number(),
  cacheUnknown: z.number(),
});
export const labBatchResponse = z.object({
  batch: labBatchSchema,
  summary: z.array(labSummarySchema),
});
export const labOverviewSchema = z.object({
  cases: z.array(
    labCaseSchema
      .pick({ id: true, title: true, question: true, contextHash: true, createdAt: true })
      .extend({ sourceCount: z.number() }),
  ),
  tariffs: z.array(tariffSchema),
  batches: z.array(
    z.object({ id: z.uuid(), title: z.string(), status: z.string(), createdAt: z.iso.datetime() }),
  ),
});
export type LabCase = z.infer<typeof labCaseSchema>;
export type LabBatch = z.infer<typeof labBatchSchema>;
export type LabRun = z.infer<typeof labRunSchema>;
export type LabTariff = z.infer<typeof tariffSchema>;
