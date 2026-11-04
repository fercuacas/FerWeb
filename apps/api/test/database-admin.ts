import pg from 'pg';
import type { Config } from '../src/config.js';

// CREATE/DROP DATABASE may wait for a disk checkpoint, unlike API queries.
export function createDatabaseAdmin(config: Config) {
  return new pg.Pool({
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.POSTGRES_DB,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: 'ferweb-test-admin',
  });
}
