import type { z } from 'zod';
import {
  labOverviewSchema,
  labBatchResponse,
  labCaseSchema,
  tariffSchema,
  type labCaseInput,
  type tariffInput,
  type labBatchInput,
  type labReviewInput,
  contextComparisonResponse,
  contextPolicyResponse,
  type contextAdoptionInput,
  agentEvaluation,
  agentEvaluationList,
  type AgentEvaluation,
  type AgentEvaluationInput,
  type agentEvaluationReviewInput,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';
export const labApi = workspaceApi.injectEndpoints({
  endpoints: (builder) => ({
    agentEvaluations: builder.query<z.infer<typeof agentEvaluationList>, string>({
      query: (project) => `/projects/${project}/lab/agent-evaluations`,
      transformResponse: (data) => agentEvaluationList.parse(data),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    agentEvaluation: builder.query<AgentEvaluation, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/lab/agent-evaluations/${id}`,
      transformResponse: (data) => agentEvaluation.parse(data),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    compareAgents: builder.mutation<
      AgentEvaluation,
      { project: string; body: AgentEvaluationInput }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/lab/agent-evaluations`,
        method: 'POST',
        timeout: 90000,
        body,
      }),
      transformResponse: (data) => agentEvaluation.parse(data),
      invalidatesTags: ['Laboratory'],
    }),
    reviewAgentEvaluation: builder.mutation<
      AgentEvaluation,
      {
        project: string;
        id: string;
        body: z.infer<typeof agentEvaluationReviewInput>;
      }
    >({
      query: ({ project, id, body }) => ({
        url: `/projects/${project}/lab/agent-evaluations/${id}/reviews`,
        method: 'POST',
        timeout: 60000,
        body,
      }),
      transformResponse: (data) => agentEvaluation.parse(data),
      invalidatesTags: ['Laboratory'],
    }),
    contextComparison: builder.query<
      z.infer<typeof contextComparisonResponse>,
      { project: string; id: string }
    >({
      query: ({ project, id }) => `/projects/${project}/lab/batches/${id}/context-comparison`,
      transformResponse: (d) => contextComparisonResponse.parse(d),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    contextPolicy: builder.query<z.infer<typeof contextPolicyResponse>, string>({
      query: (p) => `/projects/${p}/lab/context-policy`,
      transformResponse: (d) => contextPolicyResponse.parse(d),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    adoptContext: builder.mutation<
      z.infer<typeof contextPolicyResponse>,
      { project: string; body: z.infer<typeof contextAdoptionInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/lab/context-policy`,
        method: 'POST',
        body,
      }),
      transformResponse: (d) => contextPolicyResponse.parse(d),
      invalidatesTags: ['Laboratory'],
    }),
    resetContext: builder.mutation<
      z.infer<typeof contextPolicyResponse>,
      { project: string; version: number }
    >({
      query: ({ project, version }) => ({
        url: `/projects/${project}/lab/context-policy`,
        method: 'DELETE',
        body: { version },
      }),
      transformResponse: (d) => contextPolicyResponse.parse(d),
      invalidatesTags: ['Laboratory'],
    }),
    labOverview: builder.query<z.infer<typeof labOverviewSchema>, string>({
      query: (p) => `/projects/${p}/lab`,
      transformResponse: (d) => labOverviewSchema.parse(d),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    labBatch: builder.query<z.infer<typeof labBatchResponse>, { project: string; id: string }>({
      query: ({ project, id }) => ({
        url: `/projects/${project}/lab/batches/${id}`,
        timeout: 60000,
      }),
      transformResponse: (d) => labBatchResponse.parse(d),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    labCreateCase: builder.mutation<
      z.infer<typeof labCaseSchema>,
      { project: string; body: z.infer<typeof labCaseInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/lab/cases`,
        method: 'POST',
        body,
        timeout: 90000,
      }),
      transformResponse: (d) => labCaseSchema.parse(d),
      invalidatesTags: ['Laboratory'],
    }),
    labCreateTariff: builder.mutation<
      z.infer<typeof tariffSchema>,
      { project: string; body: z.infer<typeof tariffInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/lab/tariffs`,
        method: 'POST',
        body,
      }),
      transformResponse: (d) => tariffSchema.parse(d),
      invalidatesTags: ['Laboratory'],
    }),
    labCreateBatch: builder.mutation<
      z.infer<typeof labBatchResponse>,
      { project: string; body: z.infer<typeof labBatchInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/lab/batches`,
        method: 'POST',
        body,
        timeout: 180000,
      }),
      transformResponse: (d) => labBatchResponse.parse(d),
      invalidatesTags: ['Laboratory'],
    }),
    labExecute: builder.mutation<{ id: string; status: string }, { project: string; id: string }>({
      query: ({ project, id }) => ({
        url: `/projects/${project}/lab/batches/${id}/execute`,
        method: 'POST',
        body: {},
        timeout: 180000,
      }),
      invalidatesTags: ['Laboratory'],
    }),
    labCancel: builder.mutation<{ id: string; status: string }, { project: string; id: string }>({
      query: ({ project, id }) => ({
        url: `/projects/${project}/lab/batches/${id}/cancel`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['Laboratory'],
    }),
    labReview: builder.mutation<
      z.infer<typeof labBatchResponse>,
      { project: string; batch: string; run: string; body: z.infer<typeof labReviewInput> }
    >({
      query: ({ project, batch, run, body }) => ({
        url: `/projects/${project}/lab/batches/${batch}/runs/${run}/reviews`,
        method: 'POST',
        body,
        timeout: 60000,
      }),
      transformResponse: (d) => labBatchResponse.parse(d),
      invalidatesTags: ['Laboratory'],
    }),
  }),
});
