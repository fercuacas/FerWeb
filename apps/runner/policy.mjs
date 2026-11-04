export function modelPayload(value, run) {
  const allowed = new Set([
    'model',
    'input',
    'instructions',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'reasoning',
    'text',
    'include',
    'stream',
    'store',
    'max_output_tokens',
    'prompt_cache_key',
    'prompt_cache_retention',
    'service_tier',
    'temperature',
    'top_p',
    'client_metadata',
  ]);
  function localTool(t) {
    return (
      t &&
      (t.type === 'function' ||
        t.type === 'custom' ||
        (t.type === 'namespace' && Array.isArray(t.tools) && t.tools.every(localTool)))
    );
  }
  if (
    !value ||
    Object.keys(value).some((k) => !allowed.has(k)) ||
    value.model !== run.input.model ||
    value.stream !== true ||
    !Array.isArray(value.input) ||
    (value.tools ?? []).some((t) => !localTool(t))
  )
    throw Error('model_policy');
  const types = new Set([
    'message',
    'reasoning',
    'function_call',
    'custom_tool_call',
    'function_call_output',
    'custom_tool_call_output',
  ]);
  for (const item of value.input) {
    if (!item || !types.has(item.type ?? (item.role ? 'message' : '')))
      throw Error('model_input_policy');
    for (const content of [item.content, item.output])
      if (
        Array.isArray(content) &&
        content.some((c) => !['input_text', 'output_text'].includes(c.type))
      )
        throw Error('model_content_policy');
    if (item.file_id || item.file_url || item.image_url) throw Error('model_content_policy');
  }
  return {
    ...value,
    store: false,
    max_output_tokens: run.input.maxOutputTokens,
    prompt_cache_key: 'ferweb:' + run.input.jobId,
  };
}
export function attachUsageMeter(run, res) {
  const slot = run.meters.length;
  run.meters.push(null);
  const decoder = new TextDecoder();
  let buffer = '';
  const original = res.write.bind(res);
  res.write = (chunk, ...args) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    buffer = buffer.replaceAll('\r\n', '\n');
    if (buffer.length > 4000000) throw Error('meter_stream_limit');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      try {
        const event = JSON.parse(data);
        if (
          ['response.completed', 'response.incomplete', 'response.failed'].includes(event.type) &&
          event.response?.usage
        ) {
          const u = event.response.usage,
            valid = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
          run.meters[slot] = {
            inputTokens: valid(u.input_tokens),
            cachedInputTokens: valid(u.input_tokens_details?.cached_tokens),
            outputTokens: valid(u.output_tokens),
            reasoningTokens: valid(u.output_tokens_details?.reasoning_tokens),
          };
        }
      } catch {
        /* Incomplete/other SSE records do not imply zero usage. */
      }
    }
    return original(chunk, ...args);
  };
}
export function providerUsage(run) {
  const result = {
    reportedRequests: run.meters.filter(Boolean).length,
    totalRequests: run.requests,
  };
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'])
    result[key] =
      run.meters.length && run.meters.every((m) => m?.[key] !== null && m?.[key] !== undefined)
        ? run.meters.reduce((sum, m) => sum + m[key], 0)
        : null;
  return result;
}
