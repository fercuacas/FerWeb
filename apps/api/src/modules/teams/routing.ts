import {
  codingDestination,
  routingDecision,
  type CodingDestination,
  type ExecutionOption,
  type RoutingDecision,
  type routingInput,
  type TeamPlan,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';

type Stage = Pick<
  TeamPlan['snapshot']['steps'][number],
  'key' | 'maxRequests' | 'requiredCapabilities'
>;
type Catalog = Record<CodingDestination, ExecutionOption>;

export function decideRouting(
  policy: z.infer<typeof routingInput>,
  stages: Stage[],
  catalog: Catalog,
  conditions: {
    model: string | null;
    maxRequests: number;
    iterations: number;
    context: boolean;
    memory: boolean;
    review: boolean;
  },
): RoutingDecision {
  const assignments = policy.stages ?? [];
  const mixed = policy.mode === 'mixed';
  if (
    mixed
      ? assignments.length !== stages.length ||
        new Set(assignments.map((stage) => stage.step)).size !== stages.length ||
        assignments.some((stage) => !stages.some((item) => item.key === stage.step)) ||
        new Set(assignments.map((stage) => stage.destination)).size !== 2
      : policy.stages !== undefined
  )
    throw new HttpError(
      422,
      'routing_stages',
      'El plan mixto requiere un destino explícito para cada etapa y ambos destinos.',
    );

  const destinationFor = (step: string): CodingDestination =>
    policy.mode === 'mixed'
      ? assignments.find((stage) => stage.step === step)!.destination
      : policy.mode === 'local'
        ? 'codex-local-v1'
        : 'codex-v1';
  const reservedApiRequests =
    conditions.iterations *
    stages.reduce(
      (sum, step) => sum + (destinationFor(step.key) === 'codex-v1' ? step.maxRequests : 0),
      0,
    );
  if (
    policy.maxApiRequests > conditions.maxRequests ||
    reservedApiRequests > policy.maxApiRequests ||
    (policy.mode === 'local' && policy.maxApiRequests !== 0)
  )
    throw new HttpError(
      422,
      'routing_budget',
      'Las etapas no caben en el límite de peticiones externas aprobado.',
    );

  const decisions = stages.map((step, index): RoutingDecision['stages'][number] => {
    const destination = destinationFor(step.key);
    const requested = mixed
      ? assignments.find((stage) => stage.step === step.key)?.model
      : conditions.model;
    const execution = { ...catalog[destination], id: destination };
    const models = execution.models.filter(
      (model) => destination === 'codex-v1' || !!model.revision,
    );
    const model = requested
      ? models.find((item) => item.id === requested)
      : [...models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (!execution.available || !execution.configurationRevision)
      throw new HttpError(
        503,
        'routing_unavailable',
        `El destino autorizado para ${step.key} no está disponible. Prepara otra selección.`,
      );
    if (
      !step.requiredCapabilities.every(
        (capability) => execution.capabilities[capability] === 'supported',
      )
    )
      throw new HttpError(
        422,
        'routing_capabilities',
        `El destino autorizado para ${step.key} no confirma las capacidades mínimas.`,
      );
    if (!model)
      throw new HttpError(
        422,
        'routing_model',
        `El modelo solicitado para ${step.key} no está disponible en su destino.`,
      );

    return {
      step: step.key,
      execution,
      model: model.id,
      modelRevision: model.revision,
      reason: requested ? 'requested_model' : 'first_allowed_model',
      candidates: codingDestination.options.map((candidate) => ({
        destination: candidate,
        model: candidate === destination ? model.id : null,
        reason: candidate === destination ? 'selected' : 'destination_denied',
      })),
      transfers:
        destination === 'codex-v1'
          ? [
              'task',
              'workspace',
              'role-materials',
              'tool-results',
              ...(conditions.context ? ['context' as const] : []),
              ...(conditions.memory ? ['memory' as const] : []),
              ...(index > 0 || conditions.review || conditions.iterations > 1
                ? ['current-run-deliveries' as const]
                : []),
            ]
          : [],
    };
  });
  return routingDecision.parse({
    policy: 'ferweb-routing-v1',
    mode: policy.mode,
    maxApiRequests: policy.maxApiRequests,
    reservedApiRequests,
    stages: decisions,
  });
}
