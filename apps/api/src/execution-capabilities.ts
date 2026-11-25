import { createHash } from 'node:crypto';
import {
  type AiProvider,
  type CodingToolProfile,
  type ExecutionOption,
  type ExecutionUnavailableReason,
} from '@ferweb/contracts';
import { HttpError } from './http-error.js';
import type { ChatService } from './modules/chat/service.js';
import type { RunnerClient } from './modules/jobs/runner-client.js';

export function describeCoding(
  caps: Awaited<ReturnType<RunnerClient['capabilities']>>,
  profile: CodingToolProfile = 'node-isolated-v1',
): ExecutionOption {
  const environment = codingEnvironment(caps, profile);
  const reason =
    caps.reason ??
    (!caps.available
      ? 'provider_unconfigured'
      : !environment
        ? 'runner_unavailable'
        : caps.models.length === 0
          ? 'no_allowed_models'
          : null);
  return {
    id: 'codex-v1',
    provider: 'openai',
    runtime: 'codex-cli',
    destination: caps.reason ? 'unknown' : caps.simulated ? 'simulated' : 'openai-api',
    toolProfile: profile,
    configurationRevision: environment
      ? createHash('sha256')
          .update(
            JSON.stringify({
              environment,
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

export function codingEnvironment(
  caps: Awaited<ReturnType<RunnerClient['capabilities']>>,
  profile?: CodingToolProfile,
  executionId?: string,
) {
  const environment =
    profile === 'typescript-react-v1' ? caps.typescriptEnvironment : caps.environment;
  if (executionId === 'codex-local-v1')
    return environment && caps.local?.available
      ? {
          ...environment,
          simulated: caps.local.simulated,
          inference: 'local-ollama',
          localRevision: caps.local.configurationRevision,
        }
      : null;
  return environment;
}

export function describeLocalCoding(
  caps: Awaited<ReturnType<RunnerClient['capabilities']>>,
  profile: CodingToolProfile = 'node-isolated-v1',
  readOnly = false,
): ExecutionOption {
  const environment = codingEnvironment(caps, profile, 'codex-local-v1');
  const local = caps.local;
  const reason =
    caps.reason ??
    (!environment ? 'provider_unavailable' : local?.available ? null : 'no_allowed_models');
  return {
    ...describeCoding(caps, profile),
    id: 'codex-local-v1',
    provider: 'ollama',
    destination: !local ? 'unknown' : local.simulated ? 'simulated' : 'local-ollama',
    toolProfile: readOnly ? 'node-readonly-v1' : profile,
    available: !!environment && !!local?.available,
    reason: local?.reason === 'local_server_incompatible' ? 'local_server_incompatible' : reason,
    simulated: local?.simulated ?? null,
    models: local?.models ?? [],
    configurationRevision: environment
      ? createHash('sha256')
          .update(JSON.stringify({ environment, models: local?.models, readOnly }))
          .digest('hex')
      : null,
    capabilities: {
      text: 'supported',
      streaming: 'supported',
      toolCalls: 'supported',
      workspaceWrite: readOnly ? 'unsupported' : 'supported',
      structuredOutput: 'unsupported',
      cancellation: 'supported',
      usage: 'unknown',
    },
  };
}

export function describeReadOnlyCoding(
  caps: Awaited<ReturnType<RunnerClient['capabilities']>>,
): ExecutionOption {
  const option = describeCoding(caps);
  const confirmed = caps.environment?.readOnlyWorkspace === 'mount-v1';
  return {
    ...option,
    toolProfile: 'node-readonly-v1',
    available: option.available && confirmed,
    reason: option.reason ?? (confirmed ? null : 'runner_unavailable'),
    configurationRevision: option.configurationRevision
      ? createHash('sha256')
          .update(option.configurationRevision + '/node-readonly-v1')
          .digest('hex')
      : null,
    capabilities: { ...option.capabilities, workspaceWrite: 'unsupported' },
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
