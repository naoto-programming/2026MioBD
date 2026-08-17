import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal } from '../src/network.js';

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
