import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal, generateJoinCode } from '../src/network.js';

test('encodeSignal/decodeSignal round-trips an offer description', () => {
  const desc = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n' };
  const decoded = decodeSignal(encodeSignal(desc));
  assert.deepEqual(decoded, desc);
});

test('encodeSignal/decodeSignal round-trips an answer description', () => {
  const desc = { type: 'answer', sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\n' };
  const decoded = decodeSignal(encodeSignal(desc));
  assert.deepEqual(decoded, desc);
});

test('encodeSignal produces a compact JSON payload (short keys)', () => {
  const payload = encodeSignal({ type: 'offer', sdp: 'x' });
  const parsed = JSON.parse(payload);
  assert.deepEqual(Object.keys(parsed).sort(), ['s', 't']);
  assert.equal(parsed.t, 'o');
  assert.equal(parsed.s, 'x');
});

test('decodeSignal maps the compact "a" type back to "answer"', () => {
  const decoded = decodeSignal(JSON.stringify({ t: 'a', s: 'sdp-text' }));
  assert.deepEqual(decoded, { type: 'answer', sdp: 'sdp-text' });
});

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
