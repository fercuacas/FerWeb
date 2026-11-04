// Test entry point only. Production server.mjs cannot select this provider.
import { createController } from './controller.mjs';
let sequence = 0;
async function fakeProvider(run, value, res) {
  if (
    run.input.task.title === 'Fix addition with agent role' &&
    run.requests === 1 &&
    !JSON.stringify(value.input).includes('P02 frozen prompt marker v1.')
  ) {
    res.writeHead(422);
    res.end('{"error":{"message":"frozen role missing from Codex input"}}');
    return;
  }
  if (/provider failure/i.test(run.input.task.title)) {
    res.writeHead(503);
    res.end('{"error":{"message":"simulated provider failure"}}');
    return;
  }
  const tools = value.tools.flatMap((t) =>
    t.type === 'namespace' ? t.tools.map((x) => ({ ...x, namespace: t.name })) : [t],
  );
  if (run.requests > 1 && /cancel|lease|timeout/i.test(run.input.task.title)) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': waiting for cancellation\n\n');
    await new Promise((resolve) => res.once('close', resolve));
    return;
  }
  const exec = tools.find(
    (t) => t.name === 'exec_command' || t.name === 'shell_command' || t.name === 'shell',
  );
  console.log(
    JSON.stringify({
      event: 'fixture_request',
      request: run.requests,
      tools: tools.map((t) => ({ name: t.name, type: t.type, namespace: t.namespace })),
    }),
  );
  let output;
  if (run.requests === 1 && exec) {
    const cancel = /cancel|lease|timeout/i.test(run.input.task.title);
    const command = cancel
      ? 'sleep 30'
      : `node --test; node tests/isolation-probe.cjs; node -e "require('node:fs').writeFileSync('src/add.cjs', 'exports.add = (a, b) => a + b;\\n')"; node --test`;
    const args =
      exec.name === 'exec_command'
        ? { cmd: command, yield_time_ms: cancel ? 1000 : 10000, max_output_tokens: 3000 }
        : exec.name === 'shell_command'
          ? { command, timeout_ms: 60000 }
          : { command: ['sh', '-c', command], timeout_ms: 60000 };
    output = [
      {
        type: 'function_call',
        id: 'fc_' + ++sequence,
        call_id: 'call_' + sequence,
        name: exec.name,
        arguments: JSON.stringify(args),
        status: 'completed',
        ...(exec.namespace ? { namespace: exec.namespace } : {}),
      },
    ];
  } else {
    output = [
      {
        type: 'message',
        id: 'msg_' + ++sequence,
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: 'Corregida la suma. Se ejecutaron node --test y la comprobación de aislamiento. Revisa el diff y la verificación independiente del controlador.',
            annotations: [],
          },
        ],
      },
    ];
  }
  const response = {
    id: 'resp_' + sequence,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: value.model,
    status: 'completed',
    output,
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      total_tokens: 140,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) =>
    res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  output.forEach((item, index) => {
    event('response.output_item.added', {
      output_index: index,
      item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) },
    });
    if (item.type === 'function_call')
      event('response.function_call_arguments.delta', {
        item_id: item.id,
        output_index: index,
        delta: item.arguments,
      });
    else {
      event('response.content_part.added', {
        item_id: item.id,
        output_index: index,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      });
      event('response.output_text.delta', {
        item_id: item.id,
        output_index: index,
        content_index: 0,
        delta: item.content[0].text,
      });
    }
    event('response.output_item.done', { output_index: index, item });
  });
  event('response.completed', { response });
  res.end();
}
const controller = await createController({
  token: process.env.RUNNER_SERVICE_TOKEN,
  configuration: { apiKey: null, models: ['fixture-codex'] },
  fakeProvider,
  namespace: process.env.RUNNER_NAMESPACE,
  volume: process.env.RUNNER_RUNTIME_VOLUME,
});
controller.server.listen(8010, '0.0.0.0');
process.on('SIGTERM', () => void controller.close().then(() => process.exit(0)));
