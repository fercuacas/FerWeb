import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { readinessSchema, type Readiness } from '@ferweb/contracts';
import { authApi, workspaceApi, workspaceUi } from './workspace-store';

export const healthApi = createApi({
  reducerPath: 'healthApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  endpoints: (builder) => ({
    readiness: builder.query<Readiness, void>({
      async queryFn(_argument, { signal }) {
        try {
          const response = await fetch('/api/health/ready', {
            signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
            cache: 'no-store',
          });
          if (response.status !== 200 && response.status !== 503)
            throw new Error('Unexpected status');
          const parsed = readinessSchema.safeParse(await response.json());
          if (!parsed.success) throw new Error('Invalid response');
          return { data: parsed.data };
        } catch {
          return {
            error: {
              message:
                'No se ha podido consultar la API. Comprueba los servicios y vuelve a intentarlo.',
            },
          };
        }
      },
    }),
  }),
});

export const store = configureStore({
  reducer: {
    [healthApi.reducerPath]: healthApi.reducer,
    [workspaceApi.reducerPath]: workspaceApi.reducer,
    [authApi.reducerPath]: authApi.reducer,
    workspaceUi: workspaceUi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      healthApi.middleware,
      workspaceApi.middleware,
      authApi.middleware,
    ),
});
setupListeners(store.dispatch);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
