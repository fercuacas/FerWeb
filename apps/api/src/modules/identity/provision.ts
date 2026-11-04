import type { Pool } from 'pg';
import { ownerInputSchema, userSchema } from '@ferweb/contracts';
import { hashPassword } from './passwords.js';

export async function provisionOwner(pool: Pool, input: unknown) {
  const value = ownerInputSchema.parse(input);
  const passwordHash = await hashPassword(value.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(736019242)');
    const existing = await client.query('SELECT 1 FROM app_users LIMIT 1');
    if (existing.rowCount)
      throw new Error('Owner already provisioned. Existing credentials are preserved.');
    const result = await client.query(
      'INSERT INTO app_users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [value.email, passwordHash],
    );
    await client.query('COMMIT');
    return userSchema.parse(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
