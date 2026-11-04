import { createHash } from 'node:crypto';

// A transport double with actual remote side effects in memory and response loss.
// It is imported only by test fixtures, never by production configuration.
export function publicationFixture(fixture) {
  const original = fixture.transport,
    state = fixture.state;
  state.writePermissions = true;
  state.pushPermission = true;
  state.refs = new Map();
  state.commits = new Map();
  state.trees = new Map();
  state.publishedPulls = [];
  state.writes = [];
  state.failAfter = null;
  state.beforeWrite = null;
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const sha = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex');
  fixture.transport = async (input, options = {}) => {
    const url = new URL(String(input)),
      path = url.pathname,
      method = options.method ?? 'GET';
    const publishPath =
      path.startsWith('/repos/demo/ferweb/git/') || path === '/repos/demo/ferweb/pulls';
    if (publishPath && options.headers?.Authorization !== 'Bearer ghu_fixture_only')
      return json({}, 401);
    if (state.denied && publishPath) return json({}, 403);
    if (method === 'POST' && publishPath) {
      if (!state.writePermissions || !state.pushPermission) return json({}, 403);
      const body = JSON.parse(options.body);
      state.writes.push({ path, body });
      if (state.beforeWrite) await state.beforeWrite(path, body);
      let value;
      if (path.endsWith('/git/trees')) {
        if (body.base_tree !== 'e'.repeat(40)) return json({}, 422);
        const id = sha(body);
        state.trees.set(id, body);
        value = { sha: id };
      } else if (path.endsWith('/git/commits')) {
        if (!state.trees.has(body.tree) || body.parents[0] !== 'a'.repeat(40)) return json({}, 422);
        const id = sha(body);
        state.commits.set(id, body);
        value = { sha: id };
      } else if (path.endsWith('/git/refs')) {
        if (state.refs.has(body.ref) || !state.commits.has(body.sha)) return json({}, 422);
        state.refs.set(body.ref, body.sha);
        value = { ref: body.ref, object: { sha: body.sha } };
      } else if (path.endsWith('/pulls')) {
        if (
          state.publishedPulls.some((p) => p.head.ref === body.head) ||
          body.draft !== true ||
          body.maintainer_can_modify !== false
        )
          return json({}, 422);
        const repo = { id: 101, full_name: 'demo/ferweb' };
        value = {
          number: 100 + state.publishedPulls.length,
          body: body.body,
          title: body.title,
          state: 'open',
          draft: true,
          head: { ref: body.head, sha: state.refs.get('refs/heads/' + body.head), repo },
          base: { ref: body.base, sha: state.commit, repo },
        };
        state.publishedPulls.push(value);
      }
      if (value) {
        if (state.failAfter === path) {
          state.failAfter = null;
          throw Error('Simulated lost response after remote commit');
        }
        return json(value, 201);
      }
    }
    if (method === 'GET' && path.startsWith('/repos/demo/ferweb/git/matching-refs/heads/')) {
      const prefix = 'refs/heads/' + decodeURIComponent(path.split('/heads/')[1]);
      return json(
        [...state.refs]
          .filter(([ref]) => ref.startsWith(prefix))
          .map(([ref, id]) => ({ ref, object: { sha: id, type: 'commit' } })),
      );
    }
    if (method === 'GET' && path.startsWith('/repos/demo/ferweb/git/commits/'))
      return json({ sha: path.split('/').at(-1), tree: { sha: 'e'.repeat(40) } });
    if (method === 'GET' && path.endsWith('/pulls') && url.searchParams.has('head')) {
      const branch = url.searchParams.get('head').split(':').slice(1).join(':');
      return json(state.publishedPulls.filter((p) => p.head.ref === branch));
    }
    const response = await original(input, options);
    if (
      response.ok &&
      path === '/user/installations' &&
      state.writePermissions &&
      state.permissions
    ) {
      const data = await response.json();
      data.installations[0].permissions = {
        contents: 'write',
        issues: 'read',
        pull_requests: 'write',
      };
      return json(data);
    }
    if (response.ok && path === '/repos/demo/ferweb')
      return json({ ...(await response.json()), permissions: { push: state.pushPermission } });
    return response;
  };
  return fixture;
}
