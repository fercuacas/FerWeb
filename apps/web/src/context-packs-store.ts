import { z } from 'zod';
import {
  contextPackOverview,
  contextPackPrepare,
  contextReceiptResponse,
  contextCatalog,
  hybridResponse,
  indexResponse,
  projectMapInput,
  contextPackPolicyInput,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';
const path = (project: string) => `/projects/${project}/context-packs`;
export const contextPacksApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    contextPacks: b.query<z.infer<typeof contextPackOverview>, string>({
      query: (project) => path(project),
      transformResponse: (d) => contextPackOverview.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['ContextPack', 'GitHub', 'Memory', 'Skill', 'Task'],
    }),
    contextReceipt: b.query<
      z.infer<typeof contextReceiptResponse>,
      { project: string; id: string }
    >({
      query: ({ project, id }) => path(project) + '/receipts/' + id,
      transformResponse: (d) => contextReceiptResponse.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['ContextPack', 'GitHub', 'Memory', 'Skill', 'Task'],
    }),
    draftContextMap: b.mutation<{ markdown: string; paths: string[] }, string>({
      query: (project) => ({ url: path(project) + '/map/draft', method: 'POST', body: {} }),
      transformResponse: (d) =>
        z.object({ markdown: z.string(), paths: z.array(z.string()) }).parse(d),
    }),
    saveContextMap: b.mutation<
      { version: number; hash: string },
      { project: string; body: z.infer<typeof projectMapInput> }
    >({
      query: ({ project, body }) => ({ url: path(project) + '/map', method: 'PUT', body }),
      transformResponse: (d) => z.object({ version: z.number(), hash: z.string() }).parse(d),
      invalidatesTags: ['ContextPack', 'Job', 'TeamPlan'],
    }),
    saveContextPackPolicy: b.mutation<
      { version: number; hash: string },
      { project: string; body: z.infer<typeof contextPackPolicyInput> }
    >({
      query: ({ project, body }) => ({ url: path(project) + '/policy', method: 'PUT', body }),
      transformResponse: (d) => z.object({ version: z.number(), hash: z.string() }).parse(d),
      invalidatesTags: ['ContextPack', 'Job', 'TeamPlan'],
    }),
    prepareContextPack: b.mutation<
      z.infer<typeof contextReceiptResponse>,
      { project: string; body: z.input<typeof contextPackPrepare> }
    >({
      query: ({ project, body }) => ({
        url: path(project) + '/prepare',
        method: 'POST',
        body,
        timeout: 120000,
      }),
      transformResponse: (d) => contextReceiptResponse.parse(d),
      invalidatesTags: ['ContextPack'],
    }),
    contextCatalog: b.query<z.infer<typeof contextCatalog>, string>({
      query: (project) => `/projects/${project}/context/catalog`,
      transformResponse: (d) => contextCatalog.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['ContextPack', 'GitHub'],
    }),
    indexPackCatalog: b.mutation<
      z.infer<typeof indexResponse>,
      { project: string; lexicalOnly: boolean }
    >({
      query: ({ project, lexicalOnly }) => ({
        url: `/projects/${project}/context/index`,
        method: 'POST',
        body: { lexicalOnly },
        timeout: 600000,
      }),
      transformResponse: (d) => indexResponse.parse(d),
      invalidatesTags: ['ContextPack', 'GitHub', 'Conversation'],
    }),
    exportPackCatalog: b.mutation<z.infer<typeof contextCatalog>, string>({
      query: (project) => ({
        url: `/projects/${project}/context/catalog/export`,
        method: 'POST',
        body: {},
        timeout: 60000,
      }),
      transformResponse: (d) => contextCatalog.parse(d),
    }),
    hybridSearch: b.query<z.infer<typeof hybridResponse>, { project: string; query: string }>({
      query: ({ project, query }) => ({
        url: `/projects/${project}/context/hybrid/search`,
        method: 'POST',
        body: { query },
      }),
      transformResponse: (d) => hybridResponse.parse(d),
      keepUnusedDataFor: 0,
      providesTags: ['ContextPack', 'GitHub'],
    }),
  }),
});
