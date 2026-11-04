import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(): Promise<Migration[]> {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const versions = names.map((name) => name.split('_')[0]);
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration version');
  return Promise.all(
    names.map(async (name) => {
      const sql = (
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
      ).replace(/\r\n/g, '\n');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

export async function applyMigrations(pool: Pool, migrations: Migration[]) {
  const client = await pool.connect();
  try {
    // One transaction makes both the initial schema and the migration ledger atomic.
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(736019241)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );
    const known = new Map(migrations.map((migration) => [migration.name, migration]));
    for (const row of applied.rows) {
      if (known.get(row.name)?.checksum !== row.checksum)
        throw new Error('Applied migrations differ from source');
    }
    const completed = new Set(applied.rows.map((row) => row.name));
    for (const migration of migrations) {
      if (completed.has(migration.name)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
