import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_TYPES, randomCellType, createCell, createInitialMap, getCell } from '../src/mapGenerator.js';

test('randomCellType returns a value from CELL_TYPES', () => {
  const type = randomCellType(() => 0);
  assert.ok(CELL_TYPES.includes(type));
});

test('randomCellType uses rng to pick deterministically', () => {
  assert.equal(randomCellType(() => 0), CELL_TYPES[0]);
  assert.equal(randomCellType(() => 0.999), CELL_TYPES[CELL_TYPES.length - 1]);
});

test('createCell wraps a type', () => {
  assert.deepEqual(createCell('attack'), { type: 'attack' });
});

test('createInitialMap creates 20 trunk cells and no branches', () => {
  const map = createInitialMap(() => 0.5);
  assert.equal(map.trunk.length, 20);
  assert.deepEqual(map.branches, []);
});

test('getCell reads a trunk cell by index', () => {
  const map = createInitialMap(() => 0);
  assert.deepEqual(getCell(map, 'trunk', 0), { type: CELL_TYPES[0] });
});

import {
  BRANCH_THEME_NAMES,
  weightedCellType,
  createBranch,
  extendTrunk,
  isBranchPoint,
  branchesAt,
  ensureMapAhead,
} from '../src/mapGenerator.js';

test('extendTrunk grows trunk to target length without shrinking existing cells', () => {
  const map = createInitialMap(() => 0);
  const original = map.trunk.slice();
  const extended = extendTrunk(map, 25, () => 0.99);
  assert.equal(extended.trunk.length, 25);
  assert.deepEqual(extended.trunk.slice(0, 20), original);
});

test('extendTrunk is a no-op when already long enough', () => {
  const map = createInitialMap(() => 0);
  const extended = extendTrunk(map, 5, () => 0.99);
  assert.equal(extended.trunk.length, 20);
});

test('weightedCellType respects cumulative weights', () => {
  const weights = { attack: 0.5, defense: 0.5 };
  assert.equal(weightedCellType(weights, () => 0), 'attack');
  assert.equal(weightedCellType(weights, () => 0.9), 'defense');
});

test('createBranch produces 15-20 cells with the requested theme', () => {
  const branch = createBranch('branch-3', 'heal', 3, () => 0.4);
  assert.equal(branch.id, 'branch-3');
  assert.equal(branch.theme, 'heal');
  assert.equal(branch.connectFrom, 3);
  assert.ok(branch.cells.length >= 15 && branch.cells.length <= 20);
});

test('ensureMapAhead extends trunk so furthest player has lookahead cells ahead', () => {
  const map = createInitialMap(() => 0);
  const positions = [{ track: 'trunk', index: 18 }];
  const result = ensureMapAhead(map, positions, 10, () => 0.99);
  assert.ok(result.trunk.length >= 18 + 10 + 1);
});

test('ensureMapAhead can spawn a branch and branchesAt/isBranchPoint reflect it', () => {
  const map = createInitialMap(() => 0);
  // furthest player is at index 5, lookahead 20 -> target length 26, which is
  // beyond the initial 20 cells, so new cells (indices 20-25) get generated
  // and checked for branch spawns.
  const positions = [{ track: 'trunk', index: 5 }];
  // Constant low rng: every random draw (cell type, spawn chance, theme,
  // branch length, branch cell types, connectTo offset) resolves to its
  // lowest/first option, so a branch is guaranteed at every new trunk index.
  const rng = () => 0.01;
  const result = ensureMapAhead(map, positions, 20, rng);
  assert.ok(result.branches.length > 0, 'expected at least one branch to spawn with this rng');
  const branch = result.branches[0];
  assert.ok(isBranchPoint(result, branch.connectFrom));
  assert.deepEqual(branchesAt(result, branch.connectFrom).map((b) => b.id), [branch.id]);
});

test('ensureMapAhead keeps extending the trunk when every player is currently on a branch', () => {
  // Regression test: furthestTrunkIndex used to be computed by filtering to
  // track === 'trunk' only, so if every player was off the trunk, the
  // reduce's initial value of 0 won. That froze the trunk from ever growing
  // again, leaving branch.connectTo values pointing past the end of the
  // trunk once a player eventually exits their branch.
  const map = { trunk: Array.from({ length: 25 }, () => ({ type: 'item' })), branches: [{ id: 'b', theme: 'heal', connectFrom: 5, connectTo: 22, cells: [{ type: 'item' }] }] };
  const positions = [{ track: 'b', index: 0 }];
  const result = ensureMapAhead(map, positions, 20, () => 0.99);
  // furthest guaranteed future trunk index is the branch's connectTo (22),
  // so the trunk should extend to at least connectTo + lookahead + 1 = 43.
  assert.ok(result.trunk.length >= 22 + 20 + 1, `expected trunk to keep extending past connectTo, got length ${result.trunk.length}`);
});

test('ensureMapAhead always produces branches whose connectTo is strictly ahead of connectFrom and within the generated trunk', () => {
  // Regression test for the branch-rejoin crash: connectTo must never point
  // past the trunk that exists right now (not "eventually, once some later
  // call repairs it"), and it must never collapse back onto connectFrom
  // either (which would silently produce a branch that loops in place).
  // Constant low rng guarantees a branch spawns at every new trunk index,
  // including the very last one generated in this call -- the exact edge
  // case where a naive clamp (Math.min(trunk.length - 1, ...)) degenerates
  // into connectFrom === connectTo instead of extending the trunk to fit.
  const map = createInitialMap(() => 0);
  const positions = [{ track: 'trunk', index: 0 }];
  const rng = () => 0.01;
  const result = ensureMapAhead(map, positions, 20, rng);
  assert.ok(result.branches.length > 0, 'expected at least one branch to spawn with this rng');
  for (const branch of result.branches) {
    assert.ok(branch.connectFrom < branch.connectTo, `branch ${branch.id}: connectFrom ${branch.connectFrom} must be < connectTo ${branch.connectTo}`);
    assert.ok(branch.connectTo <= result.trunk.length - 1, `branch ${branch.id}: connectTo ${branch.connectTo} must be <= trunk.length - 1 (${result.trunk.length - 1})`);
  }
});

test('getCell throws a descriptive error for an out-of-range trunk index instead of returning undefined', () => {
  const map = createInitialMap(() => 0);
  assert.throws(() => getCell(map, 'trunk', 999), /out of range/);
});

test('getCell throws a descriptive error for an out-of-range branch index instead of returning undefined', () => {
  const map = { trunk: [{ type: 'item' }], branches: [{ id: 'b', theme: 'heal', connectFrom: 0, connectTo: 5, cells: [{ type: 'item' }] }] };
  assert.throws(() => getCell(map, 'b', 999), /out of range/);
});

test('getCell throws a descriptive error for an unknown branch id', () => {
  const map = { trunk: [{ type: 'item' }], branches: [] };
  assert.throws(() => getCell(map, 'nonexistent-branch', 0), /no branch found/);
});
