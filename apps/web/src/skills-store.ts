import {
  skillResponse,
  skillsResponse,
  type skillImportInput,
  type skillReviewInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';

const path = (project: string) => `/projects/${project}/skills`;
const tags = (project: string) => [{ type: 'Skill' as const, id: project }];
type Scope = { project: string; id: string };

export const skillsApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    skills: b.query<z.infer<typeof skillsResponse>, string>({
      query: path,
      transformResponse: (value) => skillsResponse.parse(value),
      providesTags: (_data, _error, project) => tags(project),
      keepUnusedDataFor: 0,
    }),
    skill: b.query<z.infer<typeof skillResponse>, Scope>({
      query: ({ project, id }) => `${path(project)}/${id}`,
      transformResponse: (value) => skillResponse.parse(value),
      providesTags: (_data, _error, { project }) => tags(project),
      keepUnusedDataFor: 0,
    }),
    importSkill: b.mutation<
      z.infer<typeof skillResponse>,
      { project: string; body: z.infer<typeof skillImportInput> }
    >({
      query: ({ project, body }) => ({ url: path(project), method: 'POST', body }),
      transformResponse: (value) => skillResponse.parse(value),
      invalidatesTags: (_data, _error, { project }) => tags(project),
    }),
    reviewSkill: b.mutation<
      z.infer<typeof skillResponse>,
      Scope & { body: z.infer<typeof skillReviewInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `${path(project)}/${id}/review`,
        method: 'POST',
        body,
      }),
      transformResponse: (value) => skillResponse.parse(value),
      invalidatesTags: (_data, _error, { project }) => tags(project),
    }),
  }),
});
