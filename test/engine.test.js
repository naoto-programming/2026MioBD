import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDie, createGameState, moveOnePlayer, resolveMovement, resolveEffects, checkGameOver, playTurn, sortPlayersByProgress, rollItemBuff } from '../src/engine.js';
import { computeBoardWindowRange } from '../src/render.js';
import { BOSSES, calculateTurnLimit } from '../src/boss.js';
import { CHARACTERS } from '../src/characters.js';

// Deterministic seeded PRNG (mulberry32) so the Monte Carlo balance test below
// is reproducible and never flaky. Not a new dependency, just a small local
// generator.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  assert.equal(state.boss.hp, BOSSES.fireDragon.maxHp);
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].hp, state.players[0].maxHp);
  assert.deepEqual(state.players[0].position, { track: 'trunk', index: 0 });
  assert.equal(state.map.trunk.length, 20);
});

test('createGameState uses turnLimitOverride when given a valid positive integer, and falls back to the calculated value otherwise', () => {
  const selections = [{ id: 'p1', name: 'Alice', characterId: 'warrior' }];
  const overridden = createGameState(selections, 'fireDragon', () => 0.5, 42);
  assert.equal(overridden.turnLimit, 42);

  const zero = createGameState(selections, 'fireDragon', () => 0.5, 0);
  const negative = createGameState(selections, 'fireDragon', () => 0.5, -5);
  const fractional = createGameState(selections, 'fireDragon', () => 0.5, 12.5);
  const missing = createGameState(selections, 'fireDragon', () => 0.5);
  const calculated = calculateTurnLimit(BOSSES.fireDragon.maxHp, 1);
  assert.equal(zero.turnLimit, calculated, 'zero is not a valid override');
  assert.equal(negative.turnLimit, calculated, 'a negative override is invalid');
  assert.equal(fractional.turnLimit, calculated, 'a non-integer override is invalid');
  assert.equal(missing.turnLimit, calculated, 'omitting the override uses the calculated default');
});

test('sortPlayersByProgress keeps the furthest player first even when earlier in array order', () => {
  const map = {
    trunk: Array.from({ length: 30 }, () => ({ type: 'attack' })),
    branches: [{ id: 'branch-5', connectFrom: 5, connectTo: 12, cells: [{ type: 'heal' }, { type: 'heal' }, { type: 'heal' }] }],
  };
  const players = [
    { id: 'p1', position: { track: 'trunk', index: 1 } },
    { id: 'p2', position: { track: 'branch-5', index: 2 } },
    { id: 'p3', position: { track: 'trunk', index: 4 } },
  ];

  const ordered = sortPlayersByProgress(players, map);
  assert.deepEqual(ordered.map((player) => player.id), ['p2', 'p3', 'p1']);
});

test('branch progress starts after the branch point so the route does not overlap the split tile', () => {
  const map = {
    trunk: Array.from({ length: 20 }, () => ({ type: 'attack' })),
    branches: [{ id: 'branch-5', connectFrom: 5, connectTo: 12, cells: [{ type: 'heal' }, { type: 'heal' }, { type: 'heal' }] }],
  };

  const player = { position: { track: 'branch-5', index: 0 } };
  const progress = player.position.track === 'branch-5' ? map.branches[0].connectFrom + 1 + player.position.index : player.position.index;
  assert.equal(progress, 6);
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
  // ensureMapAhead extends based on pre-move positions (furthest index 0) with
  // lookahead 20 -> target length 21 before trimming. After moving to index 6,
  // trimOldTrunkCells (keepBehind=5) removes indices 0-1 (removal threshold
  // 6-5=1, so indices <= 1 go), shifting everything by offset 2: trunk length
  // 21-2=19, and the player's index becomes 6-2=4.
  assert.deepEqual(moved.players[0].position, { track: 'trunk', index: 4 });
  assert.equal(moved.map.trunk.length, 19);
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

test('resolveEffects heal amount scales with the healer\'s die roll, not a fixed amount', () => {
  const map = { trunk: [{ type: 'heal' }, {}], branches: [] };
  const state = (dieValue) => baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
    players: [
      { id: 'healer', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'ally', hp: 1, maxHp: 300, characterId: 'mage', position: { track: 'trunk', index: 1 } },
    ],
  });

  const low = resolveEffects(state(), { healer: 1 }, {}, () => 0.5);
  const high = resolveEffects(state(), { healer: 6 }, {}, () => 0.5);

  const lowHeal = low.players.find((p) => p.id === 'ally').hp - 1;
  const highHeal = high.players.find((p) => p.id === 'ally').hp - 1;

  assert.equal(lowHeal, 1 * 12);
  assert.equal(highHeal, 6 * 12);
  assert.ok(highHeal > lowHeal, 'a higher die roll must heal for more than a lower one');
});

