import { createApp } from '../../apps/api/dist/app.js';
import { readConfig } from '../../apps/api/dist/config.js';
import { createPool } from '../../apps/api/dist/database.js';
import { loadMigrations } from '../../apps/api/dist/migrations.js';
import { inspectDatabase } from '../../apps/api/dist/health.js';
import { GitHubService } from '../../apps/api/dist/modules/github/service.js';
import { githubFixture } from './github.mjs';
import { ChatService } from '../../apps/api/dist/modules/chat/service.js';
import { AiClient } from '../../apps/api/dist/modules/chat/client.js';
import { RetrievalService } from '../../apps/api/dist/modules/retrieval/service.js';
import { VectorStore } from '../../apps/api/dist/modules/retrieval/vector-store.js';
import { retrievalCorpus } from './retrieval.mjs';
import { randomUUID } from 'node:crypto';
import { LaboratoryService } from '../../apps/api/dist/modules/laboratory/service.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { codingCorpus } from './coding.mjs';
import { publicationFixture } from './publication.mjs';
import { CodingService } from '../../apps/api/dist/modules/jobs/coding-service.js';
import { RunnerClient } from '../../apps/api/dist/modules/jobs/runner-client.js';

// Only the browser test runner starts this server. There is no production mock switch.
const config = readConfig(),
  pool = createPool(config),
  migrations = await loadMigrations();
const fixture = publicationFixture(codingCorpus(retrievalCorpus(githubFixture())));
fixture.config.callbackUrl = config.APP_ORIGIN + '/api/github/callback';
const github = new GitHubService(pool, fixture.config, fixture.transport);
const ai = new AiClient(process.env.AI_TEST_URL, process.env.AI_TEST_TOKEN);
const vectorPrefix = `ferweb_browser_${randomUUID().replaceAll('-', '')}`;
const retrieval = new RetrievalService(
  pool,
  github,
  ai,
  new VectorStore(config.QDRANT_URL, vectorPrefix),
);
const chats = new ChatService(pool, ai, retrieval);
const laboratory = new LaboratoryService(pool, ai, retrieval);
const jobWorker = spawn(process.execPath, ['apps/api/dist/job-worker.js'], {
  env: {
    ...process.env,
    JOB_WORKER_HEALTH_PORT: '0',
    FERWEB_INTERNAL_API_URL: `http://127.0.0.1:${config.PORT}`,
  },
  stdio: 'inherit',
});
process.on('exit', () => jobWorker.kill('SIGTERM'));
const server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
  pool,
  appOrigin: config.APP_ORIGIN,
  secureCookies: config.COOKIE_SECURE,
  github,
  chats,
  retrieval,
  laboratory,
  coding: new CodingService(
    pool,
    github,
    new RunnerClient(process.env.RUNNER_URL, process.env.RUNNER_SERVICE_TOKEN),
  ),
  runnerToken: process.env.RUNNER_SERVICE_TOKEN,
}).listen(config.PORT, config.HOST);
process.on('SIGTERM', async () => {
  chats.shutdown();
  laboratory.shutdown();
  if (jobWorker.exitCode === null && jobWorker.signalCode === null) {
    const exited = once(jobWorker, 'exit');
    jobWorker.kill('SIGTERM');
    await exited;
  }
  const collections = await (await fetch(`${config.QDRANT_URL}/collections`)).json();
  for (const entry of collections.result.collections)
    if (entry.name.startsWith(vectorPrefix + '_'))
      await fetch(`${config.QDRANT_URL}/collections/${entry.name}`, { method: 'DELETE' });
  server.close(() => void pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
});
