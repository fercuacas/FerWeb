import { z } from 'zod';
import { memorySelection } from './memory.js';
import { agentEvaluationEvidence } from './agent-evaluation.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().min(1).max(4);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]*$/u);
export const learningInput = z.strictObject({
  requestId: z.uuid(),
  evaluationId: z.uuid(),
  arm: z.enum(['solo', 'team']),
  title: text(160),
  failure: text(1000),
  correction: text(1000),
  replaces: memorySelection.optional(),
});
export const learningAction = z.strictObject({ version });
export const learningReview = learningAction.extend({ decision: z.enum(['approve', 'reject']) });
const grade = agentEvaluationEvidence.shape.solo.shape.grade;
export const learningProposal = learningInput.omit({ requestId: true }).extend({
  id: z.uuid(),
  version,
  state: z.enum(['proposed', 'approved', 'rejected', 'adopted', 'reverted']),
  createdAt: z.iso.datetime(),
  evidence: z.object({
    hash,
    origin: agentEvaluationEvidence.shape.solo.shape.evidence,
    baseline: grade.shape.status,
    verifier: grade.shape.status,
    comparable: z.boolean(),
    feedback: z.enum(['solo', 'team', 'tie', 'inconclusive']).nullable(),
  }),
  eligible: z.boolean(),
  memory: memorySelection.nullable(),
  history: z
    .array(
      z.object({
        action: z.enum(['propose', 'approve', 'reject', 'adopt', 'revert']),
        at: z.iso.datetime(),
        memory: memorySelection.nullable(),
      }),
    )
    .max(4),
});
const observation = z.object({
  jobId: z.uuid(),
  reportHash: hash.nullable(),
  role: z.object({ id: z.uuid(), version: z.number().int().positive() }).nullable(),
  skills: z
    .array(z.object({ id: z.uuid(), version: z.number().int().positive(), sha256: hash }))
    .max(6),
  state: z.enum(['completed', 'failed', 'cancelled']),
  failure: z
    .enum(['configuration', 'verification', 'artifact', 'timeout', 'agent', 'other', 'unknown'])
    .nullable(),
  origin: z.enum(['real', 'simulated', 'unknown']),
  agentTest: z.enum(['passed', 'failed', 'unobserved']),
  controllerTest: z.enum(['passed', 'failed', 'unobserved']),
  recordedAt: z.iso.datetime(),
});
export const learningHealth = z.object({
  retentionDays: z.literal(30),
  truncated: z.boolean(),
  available: z.boolean(),
  observations: z.array(observation).max(60),
});
const scenario = z.enum(['supportive', 'neutral', 'competing']);
export const learningComplianceInput = z
  .strictObject({
    supportive: z.uuid(),
    neutral: z.uuid(),
    competing: z.uuid(),
  })
  .refine((input) => new Set(Object.values(input)).size === 3, 'Elige tres ejecuciones distintas.');
export const learningCompliance = z.object({
  protocol: z.literal('ferweb-skill-comply-v1'),
  comparable: z.boolean(),
  scenarios: z.array(z.object({ label: scenario, observation })).length(3),
});
export const learningList = z.object({
  proposals: z.array(learningProposal.pick({ id: true, state: true, createdAt: true })),
});
export type LearningProposal = z.infer<typeof learningProposal>;
export type LearningInput = z.infer<typeof learningInput>;
export type LearningHealth = z.infer<typeof learningHealth>;
