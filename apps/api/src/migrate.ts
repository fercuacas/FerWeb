import { readConfig } from './config.js';
import { createPool } from './database.js';
import { applyMigrations, loadMigrations } from './migrations.js';

try {
  const pool = createPool(readConfig());
  try {
    const migrations = await loadMigrations();
    await applyMigrations(pool, migrations);
    console.log(
      JSON.stringify({ level: 'info', event: 'migrations_applied', count: migrations.length }),
    );
  } finally {
    await pool.end();
  }
} catch {
  console.error(
    'Migration failed. Check database availability, configuration and migration history. No credentials are logged.',
  );
  process.exitCode = 1;
}
