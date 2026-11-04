import { createServer } from 'node:http';
import { z } from 'zod';
import { readConfig } from './config.js';
import { createPool } from './database.js';
import { loadMigrations } from './migrations.js';
import { inspectDatabase } from './health.js';
import { JobQueue } from './modules/jobs/queue.js';
import { JobExecutor } from './modules/jobs/executor.js';
import { RunnerClient } from './modules/jobs/runner-client.js';
import { codingExecutor } from './modules/jobs/coding-executor.js';

try {
  const config = readConfig(),
    options = z
      .object({
        JOB_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(2),
        JOB_WORKER_LEASE_MS: z.coerce.number().int().min(2000).max(30000).default(5000),
        JOB_WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3002),
      })
      .parse(process.env);
  const pool = createPool(config),
    migrations = await loadMigrations();
  const health = await inspectDatabase(pool, migrations);
  if (health.checks.migrations !== 'ready') throw new Error('Schema not ready');
  const queue = new JobQueue(pool, options.JOB_WORKER_LEASE_MS);
  const executor = new JobExecutor(
    queue,
    options.JOB_WORKER_CONCURRENCY,
    codingExecutor(
      queue,
      new RunnerClient(
        process.env.RUNNER_URL ?? 'http://runner:8010',
        process.env.RUNNER_SERVICE_TOKEN ?? '',
      ),
      process.env.FERWEB_INTERNAL_API_URL ?? 'http://api:3001',
      process.env.RUNNER_SERVICE_TOKEN ?? '',
    ),
  );
  await executor.start();
  const server = createServer((_request, response) => {
    const ready = executor.ready();
    response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: ready ? 'ready' : 'unavailable' }));
  }).listen(options.JOB_WORKER_HEALTH_PORT, '0.0.0.0', () => {
    const address = server.address();
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'job_worker_ready',
        executorId: executor.id,
        healthPort: typeof address === 'object' ? address?.port : null,
      }),
    );
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 8000).unref();
    server.close();
    void executor
      .stop()
      .then(() => pool.end())
      .then(() => {
        clearTimeout(timer);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch {
  console.error(JSON.stringify({ level: 'error', event: 'job_worker_start_failed' }));
  process.exit(1);
}
