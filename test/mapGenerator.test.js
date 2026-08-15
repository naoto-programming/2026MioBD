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
