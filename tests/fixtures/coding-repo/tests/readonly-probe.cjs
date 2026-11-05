const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const input = JSON.parse(fs.readFileSync('/control/input.json', 'utf8'));
assert.equal(process.getuid(), 1000);
assert.equal(input.workspaceAccess, 'read-only');
assert.equal(input.fence, undefined);
for (const name of ['RUNNER_SERVICE_TOKEN', 'OPENAI_API_KEY', 'POSTGRES_PASSWORD'])
  assert.equal(process.env[name], undefined);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
for (const action of [
  () => fs.writeFileSync('src/add.cjs', 'changed'),
  () => fs.appendFileSync('src/add.cjs', 'changed'),
  () => fs.writeFileSync('new-file.cjs', 'created'),
  () => fs.unlinkSync('src/add.cjs'),
  () => fs.renameSync('src/add.cjs', 'src/moved.cjs'),
  () => fs.chmodSync('src/add.cjs', 0o777),
])
  assert.throws(action, { code: 'EROFS' });
fs.symlinkSync('/workspace/src/add.cjs', '/tmp/source-alias');
assert.throws(() => fs.writeFileSync('/tmp/source-alias', 'changed'), { code: 'EROFS' });
assert.equal(
  fs.readFileSync('/workspace/src/add.cjs', 'utf8'),
  input.files.find((file) => file.path === 'src/add.cjs').content,
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, body, expected = 200) {
  const response = await fetch('http://127.0.0.1:9040/team/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, expected);
  return response.json();
}
async function queryMessage(predicate) {
  for (let i = 0; i < 70; i++) {
    const data = await call('inbox', { after: 0 });
    const match = data.messages.find(predicate);
    if (match) return match;
    await sleep(100);
  }
  throw Error('Expected authenticated specialist message');
}
(async () => {
  const step = input.task.teamStep;
  if (/P07 messaging/.test(input.task.title)) {
    if (step.key === 'explore') {
      const to = step.participants.find((item) => item.key === 'audit').id;
      const body = {
        requestId: randomUUID(),
        to,
        kind: 'query',
        text: 'P07 authenticated query: inspect the independent snapshot.',
      };
      const first = await call('messages', body);
      assert.equal((await call('messages', body)).message.id, first.message.id);
      assert.equal((await call('messages', body)).repeated, true);
      await queryMessage(
        (message) => message.kind === 'response' && message.replyTo === first.message.id,
      );
    } else if (step.key === 'audit') {
      const query = await queryMessage((message) => message.kind === 'query');
      const response = await call('messages', {
        requestId: randomUUID(),
        to: query.senderStepId,
        kind: 'response',
        replyTo: query.id,
        text: 'P07 independent response: source writes are rejected.',
      });
      assert.equal(response.message.senderJobId, input.jobId);
      assert.equal(response.message.verified, false);
    }
  }
  console.log(
    'P07 independent specialist ' +
      step.key +
      ': source writes rejected; messages scoped to current job.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
