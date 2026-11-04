import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/identity/passwords.js';

test('password hashes use independent salts and reject wrong passwords or malformed hashes', async () => {
  const password = 'test-only-long-password';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
});
