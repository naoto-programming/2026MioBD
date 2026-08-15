export const CELL_TYPES = ['attack', 'defense', 'heal', 'item', 'damage'];

export function randomCellType(rng) {
  const index = Math.min(CELL_TYPES.length - 1, Math.floor(rng() * CELL_TYPES.length));
  return CELL_TYPES[index];
}

export function createCell(type) {
  return { type };
}

export function createInitialMap(rng) {
  const trunk = [];
  for (let i = 0; i < 20; i++) trunk.push(createCell(randomCellType(rng)));
  return { trunk, branches: [] };
}

export function getCell(map, track, index) {
  if (track === 'trunk') return map.trunk[index];
  const branch = map.branches.find((b) => b.id === track);
  return branch.cells[index];
}
