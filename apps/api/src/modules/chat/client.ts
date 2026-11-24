import { aiCatalogSchema, aiEvent, type AiProvider } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { z } from 'zod';

const embeddingDescription = z.object({
  configurationRevision: z.string().nullable().default(null),
  simulated: z.boolean().default(false),
  provider: z.literal('ollama'),
  model: z.string().min(1),
  revision: z.string().min(1),
  dimensions: z.number().int().min(1).max(4096),
});

export interface GenerationRequest {
  id: string;
  provider: AiProvider;
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number;
  localStructured?: boolean;
  expectedRevision?: string;
}
export class AiClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}
  private localService() {
    let url: URL;
    try {
      url = new URL(this.base);
    } catch {
      throw new HttpError(
        503,
        'local_service_untrusted',
        'El servicio de IA local no está configurado en una dirección interna permitida.',
      );
    }
    if (
      url.protocol !== 'http:' ||
      !['ai', 'ai-test', 'localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      throw new HttpError(
        503,
        'local_service_untrusted',
        'El servicio de IA local debe usar una dirección interna permitida.',
      );
  }
  private headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }
  async embeddings(texts?: string[]) {
    try {
      this.localService();
      const response = await fetch(`${this.base}/embeddings`, {
        redirect: 'error',
        method: texts ? 'POST' : 'GET',
        headers: this.headers(),
        ...(texts ? { body: JSON.stringify({ texts }) } : {}),
        signal: AbortSignal.timeout(65000),
      });
      if (!response.ok) throw new Error('embedding');
      const raw = await response.json();
      const description = embeddingDescription.parse(raw);
      const vectors = texts
        ? z
            .array(z.array(z.number().finite()).length(description.dimensions))
            .length(texts.length)
            .parse(raw.vectors)
        : [];
      return { ...description, vectors };
    } catch {
      throw new HttpError(
        503,
        'embedding_unavailable',
        'No se puede consultar el modelo local de embeddings. Revisa docs/retrieval.md.',
      );
    }
  }
  async catalog(provider: AiProvider, timeoutMs = 35000) {
    try {
      if (provider === 'ollama') this.localService();
      const response = await fetch(`${this.base}/catalog/${provider}`, {
        redirect: 'error',
        headers: this.headers(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('service');
      return aiCatalogSchema.parse(await response.json());
    } catch {
      throw new HttpError(
        503,
        'ai_service_unavailable',
        'No se ha podido consultar el servicio de IA.',
      );
    }
  }
  async cancel(id: string) {
    await fetch(`${this.base}/cancel/${id}`, {
      redirect: 'error',
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(2000),
    });
  }
  async *generate(input: GenerationRequest, signal: AbortSignal) {
    if (input.localStructured && input.provider !== 'ollama')
      throw new HttpError(422, 'local_provider_required', 'La entrega local solo admite Ollama.');
    if (input.provider === 'ollama' || input.localStructured) this.localService();
    const response = await fetch(`${this.base}/generate`, {
      redirect: 'error',
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson'))
      throw new HttpError(
        503,
        'ai_service_unavailable',
        'El servicio de IA no ha podido iniciar la generación.',
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty AI stream');
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        pending += decoder.decode(part.value, { stream: true });
        if (pending.length > 1_000_000) throw new Error('Oversized AI frame');
        let line: number;
        while ((line = pending.indexOf('\n')) >= 0) {
          const raw = pending.slice(0, line);
          pending = pending.slice(line + 1);
          if (raw.trim()) yield aiEvent.parse(JSON.parse(raw));
        }
      }
      pending += decoder.decode();
      if (pending.trim()) yield aiEvent.parse(JSON.parse(pending));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
