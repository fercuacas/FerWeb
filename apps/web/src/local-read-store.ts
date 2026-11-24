import { executionOptionSchema, localReadResponse } from '@ferweb/contracts';
import type { ExecutionOption } from '@ferweb/contracts';
import { z } from 'zod';
import { workspaceApi } from './workspace-store';
export const localReadApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    localCapabilities: b.query<{ execution: ExecutionOption }, string>({
      query: (project) => `/projects/${project}/local-read/capabilities`,
      transformResponse: (data) => z.object({ execution: executionOptionSchema }).parse(data),
      keepUnusedDataFor: 0,
    }),
    localReport: b.query<z.infer<typeof localReadResponse>, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/local-read/${id}`,
      transformResponse: (data) => localReadResponse.parse(data),
      keepUnusedDataFor: 0,
    }),
  }),
});
