import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPool } from './database.js';
import { inspectDatabase } from './health.js';
import { loadMigrations } from './migrations.js';
import { loadGitHubConfig } from './modules/github/config.js';
import { GitHubService } from './modules/github/service.js';
import { ChatService } from './modules/chat/service.js';
import { AiClient } from './modules/chat/client.js';
import { RetrievalService } from './modules/retrieval/service.js';
import { VectorStore } from './modules/retrieval/vector-store.js';
import { LaboratoryService } from './modules/laboratory/service.js';
import { CodingService } from './modules/jobs/coding-service.js';
import { RunnerClient } from './modules/jobs/runner-client.js';

try {
  const config = readConfig();
  const pool = createPool(config);
  const migrations = await loadMigrations();
  const github = new GitHubService(pool, await loadGitHubConfig());
  const ai = config.AI_SERVICE_TOKEN
    ? new AiClient(config.AI_SERVICE_URL, config.AI_SERVICE_TOKEN)
    : null;
  const retrieval = ai
    ? new RetrievalService(pool, github, ai, new VectorStore(config.QDRANT_URL))
    : undefined;
  const chats = new ChatService(pool, ai, retrieval);
  const laboratory = new LaboratoryService(pool, ai, retrieval);
  const runnerToken = process.env.RUNNER_SERVICE_TOKEN ?? '';
  const coding = new CodingService(
    pool,
    github,
    new RunnerClient(process.env.RUNNER_URL ?? 'http://runner:8010', runnerToken),
  );
  const server = createApp(
    () => inspectDatabase(pool, migrations),
    migrations.length,
    {
      pool,
      appOrigin: config.APP_ORIGIN,
      secureCookies: config.COOKIE_SECURE,
      github,
      chats,
      laboratory,
      coding,
      runnerToken,
      ...(retrieval ? { retrieval } : {}),
    },
    process.env.METRICS_TOKEN,
  ).listen(config.PORT, config.HOST, () => {
    console.log(JSON.stringify({ level: 'info', event: 'api_listening', port: config.PORT }));
  });
  server.on('error', () => {
    console.error(JSON.stringify({ level: 'error', event: 'api_start_failed' }));
    void pool.end().finally(() => process.exit(1));
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    chats.shutdown();
    laboratory.shutdown();
    const deadline = setTimeout(() => process.exit(1), 8000).unref();
    server.close(
      () =>
        void pool.end().finally(() => {
          clearTimeout(deadline);
          process.exit(0);
        }),
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith('Invalid environment fields:')
      ? error.message
      : 'API startup failed. Check configuration and migration files.',
  );
  process.exitCode = 1;
}
