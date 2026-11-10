import type { z } from 'zod';
import {
  learningCompliance,
  learningHealth,
  learningList,
  learningProposal,
  type LearningInput,
  type LearningProposal,
  type learningComplianceInput,
  type learningReview,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';

const path = (project: string) => `/projects/${project}/lab/learning`;
export const learningApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    learningList: b.query<z.infer<typeof learningList>, string>({
      query: path,
      transformResponse: (data) => learningList.parse(data),
      providesTags: ['Laboratory'],
      keepUnusedDataFor: 0,
    }),
    learningHealth: b.query<z.infer<typeof learningHealth>, string>({
      query: (project) => path(project) + '/health',
      transformResponse: (data) => learningHealth.parse(data),
      providesTags: ['Laboratory', 'Job', 'GitHub'],
      keepUnusedDataFor: 0,
    }),
    learningProposal: b.query<LearningProposal, { project: string; id: string }>({
      query: ({ project, id }) => `${path(project)}/${id}`,
      transformResponse: (data) => learningProposal.parse(data),
      providesTags: ['Laboratory', 'GitHub', 'Memory'],
      keepUnusedDataFor: 0,
    }),
    proposeLesson: b.mutation<LearningProposal, { project: string; body: LearningInput }>({
      query: ({ project, body }) => ({ url: path(project), method: 'POST', body, timeout: 90000 }),
      transformResponse: (data) => learningProposal.parse(data),
      invalidatesTags: ['Laboratory'],
    }),
    actOnLesson: b.mutation<
      LearningProposal,
      {
        project: string;
        id: string;
        body: { version: number } | z.infer<typeof learningReview>;
        action: 'review' | 'adopt' | 'revert';
      }
    >({
      query: ({ project, id, body, action }) => ({
        url: `${path(project)}/${id}/${action}`,
        method: 'POST',
        body,
        timeout: 90000,
      }),
      transformResponse: (data) => learningProposal.parse(data),
      invalidatesTags: ['Laboratory', 'Memory', 'Job', 'TeamPlan', 'TeamExecution'],
    }),
    checkCompliance: b.mutation<
      z.infer<typeof learningCompliance>,
      {
        project: string;
        body: z.infer<typeof learningComplianceInput>;
      }
    >({
      query: ({ project, body }) => ({
        url: path(project) + '/compliance',
        method: 'POST',
        body,
        timeout: 90000,
      }),
      transformResponse: (data) => learningCompliance.parse(data),
    }),
  }),
});
