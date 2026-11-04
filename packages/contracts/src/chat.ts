import { z } from 'zod';
import { sourceSchema } from './retrieval.js';
import { usageSchema } from './usage.js';
export { usageSchema, unknownUsage } from './usage.js';
import { contextMetrics } from './context-strategies.js';
export const aiProviderSchema = z.enum(['openai', 'ollama']);
const metric = z.number().nonnegative().nullable();
export const aiConfiguration = z.strictObject({
  maxOutputTokens: z.number().int().min(1).max(4096),
});
export const aiCatalogSchema = z.object({
  configurationRevision: z.string().nullable().default(null),
  simulated: z.boolean().default(false),
  provider: aiProviderSchema,
  available: z.boolean(),
  models: z
    .array(z.object({ id: z.string().min(1).max(200), revision: z.string().nullable() }))
    .max(20),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export const conversationInput = z.strictObject({
  title: z.string().trim().min(1).max(160),
  provider: aiProviderSchema,
  model: z.string().min(1).max(200),
  configuration: aiConfiguration,
});
export const conversationSchema = conversationInput.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  version: z.number().int().nonnegative(),
  catalogRevision: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const turnInput = z.strictObject({
  repositoryContext: z.boolean().default(false),
  requestId: z.uuid(),
  version: z.number().int().nonnegative(),
  content: z.string().trim().min(1).max(12000),
});
export const turnSchema = z.object({
  contextMetrics: contextMetrics.nullable().default(null),
  sources: z.array(sourceSchema).default([]),
  grounding: z
    .enum(['disabled', 'preparing', 'retrieved', 'insufficient', 'unavailable'])
    .default('disabled'),
  id: z.uuid(),
  requestId: z.uuid(),
  conversationId: z.uuid(),
  sequence: z.number().int().positive(),
  prompt: z.string(),
  response: z.string(),
  provider: aiProviderSchema,
  model: z.string(),
  reportedModel: z.string().nullable(),
  configuration: aiConfiguration,
  catalogRevision: z.string().nullable(),
  contextTurnIds: z.array(z.uuid()),
  status: z.enum(['streaming', 'completed', 'incomplete', 'cancelled', 'error', 'interrupted']),
  usage: usageSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  firstTokenMs: metric,
  durationMs: metric,
  finishReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  cancelRequested: z.boolean(),
  cancelMode: z.enum(['not_requested', 'connection_closed']),
  remoteCancellationConfirmed: z.boolean().nullable(),
});
export const conversationList = z.object({ conversations: z.array(conversationSchema) });
export const conversationResponse = z.object({
  conversation: conversationSchema,
  turns: z.array(turnSchema),
});
export const aiEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string().max(64000) }),
  z.object({ type: z.literal('meta'), reportedModel: z.string().nullable() }),
  z.object({
    type: z.literal('finish'),
    status: z.enum(['completed', 'incomplete', 'error']),
    reason: z.string().nullable(),
    usage: usageSchema,
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
  }),
  z.object({ type: z.literal('cancelled') }),
]);
export const chatStreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), turn: turnSchema }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), turn: turnSchema }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ChatTurn = z.infer<typeof turnSchema>;
export type Usage = z.infer<typeof usageSchema>;
