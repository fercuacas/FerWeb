import { z } from 'zod';
import { agentSelection, agentTemplateId } from './agents.js';
import { codingToolProfile } from './execution.js';

export const recipeKey = z.enum([
  'investigate',
  'plan',
  'feature',
  'fix',
  'review',
  'tests',
  'build',
  'docs',
  'pr-draft',
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const version = z.number().int().positive();
const paths = z
  .array(z.string().trim().min(1).max(220))
  .max(12)
  .refine((list) => new Set(list).size === list.length);
export const recipeReference = z.object({ id: z.uuid(), hash, key: recipeKey, version });
export const recipeDefinition = z.object({
  key: recipeKey,
  version,
  label: z.string(),
  mode: z.enum(['read', 'write', 'plan', 'draft']),
  role: agentTemplateId,
  steps: z.array(z.string()).min(1),
  output: z.string(),
  maxRequests: z.number().int().min(1).max(20),
  timeoutMs: z.number().int().min(10000).max(1200000),
  maxOutputTokens: z.number().int().min(64).max(8192),
});
export const recipeInput = z.strictObject({
  requestId: z.uuid(),
  key: recipeKey,
  version,
  taskVersion: version,
  paths,
  format: z.enum(['steps', 'adr', 'impact']).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  profile: codingToolProfile.optional(),
  agent: agentSelection.optional(),
  sourceJobId: z.uuid().optional(),
});
export const recipeSnapshot = z.object({
  definition: recipeDefinition,
  input: recipeInput.omit({ requestId: true }),
  task: z.object({
    id: z.uuid(),
    version,
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
  }),
  repository: z.string(),
  repositoryId: z.number().int().positive(),
  commit,
  runtimeRevision: z.string().nullable(),
  simulated: z.boolean().nullable(),
  role: z.object({
    purpose: z.string(),
    instructions: z.string(),
    outputFormat: z.string(),
  }),
  source: z.object({ jobId: z.uuid(), artifactHash: hash, paths }).nullable(),
  preview: z.string().nullable(),
});
export const recipePlan = z.object({
  id: z.uuid(),
  hash,
  snapshot: recipeSnapshot,
  jobId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export const recipeOverview = z.object({
  recipes: z.array(recipeDefinition),
  plans: z.array(
    recipePlan.pick({ id: true, createdAt: true, jobId: true }).extend({
      key: recipeKey,
      version,
    }),
  ),
});
export const recipeExecuteInput = z.strictObject({ hash });
export type RecipePlan = z.infer<typeof recipePlan>;
export type RecipeInput = z.infer<typeof recipeInput>;
export type RecipeDefinition = z.infer<typeof recipeDefinition>;
