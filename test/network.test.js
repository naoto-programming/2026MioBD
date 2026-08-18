import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateJoinCode } from '../src/network.js';

test('generateJoinCode returns a 4-digit zero-padded numeric string', () => {
  assert.equal(generateJoinCode(() => 0), '0000');
  assert.equal(generateJoinCode(() => 0.00005), '0000');
  assert.equal(generateJoinCode(() => 0.9999), '9999');
  assert.equal(generateJoinCode(() => 0.12345), '1234');
});

test('generateJoinCode always produces exactly 4 numeric characters', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateJoinCode(Math.random);
    assert.match(code, /^\d{4}$/);
  }
});

test('generateJoinCode uses crypto randomness (not a fixed value) when called with no rng', () => {
  const codes = new Set();
  for (let i = 0; i < 20; i++) codes.add(generateJoinCode());
  assert.ok(codes.size > 1, 'expected at least some variation across calls');
});
