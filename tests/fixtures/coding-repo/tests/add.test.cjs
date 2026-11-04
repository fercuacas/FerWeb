const { test } = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/add.cjs');
test('adds positive and negative numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-2, 3), 1);
});
