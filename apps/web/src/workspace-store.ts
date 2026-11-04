import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import {
  executionCatalogSchema,
  sessionSchema,
  projectsSchema,
  projectResponseSchema,
  taskResponseSchema,
  tasksSchema,
  type ProjectInput,
  type ProjectPatch,
  type TaskInput,
  type TaskPatch,
  type TaskFilters,
} from '@ferweb/contracts';

const initialState = {
  projectFilter: 'active' as 'active' | 'archived' | 'all',
  search: '',
  priority: '' as '' | TaskInput['priority'],
  status: '' as '' | TaskInput['status'],
  selectedTaskId: null as string | null,
  sessionExpired: false,
};
export const workspaceUi = createSlice({
  name: 'workspaceUi',
  initialState,
  reducers: {
    setProjectFilter(state, action: PayloadAction<typeof initialState.projectFilter>) {
      state.projectFilter = action.payload;
    },
    setSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    setPriority(state, action: PayloadAction<typeof initialState.priority>) {
      state.priority = action.payload;
    },
    setStatus(state, action: PayloadAction<typeof initialState.status>) {
      state.status = action.payload;
    },
    selectTask(state, action: PayloadAction<string | null>) {
      state.selectedTaskId = action.payload;
    },
    resetFilters(state) {
      state.search = '';
      state.priority = '';
      state.status = '';
      state.selectedTaskId = null;
    },
    sessionExpired(state) {
      state.sessionExpired = true;
    },
    reset: () => initialState,
  },
});
const baseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'same-origin',
  timeout: 10000,
  prepareHeaders(headers) {
    headers.set('X-FerWeb-Request', '1');
    return headers;
  },
});
export const authApi = createApi({
  reducerPath: 'authApi',
  baseQuery,
  endpoints: (builder) => ({
    session: builder.query<ReturnType<typeof sessionSchema.parse>, void>({
      query: () => '/auth/session',
      transformResponse: (data) => sessionSchema.parse(data),
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST', body: {} }),
    }),
  }),
});
// Keep credentials out of Redux actions and DevTools history.
export async function loginRequest(email: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-FerWeb-Request': '1' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw { data };
  return sessionSchema.parse(data);
}
export const workspaceApi = createApi({
  reducerPath: 'workspaceApi',
  baseQuery: async (args, api, extra) => {
    const result = await baseQuery(args, api, extra);
    if (result.error?.status === 401) api.dispatch(workspaceUi.actions.sessionExpired());
    return result;
  },
  tagTypes: ['Project', 'Task', 'GitHub', 'Conversation', 'Laboratory', 'Job'],
  endpoints: (builder) => ({
    executionCapabilities: builder.query<ReturnType<typeof executionCatalogSchema.parse>, string>({
      query: () => '/execution/capabilities',
      transformResponse: (data) => executionCatalogSchema.parse(data),
      keepUnusedDataFor: 0,
    }),
    projects: builder.query<ReturnType<typeof projectsSchema.parse>, void>({
      query: () => '/projects',
      transformResponse: (data) => projectsSchema.parse(data),
      providesTags: ['Project'],
    }),
    project: builder.query<ReturnType<typeof projectResponseSchema.parse>, string>({
      query: (id) => `/projects/${id}`,
      transformResponse: (data) => projectResponseSchema.parse(data),
      providesTags: ['Project'],
    }),
    createProject: builder.mutation<ReturnType<typeof projectResponseSchema.parse>, ProjectInput>({
      query: (body) => ({ url: '/projects', method: 'POST', body }),
      transformResponse: (data) => projectResponseSchema.parse(data),
      invalidatesTags: ['Project'],
    }),
    updateProject: builder.mutation<
      ReturnType<typeof projectResponseSchema.parse>,
      { id: string; body: ProjectPatch }
    >({
      query: ({ id, body }) => ({ url: `/projects/${id}`, method: 'PATCH', body }),
      transformResponse: (data) => projectResponseSchema.parse(data),
      invalidatesTags: (_result, error) => (error ? [] : ['Project', 'Task']),
    }),
    tasks: builder.query<
      ReturnType<typeof tasksSchema.parse>,
      { projectId: string; filters: TaskFilters }
    >({
      query: ({ projectId, filters }) => ({ url: `/projects/${projectId}/tasks`, params: filters }),
      transformResponse: (data) => tasksSchema.parse(data),
      providesTags: ['Task'],
    }),
    task: builder.query<
      ReturnType<typeof taskResponseSchema.parse>,
      { projectId: string; id: string }
    >({
      query: ({ projectId, id }) => `/projects/${projectId}/tasks/${id}`,
      transformResponse: (data) => taskResponseSchema.parse(data),
      providesTags: ['Task'],
    }),
    createTask: builder.mutation<
      ReturnType<typeof taskResponseSchema.parse>,
      { projectId: string; body: TaskInput }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}/tasks`,
        method: 'POST',
        body,
      }),
      transformResponse: (data) => taskResponseSchema.parse(data),
      invalidatesTags: (_result, error) => (error ? [] : ['Task']),
    }),
    updateTask: builder.mutation<
      ReturnType<typeof taskResponseSchema.parse>,
      { projectId: string; id: string; body: TaskPatch }
    >({
      query: ({ projectId, id, body }) => ({
        url: `/projects/${projectId}/tasks/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (data) => taskResponseSchema.parse(data),
      invalidatesTags: (_result, error) => (error ? [] : ['Task']),
    }),
  }),
});

export function errorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = error.data;
    if (
      typeof data === 'object' &&
      data &&
      'error' in data &&
      typeof data.error === 'object' &&
      data.error &&
      'message' in data.error &&
      typeof data.error.message === 'string'
    )
      return data.error.message;
  }
  return 'No se ha podido completar la solicitud. Comprueba la conexión y vuelve a intentarlo.';
}