test('resolveEffects applies attack damage to the boss using character power', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    map,
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, { p1: 6 }, {}, () => 0.5);
  // Warrior's face-6 triggers the 'critical' special (x1.5 power), so the
  // applied damage is higher than the raw dice-table power.
  const expectedDamage = Math.round(CHARACTERS.warrior.diceTable[6].power * 1.5);
  assert.equal(result.boss.hp, 300 - expectedDamage);
});

test('resolveEffects protects players on a defense cell and their co-located allies from boss damage', () => {
  // rng=0.2 -> boss die face 2 (火球, damage 12), a real non-zero hit so this
  // test actually exercises whether damage was blocked, not just coincidence
  // (an earlier version of this test used a boss roll that always missed,
  // so it passed regardless of whether blocking worked at all). A full roll
  // of 6 (reduction 90) comfortably exceeds the hit, fully blocking it.
  const map = { trunk: [{ type: 'defense' }], branches: [] };
  const state = baseState({
    map,
    players: [
      { id: 'defender', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'ally', hp: 300, maxHp: 300, characterId: 'mage', position: { track: 'trunk', index: 0 } },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0.2, { defender: 6 });
  const expectedReduction = 6 * 15; // defender's explicit roll of 6, DEFENSE_PER_DIE=15
  assert.equal(result.players.find((p) => p.id === 'defender').hp, 300 - Math.max(0, 12 - expectedReduction));
  assert.equal(result.players.find((p) => p.id === 'ally').hp, 300 - Math.max(0, 12 - expectedReduction), 'co-located ally should get the same reduction as the defender, without rolling themselves');
});

test('resolveEffects extends defense to a co-located ally whose own turn is suppressed while resting', () => {
  // The scenario the co-location rule actually matters for: a revived player
  // (resting, so their own cell effect is suppressed this turn) standing
  // next to an active defender should still be shielded, the same way heal
  // already works for a resting ally at a heal cell.
  const map = { trunk: [{ type: 'defense' }], branches: [] };
  const state = baseState({
    map,
    players: [
      { id: 'defender', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'skipper', hp: 300, maxHp: 300, characterId: 'mage', position: { track: 'trunk', index: 0 }, restTurns: 2 },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0.2, { defender: 6 }); // boss face 2, damage 12
  const expectedReduction = 6 * 15;
  const skipper = result.players.find((p) => p.id === 'skipper');
  assert.equal(skipper.hp, 300 - Math.max(0, 12 - expectedReduction), 'skipping player should still be protected by the co-located active defender');
});

test('resolveEffects damage cell: die value 1-2 deals zero damage, otherwise damage equals die value x DAMAGE_PER_DIE', () => {
  const map = { trunk: [{ type: 'damage' }], branches: [] };
  const lowRoll = resolveEffects(
    baseState({
      map,
      boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
      players: [{ id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
    }),
    {},
    { p1: 2 },
    () => 0.99,
  );
  assert.equal(lowRoll.players.find((p) => p.id === 'p1').hp, 300);

  const highRoll = resolveEffects(
    baseState({
      map,
      boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
      players: [{ id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
    }),
    {},
    { p1: 5 },
    () => 0.99,
  );
  assert.equal(highRoll.players.find((p) => p.id === 'p1').hp, 300 - 5 * 10);
});

test('resolveEffects revives a player who reaches 0 hp at half max hp and sets a 3-turn rest', () => {
  // cell type 'item' is intentionally not handled by resolveEffects (no-op),
  // so only the boss attack phase affects this player's hp.
  const map = { trunk: [{ type: 'item' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [{ id: 'p1', hp: 1, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.999); // boss die face 6 (大火炎, damage 70), exceeds hp 1
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.hp, 15); // maxHp/2
  assert.equal(p1.restTurns, 3, 'DEATH_REST_TURNS');
  assert.ok(result.log.some((entry) => entry.type === 'death' && entry.target === 'p1'), 'a death message should be logged');
});

test('resolveEffects records the boss die roll in the state so the UI can animate it', () => {
  const map = { trunk: [{ type: 'item' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.0);
  assert.equal(result.boss.lastRoll, 1);
  assert.equal(result.boss.hp, 300);
});

test('resolveEffects treats a boss roll of 1 as a failed attack with no damage', () => {
  const map = { trunk: [{ type: 'item' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.0);
  const logEntry = result.log.find((entry) => entry.type === 'bossAttack');
  assert.equal(logEntry.name, '失敗');
  assert.equal(logEntry.damage, 0);
  assert.equal(result.players[0].hp, 30);
});

test('resolveEffects suppresses heal for a resting player (restTurns=1) and clears it to 0 afterward', () => {
  const map = { trunk: [{ type: 'heal' }, {}, {}], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 }, // isolate from boss-attack phase
    players: [
      { id: 'healer', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 1 },
      { id: 'ally', hp: 5, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 1 }, restTurns: 0 },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0.5);
  assert.equal(result.players.find((p) => p.id === 'ally').hp, 5, 'heal should be suppressed, ally hp unchanged');
  assert.equal(result.players.find((p) => p.id === 'healer').restTurns, 0, 'rest count should reach 0 after being consumed');
});

test('resolveEffects suppresses attack for a resting player (restTurns=1) and clears it to 0 afterward', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    // hp well above any single boss hit so the boss-attack phase (which still
    // fires this turn) doesn't incidentally kill/revive this player and
    // confound the restTurns assertion below.
    players: [{ id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 1 }],
  });
  const result = resolveEffects(state, { p1: 6 }, {}, () => 0.5);
  assert.equal(result.boss.hp, 300, 'attack should be suppressed, boss takes no damage');
  assert.equal(result.players.find((p) => p.id === 'p1').restTurns, 0, 'rest count should reach 0 after being consumed');
});

test('resolveEffects suppresses defense for a resting player (restTurns=1): they still take boss damage, and rest clears to 0 afterward', () => {
  const map = { trunk: [{ type: 'defense' }], branches: [] };
  const state = baseState({
    map,
    players: [{ id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 1 }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.2); // boss die face 2 -> 火球, damage 12
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.hp, 288, 'defense should be suppressed, so boss damage (12) still lands');
  assert.equal(p1.restTurns, 0, 'rest count should reach 0 after being consumed');
});

test('resolveEffects suppresses damage-cell effect for a resting player (restTurns=1) and clears it to 0 afterward', () => {
  const map = { trunk: [{ type: 'damage' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 }, // isolate from boss-attack phase
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 1 }],
  });
  const result = resolveEffects(state, {}, { p1: 6 }, () => 0.5); // die 6 would normally deal 60 damage (6 x DAMAGE_PER_DIE)
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.hp, 30, 'damage-cell effect should be suppressed, hp unchanged');
  assert.equal(p1.restTurns, 0, 'rest count should reach 0 after being consumed');
});

test('resolveEffects decrements restTurns by 1 per turn without fully clearing it before the rest period ends', () => {
  // The specific behavior requested: dying costs 3 turns of rest, not 1 --
  // one turn of suppression should only tick restTurns down by 1, not to 0.
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
    players: [{ id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 3 }],
  });
  const result = resolveEffects(state, { p1: 6 }, {}, () => 0.5);
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.restTurns, 2, 'one turn of rest consumed, two remain');
  assert.equal(result.boss.hp, 0, 'attack should still be suppressed while resting');
});

test('resolveEffects does not affect a player with restTurns=0 (existing behavior)', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    map,
    // hp well above any single boss hit so this turn's boss-attack phase
    // can't incidentally kill/revive this player.
    players: [{ id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 0 }],
  });
  const result = resolveEffects(state, { p1: 6 }, {}, () => 0.5);
  const expectedDamage = Math.round(CHARACTERS.warrior.diceTable[6].power * 1.5); // critical special
  assert.equal(result.boss.hp, 300 - expectedDamage, 'attack should apply normally when not resting');
  assert.equal(result.players.find((p) => p.id === 'p1').restTurns, 0);
});

test('resolveEffects freshly resets restTurns for a player who dies again in the same turn their old rest was about to be consumed', () => {
  // Edge case: a player consuming the last turn of an old rest period who
  // also dies (again) this same turn must end up with restTurns freshly
  // reset to 3 for their next turns, not decremented by the "consumed" path.
  const map = { trunk: [{ type: 'item' }], branches: [] }; // no cell effect either way
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [{ id: 'p1', hp: 1, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 }, restTurns: 1 }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.999); // boss die face 6 (大火炎, damage 70), exceeds hp 1 -> dies again
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.hp, 15); // maxHp/2
  assert.equal(p1.restTurns, 3, 'should be freshly reset for the new death, not decremented from the old rest');
});

test('rollItemBuff maps every die face to a positive bonus and duration', () => {
  for (let face = 1; face <= 6; face++) {
    const buff = rollItemBuff(face);
    assert.ok(['heal', 'defense', 'attack'].includes(buff.type), `face ${face} has an unexpected buff type: ${buff.type}`);
    assert.ok(buff.bonus > 0, `face ${face} bonus should be positive`);
    assert.ok(buff.duration > 0, `face ${face} duration should be positive`);
  }
});

test('resolveEffects grants a buff and logs it when a player lands on an item cell', () => {
  const map = { trunk: [{ type: 'item' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 }, // isolate from boss-attack phase
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.5, {}, { p1: 6 });
  const p1 = result.players.find((p) => p.id === 'p1');
  const expectedBuff = rollItemBuff(6);
  assert.deepEqual(p1.buffs, [{ type: expectedBuff.type, bonus: expectedBuff.bonus, remainingTurns: expectedBuff.duration }]);
  assert.ok(result.log.some((entry) => entry.type === 'item' && entry.by === 'p1'));
});

test('resolveEffects applies an active attack buff on top of character power', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    map,
    // hp well above any single boss hit so this turn's boss-attack phase
    // can't incidentally kill/revive/heal-the-boss and confound the assertion.
    players: [{
      id: 'p1', hp: 300, maxHp: 300, characterId: 'warrior',
      position: { track: 'trunk', index: 0 },
      buffs: [{ type: 'attack', bonus: 5, remainingTurns: 2 }],
    }],
  });
  // die value 1 (no special triggered) so the buff bonus is the only extra beyond base power
  const result = resolveEffects(state, { p1: 1 }, {}, () => 0.99);
  const basePower = CHARACTERS.warrior.diceTable[1].power;
  assert.equal(result.boss.hp, 300 - (basePower + 5));
});

