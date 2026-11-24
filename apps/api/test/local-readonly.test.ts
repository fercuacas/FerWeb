import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AiClient } from '../src/modules/chat/client.js';

test('local inference rejects untrusted service destinations before fetch and refuses redirects across internal RPCs', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('Unexpected transport call');
  };
  try {
    for (const base of [
      'https://api.openai.com',
      'http://external.test',
      'http://ai/v1',
      'http://user@ai:8000',
    ]) {
      const ai = new AiClient(base, 'fixture-private-service-token');
      await assert.rejects(ai.catalog('ollama'));
      await assert.rejects(ai.embeddings(['private excerpt']));
      await assert.rejects(async () => {
        for await (const _event of ai.generate(
          {
            id: randomUUID(),
            provider: 'ollama',
            model: 'allowed-model',
            localStructured: true,
            expectedRevision: 'observed',
            messages: [{ role: 'user', content: 'private excerpt' }],
            maxOutputTokens: 100,
          },
          new AbortController().signal,
        ))
          void _event;
      });
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
  let redirected = 0;
  const target = createServer((_req, res) => {
    redirected++;
    res.end('{}');
  }).listen(0, '127.0.0.1');
  let source: Server | undefined;
  try {
    await once(target, 'listening');
    const address = target.address();
    assert.ok(address && typeof address !== 'string');
    source = createServer((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${address.port}/untrusted` });
      res.end();
    }).listen(0, '127.0.0.1');
    await once(source, 'listening');
    const origin = source.address();
    assert.ok(origin && typeof origin !== 'string');
    const ai = new AiClient(`http://127.0.0.1:${origin.port}`, 'fixture-private-service-token');
    await assert.rejects(ai.catalog('ollama'));
    await assert.rejects(ai.embeddings(['excerpt']));
    await assert.rejects(async () => {
      for await (const _event of ai.generate(
        {
          id: randomUUID(),
          provider: 'ollama',
          model: 'allowed',
          messages: [{ role: 'user', content: 'excerpt' }],
          maxOutputTokens: 100,
        },
        new AbortController().signal,
      ))
        void _event;
    });
    assert.equal(redirected, 0);
  } finally {
    if (source) await new Promise<void>((resolve) => source!.close(() => resolve()));
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});
