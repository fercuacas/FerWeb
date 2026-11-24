import {
  taskCoordinationGraph,
  gitHubWorkResponse,
  gitHubIssueAction,
  gitHubIssueActionResponse,
  type taskCoordinationInput,
  type linkGitHubWorkInput,
  type prepareGitHubIssueInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';
type Scope = { project: string; id: string };
export const coordinationApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    coordination: b.query<z.infer<typeof taskCoordinationGraph>, string>({
      query: (project) => `/projects/${project}/coordination`,
      transformResponse: (data) => taskCoordinationGraph.parse(data),
      providesTags: ['Coordination', 'Task', 'TeamExecution', 'Job'],
      keepUnusedDataFor: 0,
    }),
    saveCoordination: b.mutation<
      z.infer<typeof taskCoordinationGraph>,
      Scope & { body: z.infer<typeof taskCoordinationInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `/projects/${project}/tasks/${id}/coordination`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (data) => taskCoordinationGraph.parse(data),
      invalidatesTags: ['Coordination', 'Task', 'TeamPlan', 'Recipe'],
    }),
    githubWork: b.query<z.infer<typeof gitHubWorkResponse>, string>({
      query: (project) => `/projects/${project}/github/work`,
      transformResponse: (data) => gitHubWorkResponse.parse(data),
      providesTags: ['Coordination', 'GitHub'],
      keepUnusedDataFor: 0,
    }),
    linkWork: b.mutation<
      z.infer<typeof gitHubWorkResponse>,
      { project: string; body: z.infer<typeof linkGitHubWorkInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/github/work/link`,
        method: 'POST',
        body,
      }),
      transformResponse: (data) => gitHubWorkResponse.parse(data),
      invalidatesTags: ['Coordination'],
    }),
    prepareIssue: b.mutation<
      { action: z.infer<typeof gitHubIssueAction> },
      { project: string; body: z.infer<typeof prepareGitHubIssueInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/github/work/issues/prepare`,
        method: 'POST',
        body,
        timeout: 30000,
      }),
      transformResponse: (data) => gitHubIssueActionResponse.parse(data),
      invalidatesTags: ['Coordination'],
    }),
    issueAction: b.query<{ action: z.infer<typeof gitHubIssueAction> }, Scope>({
      query: ({ project, id }) => `/projects/${project}/github/work/actions/${id}`,
      transformResponse: (data) => gitHubIssueActionResponse.parse(data),
      providesTags: ['Coordination', 'GitHub'],
      keepUnusedDataFor: 0,
    }),
    executeIssue: b.mutation<
      { action: z.infer<typeof gitHubIssueAction> },
      Scope & { hash: string }
    >({
      query: ({ project, id, hash }) => ({
        url: `/projects/${project}/github/work/actions/${id}/execute`,
        method: 'POST',
        body: { hash },
        timeout: 30000,
      }),
      transformResponse: (data) => gitHubIssueActionResponse.parse(data),
      invalidatesTags: ['Coordination', 'GitHub'],
    }),
    reconcileIssue: b.mutation<
      { action: z.infer<typeof gitHubIssueAction> },
      Scope & { hash: string }
    >({
      query: ({ project, id, hash }) => ({
        url: `/projects/${project}/github/work/actions/${id}/reconcile`,
        method: 'POST',
        body: { hash },
        timeout: 60000,
      }),
      transformResponse: (data) => gitHubIssueActionResponse.parse(data),
      invalidatesTags: ['Coordination', 'GitHub'],
    }),
  }),
});
