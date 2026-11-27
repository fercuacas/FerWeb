import { z } from 'zod';
import { recipeDefinition, utilityFamily } from './recipes.js';

export const utilityMode = z.enum(['content', 'workflow', 'tool', 'external']);
export const utilityStatus = z.enum(['catalogued', 'reviewed', 'workflow', 'pending']);
const commit = z.string().regex(/^[0-9a-f]{40}$/);
const version = z.number().int().positive();
export const utilityQuery = z.strictObject({
  q: z.string().trim().max(100).default(''),
  family: utilityFamily.optional(),
  mode: utilityMode.optional(),
  status: utilityStatus.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const utilityRecipe = recipeDefinition.pick({
  key: true,
  label: true,
  version: true,
  mode: true,
  role: true,
  output: true,
});
export const utilityEntry = z.object({
  path: z.string(),
  title: z.string(),
  family: utilityFamily,
  mode: utilityMode,
  status: utilityStatus,
  license: z.string(),
  input: z.string(),
  output: z.string(),
  capabilities: z.array(z.string()),
  providers: z.array(z.enum(['none', 'openai-api', 'local-text'])),
  destinations: z.array(z.enum(['project-local', 'configured-api', 'configured-local'])),
  requirements: z.array(z.string()),
  recipe: utilityRecipe.nullable(),
  curated: z.string().nullable(),
  resources: z.array(z.object({ path: z.string(), gitObject: commit })),
});
export const utilityCatalog = z.object({
  source: z.object({
    repository: z.literal('affaan-m/ECC'),
    commit,
    version: z.string(),
    license: z.literal('MIT'),
    notice: z.string(),
  }),
  inventoryTotal: version,
  total: z.number().int().nonnegative(),
  page: version,
  pageSize: version,
  packages: z.array(
    z.object({
      family: utilityFamily,
      title: z.string(),
      version,
      recipes: z.array(utilityRecipe).min(1),
    }),
  ),
  entries: z.array(utilityEntry),
});
export type UtilityCatalog = z.infer<typeof utilityCatalog>;
export type UtilityEntry = z.infer<typeof utilityEntry>;
export type UtilityQuery = z.input<typeof utilityQuery>;
