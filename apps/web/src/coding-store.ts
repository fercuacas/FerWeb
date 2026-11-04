import {
  codingCapabilitiesResponse,
  codingRunSchema,
  jobDetailSchema,
  type codingInput,
  codingComparisons,
  reviewResponse,
  type reviewInput,
  type repeatCodingInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';
export const codingApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    codingReview: b.query<z.infer<typeof reviewResponse>, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/coding/${id}/review`,
      transformResponse: (d) => reviewResponse.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['Job'],
    }),
    saveCodingReview: b.mutation<
      z.infer<typeof reviewResponse>,
      { project: string; id: string; body: z.infer<typeof reviewInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `/projects/${project}/coding/${id}/review`,
        method: 'PUT',
        body,
      }),
      transformResponse: (d) => reviewResponse.parse(d),
      invalidatesTags: ['Job'],
    }),
    publishCodingReview: b.mutation<
      z.infer<typeof reviewResponse>,
      { project: string; id: string; version: number }
    >({
      query: ({ project, id, version }) => ({
        url: `/projects/${project}/coding/${id}/review/publish`,
        method: 'POST',
        body: { version },
        timeout: 120000,
      }),
      transformResponse: (d) => reviewResponse.parse(d),
      invalidatesTags: ['Job'],
    }),
    codingComparisons: b.query<z.infer<typeof codingComparisons>, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/coding/${id}/comparisons`,
      transformResponse: (d) => codingComparisons.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['Job'],
    }),
    repeatCoding: b.mutation<
      z.infer<typeof jobDetailSchema>,
      { project: string; id: string; body: z.infer<typeof repeatCodingInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `/projects/${project}/coding/${id}/repeat`,
        method: 'POST',
        body,
      }),
      transformResponse: (d) => jobDetailSchema.parse(d),
      invalidatesTags: ['Job'],
    }),
    codingCapabilities: b.query<z.infer<typeof codingCapabilitiesResponse>, string>({
      query: (p) => `/projects/${p}/coding/capabilities`,
      transformResponse: (d) => codingCapabilitiesResponse.parse(d),
      keepUnusedDataFor: 0,
    }),
    codingRun: b.query<z.infer<typeof codingRunSchema>, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/coding/${id}`,
      transformResponse: (d) => codingRunSchema.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['Job'],
    }),
    startCoding: b.mutation<
      z.infer<typeof jobDetailSchema>,
      { project: string; body: z.infer<typeof codingInput> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/coding`,
        method: 'POST',
        body,
        timeout: 120000,
      }),
      transformResponse: (d) => jobDetailSchema.parse(d),
      invalidatesTags: ['Job'],
    }),
  }),
});
