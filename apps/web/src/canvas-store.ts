import type { z } from 'zod';
import { canvasResponse, type CanvasEntryInput, type CanvasKind } from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';

type Scope = { project: string; kind: CanvasKind; id: string };
const path = ({ project, kind, id }: Scope) => `/projects/${project}/canvas/${kind}/${id}`;
type Review = z.infer<typeof canvasResponse>;
export const canvasApi = workspaceApi.injectEndpoints({
  endpoints: (b) => ({
    canvas: b.query<Review, Scope>({
      query: path,
      transformResponse: (data) => canvasResponse.parse(data),
      providesTags: ['Canvas', 'GitHub', 'Memory', 'TeamPlan'],
      keepUnusedDataFor: 0,
    }),
    addCanvasEntry: b.mutation<Review, Scope & { body: CanvasEntryInput }>({
      query: (scope) => ({ url: path(scope), method: 'POST', body: scope.body }),
      transformResponse: (data) => canvasResponse.parse(data),
      invalidatesTags: (result, _error, scope) =>
        result ? (scope.kind === 'plan' ? ['Canvas', 'TeamPlan'] : ['Canvas']) : [],
    }),
  }),
});
