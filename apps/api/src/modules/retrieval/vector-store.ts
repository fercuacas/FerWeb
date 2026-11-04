import { z } from 'zod';
import { HttpError } from '../../http-error.js';

export class VectorStore {
  constructor(
    readonly base = 'http://qdrant:6333',
    readonly collection = 'ferweb_repository_v1',
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(collection)) throw new Error('Invalid collection');
  }
  async request(path = '', method = 'GET', body?: unknown) {
    try {
      const response = await fetch(`${this.base}/collections/${this.collection}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('qdrant');
      return await response.json();
    } catch {
      throw new HttpError(503, 'vector_unavailable', 'El índice vectorial no está disponible.');
    }
  }
  async ensure(dimensions: number) {
    // A space-specific collection prevents comparing different models/digests.
    try {
      await this.request();
    } catch {
      try {
        await this.request('', 'PUT', { vectors: { size: dimensions, distance: 'Cosine' } });
      } catch {
        await this.request();
      }
    }
    const info = await this.request();
    if (info.result?.config?.params?.vectors?.size !== dimensions)
      throw new HttpError(409, 'vector_dimensions', 'Las dimensiones del índice no coinciden.');
    for (const field of ['project', 'repository'])
      await this.request('/index?wait=true', 'PUT', { field_name: field, field_schema: 'keyword' });
  }
  async upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
    if (points.length) await this.request('/points?wait=true', 'PUT', { points });
  }
  async search(project: string, repository: string, vector: number[], ids: string[]) {
    if (!ids.length) return [];
    const raw = await this.request('/points/query', 'POST', {
      query: vector,
      filter: {
        must: [
          { key: 'project', match: { value: project } },
          { key: 'repository', match: { value: repository } },
          { has_id: ids },
        ],
      },
      limit: 12,
      score_threshold: 0.25,
      with_payload: false,
    });
    return z.array(z.object({ id: z.uuid(), score: z.number().finite() })).parse(raw.result.points);
  }
  async prune(project: string, ids: string[]) {
    await this.request('/points/delete?wait=true', 'POST', {
      filter: {
        must: [{ key: 'project', match: { value: project } }],
        ...(ids.length ? { must_not: [{ has_id: ids }] } : {}),
      },
    });
  }
}
