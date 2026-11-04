import { z } from 'zod';
import { simulationSchema } from '@ferweb/contracts';
export const processRequest = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('reserve'),
    request: z.number().int().positive(),
    step: z.number().int().min(1).max(30),
  }),
  z.strictObject({
    type: z.literal('commit'),
    request: z.number().int().positive(),
    step: z.number().int().min(1).max(30),
  }),
]);
export const processControl = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('start'),
    jobId: z.uuid(),
    attempt: z.number().int().positive(),
    simulation: simulationSchema,
    startStep: z.number().int().min(1).max(31),
    leaseExpiresAt: z.iso.datetime(),
    deadlineAt: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('renew'),
    leaseExpiresAt: z.iso.datetime(),
    deadlineAt: z.iso.datetime(),
  }),
  z.strictObject({ type: z.literal('ack'), request: z.number().int(), committed: z.boolean() }),
]);
