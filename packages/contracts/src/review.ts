import { z } from 'zod';
import { codingReport, codingConfiguration } from './coding.js';

export const reviewInput = z.strictObject({
  version: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20000),
  branch: z
    .string()
    .max(180)
    .regex(/^ferweb\/[a-zA-Z0-9][a-zA-Z0-9/_-]*[a-zA-Z0-9]$/),
  approved: z.boolean(),
  notes: z.string().max(10000),
});
export const reviewPublishInput = z.strictObject({ version: z.number().int().positive() });
export const codingReview = reviewInput.omit({ version: true }).extend({
  version: z.number().int().positive(),
  jobId: z.uuid(),
  state: z.enum(['prepared', 'publishing', 'failed', 'published']),
  attemptedAt: z.string().nullable(),
  commit: z.string().nullable(),
  pullNumber: z.number().int().positive().nullable(),
  pullUrl: z.string().url().nullable(),
  baseChanged: z.boolean().nullable(),
  errorCode: z.string().nullable(),
});
export const reviewResponse = z.object({
  review: codingReview.nullable(),
  baseBranch: z.string().nullable(),
});
export const repeatCodingInput = z.strictObject({
  requestId: z.uuid(),
  model: z.string().min(1).max(100),
});
export const codingComparisons = z.object({
  baseline: z.uuid(),
  runs: z.array(
    z.object({
      jobId: z.uuid(),
      state: z.string(),
      configuration: codingConfiguration,
      commit: z.string(),
      environment: z.record(z.string(), z.unknown()).nullable(),
      comparable: z.boolean(),
      differences: z.array(z.string()),
      report: codingReport.nullable(),
      review: codingReview.nullable(),
    }),
  ),
  truncated: z.boolean(),
});