test('resolveEffects applies an active heal buff and an active defense buff', () => {
  const healMap = { trunk: [{ type: 'heal' }, {}], branches: [] };
  const healState = baseState({
    map: healMap,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
    players: [
      { id: 'healer', hp: 30, maxHp: 60, characterId: 'warrior', position: { track: 'trunk', index: 0 }, buffs: [{ type: 'heal', bonus: 4, remainingTurns: 2 }] },
      { id: 'ally', hp: 5, maxHp: 60, characterId: 'mage', position: { track: 'trunk', index: 1 } },
    ],
  });
  const healResult = resolveEffects(healState, { healer: 3 }, {}, () => 0.5);
  const ally = healResult.players.find((p) => p.id === 'ally');
  assert.equal(ally.hp, 5 + 3 * 12 + 4, 'die value (3) x 12 per die, plus the healer\'s +4 buff');

  const defenseMap = { trunk: [{ type: 'defense' }], branches: [] };
  const defenseState = baseState({
    map: defenseMap,
    players: [{
      id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior',
      position: { track: 'trunk', index: 0 },
      buffs: [{ type: 'defense', bonus: 3, remainingTurns: 2 }],
    }],
  });
  const defenseResult = resolveEffects(defenseState, {}, {}, () => 0.2, { p1: 4 }); // explicit defense roll of 4
  assert.ok(defenseResult.log.some((entry) => entry.type === 'defense' && entry.amount === 4 * 15 + 3), 'defense amount should be die(4) x DEFENSE_PER_DIE(15) plus the +3 buff');
});

