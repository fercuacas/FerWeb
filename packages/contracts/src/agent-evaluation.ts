import { z } from 'zod';
import { codingReport } from './coding.js';
import { executionBudgetLimits, usageAttribution } from './usage.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
export const agentEvaluationCase = z.enum(['recorded', 'addition-v1']);
export const agentEvaluationInput = z.strictObject({
  soloId: z.uuid(),
  teamId: z.uuid(),
  case: agentEvaluationCase,
});
export const agentEvaluationReviewInput = z.strictObject({
  version: count,
  verdict: z.enum(['solo', 'team', 'tie', 'inconclusive']),
  note: z.string().trim().min(1).max(2000),
});
const grade = z.object({
  status: z.enum(['passed', 'failed', 'unverifiable', 'not_run']),
  code: z.string(),
  passed: count.nullable(),
  total: count.nullable(),
});
const step = z.object({
  key: z.string(),
  iteration: count,
  jobId: z.uuid().nullable(),
  state: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped']),
  errorCode: z.string().nullable(),
  reportHash: hash.nullable(),
  durationMs: z.number().nonnegative().nullable(),
  requests: count.nullable(),
  attribution: usageAttribution.nullable(),
  providerUsage: codingReport.shape.providerUsage.unwrap().nullable(),
  tests: z.array(
    z.object({ command: z.string(), origin: z.string(), exitCode: z.number().nullable() }),
  ),
  context: z
    .object({
      receiptHash: hash,
      inputHash: hash,
      bytes: count,
      expansions: count,
      diagnostics: z.array(z.string()),
      relevance: z.enum(['observed', 'missing', 'unknown']),
    })
    .nullable(),
});
const arm = z.object({
  state: z.enum(['completed', 'failed', 'cancelled']),
  errorCode: z.string().nullable(),
  elapsedMs: count.nullable(),
  limits: executionBudgetLimits.nullable(),
  iterations: count,
  model: z.string().nullable(),
  maxOutputTokens: count.nullable(),
  evidence: z.enum(['simulated', 'real', 'mixed', 'unknown']),
  repository: z.string(),
  commit: z.string(),
  taskHash: hash,
  sourceHash: hash.nullable(),
  environmentHash: hash.nullable(),
  artifactHash: hash.nullable(),
  costUsd: z.null(),
  lineCoverage: z.null(),
  baseline: grade,
  grade,
  steps: z.array(step).max(12),
});
export const agentEvaluationEvidence = z.object({
  protocol: z.literal('ferweb-agent-evaluation-v1'),
  case: agentEvaluationCase,
  planHash: hash,
  fixtureHash: hash.nullable(),
  comparable: z.boolean(),
  differences: z.array(
    z.enum(['task', 'snapshot', 'tools', 'limits', 'model', 'context', 'destination']),
  ),
  solo: arm,
  team: arm,
});
const summary = agentEvaluationInput.extend({ id: z.uuid(), createdAt: z.iso.datetime() });
const candidate = z.object({
  id: z.uuid(),
  title: z.string(),
  state: z.enum(['completed', 'failed', 'cancelled']),
  createdAt: z.iso.datetime(),
});
export const agentEvaluationList = z.object({
  evaluations: z.array(summary),
  solo: z.array(candidate),
  teams: z.array(candidate),
});
export const agentEvaluation = summary.extend({
  evidenceHash: hash,
  evidence: agentEvaluationEvidence,
  reviews: z.array(agentEvaluationReviewInput.extend({ recordedAt: z.iso.datetime() })),
});
export type AgentEvaluation = z.infer<typeof agentEvaluation>;
export type AgentEvaluationEvidence = z.infer<typeof agentEvaluationEvidence>;
export type AgentEvaluationInput = z.infer<typeof agentEvaluationInput>;
