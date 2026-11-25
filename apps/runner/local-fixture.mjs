// Test-only native Ollama wire double. Never imported by server.mjs.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export async function createLocalFixture(cloudRequests, token) {
  const state = { version: '0.13.4', revision: 'a'.repeat(64), tools: true };
  const requests = [];
  let responseRequests = 0,
    authorizationRequests = 0;
  const server = http.createServer(
    (req, res) =>
      void (async () => {
        const reply = (status, data) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        let text = '';
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 1300000) return reply(413, {});
        }
        const body = text ? JSON.parse(text) : {};
        if (req.url === '/test/state') {
          if (req.headers.authorization !== 'Bearer ' + token) return reply(401, {});
          if (req.method === 'POST')
            for (const key of ['version', 'revision', 'tools'])
              if (key in body) state[key] = body[key];
          return reply(200, {
            ...state,
            requests,
            responseRequests,
            authorizationRequests,
            cloudRequests: cloudRequests(),
          });
        }
        if (req.url === '/v1/responses') responseRequests++;
        if (req.headers.authorization) authorizationRequests++;
        requests.push({
          path: req.url,
          model: body.model ?? null,
          authorization: !!req.headers.authorization,
          tools: body.tools?.map((tool) => tool.name) ?? [],
        });
        if (requests.length > 2000) requests.shift();
        if (req.url === '/api/version') return reply(200, { version: state.version });
        if (req.url === '/api/tags')
          return reply(200, {
            models: [
              { name: 'fixture-local', digest: state.revision },
              { name: 'fixture-no-tools', digest: 'b'.repeat(64) },
              {
                name: 'fixture-alias',
                digest: 'c'.repeat(64),
                remote_host: 'https://ollama.com',
                remote_model: 'cloud-model',
              },
            ],
          });
        if (req.url === '/api/show')
          return reply(200, {
            capabilities:
              body.model === 'fixture-local' && state.tools
                ? ['completion', 'tools']
                : ['completion'],
          });
        if (req.url !== '/v1/responses' || req.method !== 'POST') return reply(404, {});
        if (
          body.model !== 'fixture-local' ||
          body.stream !== true ||
          body.previous_response_id ||
          body.conversation ||
          body.store ||
          req.headers.authorization ||
          body.tools.some(
            (tool) =>
              tool.type !== 'function' || !['exec_command', 'write_stdin'].includes(tool.name),
          )
        )
          return reply(422, {});
        const prompts = body.input
          .filter((item) => item.role === 'user')
          .flatMap((item) =>
            typeof item.content === 'string'
              ? [item.content]
              : (item.content ?? []).map((part) => part.text ?? ''),
          );
        const prompt = prompts.find((value) => value.includes('Task snapshot:')) ?? '';
        let task = {};
        try {
          task = JSON.parse(
            prompt.slice(prompt.lastIndexOf('Task snapshot:') + 'Task snapshot:'.length),
          );
        } catch {
          /* Invalid fixture prompt fails without external inference. */
        }
        const title = task.title ?? '';
        if (!title.startsWith('P20')) return reply(422, {});
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (/incomplete/.test(title)) {
          res.end('data: {"type":"response.created"}\n\n');
          return;
        }
        if (/oversize/.test(title)) {
          res.end('x'.repeat(4000001));
          return;
        }
        if (/cancel|timeout/.test(title)) {
          res.flushHeaders();
          const timer = setTimeout(() => res.end(), 60000);
          res.on('close', () => clearTimeout(timer));
          return;
        }
        const first = !body.input.some((item) => item.type === 'function_call_output');
        let output;
        if (first || /loop/.test(title)) {
          const code =
            'const fs=require("node:fs"),assert=require("node:assert/strict");assert.equal(process.getuid(),1000);assert.equal(fs.existsSync("/var/run/docker.sock"),false);assert.throws(()=>process.setuid(0));assert.equal(Object.keys(process.env).some(k=>/TOKEN|PASSWORD|API_KEY/.test(k)),false);const control=JSON.parse(fs.readFileSync("/control/input.json","utf8"));assert.equal("fence" in control,false);assert.equal("controlOrigin" in control,false);fetch("http://203.0.113.1",{signal:AbortSignal.timeout(300)}).then(()=>{throw Error("egress allowed")},()=>{fs.writeFileSync("src/add.cjs","exports.add = (a, b) => a + b;");console.log("P20 local tool isolation passed")})';
          const command = /loop/.test(title)
            ? 'printf P20-loop'
            : task.teamStep?.key === 'review'
              ? 'node --test'
              : "node -e '" + code + "' && node --test";
          output = [
            {
              type: 'function_call',
              id: 'fc_' + randomUUID(),
              call_id: 'call_' + randomUUID(),
              name: /unknown/.test(title) ? 'spawn_agent' : 'exec_command',
              arguments: /malformed/.test(title)
                ? '{broken'
                : JSON.stringify({ cmd: command, max_output_tokens: 2000, yield_time_ms: 10000 }),
              status: 'completed',
            },
          ];
        } else
          output = [
            {
              type: 'message',
              id: 'msg_' + randomUUID(),
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: 'P20 local delivery: tools changed the allowed snapshot; independent verification remains the controller responsibility.',
                  annotations: [],
                },
              ],
            },
          ];
        const response = {
          id: 'resp_' + randomUUID(),
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          model: body.model,
          status: 'completed',
          output,
        };
        const emit = (type, data) =>
          res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
        emit('response.created', { response: { ...response, status: 'in_progress', output: [] } });
        output.forEach((item, index) => {
          emit('response.output_item.added', {
            output_index: index,
            item: {
              ...item,
              ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }),
            },
          });
          if (item.type === 'function_call')
            emit('response.function_call_arguments.delta', {
              item_id: item.id,
              output_index: index,
              delta: item.arguments,
            });
          else {
            emit('response.content_part.added', {
              item_id: item.id,
              output_index: index,
              content_index: 0,
              part: { type: 'output_text', text: '', annotations: [] },
            });
            emit('response.output_text.delta', {
              item_id: item.id,
              output_index: index,
              content_index: 0,
              delta: item.content[0].text,
            });
          }
          emit('response.output_item.done', { output_index: index, item });
        });
        emit('response.completed', { response });
        res.end();
      })().catch(() => {
        if (!res.headersSent) res.writeHead(400);
        res.end('{}');
      }),
  );
  await new Promise((resolve) => server.listen(8011, '0.0.0.0', resolve));
  return {
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
