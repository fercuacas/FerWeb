import { z } from 'zod';
export * from './memory.js';
export * from './context-packs.js';
export * from './retrieval.js';
export * from './laboratory.js';
export * from './jobs.js';
export * from './coding.js';
export * from './agents.js';
export * from './skills.js';
export * from './usage.js';
export * from './teams.js';
export * from './execution.js';
export * from './review.js';
export * from './context-strategies.js';
export * from './github.js';
export * from './chat.js';

export const readinessSchema = z.object({
  service: z.literal('ferweb-api'),
  status: z.enum(['ready', 'unavailable']),
  checkedAt: z.iso.datetime(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({
    database: z.enum(['ready', 'unavailable']),
    migrations: z.enum(['ready', 'pending', 'unavailable']),
    appliedMigrations: z.number().int().nonnegative().nullable(),
    requiredMigrations: z.number().int().nonnegative(),
  }),
  installation: z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).nullable(),
});

export type Readiness = z.infer<typeof readinessSchema>;

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const ownerInputSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(12).max(128),
});
export const loginInputSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const userSchema = z.object({ id: z.uuid(), email: emailSchema });
export const sessionSchema = z.object({ user: userSchema.nullable() });
export type User = z.infer<typeof userSchema>;

const name = z.string().trim().min(1, 'Escribe un nombre.').max(120);
const description = z.string().trim().max(4000);
export const projectInputSchema = z.strictObject({ name, description });
export const projectPatchSchema = z
  .strictObject({
    name: name.optional(),
    description: description.optional(),
    archived: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.archived !== undefined,
    'Indica un cambio.',
  );
export const projectSchema = z.object({
  id: z.uuid(),
  name,
  description,
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int().positive(),
});
export const projectsSchema = z.object({ projects: z.array(projectSchema) });
export const projectResponseSchema = z.object({ project: projectSchema });
export type Project = z.infer<typeof projectSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const taskInputSchema = z.strictObject({
  title: z.string().trim().min(1, 'Escribe un título.').max(160),
  description: z.string().trim().max(10000),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(30),
});
export const taskPatchSchema = taskInputSchema.extend({ version: z.number().int().positive() });
export const taskSchema = taskInputSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int().positive(),
});
export const tasksSchema = z.object({ tasks: z.array(taskSchema) });
export const taskResponseSchema = z.object({ task: taskSchema });
export const taskFilterSchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
});
export type Task = z.infer<typeof taskSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;
export type TaskFilters = z.infer<typeof taskFilterSchema>;
