import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSSES, rollBossAttack, calculateTurnLimit } from '../src/boss.js';

test('fireDragon has a full 1-6 dice table matching the design doc flavor', () => {
  const names = [1, 2, 3, 4, 5, 6].map((face) => BOSSES.fireDragon.diceTable[face].name);
  assert.deepEqual(names, ['爪撃', '火球', '火球', '咆哮', '全体火炎', '大火炎']);
});

test('rollBossAttack returns the dice table entry for the given face', () => {
  const result = rollBossAttack('fireDragon', 6);
  assert.equal(result.name, '大火炎');
  assert.ok(result.damage > 0);
});

test('calculateTurnLimit scales inversely with player count', () => {
  const limitFor2 = calculateTurnLimit(300, 2);
  const limitFor8 = calculateTurnLimit(300, 8);
  assert.ok(limitFor2 > limitFor8);
});

test('calculateTurnLimit is a positive integer', () => {
  const limit = calculateTurnLimit(300, 4);
  assert.ok(Number.isInteger(limit));
  assert.ok(limit > 0);
});

test('calculateTurnLimit throws a descriptive error for a playerCount below 1 instead of producing Infinity', () => {
  // Regression guard: an unvalidated empty/zero player-count input elsewhere
  // (e.g. Number("") === 0) used to silently divide by zero here, producing
  // Infinity and soft-locking the game. This should fail loudly instead.
  assert.throws(() => calculateTurnLimit(300, 0), /playerCount must be at least 1/);
  assert.throws(() => calculateTurnLimit(300, -1), /playerCount must be at least 1/);
});
