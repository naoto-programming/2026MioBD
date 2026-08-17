import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCode } from '../src/network.js';

test('generateRoomCode returns a 4-character code by default', () => {
  const code = generateRoomCode(() => 0.5);
  assert.equal(code.length, 4);
});

test('generateRoomCode only uses unambiguous uppercase letters and digits (no 0/O/1/I/L)', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const code = generateRoomCode(Math.random);
    for (const ch of code) seen.add(ch);
  }
  for (const ch of seen) {
    assert.ok(/[2-9A-HJ-NP-Z]/.test(ch), `unexpected character in room code: ${ch}`);
  }
});

test('generateRoomCode is deterministic for a given rng sequence', () => {
  const values = [0, 0.5, 0.99, 0.25];
  const makeRng = () => {
    let calls = 0;
    return () => values[calls++ % values.length];
  };
  assert.equal(generateRoomCode(makeRng(), 4), generateRoomCode(makeRng(), 4));
});

test('generateRoomCode supports a custom length', () => {
  assert.equal(generateRoomCode(() => 0.1, 6).length, 6);
});
