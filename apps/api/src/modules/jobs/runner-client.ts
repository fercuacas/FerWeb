import { codingCapabilities } from '@ferweb/contracts';
import type { z } from 'zod';
import { HttpError } from '../../http-error.js';
export class RunnerClient {
  constructor(
    readonly url: string,
    readonly token: string,
  ) {}
  async request(
    path: string,
    body?: unknown,
    fence?: string,
    timeout = 4000,
    responseLimit = 1500000,
  ): Promise<any> {
    try {
      const response = await fetch(this.url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: 'Bearer ' + this.token,
          'content-type': 'application/json',
          ...(fence ? { 'X-Run-Fence': fence } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('runner_response');
      }
      const text = await response.text();
      if (text.length > responseLimit) throw new Error('runner_limit');
      return JSON.parse(text);
    } catch {
      throw new HttpError(
        503,
        'runner_unavailable',
        'El ejecutor no está disponible o no confirma la operación.',
      );
    }
  }
  async capabilities(): Promise<
    z.infer<typeof codingCapabilities> & {
      reason: 'runner_unconfigured' | 'runner_unavailable' | null;
    }
  > {
    const unavailable = { available: false, models: [], simulated: false, environment: null };
    if (!this.token) return { ...unavailable, reason: 'runner_unconfigured' };
    try {
      return { ...codingCapabilities.parse(await this.request('/capabilities')), reason: null };
    } catch {
      return { ...unavailable, reason: 'runner_unavailable' };
    }
  }
}
