import type { z } from 'zod';
import { jobListSchema, jobDetailSchema, jobEventsSchema, type jobInput } from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';
export const jobsApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    jobs: b.query<z.infer<typeof jobListSchema>, string>({
      query: (p) => `/projects/${p}/jobs`,
      transformResponse: (d) => jobListSchema.parse(d),
      providesTags: ['Job'],
      keepUnusedDataFor: 0,
    }),
    job: b.query<z.infer<typeof jobDetailSchema>, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/jobs/${id}`,
      transformResponse: (d) => jobDetailSchema.parse(d),
      providesTags: ['Job'],
      keepUnusedDataFor: 0,
    }),
    jobEvents: b.query<
      z.infer<typeof jobEventsSchema>,
      { project: string; id: string; after: number }
    >({
      query: ({ project, id, after }) => ({
        url: `/projects/${project}/jobs/${id}/events`,
        params: { after },
      }),
      transformResponse: (d) => jobEventsSchema.parse(d),
      keepUnusedDataFor: 0,
    }),
    enqueueJob: b.mutation<
      z.infer<typeof jobDetailSchema>,
      { project: string; body: z.infer<typeof jobInput> }
    >({
      query: ({ project, body }) => ({ url: `/projects/${project}/jobs`, method: 'POST', body }),
      transformResponse: (d) => jobDetailSchema.parse(d),
      invalidatesTags: ['Job'],
    }),
    cancelJob: b.mutation<z.infer<typeof jobDetailSchema>, { project: string; id: string }>({
      query: ({ project, id }) => ({
        url: `/projects/${project}/jobs/${id}/cancel`,
        method: 'POST',
        body: {},
      }),
      transformResponse: (d) => jobDetailSchema.parse(d),
      invalidatesTags: ['Job'],
    }),
  }),
});
