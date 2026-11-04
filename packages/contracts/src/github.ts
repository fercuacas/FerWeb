import { z } from 'zod';

export const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const githubSha = z.string().regex(/^[a-f0-9]{40}$/);
export const githubPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes('\0') &&
      path.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
export const githubRepositorySchema = z.object({
  id: githubId,
  fullName: z.string(),
  name: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  description: z.string().nullable(),
});
export const githubInstallationSchema = z.object({
  id: githubId,
  account: z.string(),
  connected: z.boolean(),
});
export const githubItemSchema = z.object({
  number: githubId,
  title: z.string(),
  body: z.string(),
  state: z.string(),
  updatedAt: z.string(),
  url: z.url(),
  head: githubSha.optional(),
  base: githubSha.optional(),
});
export const githubEntrySchema = z.object({
  path: githubPath,
  sha: githubSha,
  type: z.enum(['blob', 'tree', 'commit']),
  mode: z.string(),
  size: z.number().nonnegative().nullable(),
});
export const githubSnapshotSchema = z.object({
  repository: githubRepositorySchema,
  branch: z.string(),
  commit: githubSha,
  tree: z.array(githubEntrySchema).max(5000),
  treeTruncated: z.boolean(),
  issues: z.array(githubItemSchema),
  pullRequests: z.array(githubItemSchema),
  issuesTruncated: z.boolean(),
  pullRequestsTruncated: z.boolean(),
  observedAt: z.iso.datetime(),
});
export const githubLinkSchema = z.object({
  installationId: githubId,
  repositoryId: githubId,
  fullName: z.string(),
  branch: z.string(),
  version: z.number().int().positive(),
  stale: z.boolean(),
  revoked: z.boolean(),
  syncedAt: z.iso.datetime().nullable(),
  snapshot: githubSnapshotSchema.nullable(),
});
export const githubLinkInput = z.strictObject({
  installationId: githubId,
  repositoryId: githubId,
  branch: z.string().trim().min(1).max(250).optional(),
  version: z.number().int().nonnegative(),
});
export const githubLinkResponse = z.object({ link: githubLinkSchema.nullable() });
export const githubStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  login: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  installUrl: z.url().nullable(),
});
export const githubInstallationsResponse = z.object({
  installations: z.array(githubInstallationSchema),
});
export const githubRepositoriesResponse = z.object({
  repositories: z.array(githubRepositorySchema),
  nextPage: z.number().int().positive().nullable(),
});
export const githubFileResponse = z.object({
  path: githubPath,
  commit: githubSha,
  sha: githubSha,
  content: z.string().max(1_000_000),
  stale: z.boolean(),
});
export type GitHubSnapshot = z.infer<typeof githubSnapshotSchema>;
export type GitHubLink = z.infer<typeof githubLinkSchema>;
