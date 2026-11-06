import { z } from 'zod';
import { reviewTarget } from './review.js';
import { memorySelections } from './memory.js';
import { agentCapability, agentSelection, agentTemplateId } from './agents.js';
import { codingAgentSnapshot } from './coding.js';
import { executionOptionSchema } from './execution.js';
import { executionBudgetLimits } from './usage.js';

const text = z.string().regex(/^[^\u0000\uD800-\uDFFF]*$/u);
const key = z
  .string()
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$(?![\s\S])/);
const version = z.number().int().min(1).max(50);
export const teamPresetId = z.enum([
  'implement-review',
  'research-answer',
  'review-diff',
  'specialists-review',
  'dimensional-review',
]);
export const teamStep = z.strictObject({
  key,
  title: text.trim().min(1).max(120),
  role: agentSelection,
  dependsOn: z.array(key).max(5),
  exitCriteria: z.array(text.trim().min(1).max(500)).min(1).max(8),
  requiredCapabilities: z.array(agentCapability).min(1).max(7),
  maxRequests: z.number().int().min(1).max(20),
});
export function teamStepOrder(steps: { key: string; dependsOn: string[] }[]) {
  const remaining = new Map(steps.map((step) => [step.key, step]));
  const order: string[] = [];
  while (remaining.size) {
    const next = [...remaining.values()].find((step) =>
      step.dependsOn.every((id) => order.includes(id)),
    );
    if (!next) return null;
    order.push(next.key);
    remaining.delete(next.key);
  }
  return order;
}
export const teamDefinition = z
  .strictObject({
    name: text.trim().min(1).max(120),
    strategy: z.literal('specialists').optional(),
    reviewMode: z.literal('dimensions-v1').optional(),
    description: text.trim().max(1000),
    maxIterations: z.number().int().min(1).max(3),
    limits: executionBudgetLimits,
    steps: z.array(teamStep).min(1).max(6),
  })
  .superRefine((value, ctx) => {
    if (
      value.reviewMode &&
      (value.strategy !== 'specialists' ||
        value.steps.map((s) => s.key).join(',') !== 'correctness,stack,security-tests,verify')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message:
          'La revisión requiere corrección, stack, seguridad/pruebas y verificador, en ese orden.',
      });
    if (value.strategy === 'specialists') {
      const roots = value.steps.slice(0, -1),
        summary = value.steps.at(-1)!;
      if (
        roots.length < 2 ||
        roots.length > 4 ||
        roots.some((step) => step.dependsOn.length) ||
        summary.dependsOn.length !== roots.length ||
        roots.some((step) => !summary.dependsOn.includes(step.key)) ||
        value.maxIterations > (value.reviewMode ? 2 : 1) ||
        value.steps.some((step) => step.requiredCapabilities.includes('workspaceWrite'))
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Especialistas requiere etapas independientes de solo lectura y reunión final: una pasada, o hasta dos rondas de revisión P08.',
          path: ['steps'],
        });
    } else if (value.limits.concurrency !== 1)
      ctx.addIssue({
        code: 'custom',
        message: 'La ejecución secuencial conserva concurrencia uno.',
        path: ['limits', 'concurrency'],
      });
    const keys = value.steps.map((step) => step.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Cada paso debe tener una clave única.',
        path: ['steps'],
      });
    for (const [index, step] of value.steps.entries()) {
      if (
        new Set(step.dependsOn).size !== step.dependsOn.length ||
        step.dependsOn.some((id) => !keys.includes(id))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Las dependencias deben existir y ser únicas.',
          path: ['steps', index, 'dependsOn'],
        });
    }
    if (!teamStepOrder(value.steps))
      ctx.addIssue({
        code: 'custom',
        message: 'El plan contiene un ciclo o dependencias ausentes.',
        path: ['steps'],
      });
    if (
      value.steps.reduce((sum, step) => sum + step.maxRequests, 0) * value.maxIterations >
      value.limits.maxRequests
    )
      ctx.addIssue({
        code: 'custom',
        message: 'El máximo de peticiones de todas las iteraciones supera el presupuesto.',
        path: ['limits', 'maxRequests'],
      });
  });
export const teamPreset = z.object({
  reviewMode: z.literal('dimensions-v1').optional(),
  strategy: z.literal('specialists').optional(),
  id: teamPresetId,
  name: z.string(),
  description: z.string(),
  steps: z.array(teamStep.omit({ role: true }).extend({ specialty: agentTemplateId })),
});
export const teamTemplateVersion = z.object({
  id: z.uuid(),
  version,
  definition: teamDefinition,
  origin: z.object({ preset: teamPresetId.nullable(), revision: z.literal(1) }),
});
export const teamTemplate = z.object({
  id: z.uuid(),
  archivedAt: z.iso.datetime().nullable(),
  latest: teamTemplateVersion,
});
export const teamTemplatesResponse = z.object({
  templates: z.array(teamTemplate),
  presets: z.array(teamPreset),
});
export const teamTemplateResponse = z.object({
  template: teamTemplate,
  versions: z.array(teamTemplateVersion),
});
export const createTeamTemplateInput = z.strictObject({
  definition: teamDefinition,
  preset: teamPresetId.optional(),
});
export const updateTeamTemplateInput = z.strictObject({ version, definition: teamDefinition });
export const archiveTeamTemplateInput = z.strictObject({ version });
export const prepareTeamPlanInput = z
  .strictObject({
    memory: memorySelections.optional(),
    requestId: z.uuid(),
    reviewTarget: z.uuid().optional(),
    taskId: z.uuid(),
    taskVersion: z.number().int().positive().max(2_147_483_647),
    templateId: z.uuid(),
    templateVersion: version,
    mode: z.enum(['auto', 'single', 'team']),
    singleStep: key.optional(),
    executionId: z.literal('codex-v1'),
    model: text.trim().min(1).max(100).nullable(),
  })
  .refine(
    (value) => (value.mode === 'single' ? !!value.singleStep : !value.singleStep),
    'Elige un paso solo en el modo de agente único.',
  );