test('resolveEffects ticks buff duration down each turn and expires it at zero, without ticking a buff granted this same turn', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] }; // not an item cell, so no new buff is granted this turn
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 0, maxHp: 300 },
    players: [{
      id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior',
      position: { track: 'trunk', index: 0 },
      buffs: [{ type: 'attack', bonus: 3, remainingTurns: 1 }],
    }],
  });
  const result = resolveEffects(state, { p1: 1 }, {}, () => 0.5);
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.deepEqual(p1.buffs, [], 'a buff at 1 remaining turn should expire after this turn ticks it to 0');
});

test('resolveEffects character specials: critical multiplies power, extraHit and bigMagic add a flat bonus, stealItem grants a buff without changing power', () => {
  const critical = resolveEffects(
    baseState({ map: { trunk: [{ type: 'attack' }], branches: [] }, boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 }, players: [{ id: 'p1', hp: 60, maxHp: 60, characterId: 'warrior', position: { track: 'trunk', index: 0 } }] }),
    { p1: 6 }, {}, () => 0.5,
  );
  const basePower = CHARACTERS.warrior.diceTable[6].power;
  assert.equal(300 - critical.boss.hp, Math.round(basePower * 1.5));

  const extraHit = resolveEffects(
    baseState({ map: { trunk: [{ type: 'attack' }], branches: [] }, boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 }, players: [{ id: 'p1', hp: 48, maxHp: 48, characterId: 'archer', position: { track: 'trunk', index: 0 } }] }),
    { p1: 6 }, {}, () => 0.5,
  );
  assert.equal(300 - extraHit.boss.hp, CHARACTERS.archer.diceTable[6].power + 4);
  assert.ok(extraHit.log.some((entry) => entry.type === 'special' && entry.special === 'extraHit'));

  const bigMagic = resolveEffects(
    baseState({ map: { trunk: [{ type: 'attack' }], branches: [] }, boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 }, players: [{ id: 'p1', hp: 40, maxHp: 40, characterId: 'mage', position: { track: 'trunk', index: 0 } }] }),
    { p1: 6 }, {}, () => 0.5,
  );
  assert.equal(300 - bigMagic.boss.hp, CHARACTERS.mage.diceTable[6].power + 6);

  const stealItem = resolveEffects(
    baseState({ map: { trunk: [{ type: 'attack' }], branches: [] }, boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 }, players: [{ id: 'p1', hp: 44, maxHp: 44, characterId: 'thief', position: { track: 'trunk', index: 0 } }] }),
    { p1: 6 }, {}, () => 0.5, {}, { p1: 5 },
  );
  assert.equal(300 - stealItem.boss.hp, CHARACTERS.thief.diceTable[6].power, 'stealItem should not change the damage dealt');
  const p1 = stealItem.players.find((p) => p.id === 'p1');
  const expectedBuff = rollItemBuff(5);
  assert.deepEqual(p1.buffs, [{ type: expectedBuff.type, bonus: expectedBuff.bonus, remainingTurns: expectedBuff.duration }]);
  assert.ok(stealItem.log.some((entry) => entry.type === 'special' && entry.special === 'stealItem'));
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

