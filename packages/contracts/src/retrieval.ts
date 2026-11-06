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
  strategy: z.enum(['none', 'vector', 'lexical']),
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
export const contextCatalog = z.object({
  protocol: z.literal('ferweb-catalog-v1'),
  projectId: z.uuid(),
  repositoryId: z.number(),
  repository: z.string(),
  commit: z.string(),
  linkVersion: z.number(),
  embeddingSpace: z.string(),
  embeddingIdentity: z.string().nullable(),
  embeddingSimulated: z.boolean(),
  partial: z.boolean(),
  fingerprint: z.string(),
  documents: z
    .array(
      z.object({
        path: z.string(),
        kind: z.string(),
        fingerprint: z.string(),
        commit: z.string(),
        chunks: z
          .array(
            z.object({
              id: z.uuid(),
              startLine: z.number(),
              endLine: z.number(),
              hash: z.string(),
              content: z.string().max(2500).optional(),
            }),
          )
          .max(100),
      }),
    )
    .max(200),
});

export const hybridHit = z.object({
  source: sourceSchema,
  reason: z.array(
    z.enum(['exact_path', 'exact_identifier', 'exact_text', 'lexical', 'ngrams', 'vector']),
  ),
  lexicalRank: z.number().int().nullable(),
  vectorRank: z.number().int().nullable(),
  fusionScore: z.number().finite(),
});
export const hybridResponse = z.object({
  sources: z.array(sourceSchema).max(12),
  hits: z.array(hybridHit).max(12),
  insufficient: z.boolean(),
  strategy: z.enum(['hybrid-rrf-v1', 'lexical-v1', 'vector-v1']),
  fallback: z.string().nullable(),
  embeddingUsed: z.boolean(),
  simulated: z.boolean(),
  elapsedMs: z.number().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  partial: z.boolean(),
});
