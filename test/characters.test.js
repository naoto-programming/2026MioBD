import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, rollCharacterAttack } from '../src/characters.js';

test('CHARACTERS contains the four phase-1 classes', () => {
  assert.deepEqual(Object.keys(CHARACTERS).sort(), ['archer', 'mage', 'thief', 'warrior']);
});

test('every character has a full 1-6 dice table with positive power', () => {
  for (const character of Object.values(CHARACTERS)) {
    for (let face = 1; face <= 6; face++) {
      const entry = character.diceTable[face];
      assert.ok(entry, `${character.id} missing face ${face}`);
      assert.ok(entry.power > 0, `${character.id} face ${face} power must be positive`);
    }
  }
});

test('rollCharacterAttack looks up power for a given class and die value', () => {
  const result = rollCharacterAttack('warrior', 6);
  assert.equal(result.power, CHARACTERS.warrior.diceTable[6].power);
  assert.equal(result.special, 'critical');
});

test('each character has a unique special effect on face 6', () => {
  const specials = Object.values(CHARACTERS).map((c) => c.diceTable[6].special);
  assert.equal(new Set(specials).size, specials.length);
});
