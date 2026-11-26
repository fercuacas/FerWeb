import { z } from 'zod';
import { executionOptionSchema } from './execution.js';

export const codingDestination = z.enum(['codex-v1', 'codex-local-v1']);
export type CodingDestination = z.infer<typeof codingDestination>;
const stepKey = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const modelName = z.string().trim().min(1).max(100);
const requestLimit = z.number().int().min(0).max(20);
const mode = z.enum(['api', 'local', 'mixed']);

export const routingInput = z.strictObject({
  mode,
  maxApiRequests: requestLimit,
  stages: z
    .array(
      z.strictObject({
        step: stepKey,
        destination: codingDestination,
        model: modelName.optional(),
      }),
    )
    .max(6)
    .optional(),
});
export const routingDecision = z.strictObject({
  policy: z.literal('ferweb-routing-v1'),
  mode,
  maxApiRequests: requestLimit,
  reservedApiRequests: requestLimit,
  stages: z
    .array(
      z.strictObject({
        step: stepKey,
        execution: executionOptionSchema.extend({ id: codingDestination }),
        model: modelName,
        modelRevision: z.string().nullable(),
        reason: z.enum(['requested_model', 'first_allowed_model']),
        candidates: z
          .array(
            z.strictObject({
              destination: codingDestination,
              model: modelName.nullable(),
              reason: z.enum([
                'selected',
                'destination_denied',
                'unavailable',
                'capabilities',
                'model_unavailable',
              ]),
            }),
          )
          .length(2),
        transfers: z.array(
          z.enum([
            'task',
            'workspace',
            'role-materials',
            'context',
            'memory',
            'current-run-deliveries',
            'tool-results',
          ]),
        ),
      }),
    )
    .min(1)
    .max(6),
});
export type RoutingDecision = z.infer<typeof routingDecision>;
