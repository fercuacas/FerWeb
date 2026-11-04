import pg from 'pg';
import type { Config } from './config.js';

export function createPool(config: Config) {
  const pool = new pg.Pool({
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.POSTGRES_DB,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    max: 5,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 2000,
    query_timeout: 2500,
    application_name: 'ferweb-api',
  });
  pool.on('error', () =>
    console.error(JSON.stringify({ level: 'error', event: 'database_connection_error' })),
  );
  return pool;
}
