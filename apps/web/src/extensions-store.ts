import {
  extensionDetail,
  extensionRun,
  extensionsResponse,
  portablePreview,
  type extensionImport,
  type extensionAction,
  type extensionOperation,
  type portableDownload,
  type portableSelection,
} from '@ferweb/contracts';
import type { z } from 'zod';
import { workspaceApi } from './workspace-store';

const path = (project: string) => `/projects/${project}/extensions`;
const tag = (project: string) => [{ type: 'Extension' as const, id: project }];
type Scope = { project: string; id: string };

export const extensionsApi = workspaceApi.injectEndpoints({
  endpoints: (builder) => ({
    extensions: builder.query<z.infer<typeof extensionsResponse>, string>({
      query: path,
      transformResponse: (data) => extensionsResponse.parse(data),
      providesTags: (_data, _error, project) => tag(project),
      keepUnusedDataFor: 0,
    }),
    extension: builder.query<z.infer<typeof extensionDetail>, Scope>({
      query: ({ project, id }) => `${path(project)}/${id}`,
      transformResponse: (data) => extensionDetail.parse(data),
      providesTags: (_data, _error, { project }) => tag(project),
      keepUnusedDataFor: 0,
    }),
    importExtension: builder.mutation<
      z.infer<typeof extensionDetail>,
      { project: string; body: z.infer<typeof extensionImport> }
    >({
      query: ({ project, body }) => ({ url: path(project), method: 'POST', body }),
      transformResponse: (data) => extensionDetail.parse(data),
      invalidatesTags: (_data, _error, { project }) => tag(project),
    }),
    changeExtension: builder.mutation<
      z.infer<typeof extensionDetail>,
      Scope & { body: z.infer<typeof extensionAction> }
    >({
      query: ({ project, id, body }) => ({
        url: `${path(project)}/${id}/actions`,
        method: 'POST',
        body,
      }),
      transformResponse: (data) => extensionDetail.parse(data),
      invalidatesTags: (_data, _error, { project }) => tag(project),
    }),
    runExtension: builder.mutation<
      z.infer<typeof extensionRun>,
      Scope & { body: z.infer<typeof extensionOperation> }
    >({
      query: ({ project, id, body }) => ({
        url: `${path(project)}/${id}/runs`,
        method: 'POST',
        body,
      }),
      transformResponse: (data) => extensionRun.parse(data),
      invalidatesTags: (_data, _error, { project }) => tag(project),
    }),
    previewPortable: builder.mutation<
      z.infer<typeof portablePreview>,
      { project: string; body: z.infer<typeof portableSelection> }
    >({
      query: ({ project, body }) => ({
        url: `/projects/${project}/portable/preview`,
        method: 'POST',
        body,
      }),
      transformResponse: (data) => portablePreview.parse(data),
    }),
    downloadPortable: builder.mutation<
      void,
      { project: string; body: z.infer<typeof portableDownload>; format: 'json' | 'codex' }
    >({
      query: ({ project, format, body }) => ({
        url: `/projects/${project}/portable/${format}`,
        method: 'POST',
        body,
        responseHandler: async (response: Response) => {
          if (!response.ok) return response.json();
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement('a');
          link.href = url;
          link.download = format === 'json' ? 'ferweb-portable.json' : 'ferweb-codex.zip';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      }),
    }),
  }),
});
