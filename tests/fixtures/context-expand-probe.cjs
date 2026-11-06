const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function request(body) {
  const response = await fetch('http://127.0.0.1:9040/context/expand', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function main() {
  const selector = {
    requestId: randomUUID(),
    kind: 'contract',
    reason: 'The implementation needs the documented addition contract.',
    path: 'docs/p10-contract.md',
  };
  const [first, deduplicated] = await Promise.all([
    request(selector),
    request({
      ...selector,
      requestId: randomUUID(),
      reason: 'Concurrent lookup of the same contract.',
    }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(deduplicated.status, 200);
  const delivered = [first.data, deduplicated.data].flatMap((result) => result.sources);
  assert.equal(delivered.length, 1);
  assert.ok(delivered[0].excerpt.includes('P10 expanded contract marker'));
  const replay = await request(selector);
  assert.deepEqual(replay, first);
  const overBudget = await request({
    ...selector,
    requestId: randomUUID(),
    reason: 'Attempt a third expansion after the two admitted requests.',
  });
  assert.equal(overBudget.status, 422);
  console.log(JSON.stringify({ marker: 'P10 context expansion validated', delivered }));
}
main().catch(() => {
  console.error('P10 context expansion probe failed');
  process.exitCode = 1;
});