export const taskClassification = z.object({
  size: z.enum(['small', 'medium', 'large']),
  recommendedMode: z.enum(['single', 'team']),
});
export function classifyPlanTask(task: { description: string; acceptanceCriteria: string[] }) {
  const size =
    task.description.length <= 800 && task.acceptanceCriteria.length <= 3
      ? 'small'
      : task.description.length <= 4000 && task.acceptanceCriteria.length <= 10
        ? 'medium'
        : 'large';
  return { size, recommendedMode: size === 'small' ? 'single' : 'team' } as z.infer<
    typeof taskClassification
  >;
}
export const teamPlanSnapshot = z.object({
  memory: memorySelections.optional(),
  reviewTarget: reviewTarget.optional(),
  version: z.literal(1),
  template: teamTemplateVersion,
  task: z.object({
    id: z.uuid(),
    version: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
  }),
  classification: taskClassification,
  mode: z.enum(['single', 'team']),
  execution: executionOptionSchema,
  model: z.string().nullable(),
  limits: executionBudgetLimits,
  maxIterations: z.number().int().min(1).max(3),
  plannedRequests: z.number().int().min(1).max(20),
  steps: z
    .array(teamStep.extend({ agent: codingAgentSnapshot }))
    .min(1)
    .max(6),
});
export const teamPlan = z.object({
  id: z.uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['prepared', 'approved', 'executed']),
  createdAt: z.iso.datetime(),
  approval: z
    .object({ hash: z.string(), version: z.literal(1), approvedAt: z.iso.datetime() })
    .nullable(),
  executionId: z.uuid().nullable(),
  snapshot: teamPlanSnapshot,
});
export const teamPlanSummary = teamPlan.omit({ snapshot: true }).extend({
  reviewJobId: z.uuid().nullable(),
  taskId: z.uuid(),
  title: z.string(),
  templateName: z.string(),
  templateVersion: version,
});
export const teamPlansResponse = z.object({ plans: z.array(teamPlanSummary) });
export const teamPlanResponse = z.object({ plan: teamPlan });
export const approveTeamPlanInput = z.strictObject({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.literal(1),
});
export type TeamDefinition = z.infer<typeof teamDefinition>;
export type TeamTemplate = z.infer<typeof teamTemplate>;
export type TeamTemplateVersion = z.infer<typeof teamTemplateVersion>;
export type TeamPreset = z.infer<typeof teamPreset>;
export type TeamPlan = z.infer<typeof teamPlan>;

export const executeTeamPlanInput = z.strictObject({
  requestId: z.uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.literal(1),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
});
export const teamDelivery = z.object({
  jobId: z.uuid(),
  step: z.string(),
  result: z.string(),
  sources: z
    .array(z.object({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }))
    .max(100),
  inputHash: z.string(),
  outputHash: z.string().nullable(),
  tests: z.array(
    z.object({ command: z.string(), exitCode: z.number().nullable(), origin: z.string() }),
  ),
  doubts: z.array(z.string()),
  verified: z.boolean(),
});
export const teamExecution = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  planId: z.uuid(),
  planHash: z.string(),
  title: z.string(),
  state: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  cancelRequested: z.boolean(),
  commit: z.string(),
  repository: z.string(),
  budgetId: z.uuid(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export const teamExecutionResponse = z.object({
  gathering: z.object({
    complete: z.boolean(),
    received: z.array(z.string()),
    missing: z.array(z.string()),
    summary: z.string().nullable(),
    conflicts: z.number().int().nonnegative(),
  }),
  execution: teamExecution,
  plan: teamPlanSnapshot,
  steps: z.array(
    z.object({
      id: z.uuid(),
      position: z.number().int(),
      iteration: z.number().int().min(1).max(2),
      key: z.string(),
      jobId: z.uuid().nullable(),
      state: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped']),
      errorCode: z.string().nullable(),
      delivery: teamDelivery.nullable(),
    }),
  ),
  events: z.array(
    z.object({
      sequence: z.number().int(),
      type: z.string(),
      message: z.string(),
      data: z.record(z.string(), z.unknown()),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export const teamPolicy = z.object({
  parallelism: z.union([z.literal(1), z.literal(2)]),
  version: z.number().int().positive(),
});
export const updateTeamPolicyInput = z.strictObject({ ...teamPolicy.shape });
export const teamMessageKind = z.enum(['handoff', 'query', 'response', 'completion', 'conflict']);
export const sendTeamMessageInput = z
  .strictObject({
    requestId: z.uuid(),
    to: z.uuid().nullable(),
    kind: teamMessageKind,
    text: text.trim().min(1).max(2000),
    replyTo: z.uuid().optional(),
  })
  .refine(
    (value) => value.kind !== 'response' || !!value.replyTo,
    'Una respuesta requiere la consulta original.',
  );
export const teamMessage = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  kind: teamMessageKind,
  text: z.string(),
  sender: z.enum(['agent', 'coordinator']),
  senderStepId: z.uuid().nullable(),
  senderJobId: z.uuid().nullable(),
  to: z.uuid().nullable(),
  replyTo: z.uuid().nullable(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const teamMessagesResponse = z.object({
  messages: z.array(teamMessage),
  nextCursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const teamExecutionsResponse = z.object({ executions: z.array(teamExecution) });
