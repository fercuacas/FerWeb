import { z } from 'zod';
import { codingConfiguration } from './coding.js';
export const simulationSchema = z
  .strictObject({
    steps: z.number().int().min(1).max(30),
    stepDelayMs: z.number().int().min(50).max(1000),
    unitsPerStep: z.number().int().min(1).max(20),
    costMicrosPerStep: z.number().int().min(0).max(10000),
    failure: z.enum(['none', 'transient', 'permanent', 'after_commit']),
    failureStep: z.number().int().min(1).max(30),
    failuresBeforeSuccess: z.number().int().min(0).max(2),
    ignoreTermination: z.boolean(),
  })
  .refine((v) => v.failureStep <= v.steps, 'El paso de fallo debe existir.');
export const jobLimits = z.strictObject({
  timeoutMs: z.number().int().min(1000).max(120000),
  maxAttempts: z.number().int().min(1).max(3),
  budgetUnits: z.number().int().min(1).max(10000),
  budgetMicros: z.number().int().min(0).max(1000000),
});
export const jobConfiguration = z.strictObject({ simulation: simulationSchema, limits: jobLimits });
export const anyJobConfiguration = z.union([jobConfiguration, codingConfiguration]);
export const jobInput = z.strictObject({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  simulation: simulationSchema,
  limits: jobLimits,
});
export const jobState = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
const baseJobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  requestId: z.uuid(),
  title: z.string(),
  state: jobState,
  attempt: z.number().int(),
  completedSteps: z.number().int(),
  usedUnits: z.number().int(),
  usedCostMicros: z.number().int(),
  cancelRequested: z.boolean(),
  executorId: z.uuid().nullable(),
  executorConnected: z.boolean(),
  availableAt: z.iso.datetime(),
  firstStartedAt: z.iso.datetime().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  eventSequence: z.number().int(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  result: z
    .union([
      z.object({
        kind: z.literal('simulation-v1'),
        completedSteps: z.number(),
        effectKeys: z.array(z.string()),
        simulated: z.literal(true),
      }),
      z.object({ kind: z.literal('codex-v1'), runId: z.uuid() }),
    ])
    .nullable(),
});
export const jobSchema = z.discriminatedUnion('kind', [
  baseJobSchema.extend({ kind: z.literal('simulation-v1'), configuration: jobConfiguration }),
  baseJobSchema.extend({ kind: z.literal('codex-v1'), configuration: codingConfiguration }),
]);
export const jobEventSchema = z.object({
  jobId: z.uuid(),
  sequence: z.number().int(),
  attempt: z.number().int(),
  executorId: z.uuid().nullable(),
  type: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export const jobAttemptSchema = z.object({
  jobId: z.uuid(),
  attempt: z.number().int(),
  executorId: z.uuid(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled', 'lost']),
  processPid: z.number().int().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  exitCode: z.number().nullable(),
  exitSignal: z.string().nullable(),
  terminationConfirmed: z.boolean().nullable(),
  errorCode: z.string().nullable(),
});
export const jobDetailSchema = z.object({
  job: jobSchema,
  attempts: z.array(jobAttemptSchema),
  limits: z.object({
    globalConcurrency: z.literal(2),
    projectConcurrency: z.union([z.literal(1), z.literal(2)]),
  }),
});
export const jobListSchema = z.object({ jobs: z.array(jobSchema) });
export const jobEventsSchema = z.object({
  events: z.array(jobEventSchema),
  nextCursor: z.number().int(),
  hasMore: z.boolean(),
});
export type Job = z.infer<typeof jobSchema>;
export type Simulation = z.infer<typeof simulationSchema>;
export type JobConfiguration = z.infer<typeof jobConfiguration>;
