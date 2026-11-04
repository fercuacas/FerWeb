import { z } from 'zod';
import { githubId, githubSha, githubEntrySchema, type GitHubSnapshot } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import type { GitHubConfig } from './config.js';

export type GitHubFetch = typeof fetch;
const id = githubId;
const publicationPull = z.object({
  number: id,
  body: z.string().nullable(),
  state: z.string(),
  head: z.object({
    ref: z.string(),
    sha: githubSha,
    repo: z.object({ id, full_name: z.string() }).nullable(),
  }),
  base: z.object({
    ref: z.string(),
    sha: githubSha,
    repo: z.object({ id, full_name: z.string() }),
  }),
});
const repositorySchema = z.object({
  id,
  name: z.string(),
  full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  private: z.boolean(),
  default_branch: z.string(),
  description: z.string().nullable(),
});
const installationSchema = z.object({
  id,
  app_id: id,
  account: z.object({ login: z.string() }),
  suspended_at: z.string().nullable(),
  permissions: z.record(z.string(), z.string()),
});
export function readableInstallation(installation: z.infer<typeof installationSchema>) {
  return ['contents', 'issues', 'pull_requests'].every((permission) =>
    ['read', 'write'].includes(installation.permissions[permission] ?? ''),
  );
}
export function visiblePath(path: string) {
  return !path
    .split('/')
    .some(
      (part) =>
        /^(\.git|\.local|node_modules|secrets|backups)$/i.test(part) ||
        /^\.env/i.test(part) ||
        /\.(pem|key|p12|pfx)$/i.test(part),
    );
}
function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(502, 'github_response', 'GitHub ha devuelto datos no válidos.');
  return parsed.data;
}
function repository(raw: z.infer<typeof repositorySchema>) {
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    description: raw.description,
  };
}
export class GitHubClient {
  constructor(
    private readonly config: GitHubConfig,
    private readonly transport: GitHubFetch = fetch,
    private readonly deadline = Infinity,
  ) {}
  operation() {
    return new GitHubClient(this.config, this.transport, Date.now() + 45_000);
  }
  private async request(url: string, token?: string, body?: URLSearchParams, jsonBody?: unknown) {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0)
      throw new HttpError(
        504,
        'github_timeout',
        'GitHub ha tardado demasiado. Vuelve a intentarlo.',
      );
    let response: Response;
    try {
      response = await this.transport(url, {
        method: body || jsonBody !== undefined ? 'POST' : 'GET',
        redirect: 'error',
        headers: {
          Accept: body ? 'application/json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'FerWeb',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body } : {}),
        ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
        signal: AbortSignal.timeout(Math.min(8000, remaining)),
      });
    } catch {
      throw new HttpError(502, 'github_unavailable', 'No se ha podido contactar con GitHub.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([409, 422].includes(response.status))
        throw new HttpError(
          409,
          'github_write_conflict',
          'GitHub ha rechazado la escritura. Revisa la rama y vuelve a intentar la misma publicación.',
        );
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' ||
            response.headers.has('retry-after')))
      )
        throw new HttpError(
          429,
          'github_rate_limited',
          'GitHub ha limitado las consultas. Espera antes de sincronizar de nuevo.',
        );
      if ([401, 403, 404].includes(response.status))
        throw new HttpError(
          response.status === 401 ? 409 : 403,
          response.status === 401 ? 'github_reauthorize' : 'github_access_denied',
          'GitHub ya no permite este acceso. Revisa la autorización y los repositorios de la App.',
        );
      throw new HttpError(502, 'github_unavailable', 'GitHub no ha podido completar la consulta.');
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (!reader)
      throw new HttpError(502, 'github_response', 'GitHub ha devuelto una respuesta vacía.');
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 8_000_000) {
          await reader.cancel();
          throw new Error('size');
        }
        chunks.push(part.value);
      }
      return {
        data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        more: /<[^>]+>;\s*rel="next"/.test(response.headers.get('link') ?? ''),
      };
    } catch {
      throw new HttpError(
        502,
        'github_response',
        'La respuesta de GitHub es inválida o supera el límite de lectura.',
      );
    }
  }
  private get(path: string, token: string) {
    return this.request(`https://api.github.com${path}`, token);
  }
  private post(path: string, token: string, value: unknown) {
    return this.request(`https://api.github.com${path}`, token, undefined, value);
  }
  async requirePush(token: string, fullName: string) {
    const repo = decode(
      z.object({ permissions: z.object({ push: z.boolean() }) }),
      (await this.get(`/repos/${fullName}`, token)).data,
    );
    if (!repo.permissions.push)
      throw new HttpError(
        403,
        'github_write_denied',
        'Tu usuario no puede escribir en este repositorio.',
      );
  }
  async branchHead(token: string, fullName: string, branch: string) {
    const row = decode(
      z.object({ name: z.string(), commit: z.object({ sha: githubSha }) }),
      (await this.get(`/repos/${fullName}/branches/${encodeURIComponent(branch)}`, token)).data,
    );
    if (row.name !== branch)
      throw new HttpError(502, 'github_response', 'GitHub ha devuelto otra rama.');
    return row.commit.sha;
  }
  async ref(token: string, fullName: string, branch: string) {
    const rows = decode(
      z.array(
        z.object({ ref: z.string(), object: z.object({ sha: githubSha, type: z.string() }) }),
      ),
      (
        await this.get(
          `/repos/${fullName}/git/matching-refs/heads/${encodeURIComponent(branch)}`,
          token,
        )
      ).data,
    );
    return rows.find((r) => r.ref === `refs/heads/${branch}`)?.object.sha ?? null;
  }
  async createRef(token: string, fullName: string, branch: string, sha: string) {
    await this.post(`/repos/${fullName}/git/refs`, token, { ref: `refs/heads/${branch}`, sha });
  }
  async createChangeCommit(
    token: string,
    fullName: string,
    parent: string,
    tree: { path: string; mode: string; type: 'blob'; content?: string; sha?: null }[],
    message: string,
    date: string,
  ) {
    const base = decode(
      z.object({ sha: githubSha, tree: z.object({ sha: githubSha }) }),
      (await this.get(`/repos/${fullName}/git/commits/${parent}`, token)).data,
    );
    if (base.sha !== parent) throw new HttpError(502, 'github_response', 'Commit base no válido.');
    const next = decode(
      z.object({ sha: githubSha }),
      (await this.post(`/repos/${fullName}/git/trees`, token, { base_tree: base.tree.sha, tree }))
        .data,
    );
    const identity = { name: 'FerWeb', email: 'ferweb@users.noreply.github.com', date };
    return decode(
      z.object({ sha: githubSha }),
      (
        await this.post(`/repos/${fullName}/git/commits`, token, {
          message,
          tree: next.sha,
          parents: [parent],
          author: identity,
          committer: identity,
        })
      ).data,
    ).sha;
  }
  async findPull(token: string, fullName: string, branch: string) {
    const query = new URLSearchParams({
      state: 'all',
      head: `${fullName.split('/')[0]}:${branch}`,
      per_page: '100',
    });
    const response = await this.get(`/repos/${fullName}/pulls?${query}`, token);
    if (response.more)
      throw new HttpError(422, 'github_limit', 'Demasiadas PR para reconciliar esta rama.');
    return decode(z.array(publicationPull), response.data);
  }
  async createPull(
    token: string,
    fullName: string,
    input: { title: string; body: string; head: string; base: string },
  ) {
    return decode(
      publicationPull,
      (
        await this.post(`/repos/${fullName}/pulls`, token, {
          ...input,
          draft: true,
          maintainer_can_modify: false,
        })
      ).data,
    );
  }
  async exchange(code: string, verifier: string) {
    const { data } = await this.request(
      'https://github.com/login/oauth/access_token',
      undefined,
      new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.callbackUrl,
        code,
        code_verifier: verifier,
      }),
    );
    return decode(
      z.object({
        access_token: z.string().min(1).max(4096),
        expires_in: z.number().positive().optional(),
        token_type: z.literal('bearer'),
      }),
      data,
    );
  }
  async user(token: string) {
    return decode(
      z.object({ id, login: z.string().max(200) }),
      (await this.get('/user', token)).data,
    );
  }
  async installations(token: string) {
    const result: z.infer<typeof installationSchema>[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.get(`/user/installations?per_page=100&page=${page}`, token);
      result.push(
        ...decode(z.object({ installations: z.array(installationSchema) }), response.data)
          .installations,
      );
      if (!response.more)
        return result.filter((item) => item.app_id === this.config.appId && !item.suspended_at);
    }
    throw new HttpError(
      422,
      'github_limit',
      'La lista de instalaciones supera el límite de esta entrega.',
    );
  }
  async repositories(token: string, installation: number, page: number) {
    const response = await this.get(
      `/user/installations/${installation}/repositories?per_page=100&page=${page}`,
      token,
    );
    return {
      repositories: decode(
        z.object({ repositories: z.array(repositorySchema) }),
        response.data,
      ).repositories.map(repository),
      nextPage: response.more ? page + 1 : null,
    };
  }
  async accessibleRepository(token: string, installation: number, repositoryId: number) {
    for (let page = 1; page <= 10; page++) {
      const list = await this.repositories(token, installation, page);
      const found = list.repositories.find((repo) => repo.id === repositoryId);
      if (found) return found;
      if (!list.nextPage) break;
    }
    throw new HttpError(
      403,
      'github_access_denied',
      'El repositorio no está accesible en esta instalación (límite de comprobación: 1000 repositorios).',
    );
  }
  private async items(token: string, fullName: string, kind: 'issues' | 'pulls') {
    const items: GitHubSnapshot['issues'] = [];
    for (let page = 1; page <= 5; page++) {
      const result = await this.get(
        `/repos/${fullName}/${kind}?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
        token,
      );
      const rows = decode(
        z.array(
          z.object({
            number: id,
            title: z.string().max(2000),
            body: z.string().nullable(),
            state: z.string(),
            updated_at: z.string(),
            pull_request: z.unknown().optional(),
            head: z.object({ sha: githubSha }).optional(),
            base: z.object({ sha: githubSha }).optional(),
          }),
        ),
        result.data,
      );
      for (const row of rows)
        if (kind !== 'issues' || !row.pull_request)
          items.push({
            number: row.number,
            title: row.title,
            body: (row.body ?? '').slice(0, 20_000),
            state: row.state,
            updatedAt: row.updated_at,
            url: `https://github.com/${fullName}/${kind === 'issues' ? 'issues' : 'pull'}/${row.number}`,
            ...(row.head ? { head: row.head.sha } : {}),
            ...(row.base ? { base: row.base.sha } : {}),
          });
      if (!result.more) return { items, truncated: false };
    }
    return { items, truncated: true };
  }
  async snapshot(token: string, fullName: string, branch: string): Promise<GitHubSnapshot> {
    const repo = repository(
      decode(repositorySchema, (await this.get(`/repos/${fullName}`, token)).data),
    );
    const selected = decode(
      z.object({ name: z.string(), commit: z.object({ sha: githubSha }) }),
      (await this.get(`/repos/${repo.fullName}/branches/${encodeURIComponent(branch)}`, token))
        .data,
    );
    if (selected.name !== branch)
      throw new HttpError(502, 'github_response', 'GitHub ha devuelto una rama distinta.');
    const commit = decode(
      z.object({ sha: githubSha, commit: z.object({ tree: z.object({ sha: githubSha }) }) }),
      (await this.get(`/repos/${repo.fullName}/commits/${selected.commit.sha}`, token)).data,
    );
    if (commit.sha !== selected.commit.sha)
      throw new HttpError(502, 'github_response', 'GitHub ha devuelto un commit distinto.');
    const [treeResult, issues, pulls] = await Promise.all([
      this.get(`/repos/${repo.fullName}/git/trees/${commit.commit.tree.sha}?recursive=1`, token),
      this.items(token, repo.fullName, 'issues'),
      this.items(token, repo.fullName, 'pulls'),
    ]);
    const tree = decode(
      z.object({
        truncated: z.boolean(),
        tree: z.array(
          githubEntrySchema
            .omit({ size: true })
            .extend({ size: z.number().nonnegative().optional() }),
        ),
      }),
      treeResult.data,
    );
    const visible = tree.tree.filter((entry) => visiblePath(entry.path));
    return {
      repository: repo,
      branch,
      commit: commit.sha,
      tree: visible.slice(0, 5000).map((entry) => ({ ...entry, size: entry.size ?? null })),
      treeTruncated: tree.truncated || visible.length > 5000,
      issues: issues.items,
      pullRequests: pulls.items,
      issuesTruncated: issues.truncated,
      pullRequestsTruncated: pulls.truncated,
      observedAt: new Date().toISOString(),
    };
  }
  async blob(token: string, fullName: string, sha: string) {
    const value = decode(
      z.object({
        sha: githubSha,
        size: z.number().nonnegative(),
        encoding: z.literal('base64'),
        content: z.string().max(1_500_000),
      }),
      (await this.get(`/repos/${fullName}/git/blobs/${sha}`, token)).data,
    );
    if (value.sha !== sha || value.size > 1_000_000)
      throw new HttpError(
        415,
        'github_file_unsupported',
        'Solo se muestran archivos de texto de hasta 1 MB.',
      );
    const bytes = Buffer.from(value.content, 'base64');
    if (bytes.length > 1_000_000 || bytes.includes(0))
      throw new HttpError(
        415,
        'github_file_unsupported',
        'El archivo es binario o demasiado grande.',
      );
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new HttpError(415, 'github_file_unsupported', 'El archivo no es texto UTF-8.');
    }
  }
}
