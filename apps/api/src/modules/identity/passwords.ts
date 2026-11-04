import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt profile: N=2^15, r=8, p=3 (32 MiB working memory).
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split('$');
  if (
    parts[0] !== 'scrypt-v1' ||
    !/^[a-f0-9]{32}$/.test(parts[1] ?? '') ||
    !/^[a-f0-9]{128}$/.test(parts[2] ?? '')
  )
    return false;
  const actual = await derive(password, Buffer.from(parts[1]!, 'hex'));
  return timingSafeEqual(actual, Buffer.from(parts[2]!, 'hex'));
}
export const dummyPasswordHash = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
