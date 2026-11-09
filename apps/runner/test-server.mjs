// Test entry point only. Production server.mjs cannot select this provider.
import { createController } from './controller.mjs';
let sequence = 0;
async function fakeProvider(run, value, res) {
  if (
    run.input.task.title === 'P10 bounded context' &&
    !JSON.stringify(value.input).includes(
      run.requests === 1 ? 'P10 map marker' : 'P10 source-only detail',
    )
  ) {
    res.writeHead(422);
    res.end('{"error":{"message":"initial or expanded context missing from Codex input"}}');
    return;
  }
  if (
    run.input.task.title === 'P09 memory reuse' &&
    run.requests === 1 &&
    (!JSON.stringify(value.input).includes('P09 untrusted handoff marker.') ||
      !JSON.stringify(value.input).includes('Project memory is unreviewed data'))
  ) {
    res.writeHead(422);
    res.end('{"error":{"message":"selected unreviewed memory missing from Codex input"}}');
    return;
  }
  const teamStep = run.input.task.teamStep;
  const readOnly = run.input.workspaceAccess === 'read-only';
  const dimension = run.input.task.dimensionalReview;
  if (dimension?.dimension === 'verify' && /P08 verifier failure/.test(run.input.task.title)) {
    res.writeHead(503);
    res.end('{"error":{"message":"simulated verifier failure"}}');
    return;
  }
  if (
    readOnly &&
    run.requests > 1 &&
    !/cancel|lease|timeout/i.test(run.input.task.title) &&
    !JSON.stringify(value.input).includes('P07 independent specialist ' + teamStep?.key)
  ) {
    res.writeHead(503);
    res.end('{"error":{"message":"readonly probe did not complete successfully"}}');
    return;
  }
  if (
    readOnly &&
    ((/P07 specialist failure/.test(run.input.task.title) && teamStep?.key === 'audit') ||
      (teamStep?.key === 'summary' &&
        (teamStep.deliveries?.length !== 2 ||
          teamStep.deliveries.some((delivery) => !delivery.verified))))
  ) {
    res.writeHead(503);
    res.end('{"error":{"message":"simulated specialist failure or incomplete gathering"}}');
    return;
  }
  if (
    teamStep?.key === 'review' &&
    (/P06 reviewer error/.test(run.input.task.title) ||
      !teamStep.deliveries?.some((delivery) => delivery.verified && delivery.outputHash) ||
      !run.input.files.some(
        (file) => file.path === 'src/add.cjs' && file.content.includes('a + b'),
      ))
  ) {
    res.writeHead(503);
    res.end('{"error":{"message":"review fixture requires a verified implementation handoff"}}');
    return;
  }
  if (
    run.input.task.title === 'Fix addition with skill material' &&
    run.requests === 1 &&
    (!JSON.stringify(value.input).includes('P03 frozen material marker.') ||
      !JSON.stringify(value.input).includes('Aviso de licencia de la fixture de FerWeb.') ||
      JSON.stringify(value.input).includes('New material that must stay out'))
  ) {
    res.writeHead(422);
    res.end('{"error":{"message":"wrong frozen skill content in Codex input"}}');
    return;
  }
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
    let command = readOnly
      ? `node tests/readonly-probe.cjs${cancel ? ' && sleep 30' : ''}`
      : teamStep?.key === 'review'
        ? 'node --test; node tests/isolation-probe.cjs'
        : cancel
          ? 'sleep 30'
          : `node --test; node tests/isolation-probe.cjs; node -e "require('node:fs').writeFileSync('src/add.cjs', 'exports.add = (a, b) => a + b${/P08 reproduced target/.test(run.input.task.title) ? ' + 1' : ''};\\n')"; node --test`;
    if (run.input.task.title === 'P10 bounded context')
      command = 'node tools/context-expand-probe.cjs && (' + command + ')';
    if (run.input.task.title === 'P11 typecheck failure')
      command = 'node tests/isolation-probe.cjs';
    if (
      run.input.task.title === 'P11 typecheck fix' ||
      run.input.task.title === 'P11 TypeScript team'
    ) {
      command = `node tests/isolation-probe.cjs && node -e "const fs=require('node:fs');const p='src/Counter.tsx';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('total=\\"wrong\\"','total={42}'))" && (${command})`;
    }
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
            text: dimension
              ? dimensionalFixture(run, dimension)
              : readOnly
                ? `P07 ${teamStep.key}: resultado independiente con fuentes intactas.${teamStep.key === 'summary' ? ' Resumen de las dos entregas verificadas.' : ''} Los criterios requieren revisión humana.`
                : 'Corregida la suma. Se ejecutaron node --test y la comprobación de aislamiento. Revisa el diff y la verificación independiente del controlador.',
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
function dimensionalFixture(run, context) {
  if (context.dimension === 'verify') {
    if (context.controllerEvidence.length < 3) throw Error('missing independent review evidence');
    return JSON.stringify({
      verifications: context.findings.map((f) => {
        const evidence = context.controllerEvidence.find((e) =>
          e.tests.some((t) => t.origin === 'controller-review-tests'),
        );
        const index = evidence?.tests.findIndex((t) => t.origin === 'controller-review-tests');
        const test = evidence?.tests[index];
        const line = test?.output.split('\n').find((l) => {
          try {
            return JSON.parse(l).name === 'adds positive and negative numbers';
          } catch {
            return false;
          }
        });
        return {
          findingId: f.id,
          status:
            line && JSON.parse(line).outcome === 'failed'
              ? 'confirmed'
              : line && JSON.parse(line).outcome === 'passed'
                ? 'refuted'
                : 'unverifiable',
          reason:
            'Fixture checks the exact named reproduction in a controller-owned test report, independently of agent claims.',
          proof: line ? { jobId: evidence.jobId, testIndex: index, quote: line.trim() } : null,
        };
      }),
    });
  }
  if (
    context.dimension === 'stack' &&
    (/P08 invalid dimension/.test(run.input.task.title) ||
      (/P08 corrected review/.test(run.input.task.title) && context.iteration === 1))
  )
    return '{"findings":[{"title":"missing required evidence"}]}';
  const source = run.input.files.find((f) => f.path === 'src/add.cjs');
  const common = {
    code: 'numeric_result',
    title:
      context.dimension === 'stack' ? 'Duplicate with a different title' : 'Check addition result',
    path: 'src/add.cjs',
    side: 'after',
    startLine: 1,
    endLine: 1,
    evidence: source.content.trim(),
    trigger: 'Call add(2, 3)',
    impact:
      context.dimension === 'stack'
        ? 'Wrong returned value affects callers.'
        : 'Incorrect arithmetic result.',
    severity: context.dimension === 'stack' ? 'medium' : 'high',
    reproductionTest: /P08 unverified/.test(run.input.task.title)
      ? null
      : 'adds positive and negative numbers',
  };
  return JSON.stringify({ findings: context.dimension === 'security-tests' ? [] : [common] });
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
