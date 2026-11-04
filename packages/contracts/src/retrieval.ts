import { z } from 'zod';
export const sourceSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  repositoryId: z.number(),
  repository: z.string(),
  path: z.string(),
  commit: z.string(),
  linkVersion: z.number().int().positive(),
  kind: z.enum(['file', 'issue', 'pull_request']),
  startLine: z.number().int(),
  endLine: z.number().int(),
  observedAt: z.string().nullable(),
  score: z.number().nullable(),
  excerpt: z.string().max(2500),
});
export const retrievalResponse = z.object({
  sources: z.array(sourceSchema),
  insufficient: z.boolean(),
});
export const indexResponse = z.object({
  partial: z.boolean(),
  available: z.boolean(),
  stale: z.boolean(),
  commit: z.string().nullable(),
  indexedAt: z.string().nullable(),
  documents: z.number(),
  chunks: z.number(),
  skipped: z.array(z.string()),
});
export type Source = z.infer<typeof sourceSchema>;
