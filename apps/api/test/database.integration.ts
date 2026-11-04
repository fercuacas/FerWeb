import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createPool } from '../src/database.js';
import { readConfig } from '../src/config.js';
import { inspectDatabase } from '../src/health.js';
import { applyMigrations, loadMigrations } from '../src/migrations.js';
import { createDatabaseAdmin } from './database-admin.js';

// Creates only a uniquely named disposable database; never resets the application DB.
test('real PostgreSQL: fresh schema, repeat/concurrent migration, checksum and rollback', async () => {
  const config = readConfig();
  const admin = createDatabaseAdmin(config);
  const database = `ferweb_test_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool({ ...config, POSTGRES_DB: database });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const migrations = await loadMigrations();
    const before = await inspectDatabase(pool, migrations);
    assert.equal(before.checks.database, 'ready');
    assert.equal(before.checks.migrations, 'pending');
    await Promise.all([applyMigrations(pool, migrations), applyMigrations(pool, migrations)]);
    const first = await inspectDatabase(pool, migrations);
    assert.equal(first.checks.migrations, 'ready');
    assert.ok(first.installation?.id);
    await applyMigrations(pool, migrations);
    assert.equal((await inspectDatabase(pool, migrations)).installation?.id, first.installation.id);
    const original = migrations[0];
    assert.ok(original);
    await assert.rejects(applyMigrations(pool, [{ ...original, checksum: 'changed' }]), /differ/);
    await assert.rejects(
      applyMigrations(pool, [
        ...migrations,
        {
          name: '003_intentional_failure.sql',
          checksum: 'test-only',
          sql: 'CREATE TABLE rollback_probe (id integer); SELECT * FROM deliberately_missing_table;',
        },
      ]),
    );
    const rollback = await pool.query("SELECT to_regclass('public.rollback_probe') AS probe");
    assert.equal(rollback.rows[0].probe, null);
    assert.equal((await inspectDatabase(pool, migrations)).installation?.id, first.installation.id);
  } finally {
    await pool.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
