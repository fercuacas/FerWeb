import {
  githubStatusSchema,
  githubInstallationsResponse,
  githubRepositoriesResponse,
  githubLinkResponse,
  githubFileResponse,
  type githubLinkInput,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';
import type { z } from 'zod';

export const githubApi = workspaceApi.injectEndpoints({
  endpoints: (builder) => ({
    githubStatus: builder.query<ReturnType<typeof githubStatusSchema.parse>, void>({
      query: () => '/github/status',
      transformResponse: (data) => githubStatusSchema.parse(data),
      providesTags: ['GitHub'],
    }),
    githubInstallations: builder.query<ReturnType<typeof githubInstallationsResponse.parse>, void>({
      query: () => ({ url: '/github/installations', timeout: 60000 }),
      transformResponse: (data) => githubInstallationsResponse.parse(data),
      providesTags: ['GitHub'],
      keepUnusedDataFor: 0,
    }),
    connectInstallation: builder.mutation<void, number>({
      query: (installationId) => ({
        url: '/github/installations',
        method: 'POST',
        body: { installationId },
        timeout: 60000,
      }),
      invalidatesTags: ['GitHub'],
    }),
    disconnectGitHub: builder.mutation<void, void>({
      query: () => ({ url: '/github/disconnect', method: 'POST', body: {} }),
      invalidatesTags: ['GitHub'],
    }),
    githubRepositories: builder.query<
      ReturnType<typeof githubRepositoriesResponse.parse>,
      { installationId: number; page: number }
    >({
      query: ({ installationId, page }) => ({
        url: `/github/installations/${installationId}/repositories`,
        params: { page },
        timeout: 60000,
      }),
      transformResponse: (data) => githubRepositoriesResponse.parse(data),
      providesTags: ['GitHub'],
      keepUnusedDataFor: 0,
    }),
    githubLink: builder.query<ReturnType<typeof githubLinkResponse.parse>, string>({
      query: (id) => ({ url: `/projects/${id}/github`, timeout: 60000 }),
      transformResponse: (data) => githubLinkResponse.parse(data),
      providesTags: ['GitHub'],
      keepUnusedDataFor: 0,
    }),
    linkGitHub: builder.mutation<
      ReturnType<typeof githubLinkResponse.parse>,
      { projectId: string; body: z.infer<typeof githubLinkInput> }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}/github`,
        method: 'POST',
        body,
        timeout: 60000,
      }),
      transformResponse: (data) => githubLinkResponse.parse(data),
      invalidatesTags: ['GitHub'],
    }),
    syncGitHub: builder.mutation<
      ReturnType<typeof githubLinkResponse.parse>,
      { projectId: string; version: number }
    >({
      query: ({ projectId, version }) => ({
        url: `/projects/${projectId}/github/sync`,
        method: 'POST',
        body: { version },
        timeout: 60000,
      }),
      transformResponse: (data) => githubLinkResponse.parse(data),
      invalidatesTags: ['GitHub'],
    }),
    unlinkGitHub: builder.mutation<void, { projectId: string; version: number }>({
      query: ({ projectId, version }) => ({
        url: `/projects/${projectId}/github`,
        method: 'DELETE',
        body: { version },
      }),
      invalidatesTags: ['GitHub'],
    }),
    githubFile: builder.query<
      ReturnType<typeof githubFileResponse.parse>,
      { projectId: string; path: string; version: number }
    >({
      query: ({ projectId, path, version }) => ({
        url: `/projects/${projectId}/github/file`,
        params: { path, version },
        timeout: 60000,
      }),
      transformResponse: (data) => githubFileResponse.parse(data),
      providesTags: ['GitHub'],
      keepUnusedDataFor: 0,
    }),
  }),
});
export async function authorizeGitHub() {
  const response = await fetch('/api/github/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FerWeb-Request': '1' },
    body: '{}',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10000),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw { data };
  if (!data || typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string')
    throw new Error('Invalid authorization URL');
  const url = new URL(data.url);
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize')
    throw new Error('Invalid authorization URL');
  window.location.assign(url.href);
}
