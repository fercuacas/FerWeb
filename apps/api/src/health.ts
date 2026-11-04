import type { Readiness } from '@ferweb/contracts';
import type { Pool } from 'pg';
import type { Migration } from './migrations.js';

export type DatabaseSnapshot = Pick<Readiness, 'checks' | 'installation'>;

export async function inspectDatabase(
  pool: Pool,
  migrations: Migration[],
): Promise<DatabaseSnapshot> {
  const schema = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  if (!schema.rows[0]?.exists) {
    return {
      checks: {
        database: 'ready',
        migrations: 'pending',
        appliedMigrations: 0,
        requiredMigrations: migrations.length,
      },
      installation: null,
    };
  }
  const ledger = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations ORDER BY name',
  );
  const applied = new Map(ledger.rows.map((row) => [row.name, row.checksum]));
  const current =
    applied.size === migrations.length &&
    migrations.every((migration) => applied.get(migration.name) === migration.checksum);
  const checks: Readiness['checks'] = {
    database: 'ready',
    migrations: current ? 'ready' : 'pending',
    appliedMigrations: ledger.rows.length,
    requiredMigrations: migrations.length,
  };
  if (!current) return { checks, installation: null };
  const result = await pool.query<{ id: string; created_at: Date }>(
    'SELECT id, created_at FROM installation WHERE singleton = true',
  );
  const installation = result.rows[0];
  return {
    checks: { ...checks, migrations: installation ? 'ready' : 'pending' },
    installation: installation
      ? { id: installation.id, createdAt: installation.created_at.toISOString() }
      : null,
  };
}
