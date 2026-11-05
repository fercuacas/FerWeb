import { z } from 'zod';
import { aiProviderSchema } from './chat.js';

const support = z.enum(['supported', 'unsupported', 'unknown']);
const executionUnavailableReason = z.enum([
  'runner_unconfigured',
  'runner_unavailable',
  'ai_unconfigured',
  'provider_unconfigured',
  'provider_unavailable',
  'no_allowed_models',
]);
export type ExecutionUnavailableReason = z.infer<typeof executionUnavailableReason>;

export const executionOptionSchema = z.object({
  id: z.enum(['codex-v1', 'openai-chat', 'ollama-chat']),
  provider: aiProviderSchema,
  runtime: z.enum(['codex-cli', 'ferweb-chat']),
  destination: z.enum(['openai-api', 'local-ollama', 'simulated', 'unknown']),
  toolProfile: z.enum(['node-isolated-v1', 'node-readonly-v1', 'text-only']),
  configurationRevision: z.string().nullable(),
  available: z.boolean(),
  reason: executionUnavailableReason.nullable(),
  simulated: z.boolean().nullable(),
  models: z.array(z.object({ id: z.string(), revision: z.string().nullable() })),
  capabilities: z.object({
    text: support,
    streaming: support,
    toolCalls: support,
    workspaceWrite: support,
    structuredOutput: support,
    cancellation: support,
    usage: support,
  }),
});
export type ExecutionOption = z.infer<typeof executionOptionSchema>;
export const executionCatalogSchema = z.object({ options: z.array(executionOptionSchema) });
