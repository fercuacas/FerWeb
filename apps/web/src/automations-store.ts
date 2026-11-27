import {
  automationOverview,
  automationSchedule,
  type AutomationAction,
  type AutomationCreate,
  type AutomationOverview,
  type AutomationSchedule,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';

const path = (id: string) => `/projects/${id}/automations`;
const tags = (id: string) => [{ type: 'Automation' as const, id }];
type Target = { project: string; id: string };

export const automationsApi = workspaceApi.injectEndpoints({
  endpoints: (builder) => ({
    automations: builder.query<AutomationOverview, string>({
      query: path,
      transformResponse: (body) => automationOverview.parse(body),
      providesTags: (_data, _error, project) => tags(project),
      keepUnusedDataFor: 0,
    }),
    createAutomation: builder.mutation<
      AutomationSchedule,
      { project: string; body: AutomationCreate }
    >({
      query: ({ project, body }) => ({ url: path(project), method: 'POST', body }),
      transformResponse: (body) => automationSchedule.parse(body),
      invalidatesTags: (_data, _error, { project }) => tags(project),
    }),
    automationAction: builder.mutation<AutomationSchedule, Target & { body: AutomationAction }>({
      query: ({ project, id, body }) => ({
        url: `${path(project)}/${id}/actions`,
        method: 'POST',
        body,
      }),
      transformResponse: (body) => automationSchedule.parse(body),
      invalidatesTags: (_data, _error, { project }) => tags(project),
    }),
    markAutomationRead: builder.mutation<{ read: true }, Target>({
      query: ({ project, id }) => ({
        url: `${path(project)}/notifications/${encodeURIComponent(id)}/read`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: (_data, _error, { project }) => tags(project),
    }),
  }),
});
