import { z } from 'zod';
import { githubId, githubItemSchema } from './github.js';
const version = z.number().int().positive().max(2147483647);
const text = z.string().regex(/^[^\u0000\uD800-\uDFFF]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const taskCoordinationInput = z.strictObject({
  version,
  kind: z.enum(['task', 'epic']),
  parentEpicId: z.uuid().nullable(),
  dependsOn: z.array(z.uuid()).max(20),
  blocker: text.trim().min(1).max(500).nullable(),
  claim: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('owner') }),
    z.strictObject({ kind: z.literal('team'), templateId: z.uuid(), templateVersion: version }),
  ]),
});
export const taskCoordinationGraph = z.object({
  tasks: z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        status: z.enum(['todo', 'in_progress', 'done']),
        version,
        kind: z.enum(['task', 'epic']),
        parentEpicId: z.uuid().nullable(),
        dependsOn: z.array(z.uuid()).max(20),
        blocker: z.string().nullable(),
        blockedBy: z.array(z.uuid()),
        claim: z.object({
          owner: z.string().nullable(),
          templateId: z.uuid().nullable(),
          templateVersion: version.nullable(),
          name: z.string().nullable(),
        }),
      }),
    )
    .max(1000),
  executions: z
    .array(
      z.object({
        id: z.uuid(),
        taskId: z.uuid(),
        kind: z.enum(['coding', 'team']),
        state: z.string(),
        title: z.string(),
      }),
    )
    .max(200),
});
export const linkGitHubWorkInput = z.strictObject({
  taskId: z.uuid(),
  taskVersion: version,
  linkVersion: version,
  kind: z.enum(['issue', 'pull']),
  itemId: githubId,
});
export const prepareGitHubIssueInput = z.strictObject({
  requestId: z.uuid(),
  taskId: z.uuid(),
  taskVersion: version,
  linkVersion: version,
  title: text.trim().min(1).max(200),
  body: text.max(19000),
});
export const gitHubIssueAction = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  hash,
  state: z.enum(['prepared', 'sending', 'uncertain', 'published']),
  snapshot: z.object({
    version: z.literal(1),
    taskVersion: version,
    repositoryId: githubId,
    repository: z.string(),
    linkVersion: version,
    authorId: githubId,
    title: z.string(),
    body: z.string(),
  }),
  item: githubItemSchema.nullable(),
  errorCode: z.string().nullable(),
  conditionsCurrent: z.boolean(),
});
export const gitHubIssueActionInput = z.strictObject({ hash });
export const gitHubIssueActionResponse = z.object({ action: gitHubIssueAction });
export const gitHubWorkResponse = z.object({
  repositoryId: githubId,
  linkVersion: version,
  stale: z.boolean(),
  links: z
    .array(
      z.object({
        id: z.uuid(),
        taskId: z.uuid(),
        kind: z.enum(['issue', 'pull']),
        itemId: githubId,
        number: githubId,
        origin: z.enum(['linked', 'created']),
        observation: githubItemSchema.nullable(),
        observedAt: z.iso.datetime().nullable(),
        state: z.enum(['present', 'missing', 'unconfirmed']),
      }),
    )
    .max(1000),
  publications: z
    .array(
      z.object({
        jobId: z.uuid(),
        taskId: z.uuid(),
        number: githubId,
        url: z.url(),
        reportHash: hash,
      }),
    )
    .max(100),
  actions: z.array(gitHubIssueAction).max(100),
});