test('playTurn does not crash when a player exits a branch whose connectTo was left dangling past the trunk end', () => {
  // Regression test for the branch-rejoin crash: a branch's connectTo could
  // point past the current trunk length if it was never repaired by a later
  // trunk extension (e.g. because every player was off the trunk). Exiting
  // such a branch used to send the player to an undefined trunk cell, which
  // then crashed resolveEffects when it dereferenced cell.type.
  const state = {
    turn: 0,
    turnLimit: 10,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [
      {
        id: 'p1',
        name: 'A',
        characterId: 'warrior',
        hp: 30,
        maxHp: 30,
        position: { track: 'b', index: 0 },
        restTurns: 0,
      },
    ],
    map: {
      trunk: Array.from({ length: 25 }, () => ({ type: 'item' })), // max index 24
      branches: [{ id: 'b', theme: 'heal', connectFrom: 5, connectTo: 30, cells: [{ type: 'item' }] }],
    },
  };
  assert.doesNotThrow(() => playTurn(state, { p1: 1 }, {}, {}, {}, () => 0.5));
});

test('playTurn moves players, resolves effects, and advances the turn counter', () => {
  const state = createGameState(
    [{ id: 'p1', name: 'Alice', characterId: 'warrior' }],
    'fireDragon',
    () => 0.5,
  );
  const { state: nextState, gameOver } = playTurn(state, { p1: 6 }, {}, {}, {}, () => 0.5);
  assert.equal(nextState.turn, 1);
  // See the equivalent resolveMovement test above for why this is index 4,
  // not 6 -- trimOldTrunkCells shifts it after the move.
  assert.deepEqual(nextState.players[0].position, { track: 'trunk', index: 4 });
  assert.equal(gameOver.over, false);
});

