import { z } from 'zod';
import { executionOptionSchema, type ExecutionOption } from './execution.js';

export const agentCapability = executionOptionSchema.shape.capabilities.keyof();
export const agentToolProfile = executionOptionSchema.shape.toolProfile;
const version = z.number().int().positive().max(2_147_483_647);
export const agentSelection = z.strictObject({ id: z.uuid(), version });
export const agentDefinition = z.strictObject({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(1000),
  instructions: z.string().trim().min(1).max(8000),
  outputFormat: z.string().trim().min(1).max(2000),
  requiredCapabilities: z.array(agentCapability).min(1).max(agentCapability.options.length),
  allowedToolProfiles: z.array(agentToolProfile).min(1).max(agentToolProfile.options.length),
});
export const agentTemplateId = z.enum([
  'explorer',
  'planner',
  'implementer',
  'reviewer',
  'security',
  'tester',
]);
const agentOrigin = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('custom') }),
  z.strictObject({
    kind: z.literal('template'),
    template: agentTemplateId,
    revision: version,
    reference: z.url(),
  }),
]);
export const agentSnapshot = agentDefinition.extend({
  ...agentSelection.shape,
  origin: agentOrigin,
});
export const agentRole = z.object({
  id: z.uuid(),
  archivedAt: z.iso.datetime().nullable(),
  latest: agentSnapshot,
});
export const agentTemplate = z.object({ id: agentTemplateId, definition: agentDefinition });
export const agentsResponse = z.object({
  roles: z.array(agentRole),
  templates: z.array(agentTemplate),
});
export const agentResponse = z.object({ role: agentRole, versions: z.array(agentSnapshot) });
export const agentMutationResponse = z.object({ role: agentRole });
export const createAgentInput = z.union([
  agentDefinition,
  z.strictObject({ template: agentTemplateId }),
]);
export const updateAgentInput = z.strictObject({ version, definition: agentDefinition });
export const archiveAgentInput = z.strictObject({ version });
export type AgentDefinition = z.infer<typeof agentDefinition>;
export type AgentRole = z.infer<typeof agentRole>;
export type AgentSnapshot = z.infer<typeof agentSnapshot>;
export type AgentTemplate = z.infer<typeof agentTemplate>;

export function supportsAgent(
  agent: Pick<AgentDefinition, 'allowedToolProfiles' | 'requiredCapabilities'>,
  option: ExecutionOption,
) {
  return (
    option.available &&
    agent.allowedToolProfiles.includes(option.toolProfile) &&
    agent.requiredCapabilities.every(
      (capability) => option.capabilities[capability] === 'supported',
    )
  );
}
