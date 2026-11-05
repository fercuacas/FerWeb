import {
  teamTemplatesResponse,
  teamTemplateResponse,
  teamPlanResponse,
  teamPlansResponse,
  type createTeamTemplateInput,
  type updateTeamTemplateInput,
  type prepareTeamPlanInput,
  type approveTeamPlanInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';

type Scope = { project: string; id: string };
const templates = (project: string) => `/projects/${project}/team-templates`;
const plans = (project: string) => `/projects/${project}/team-plans`;
const mutation = teamTemplateResponse.pick({ template: true });
export const teamsApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    teamTemplates: b.query<z.infer<typeof teamTemplatesResponse>, string>({
      query: templates,
      transformResponse: (data) => teamTemplatesResponse.parse(data),
      providesTags: (_data, _error, project) => [{ type: 'TeamTemplate', id: project }],
      keepUnusedDataFor: 0,
    }),
    teamTemplate: b.query<z.infer<typeof teamTemplateResponse>, Scope>({
      query: ({ project, id }) => `${templates(project)}/${id}`,
      transformResponse: (data) => teamTemplateResponse.parse(data),
      providesTags: (_data, _error, { project }) => [{ type: 'TeamTemplate', id: project }],
      keepUnusedDataFor: 0,
    }),
    createTeamTemplate: b.mutation<
      z.infer<typeof mutation>,
      { project: string; body: z.infer<typeof createTeamTemplateInput> }
    >({
      query: ({ project, body }) => ({ url: templates(project), method: 'POST', body }),
      transformResponse: (data) => mutation.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'TeamTemplate', id: project }],
    }),
    updateTeamTemplate: b.mutation<
      z.infer<typeof mutation>,
      Scope & { body: z.infer<typeof updateTeamTemplateInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `${templates(project)}/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (data) => mutation.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'TeamTemplate', id: project }],
    }),
    archiveTeamTemplate: b.mutation<{ archived: boolean }, Scope & { version: number }>({
      query: ({ project, id, version }) => ({
        url: `${templates(project)}/${id}/archive`,
        method: 'POST',
        body: { version },
      }),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'TeamTemplate', id: project }],
    }),
    teamPlans: b.query<z.infer<typeof teamPlansResponse>, string>({
      query: plans,
      transformResponse: (data) => teamPlansResponse.parse(data),
      providesTags: (_data, _error, project) => [{ type: 'TeamPlan', id: project }],
      keepUnusedDataFor: 0,
    }),
    teamPlan: b.query<z.infer<typeof teamPlanResponse>, Scope>({
      query: ({ project, id }) => `${plans(project)}/${id}`,
      transformResponse: (data) => teamPlanResponse.parse(data),
      providesTags: (_data, _error, { project }) => [{ type: 'TeamPlan', id: project }],
      keepUnusedDataFor: 0,
    }),
    prepareTeamPlan: b.mutation<
      z.infer<typeof teamPlanResponse>,
      { project: string; body: z.infer<typeof prepareTeamPlanInput> }
    >({
      query: ({ project, body }) => ({ url: plans(project), method: 'POST', body }),
      transformResponse: (data) => teamPlanResponse.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'TeamPlan', id: project }],
    }),
    approveTeamPlan: b.mutation<
      z.infer<typeof teamPlanResponse>,
      Scope & { body: z.infer<typeof approveTeamPlanInput> }
    >({
      query: ({ project, id, body }) => ({
        url: `${plans(project)}/${id}/approve`,
        method: 'POST',
        body,
      }),
      transformResponse: (data) => teamPlanResponse.parse(data),
      invalidatesTags: (_data, _error, { project }) => [{ type: 'TeamPlan', id: project }],
    }),
  }),
});
