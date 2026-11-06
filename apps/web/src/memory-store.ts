import { z } from 'zod';
import {
  memoryMutation,
  memoryCorrection,
  memoryReadResponse,
  memoryWriteResponse,
  memorySearchInput,
  memorySearchResponse,
  memoryHistoryResponse,
  memoryImportInput,
  memoryImportResponse,
  memoryExportInput,
  memoryExportResponse,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';
const path = (project: string) => `/projects/${project}/memory`;
export const memoryApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    memorySearch: b.query<
      z.infer<typeof memorySearchResponse>,
      { project: string; body: z.input<typeof memorySearchInput> }
    >({
      query: ({ project, body }) => ({ url: path(project) + '/search', method: 'POST', body }),
      transformResponse: (d) => memorySearchResponse.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['Memory', 'GitHub', 'Task'],
    }),
    memoryRead: b.query<
      z.infer<typeof memoryReadResponse>,
      { project: string; id: string; revision?: number }
    >({
      query: ({ project, id, revision }) => ({
        url: path(project) + '/' + id,
        params: revision ? { revision } : undefined,
      }),
      transformResponse: (d) => memoryReadResponse.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['Memory', 'GitHub', 'Task'],
    }),
    memoryHistory: b.query<z.infer<typeof memoryHistoryResponse>, { project: string; id: string }>({
      query: ({ project, id }) => path(project) + '/' + id + '/history',
      transformResponse: (d) => memoryHistoryResponse.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['Memory', 'GitHub', 'Task'],
    }),
    memoryCreate: b.mutation<
      z.infer<typeof memoryWriteResponse>,
      { project: string; body: z.infer<typeof memoryMutation> }
    >({
      query: ({ project, body }) => ({ url: path(project), method: 'POST', body }),
      transformResponse: (d) => memoryWriteResponse.parse(d),
      invalidatesTags: ['Memory'],
    }),
    memoryCorrect: b.mutation<
      z.infer<typeof memoryWriteResponse>,
      { project: string; id: string; body: z.infer<typeof memoryCorrection> }
    >({
      query: ({ project, id, body }) => ({ url: path(project) + '/' + id, method: 'PUT', body }),
      transformResponse: (d) => memoryWriteResponse.parse(d),
      invalidatesTags: ['Memory', 'Job', 'TeamPlan', 'TeamExecution'],
    }),
    memoryImport: b.mutation<
      z.infer<typeof memoryImportResponse>,
      { project: string; body: z.infer<typeof memoryImportInput> }
    >({
      query: ({ project, body }) => ({ url: path(project) + '/import', method: 'POST', body }),
      transformResponse: (d) => memoryImportResponse.parse(d),
      invalidatesTags: ['Memory'],
    }),
    memoryExport: b.mutation<
      z.infer<typeof memoryExportResponse>,
      { project: string; body: z.infer<typeof memoryExportInput> }
    >({
      query: ({ project, body }) => ({ url: path(project) + '/export', method: 'POST', body }),
      transformResponse: (d) => memoryExportResponse.parse(d),
    }),
  }),
});
