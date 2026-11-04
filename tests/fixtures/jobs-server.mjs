import { createApp } from '../../apps/api/dist/app.js';
import { readConfig } from '../../apps/api/dist/config.js';
import { createPool } from '../../apps/api/dist/database.js';
import { loadMigrations } from '../../apps/api/dist/migrations.js';
import { inspectDatabase } from '../../apps/api/dist/health.js';
const config = readConfig(),
  pool = createPool(config),
  migrations = await loadMigrations();
const server = createApp(() => inspectDatabase(pool, migrations), migrations.length, {
  pool,
  appOrigin: config.APP_ORIGIN,
  secureCookies: false,
}).listen(config.PORT, config.HOST, () =>
  console.log(JSON.stringify({ event: 'jobs_test_api_ready' })),
);
process.on('SIGTERM', () => server.close(() => void pool.end().then(() => process.exit(0))));
