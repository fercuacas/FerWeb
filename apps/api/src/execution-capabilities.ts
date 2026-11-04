import { createHash } from 'node:crypto';
import {
  type AiProvider,
  type ExecutionOption,
  type ExecutionUnavailableReason,
} from '@ferweb/contracts';
import { HttpError } from './http-error.js';
import type { ChatService } from './modules/chat/service.js';
import type { RunnerClient } from './modules/jobs/runner-client.js';

export function describeCoding(
  caps: Awaited<ReturnType<RunnerClient['capabilities']>>,
): ExecutionOption {
  const reason =
    caps.reason ??
    (!caps.available
      ? 'provider_unconfigured'
      : !caps.environment
        ? 'runner_unavailable'
        : caps.models.length === 0
          ? 'no_allowed_models'
          : null);
  return {
    id: 'codex-v1',
    provider: 'openai',
    runtime: 'codex-cli',
    destination: caps.reason ? 'unknown' : caps.simulated ? 'simulated' : 'openai-api',
    toolProfile: 'node-isolated-v1',
    configurationRevision: caps.environment
      ? createHash('sha256')
          .update(
            JSON.stringify({
              environment: caps.environment,
              models: caps.models,
              available: caps.available,
            }),
          )
          .digest('hex')
      : null,
    available: reason === null,
    reason,
    simulated: caps.reason ? null : caps.simulated,
    models: caps.models.map((id) => ({ id, revision: null })),
    capabilities: {
      text: 'supported',
      streaming: 'supported',
      toolCalls: 'supported',
      workspaceWrite: 'supported',
      structuredOutput: 'unsupported',
      cancellation: 'supported',
      usage: 'unknown',
    },
  };
}

export async function describeChat(
  chats: ChatService,
  provider: AiProvider,
): Promise<ExecutionOption> {
  let catalog: Awaited<ReturnType<ChatService['diagnosticCatalog']>> | undefined;
  let reason: ExecutionUnavailableReason | null;
  try {
    catalog = await chats.diagnosticCatalog(provider);
    reason = catalog.available
      ? catalog.models.length === 0
        ? 'no_allowed_models'
        : null
      : catalog.error?.code === 'provider_not_configured'
        ? 'provider_unconfigured'
        : 'provider_unavailable';
  } catch (error) {
    reason =
      error instanceof HttpError && error.code === 'ai_unconfigured'
        ? 'ai_unconfigured'
        : 'provider_unavailable';
  }
  return {
    id: provider === 'ollama' ? 'ollama-chat' : 'openai-chat',
    provider,
    runtime: 'ferweb-chat',
    destination: !catalog
      ? 'unknown'
      : catalog.simulated
        ? 'simulated'
        : provider === 'ollama'
          ? 'local-ollama'
          : 'openai-api',
    toolProfile: 'text-only',
    configurationRevision: catalog?.configurationRevision ?? null,
    available: reason === null,
    reason,
    simulated: catalog?.simulated ?? null,
    models: catalog?.models ?? [],
    capabilities: {
      text: 'supported',
      streaming: 'supported',
      toolCalls: 'unsupported',
      workspaceWrite: 'unsupported',
      structuredOutput: 'unsupported',
      cancellation: 'supported',
      usage: 'unknown',
    },
  };
}