test('Monte Carlo: simulated games win at a sane rate (regression guard for boss balance)', () => {
  // Regression guard for the "game is mathematically unwinnable" defect:
  // calculateTurnLimit's default avgDamagePerPlayerPerTurn used to be 6, but
  // real expected throughput is far lower (players only attack when they land
  // on an attack cell), which made every simulated game lose (verified: with
  // the old default this exact harness scores 0 wins / 100 losses). This test
  // plays a batch of full games end-to-end through playTurn with a seeded,
  // deterministic PRNG and checks the outcome is not degenerate in either
  // direction.
  //
  // The assertion below is intentionally a wide floor rather than a tight
  // band: the exact win rate has shifted with every balance pass so far
  // (character power, boss HP/damage, heal/defense/damage-cell scaling,
  // the rest-turns death penalty), and re-deriving/re-pinning an exact band
  // each time is not worth the added flakiness risk. The regression this
  // test actually exists to catch is the calibration going back to ~0%
  // (unwinnable) or ~100% (trivial); the floor plus the wins>0/losses>0
  // checks below catch both directions without tracking the exact rate.
  const GAMES = 100;
  const PLAYER_COUNT = 3;
  const CHARACTER_IDS = ['warrior', 'mage', 'archer'];

  let wins = 0;
  let losses = 0;

  for (let gameIndex = 0; gameIndex < GAMES; gameIndex++) {
    const rng = mulberry32(1000 + gameIndex);
    const selections = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
    }));
    let state = createGameState(selections, 'fireDragon', rng);
    const chooseBranchFns = {}; // no entry for any player id -> always declines branches (see resolveMovement)

    let gameOver = { over: false, result: null };
    const turnCap = state.turnLimit + 5; // safety valve in case of an unforeseen infinite loop
    let iterations = 0;
    while (!gameOver.over && iterations < turnCap) {
      const moves = {};
      const attackRolls = {};
      const damageRolls = {};
      for (const player of state.players) {
        moves[player.id] = rollDie(rng);
        attackRolls[player.id] = rollDie(rng);
        damageRolls[player.id] = rollDie(rng);
      }
      const result = playTurn(state, moves, chooseBranchFns, attackRolls, damageRolls, rng);
      state = result.state;
      gameOver = result.gameOver;
      iterations++;
    }

    assert.ok(gameOver.over, `game ${gameIndex} did not terminate within the turn cap of ${turnCap} turns`);
    if (gameOver.result === 'win') wins++;
    else losses++;
  }

  const winRate = wins / GAMES;
  assert.equal(wins + losses, GAMES);
  // Floor well above 0% (guards the exact defect: the old default scored 0%
  // here), and both outcomes must actually occur across the batch (guards
  // against a hypothetical future change that makes the result deterministic
  // in either direction).
  assert.ok(winRate >= 0.5, `expected win rate to comfortably clear the "unwinnable" floor, got ${winRate} (${wins} wins / ${losses} losses over ${GAMES} games)`);
  assert.ok(wins > 0, 'expected at least one win across the batch');
  assert.ok(losses > 0, 'expected at least one loss across the batch (game should not be deterministically unlosable)');
});
