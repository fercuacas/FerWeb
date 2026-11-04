import { randomBytes } from 'node:crypto';

// Test-only adapter. Never selected by production configuration or an HTTP flag.
export function githubFixture() {
  const config = {
    appId: 123,
    clientId: 'fixture-client',
    clientSecret: 'fixture-client-secret',
    appSlug: 'ferweb-fixture',
    webhookSecret: randomBytes(32).toString('hex'),
    encryptionKey: randomBytes(32).toString('base64'),
    callbackUrl: 'http://127.0.0.1:5173/api/github/callback',
  };
  const state = {
    denied: false,
    expired: false,
    rateLimited: false,
    permissions: true,
    commit: 'a'.repeat(40),
    treeTruncated: false,
    beforeTree: null,
    beforeBlob: null,
    requests: [],
    exchanges: [],
    extraFiles: [],
    blobs: {},
    issueBody: 'Descripción **sin ejecutar HTML**',
  };
  const repo = {
    id: 101,
    name: 'ferweb',
    full_name: 'demo/ferweb',
    private: true,
    default_branch: 'main',
    description: 'Repositorio simulado de pruebas',
  };
  const transport = async (input, options = {}) => {
    const url = new URL(String(input));
    state.requests.push(url.pathname + url.search);
    const json = (data, status = 200, headers = {}) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token') {
      const body = new URLSearchParams(options.body);
      state.exchanges.push(Object.fromEntries(body));
      if (!body.get('code_verifier') || body.get('client_secret') !== config.clientSecret)
        return json({ error: 'bad_verification_code' });
      return json({
        access_token: 'ghu_fixture_only',
        expires_in: 28800,
        token_type: 'bearer',
        refresh_token: 'discarded_fixture_refresh',
      });
    }
    if (url.origin !== 'https://api.github.com')
      throw new Error('Unexpected external endpoint in fixture');
    if (state.expired) return json({ message: 'fixture-upstream-secret' }, 401);
    if (state.rateLimited)
      return json({ message: 'fixture-upstream-secret' }, 403, {
        'x-ratelimit-remaining': '0',
        'retry-after': '60',
      });
    if (options.headers?.Authorization !== 'Bearer ghu_fixture_only')
      return json({ message: 'Bad credentials' }, 401);
    if (url.pathname === '/user') return json({ id: 501, login: 'fixture-owner' });
    if (url.pathname === '/user/installations')
      return json({
        total_count: 2,
        installations: [
          {
            id: 71,
            app_id: 123,
            account: { login: 'demo' },
            suspended_at: null,
            permissions: state.permissions
              ? { contents: 'read', issues: 'read', pull_requests: 'read' }
              : { metadata: 'read' },
          },
          {
            id: 92,
            app_id: 999,
            account: { login: 'other-app' },
            suspended_at: null,
            permissions: { contents: 'read', issues: 'read', pull_requests: 'read' },
          },
        ],
      });
    if (url.pathname === '/user/installations/71/repositories') {
      if (state.denied) return json({ message: 'fixture-upstream-secret' }, 404);
      const second = url.searchParams.get('page') === '2';
      return json(
        {
          repositories: [
            second ? { ...repo, id: 102, name: 'second', full_name: 'demo/second' } : repo,
          ],
        },
        200,
        second
          ? {}
          : {
              link: '<https://api.github.com/user/installations/71/repositories?page=2>; rel="next"',
            },
      );
    }
    if (url.pathname === '/repos/demo/ferweb') return json(repo);
    if (url.pathname.startsWith('/repos/demo/ferweb/branches/'))
      return json({
        name: decodeURIComponent(url.pathname.split('/branches/')[1]),
        commit: { sha: state.commit },
      });
    if (url.pathname.startsWith('/repos/demo/ferweb/commits/'))
      return json({ sha: state.commit, commit: { tree: { sha: 'e'.repeat(40) } } });
    if (url.pathname === '/repos/demo/ferweb/git/trees/' + 'e'.repeat(40)) {
      if (state.beforeTree) await state.beforeTree();
      return json({
        truncated: state.treeTruncated,
        tree: [
          ...state.extraFiles,
          { path: 'src', type: 'tree', mode: '040000', sha: 'd'.repeat(40) },
          { path: 'src/demo.ts', type: 'blob', mode: '100644', sha: 'b'.repeat(40), size: 26 },
          { path: '.env', type: 'blob', mode: '100644', sha: 'f'.repeat(40), size: 20 },
          { path: 'secrets/key.pem', type: 'blob', mode: '100644', sha: 'f'.repeat(40), size: 20 },
          { path: 'link', type: 'blob', mode: '120000', sha: 'c'.repeat(40), size: 6 },
          { path: 'binary.bin', type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: 2 },
          { path: 'large.txt', type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: 1000001 },
        ],
      });
    }
    if (url.pathname === '/repos/demo/ferweb/issues')
      return json([
        {
          number: 1,
          title: 'Revisar permisos <script>',
          body: state.issueBody,
          state: 'open',
          updated_at: '2026-11-01T12:00:00Z',
        },
        {
          number: 2,
          title: 'También es PR',
          body: null,
          state: 'open',
          updated_at: '2026-11-01T12:00:00Z',
          pull_request: { url: 'ignored' },
        },
      ]);
    if (url.pathname === '/repos/demo/ferweb/pulls')
      return json([
        {
          number: 2,
          title: 'Propuesta de cambio',
          body: 'Revisión pendiente',
          state: 'open',
          updated_at: '2026-11-01T12:00:00Z',
          head: { sha: 'c'.repeat(40) },
          base: { sha: state.commit },
        },
      ]);
    if (url.pathname.startsWith('/repos/demo/ferweb/git/blobs/')) {
      if (state.beforeBlob) await state.beforeBlob();
      const sha = url.pathname.split('/').at(-1);
      const bytes =
        state.blobs[sha] !== undefined
          ? Buffer.from(state.blobs[sha])
          : sha === 'b'.repeat(40)
            ? Buffer.from('export const demo = true;\n')
            : Buffer.from([0, 1]);
      return json({
        sha,
        encoding: 'base64',
        size: bytes.length,
        content: bytes.toString('base64'),
      });
    }
    return json({ message: 'fixture-upstream-secret' }, 404);
  };
  return { config, state, transport };
}
