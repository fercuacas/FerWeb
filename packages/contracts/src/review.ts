import { z } from 'zod';
import { codingReport, codingConfiguration, codingWorkspace } from './coding.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewTarget = z.object({
  jobId: z.uuid(),
  reportHash: hash,
  diffHash: hash,
  taskHash: hash,
  environmentHash: hash,
  filesHash: hash,
  artifactHash: hash,
  diff: codingReport.shape.diff,
  files: codingWorkspace,
  beforeFiles: codingWorkspace,
});
export const reviewFinding = z
  .strictObject({
    code: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    title: z.string().trim().min(1).max(200),
    path: z.string().min(1).max(300),
    side: z.enum(['before', 'after']),
    startLine: z.number().int().min(1).max(100000),
    endLine: z.number().int().min(1).max(100000),
    evidence: z.string().trim().min(1).max(2000),
    trigger: z.string().trim().min(1).max(1000),
    impact: z.string().trim().min(1).max(1000),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    reproductionTest: z.string().trim().min(1).max(200).nullable(),
  })
  .refine((v) => v.endLine >= v.startLine && v.endLine - v.startLine < 50);
export const dimensionOutput = z.strictObject({ findings: z.array(reviewFinding).max(10) });
export const findingVerification = z.strictObject({
  findingId: hash,
  status: z.enum(['confirmed', 'refuted', 'unverifiable']),
  reason: z.string().trim().min(1).max(2000),
  proof: z
    .strictObject({
      jobId: z.uuid(),
      testIndex: z.number().int().min(0).max(10),
      quote: z.string().min(1).max(2000),
    })
    .nullable(),
});
export const verificationOutput = z.strictObject({
  verifications: z.array(findingVerification).max(60),
});
export const controllerReviewTest = z.strictObject({
  protocol: z.literal('ferweb-test-v1'),
  name: z.string(),
  outcome: z.enum(['passed', 'failed', 'skipped', 'unverifiable']),
  file: z.string().nullable(),
});
export const dimensionalReview = z.object({
  executionId: z.uuid(),
  artifactHash: hash,
  diffHash: hash,
  state: z.enum(['running', 'complete', 'incomplete', 'stale']),
  iteration: z.number().int().min(1).max(2),
  maxIterations: z.number().int().min(1).max(2),
  dimensions: z.array(
    z.object({
      key: z.string(),
      iteration: z.number().int().min(1).max(2),
      jobId: z.uuid().nullable(),
      role: z.uuid(),
      version: z.number().int(),
      state: z.enum(['pending', 'verified', 'failed', 'invalid']),
      error: z.string().nullable(),
    }),
  ),
  findings: z
    .array(
      z.object({
        id: hash,
        finding: reviewFinding,
        provenance: z.array(
          z.object({
            dimension: z.string(),
            iteration: z.number().int().min(1).max(2),
            jobId: z.uuid(),
            role: z.uuid(),
            version: z.number().int(),
            claim: reviewFinding,
          }),
        ),
        discrepancies: z.array(z.string()),
        verification: z.object({
          status: z.enum(['confirmed', 'refuted', 'unverifiable']),
          reason: z.string(),
          proof: findingVerification.shape.proof,
          origin: z.enum(['controller-test', 'unverified']),
        }),
      }),
    )
    .max(60),
  blockers: z.array(z.string()),
});

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
  dimensions: z.array(dimensionalReview).max(10),
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
