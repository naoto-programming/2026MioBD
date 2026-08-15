import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDie, createGameState, moveOnePlayer, resolveMovement } from '../src/engine.js';

test('rollDie returns 1-6 based on rng', () => {
  assert.equal(rollDie(() => 0), 1);
  assert.equal(rollDie(() => 0.999), 6);
});

test('createGameState sets up players, boss, turnLimit and initial map', () => {
  const state = createGameState(
    [
      { id: 'p1', name: 'Alice', characterId: 'warrior' },
      { id: 'p2', name: 'Bob', characterId: 'mage' },
    ],
    'fireDragon',
    () => 0.5,
  );
  assert.equal(state.turn, 0);
  assert.ok(state.turnLimit > 0);
  assert.equal(state.boss.hp, 300);
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].hp, state.players[0].maxHp);
  assert.deepEqual(state.players[0].position, { track: 'trunk', index: 0 });
  assert.equal(state.map.trunk.length, 20);
});

test('moveOnePlayer advances along the trunk when there is no fork', () => {
  const map = { trunk: Array.from({ length: 30 }, () => ({ type: 'attack' })), branches: [] };
  const position = moveOnePlayer(map, { track: 'trunk', index: 2 }, 4, () => null);
  assert.deepEqual(position, { track: 'trunk', index: 6 });
});

test('moveOnePlayer takes the branch when chooseBranch returns its id', () => {
  const map = {
    trunk: Array.from({ length: 10 }, () => ({ type: 'attack' })),
    branches: [{ id: 'branch-3', connectFrom: 3, connectTo: 7, cells: [{ type: 'heal' }, { type: 'heal' }] }],
  };
  const position = moveOnePlayer(map, { track: 'trunk', index: 1 }, 3, (forks) => forks[0].id);
  // step1: 1->2 (no fork), step2: 2->3 (no fork at 2), step3: at index3 fork exists -> enter branch index0
  assert.deepEqual(position, { track: 'branch-3', index: 0 });
});

test('moveOnePlayer rejoins the trunk after exhausting branch cells', () => {
  const map = {
    trunk: Array.from({ length: 10 }, () => ({ type: 'attack' })),
    branches: [{ id: 'branch-0', connectFrom: 0, connectTo: 5, cells: [{ type: 'heal' }] }],
  };
  const position = moveOnePlayer(map, { track: 'branch-0', index: 0 }, 1, () => null);
  assert.deepEqual(position, { track: 'trunk', index: 5 });
});

test('resolveMovement moves every player and extends the map ahead', () => {
  const state = createGameState(
    [{ id: 'p1', name: 'Alice', characterId: 'warrior' }],
    'fireDragon',
    () => 0.5,
  );
  const moved = resolveMovement(state, { p1: 6 }, {}, () => 0.5);
  assert.deepEqual(moved.players[0].position, { track: 'trunk', index: 6 });
  // ensureMapAhead extends based on pre-move positions (furthest index 0) with
  // lookahead 20 -> target length 21, comfortably past the post-move index 6.
  assert.equal(moved.map.trunk.length, 21);
});
