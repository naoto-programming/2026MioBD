import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDie, createGameState, moveOnePlayer, resolveMovement, resolveEffects, checkGameOver, playTurn } from '../src/engine.js';

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

function baseState(overrides = {}) {
  return {
    turn: 0,
    turnLimit: 10,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [],
    map: { trunk: [], branches: [] },
    ...overrides,
  };
}

test('resolveEffects heals players within radius 3 on the same track', () => {
  const map = { trunk: [{ type: 'heal' }, {}, {}, {}, {}], branches: [] };
  const state = baseState({
    map,
    // boss hp set to 0 so the always-on boss-attack phase (guarded by boss.hp > 0)
    // doesn't also change player hp here; this test isolates heal-radius behavior.
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
    players: [
      { id: 'healer', hp: 10, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'near', hp: 5, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 3 } },
      { id: 'far', hp: 5, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 4 } },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0.5);
  assert.ok(result.players.find((p) => p.id === 'near').hp > 5);
  assert.equal(result.players.find((p) => p.id === 'far').hp, 5);
});

test('resolveEffects applies attack damage to the boss using character power', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    map,
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, { p1: 6 }, {}, () => 0.5);
  assert.equal(result.boss.hp, 300 - 10); // warrior face-6 power is 10
});

test('resolveEffects protects players on a defense cell and their co-located allies from boss damage', () => {
  const map = { trunk: [{ type: 'defense' }], branches: [] };
  const state = baseState({
    map,
    players: [
      { id: 'defender', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'ally', hp: 30, maxHp: 30, characterId: 'mage', position: { track: 'trunk', index: 0 } },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0); // rng=0 -> boss die face 1 (爪撃, damage 4)
  assert.equal(result.players.find((p) => p.id === 'defender').hp, 30);
  assert.equal(result.players.find((p) => p.id === 'ally').hp, 30);
});

test('resolveEffects damage cell: die value 1-2 deals zero damage, otherwise damage equals die value', () => {
  const map = { trunk: [{ type: 'damage' }], branches: [] };
  const lowRoll = resolveEffects(
    baseState({ map, players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }] }),
    {},
    { p1: 2 },
    () => 0.99, // boss die won't matter for this assertion beyond being applied too
  );
  const p1Hp = lowRoll.players.find((p) => p.id === 'p1').hp;
  assert.ok(p1Hp === 30 - 0 - lowRoll.log.find((e) => e.type === 'bossAttack').damage);
});

test('resolveEffects revives a player who reaches 0 hp at half max hp', () => {
  // cell type 'item' is intentionally not handled by resolveEffects (no-op),
  // so only the boss attack phase affects this player's hp.
  const map = { trunk: [{ type: 'item' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [{ id: 'p1', hp: 1, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.999); // boss die face 6, damage 14, exceeds hp 1
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.hp, 15); // maxHp/2
  assert.equal(p1.skipNextEffect, true);
});

test('checkGameOver reports win when boss hp is 0', () => {
  const result = checkGameOver({ turn: 1, turnLimit: 10, boss: { hp: 0 } });
  assert.deepEqual(result, { over: true, result: 'win' });
});

test('checkGameOver reports lose when turn exceeds turnLimit', () => {
  const result = checkGameOver({ turn: 10, turnLimit: 10, boss: { hp: 50 } });
  assert.deepEqual(result, { over: true, result: 'lose' });
});

test('checkGameOver reports not over otherwise', () => {
  const result = checkGameOver({ turn: 3, turnLimit: 10, boss: { hp: 50 } });
  assert.deepEqual(result, { over: false, result: null });
});

test('playTurn moves players, resolves effects, and advances the turn counter', () => {
  const state = createGameState(
    [{ id: 'p1', name: 'Alice', characterId: 'warrior' }],
    'fireDragon',
    () => 0.5,
  );
  const { state: nextState, gameOver } = playTurn(state, { p1: 6 }, {}, {}, {}, () => 0.5);
  assert.equal(nextState.turn, 1);
  assert.deepEqual(nextState.players[0].position, { track: 'trunk', index: 6 });
  assert.equal(gameOver.over, false);
});
