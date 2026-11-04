import {
  agentMutationResponse,
  agentResponse,
  agentsResponse,
  type createAgentInput,
  type updateAgentInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';

const catalog = (project: string) => `/projects/${project}/agents`;
type Scope = { project: string; id: string };
export const agentsApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    agents: b.query<z.infer<typeof agentsResponse>, string>({
      query: catalog,
      transformResponse: (data) => agentsResponse.parse(data),
      providesTags: (_data, _error, project) => [{ type: 'Agent', id: project }],
      keepUnusedDataFor: 0,
    }),
    agent: b.query<z.infer<typeof agentResponse>, Scope>({
      query: ({ project, id }) => `${catalog(project)}/${id}`,
      transformResponse: (data) => agentResponse.parse(data),
      providesTags: (_data, _error, { project }) => [{ type: 'Agent', id: project }],
      keepUnusedDataFor: 0,
    }),
    createAgent: b.mutation<
      z.infer<typeof agentMutationResponse>,
      { project: string; body: z.infer<typeof createAgentInput> }
    >({
      query: ({ project, body }) => ({ url: catalog(project), method: 'POST', body }),
      transformResponse: (data) => agentMutationResponse.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'Agent', id: project }],
    }),
    updateAgent: b.mutation<
      z.infer<typeof agentMutationResponse>,
      Scope & { body: z.infer<typeof updateAgentInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `${catalog(project)}/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (data) => agentMutationResponse.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'Agent', id: project }],
    }),
    archiveAgent: b.mutation<z.infer<typeof agentMutationResponse>, Scope & { version: number }>({
      query: ({ project, id, version }) => ({
        url: `${catalog(project)}/${id}/archive`,
        method: 'POST',
        body: { version },
      }),
      transformResponse: (data) => agentMutationResponse.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'Agent', id: project }],
    }),
  }),
});
