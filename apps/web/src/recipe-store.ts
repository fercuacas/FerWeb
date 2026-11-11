import type { z } from 'zod';
import { recipeOverview, recipePlan, type RecipeInput, type RecipePlan } from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';

type Scope = { project: string; task: string };
const route = ({ project, task }: Scope) => `/projects/${project}/tasks/${task}/recipes`;
export const recipeApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    recipes: b.query<z.infer<typeof recipeOverview>, Scope>({
      query: route,
      transformResponse: (data) => recipeOverview.parse(data),
      providesTags: ['Recipe'],
      keepUnusedDataFor: 0,
    }),
    recipePlan: b.query<RecipePlan, Scope & { id: string }>({
      query: (scope) => route(scope) + '/' + scope.id,
      transformResponse: (data) => recipePlan.parse(data),
      providesTags: ['Recipe', 'GitHub'],
      keepUnusedDataFor: 0,
    }),
    prepareRecipe: b.mutation<RecipePlan, Scope & { body: RecipeInput }>({
      query: (scope) => ({ url: route(scope), method: 'POST', body: scope.body, timeout: 90000 }),
      transformResponse: (data) => recipePlan.parse(data),
      invalidatesTags: ['Recipe'],
    }),
    executeRecipe: b.mutation<RecipePlan, Scope & { id: string; hash: string }>({
      query: (scope) => ({
        url: route(scope) + '/' + scope.id + '/execute',
        method: 'POST',
        body: { hash: scope.hash },
        timeout: 90000,
      }),
      transformResponse: (data) => recipePlan.parse(data),
      invalidatesTags: ['Recipe', 'Job'],
    }),
  }),
});
