import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { userSchema, type User } from '@ferweb/contracts';
import { HttpError } from '../../http-error.js';
import { dummyPasswordHash, verifyPassword } from './passwords.js';

export const sessionCookie = 'ferweb_session';
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;
export function tokenHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function readToken(request: Request) {
  const match = request.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${sessionCookie}=`));
  const token = match?.slice(sessionCookie.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export async function currentUser(pool: Pool, request: Request): Promise<User | null> {
  const token = readToken(request);
  if (!token) return null;
  const result = await pool.query(
    'SELECT u.id, u.email FROM sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [tokenHash(token)],
  );
  return result.rows[0] ? userSchema.parse(result.rows[0]) : null;
}
async function countAttempt(pool: Pool, key: string, limit: number) {
  const result = await pool.query<{ attempts: number }>(
    `INSERT INTO login_attempts (key) VALUES ($1)
    ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN login_attempts.window_started_at < now() - interval '15 minutes' THEN 1 ELSE login_attempts.attempts + 1 END,
    window_started_at = CASE WHEN login_attempts.window_started_at < now() - interval '15 minutes' THEN now() ELSE login_attempts.window_started_at END
    RETURNING attempts`,
    [key],
  );
  if (result.rows[0]!.attempts > limit)
    throw new HttpError(
      429,
      'login_limited',
      'Demasiados intentos. Vuelve a intentarlo dentro de 15 minutos.',
    );
}
export async function signIn(
  pool: Pool,
  request: Request,
  response: Response,
  input: { email: string; password: string },
  secure: boolean,
) {
  await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  await pool.query("DELETE FROM login_attempts WHERE window_started_at < now() - interval '1 day'");
  const address = request.ip ?? 'unknown';
  const key = tokenHash(`account:${input.email}|${address}`);
  await countAttempt(pool, tokenHash(`ip:${address}`), 50);
  await countAttempt(pool, key, 10);
  const result = await pool.query<{ id: string; email: string; password_hash: string }>(
    'SELECT id, email, password_hash FROM app_users WHERE email = $1',
    [input.email],
  );
  const row = result.rows[0];
  const valid = await verifyPassword(input.password, row?.password_hash ?? dummyPasswordHash);
  if (!valid || !row)
    throw new HttpError(401, 'invalid_credentials', 'El correo o la contraseña no son correctos.');
  const token = randomBytes(32).toString('base64url');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = readToken(request);
    if (previous)
      await client.query('DELETE FROM sessions WHERE token_hash = $1 AND user_id = $2', [
        tokenHash(previous),
        row.id,
      ]);
    await client.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash(token), row.id, new Date(Date.now() + sessionLifetimeMs)],
    );
    await client.query('DELETE FROM login_attempts WHERE key = $1', [key]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api',
    maxAge: sessionLifetimeMs,
  });
  return userSchema.parse(row);
}
export async function signOut(pool: Pool, request: Request, response: Response, secure: boolean) {
  const token = readToken(request);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
  response.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'strict', secure, path: '/api' });
}
