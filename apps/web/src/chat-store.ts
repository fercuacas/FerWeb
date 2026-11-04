import {
  aiCatalogSchema,
  conversationList,
  conversationResponse,
  chatStreamEvent,
  turnSchema,
  type AiProvider,
} from '@ferweb/contracts';
import { workspaceApi } from './workspace-store';
import type { z } from 'zod';
import type { conversationInput, turnInput } from '@ferweb/contracts';

export const chatApi = workspaceApi.injectEndpoints({
  endpoints: (builder) => ({
    aiModels: builder.query<
      ReturnType<typeof aiCatalogSchema.parse>,
      { projectId: string; provider: AiProvider }
    >({
      query: ({ projectId, provider }) => ({
        url: `/projects/${projectId}/ai/models`,
        params: { provider },
        timeout: 40000,
      }),
      transformResponse: (data) => aiCatalogSchema.parse(data),
      keepUnusedDataFor: 0,
    }),
    conversations: builder.query<ReturnType<typeof conversationList.parse>, string>({
      query: (projectId) => `/projects/${projectId}/conversations`,
      transformResponse: (data) => conversationList.parse(data),
      providesTags: ['Conversation'],
    }),
    conversation: builder.query<
      ReturnType<typeof conversationResponse.parse>,
      { projectId: string; id: string }
    >({
      query: ({ projectId, id }) => `/projects/${projectId}/conversations/${id}`,
      transformResponse: (data) => conversationResponse.parse(data),
      providesTags: ['Conversation'],
      keepUnusedDataFor: 0,
    }),
    createConversation: builder.mutation<
      ReturnType<typeof conversationResponse.parse>,
      { projectId: string; body: z.infer<typeof conversationInput> }
    >({
      query: ({ projectId, body }) => ({
        url: `/projects/${projectId}/conversations`,
        method: 'POST',
        body,
        timeout: 40000,
      }),
      transformResponse: (data) => conversationResponse.parse(data),
      invalidatesTags: ['Conversation'],
    }),
    cancelGeneration: builder.mutation<
      { turn: ReturnType<typeof turnSchema.parse> },
      { projectId: string; conversationId: string; turnId: string }
    >({
      query: ({ projectId, conversationId, turnId }) => ({
        url: `/projects/${projectId}/conversations/${conversationId}/turns/${turnId}/cancel`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['Conversation'],
    }),
  }),
});
export async function streamTurn(
  projectId: string,
  conversationId: string,
  body: z.input<typeof turnInput>,
  signal: AbortSignal,
  onEvent: (event: z.infer<typeof chatStreamEvent>) => void,
) {
  const response = await fetch(`/api/projects/${projectId}/conversations/${conversationId}/turns`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-FerWeb-Request': '1' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw { status: response.status, data: await response.json() };
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty stream');
  const decoder = new TextDecoder();
  let pending = '',
    done = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      if (pending.length > 1_000_000) throw new Error('Stream too large');
      let index: number;
      while ((index = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, index);
        pending = pending.slice(index + 2);
        const payload = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (payload) {
          const event = chatStreamEvent.parse(JSON.parse(payload));
          if (event.type === 'done' || event.type === 'error') done = true;
          onEvent(event);
        }
      }
    }
    if (!done && !signal.aborted) throw new Error('Stream interrupted');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
