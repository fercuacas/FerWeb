import type { Claim } from './queue.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = (value: unknown) =>
  typeof value === 'string' && value.length === 36 && uuid.test(value) ? value : null;

export function attemptFields(claim: Claim) {
  const runtime =
    claim.kind === 'simulation-v1'
      ? 'simulator'
      : claim.kind === 'local-readonly-v1'
        ? 'ollama_read'
        : 'executionId' in claim.configuration &&
            claim.configuration.executionId === 'codex-local-v1'
          ? 'codex_local'
          : 'codex_api';
  const { parent, step, agent, version } = claim.correlation ?? {};
  const agentVersion =
    typeof version === 'string' && /^[1-9]\d{0,7}$/.test(version) ? Number(version) : null;
  return {
    jobId: identifier(claim.id),
    executorId: identifier(claim.executor_id),
    attempt: claim.attempt,
    runtime,
    teamId: identifier(parent),
    teamStepId: identifier(step),
    agentId: identifier(agent),
    agentVersion,
  };
}
