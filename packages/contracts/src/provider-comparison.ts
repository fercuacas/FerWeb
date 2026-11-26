import { z } from 'zod';
import {
  agentEvaluationCase,
  agentEvaluationEvidence,
  agentEvaluationList,
} from './agent-evaluation.js';
import { codingReport } from './coding.js';
import { codingDestination } from './routing.js';
import { executionBudgetLimits } from './usage.js';

export const providerComparisonInput = z.strictObject({
  apiId: z.uuid(),
  localId: z.uuid(),
  case: agentEvaluationCase,
  localHardware: z.string().trim().min(1).max(240).optional(),
});
export type ProviderComparisonInput = z.infer<typeof providerComparisonInput>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const arm = z.object({
  jobId: z.uuid(),
  state: agentEvaluationEvidence.shape.solo.shape.state,
  errorCode: z.string().nullable(),
  destination: codingDestination,
  model: z.string(),
  reportedModel: z.string().nullable(),
  modelRevision: z.string().nullable(),
  configurationRevision: z.string().nullable(),
  serverVersion: z.string().nullable(),
  cliVersion: z.string().nullable(),
  simulated: z.boolean().nullable(),
  taskHash: hash,
  commit: z.string(),
  sourceHash: hash.nullable(),
  toolsHash: hash.nullable(),
  contextHash: hash,
  reportHash: hash.nullable(),
  limits: executionBudgetLimits.nullable(),
  maxRequests: count,
  maxOutputTokens: count,
  timeoutMs: count,
  requests: count.nullable(),
  elapsedMs: count.nullable(),
  usage: codingReport.shape.providerUsage.unwrap().nullable(),
  independentTests: z.array(z.object({ origin: z.string(), exitCode: z.number().nullable() })),
  baseline: agentEvaluationEvidence.shape.solo.shape.baseline,
  grade: agentEvaluationEvidence.shape.solo.shape.grade,
  artifactHash: hash.nullable(),
  costUsd: z.null(),
});
export const providerComparisonEvidence = z.object({
  protocol: z.literal('ferweb-provider-comparison-v1'),
  case: agentEvaluationCase,
  fixtureHash: hash.nullable(),
  localHardware: z.string().nullable(),
  comparable: z.boolean(),
  differences: z.array(z.enum(['task', 'sources', 'tools', 'context', 'limits', 'simulation'])),
  api: arm,
  local: arm,
});
const summary = z.object({
  id: z.uuid(),
  apiId: z.uuid(),
  localId: z.uuid(),
  case: agentEvaluationCase,
  createdAt: z.iso.datetime(),
});
export const providerComparisonList = z.object({
  comparisons: z.array(summary),
  api: agentEvaluationList.shape.solo,
  local: agentEvaluationList.shape.solo,
});
export const providerComparison = summary.extend({
  evidenceHash: hash,
  evidence: providerComparisonEvidence,
});
export type ProviderComparison = z.infer<typeof providerComparison>;
