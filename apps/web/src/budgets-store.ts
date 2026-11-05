import {
  executionBudgetResponse,
  executionBudgetsResponse,
  type executionBudgetInput,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';

export const budgetsApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    budget: b.query<z.infer<typeof executionBudgetResponse>, { project: string; id: string }>({
      query: ({ project, id }) => `/projects/${project}/budgets/${id}`,
      transformResponse: (value) => executionBudgetResponse.parse(value),
      providesTags: ['Budget'],
      keepUnusedDataFor: 0,
    }),
    budgets: b.query<z.infer<typeof executionBudgetsResponse>, string>({
      query: (project) => `/projects/${project}/budgets`,
      transformResponse: (value) => executionBudgetsResponse.parse(value),
      providesTags: ['Budget'],
      keepUnusedDataFor: 0,
    }),
    createBudget: b.mutation<
      z.infer<typeof executionBudgetResponse>,
      { project: string; body: z.infer<typeof executionBudgetInput> }
    >({
      query: ({ project, body }) => ({ url: `/projects/${project}/budgets`, method: 'POST', body }),
      transformResponse: (value) => executionBudgetResponse.parse(value),
      invalidatesTags: ['Budget'],
    }),
    cancelBudget: b.mutation<
      z.infer<typeof executionBudgetResponse>,
      { project: string; id: string }
    >({
      query: ({ project, id }) => ({
        url: `/projects/${project}/budgets/${id}/cancel`,
        method: 'POST',
        body: {},
      }),
      transformResponse: (value) => executionBudgetResponse.parse(value),
      invalidatesTags: ['Budget', 'Job'],
    }),
  }),
});
