// Test-only GitHub observations and ambiguous issue delivery. No production switch.
export function coordinationFixture(fixture) {
  const original = fixture.transport,
    state = fixture.state;
  Object.assign(state, {
    issueWrites: [],
    createdIssues: [],
    issueWritePermission: true,
    loseIssueResponse: false,
    workIssuesMissing: false,
    workIssuesPartial: false,
    workIssueState: 'open',
    workIssueNumber: 1,
  });
  const json = (body, headers = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
  fixture.transport = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === '/repos/demo/ferweb/issues' && options.method === 'POST') {
      if (options.headers?.Authorization !== 'Bearer ghu_fixture_only')
        return new Response('', { status: 401 });
      if (state.denied || !state.issueWritePermission) return new Response('', { status: 403 });
      const body = JSON.parse(options.body);
      state.issueWrites.push(body);
      const item = {
        id: 10000 + state.issueWrites.length,
        number: 10 + state.issueWrites.length,
        title: body.title,
        body: body.body,
        state: 'open',
        updated_at: new Date().toISOString(),
        user: { id: 501 },
        labels: [],
        assignees: [],
      };
      state.createdIssues.push(item);
      if (state.loseIssueResponse || body.title === 'P18 browser lost response') {
        state.loseIssueResponse = false;
        throw new Error('Simulated response loss after remote issue creation');
      }
      return json(item);
    }
    const response = await original(url, options);
    if (!response.ok) return response;
    if (path === '/user/installations') {
      const data = await response.json();
      if (state.permissions)
        data.installations[0].permissions.issues = state.issueWritePermission ? 'write' : 'read';
      return json(data);
    }
    if (
      (options.method ?? 'GET') === 'GET' &&
      (path === '/repos/demo/ferweb/issues' || path === '/repos/demo/ferweb/pulls')
    ) {
      const issues = path.endsWith('/issues');
      let items = (await response.json()).map((item) => ({
        ...item,
        id: (issues ? 1000 : 2000) + item.number,
        user: { id: 501 },
        labels: ['untrusted-owner-label'],
        assignees: [{ login: 'remote-observer' }],
        ...(issues && item.number === 1
          ? { number: state.workIssueNumber, state: state.workIssueState }
          : {}),
      }));
      if (issues) items = state.workIssuesMissing ? [] : [...items, ...state.createdIssues];
      return json(
        items,
        state.workIssuesPartial && issues
          ? { link: `<https://api.github.com/repos/demo/ferweb/issues?page=2>; rel="next"` }
          : {},
      );
    }
    return response;
  };
  return fixture;
}
