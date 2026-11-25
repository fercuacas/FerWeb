import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code) => Object.assign(new Error(code), { code });
const toolNames = new Set(['exec_command', 'write_stdin']);
const commonProperties = {
  yield_time_ms: { type: 'integer', minimum: 0, maximum: 10000 },
  max_output_tokens: { type: 'integer', minimum: 0, maximum: 8192 },
};
const toolParameters = {
  exec_command: {
    type: 'object',
    properties: {
      cmd: { type: 'string', minLength: 1, maxLength: 16000 },
      workdir: { type: 'string', maxLength: 16000 },
      ...commonProperties,
    },
    required: ['cmd'],
    additionalProperties: false,
  },
  write_stdin: {
    type: 'object',
    properties: {
      session_id: { type: 'integer', minimum: 0 },
      chars: { type: 'string', maxLength: 16000 },
      ...commonProperties,
    },
    required: ['session_id'],
    additionalProperties: false,
  },
};
export function localEnvironment(environment, local) {
  return environment && local?.available
    ? {
        ...environment,
        simulated: local.simulated,
        inference: 'local-ollama',
        localRevision: local.configurationRevision,
      }
    : null;
}
export function localRequest(value, run = {}) {
  // Codex continues to own execution. Only its bounded shell/session functions
  // are exposed to this provider; no built-in web, MCP or delegated tools.
  const tools = (value.tools ?? [])
    .filter((tool) => tool.type === 'function' && toolNames.has(tool.name))
    .map((tool) => ({
      type: 'function',
      name: tool.name,
      description:
        tool.name === 'exec_command'
          ? 'Run a bounded command in the isolated workspace. No network or extra permissions.'
          : 'Read or send bounded input to an existing sandbox command session.',
      parameters: toolParameters[tool.name],
    }));
  if (!tools.some((tool) => tool.name === 'exec_command'))
    throw failure('local_tools_incompatible');
  if (
    value.input.some((item) => ['custom_tool_call', 'custom_tool_call_output'].includes(item.type))
  )
    throw failure('local_tools_incompatible');
  for (const item of value.input) {
    if (item.type === 'function_call' || item.type === 'function_call_output') {
      const issued = run.localIssued?.get(item.call_id);
      if (!issued) throw failure('local_history_invalid');
      if (item.type === 'function_call') {
        const args = argumentsValid(item.name, item.arguments);
        if (
          issued.name !== item.name ||
          issued.argsHash !== hash(Object.fromEntries(Object.entries(args).sort()))
        )
          throw failure('local_history_invalid');
      }
    }
  }
  return {
    model: value.model,
    input: value.input,
    stream: true,
    ...(value.instructions && { instructions: value.instructions }),
    tools,
    max_output_tokens: value.max_output_tokens,
    ...(value.reasoning && { reasoning: { effort: value.reasoning.effort } }),
  };
}
function argumentsValid(name, raw) {
  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    throw failure('local_tool_arguments');
  }
  if (!args || Array.isArray(args) || typeof args !== 'object')
    throw failure('local_tool_arguments');
  const allowed =
    name === 'exec_command'
      ? ['cmd', 'workdir', 'yield_time_ms', 'max_output_tokens']
      : ['session_id', 'chars', 'yield_time_ms', 'max_output_tokens'];
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw failure('local_tool_arguments');
  if (
    name === 'exec_command' &&
    (typeof args.cmd !== 'string' || !args.cmd.length || args.cmd.length > 16000)
  )
    throw failure('local_tool_arguments');
  if (name === 'write_stdin' && (!Number.isSafeInteger(args.session_id) || args.session_id < 0))
    throw failure('local_tool_arguments');
  for (const key of ['workdir', 'chars'])
    if (args[key] !== undefined && (typeof args[key] !== 'string' || args[key].length > 16000))
      throw failure('local_tool_arguments');
  for (const key of ['yield_time_ms', 'max_output_tokens'])
    if (
      args[key] !== undefined &&
      (!Number.isSafeInteger(args[key]) ||
        args[key] < 0 ||
        args[key] > (key === 'yield_time_ms' ? 10000 : 8192))
    )
      throw failure('local_tool_arguments');
  return args;
}
export function validateLocalStream(text, value, run) {
  const events = [];
  for (const block of text.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      throw failure('local_stream_invalid');
    }
  }
  const terminal = events.filter((event) =>
    ['response.completed', 'response.failed', 'response.incomplete'].includes(event.type),
  );
  if (
    terminal.length !== 1 ||
    terminal[0].type !== 'response.completed' ||
    terminal[0].response?.status !== 'completed'
  )
    throw failure('local_stream_incomplete');
  if (terminal[0].response.model && terminal[0].response.model !== value.model)
    throw failure('local_model_changed');
  const output = terminal[0].response.output;
  if (!Array.isArray(output) || output.length > 20) throw failure('local_stream_invalid');
  const calls = output.filter((item) => item.type === 'function_call');
  if (
    calls.length > 4 ||
    output.some((item) => !['function_call', 'message', 'reasoning'].includes(item.type))
  )
    throw failure('local_tools_incompatible');
  const declared = new Set(value.tools.map((tool) => tool.name));
  const deltas = new Map();
  for (const event of events.filter(
    (item) =>
      item.type === 'response.function_call_arguments.delta' ||
      item.type === 'response.function_call_arguments.done',
  )) {
    const call = calls.find((item) => item.id === event.item_id);
    if (!call) throw failure('local_stream_invalid');
    if (event.type.endsWith('.delta')) {
      if (typeof event.delta !== 'string') throw failure('local_stream_invalid');
      const text = (deltas.get(event.item_id) ?? '') + event.delta;
      if (text.length > 64000) throw failure('local_tool_arguments');
      deltas.set(event.item_id, text);
    } else if (event.arguments !== call.arguments) throw failure('local_stream_invalid');
  }
  for (const call of calls)
    if (deltas.has(call.id) && deltas.get(call.id) !== call.arguments)
      throw failure('local_stream_invalid');
  const ids = new Set();
  const progress = [
    ...new Set(
      value.input
        .filter((item) => item.type === 'function_call_output')
        .map((item) => {
          const output =
            typeof item.output === 'string'
              ? item.output
              : Array.isArray(item.output)
                ? item.output.map((part) => part.text ?? '').join('\n')
                : JSON.stringify(item.output);
          return output
            .replace(/^(Chunk ID|Wall time):.*$/gm, '')
            .replace(/duration_ms["':\s]+[0-9.]+/g, 'duration_ms')
            .trim();
        }),
    ),
  ].sort();
  run.localCalls ??= new Set();
  run.localIssued ??= new Map();
  for (const call of calls) {
    if (!declared.has(call.name) || !toolNames.has(call.name)) throw failure('local_tool_unknown');
    if (
      typeof call.call_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(call.call_id) ||
      ids.has(call.call_id) ||
      typeof call.arguments !== 'string' ||
      call.arguments.length > 64000
    )
      throw failure('local_tool_arguments');
    ids.add(call.call_id);
    if (run.localIssued.has(call.call_id)) throw failure('local_tool_replay');
    const args = argumentsValid(call.name, call.arguments);
    const signature = hash({
      name: call.name,
      args: Object.fromEntries(Object.entries(args).sort()),
      progress,
    });
    if (run.localCalls.has(signature)) throw failure('local_no_progress');
    run.localCalls.add(signature);
    run.localIssued.set(call.call_id, {
      name: call.name,
      argsHash: hash(Object.fromEntries(Object.entries(args).sort())),
    });
  }
  // Reject discrepancies before any streamed tool call can reach Codex.
  const announced = events
    .filter((event) => event.type === 'response.output_item.done')
    .map((event) => event.item);
  if (announced.length && !isDeepStrictEqual(announced, output))
    throw failure('local_stream_invalid');
  for (const event of events.filter((item) => item.type === 'response.output_item.added')) {
    const final = output.find((item) => item.id === event.item?.id);
    if (
      !final ||
      final.type !== event.item.type ||
      (final.type === 'function_call' &&
        (final.name !== event.item.name || final.call_id !== event.item.call_id))
    )
      throw failure('local_stream_invalid');
  }
  for (const item of output) {
    if (typeof item.id !== 'string' || item.id.length > 160) throw failure('local_stream_invalid');
    if (
      item.type === 'message' &&
      (item.role !== 'assistant' ||
        !Array.isArray(item.content) ||
        item.content.some((part) => part.type !== 'output_text' || typeof part.text !== 'string'))
    )
      throw failure('local_stream_invalid');
  }
  return terminal[0].response;
}

function canonicalStream(response, model) {
  // Native deltas are untrusted. Reconstruct the checked response so an early
  // or contradictory tool delta cannot execute before validation is complete.
  const final = { ...response, model, object: 'response', status: 'completed' };
  const chunks = [];
  const emit = (type, value) =>
    chunks.push('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...value }) + '\n\n');
  emit('response.created', { response: { ...final, status: 'in_progress', output: [] } });
  for (const [index, item] of final.output.entries()) {
    emit('response.output_item.added', {
      output_index: index,
      item: {
        ...item,
        ...(item.type === 'function_call'
          ? { arguments: '' }
          : item.type === 'message'
            ? { content: [] }
            : {}),
      },
    });
    if (item.type === 'function_call')
      emit('response.function_call_arguments.delta', {
        item_id: item.id,
        output_index: index,
        delta: item.arguments,
      });
    if (item.type === 'message')
      for (const [contentIndex, part] of item.content.entries()) {
        emit('response.content_part.added', {
          item_id: item.id,
          output_index: index,
          content_index: contentIndex,
          part: { ...part, text: '' },
        });
        emit('response.output_text.delta', {
          item_id: item.id,
          output_index: index,
          content_index: contentIndex,
          delta: part.text,
        });
      }
    emit('response.output_item.done', { output_index: index, item });
  }
  emit('response.completed', { response: final });
  return chunks.join('');
}

export class LocalProvider {
  constructor(config, simulated = false) {
    if (!config || Object.keys(config).some((key) => !['url', 'models'].includes(key)))
      throw failure('local_config_invalid');
    const url = new URL(config.url);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', 'host.docker.internal', 'ollama'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      throw failure('local_destination_denied');
    if (
      !Array.isArray(config.models) ||
      !config.models.length ||
      config.models.length > 20 ||
      config.models.some(
        (name) =>
          typeof name !== 'string' ||
          !/^[a-zA-Z0-9._:/-]{1,100}$/.test(name) ||
          /cloud/i.test(name),
      )
    )
      throw failure('local_models_invalid');
    this.base = url.origin;
    this.models = [...new Set(config.models)].sort();
    this.simulated = simulated;
  }
  async read(path, body, signal) {
    const response = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw failure('local_provider_unavailable');
    }
    let text = '';
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString('utf8');
      if (text.length > 1000000) throw failure('local_catalog_limit');
    }
    return JSON.parse(text);
  }
  async capabilities() {
    try {
      const signal = AbortSignal.timeout(3500);
      const { version } = await this.read('/api/version', undefined, signal);
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
        throw failure('local_server_incompatible');
      const [major, minor, patch] = version.split('.').map(Number);
      if (major === 0 && (minor < 13 || (minor === 13 && patch < 4)))
        throw failure('local_server_incompatible');
      const tags = await this.read('/api/tags', undefined, signal),
        models = [];
      for (const item of tags.models ?? []) {
        const id = item.name ?? item.model;
        if (
          !this.models.includes(id) ||
          /cloud/i.test(id) ||
          item.remote_host ||
          item.remote_model ||
          typeof item.digest !== 'string' ||
          !item.digest.length ||
          item.digest.length > 200
        )
          continue;
        const detail = await this.read('/api/show', { model: id }, signal);
        if (
          detail.remote_host ||
          detail.remote_model ||
          !detail.capabilities?.includes('tools') ||
          !detail.capabilities.includes('completion')
        )
          continue;
        models.push({ id, revision: item.digest });
      }
      models.sort((a, b) => a.id.localeCompare(b.id));
      return {
        available: models.length > 0,
        models,
        version,
        simulated: this.simulated,
        configurationRevision: hash({
          protocol: 'ollama-responses-v1',
          base: this.base,
          allowed: this.models,
          models,
          version,
        }),
        reason: models.length ? null : 'no_allowed_models',
      };
    } catch (error) {
      return {
        available: false,
        models: [],
        version: null,
        simulated: this.simulated,
        configurationRevision: null,
        reason:
          error.code === 'local_server_incompatible'
            ? 'local_server_incompatible'
            : 'local_provider_unavailable',
      };
    }
  }
  async generate(run, value, res) {
    const catalog = await this.capabilities();
    if (
      !catalog.available ||
      catalog.configurationRevision !== run.input.environment.localRevision ||
      !catalog.models.some(
        (model) => model.id === value.model && model.revision === run.input.modelRevision,
      )
    )
      throw failure('local_model_changed');
    const abort = new AbortController();
    run.upstreams.add(abort);
    const timer = setTimeout(
      () => abort.abort(),
      Math.max(1, Math.min(120000, run.deadline - Date.now())),
    );
    res.on('close', () => abort.abort());
    try {
      const response = await fetch(this.base + '/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
        signal: abort.signal,
        redirect: 'error',
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw failure('local_responses_incompatible');
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 4000000) {
          abort.abort();
          throw failure('local_output_limit');
        }
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const final = validateLocalStream(text, value, run);
      run.report.execution.reportedModel = final.model ?? null;
      if (run.finishing || Date.now() >= run.deadline || Date.now() >= run.lease)
        throw failure('execution_limit');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(canonicalStream(final, value.model));
      res.end();
    } catch (error) {
      if (typeof error.code === 'string' && /^local_[a-z_]+$/.test(error.code)) throw error;
      throw failure('local_provider_failed');
    } finally {
      clearTimeout(timer);
      run.upstreams.delete(abort);
    }
  }
}
