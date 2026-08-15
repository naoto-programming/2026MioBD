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
