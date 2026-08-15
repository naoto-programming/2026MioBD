export const CELL_TYPES = ['attack', 'defense', 'heal', 'item', 'damage'];

export function randomCellType(rng = Math.random) {
  const index = Math.min(CELL_TYPES.length - 1, Math.floor(rng() * CELL_TYPES.length));
  return CELL_TYPES[index];
}

export function createCell(type) {
  return { type };
}

export function createInitialMap(rng = Math.random) {
  const trunk = [];
  for (let i = 0; i < 20; i++) trunk.push(createCell(randomCellType(rng)));
  return { trunk, branches: [] };
}

export function getCell(map, track, index) {
  if (track === 'trunk') return map.trunk[index];
  const branch = map.branches.find((b) => b.id === track);
  return branch.cells[index];
}

const BRANCH_THEMES = {
  attack: { attack: 0.4, defense: 0.1, heal: 0.1, item: 0.15, damage: 0.25 },
  defense: { attack: 0.1, defense: 0.4, heal: 0.15, item: 0.15, damage: 0.2 },
  heal: { attack: 0.1, defense: 0.1, heal: 0.4, item: 0.1, damage: 0.3 },
  item: { attack: 0.1, defense: 0.1, heal: 0.15, item: 0.45, damage: 0.2 },
  danger: { attack: 0.2, defense: 0.1, heal: 0.1, item: 0.1, damage: 0.5 },
};

export const BRANCH_THEME_NAMES = Object.keys(BRANCH_THEMES);

export function weightedCellType(weights, rng = Math.random) {
  const roll = rng();
  let cumulative = 0;
  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll < cumulative) return type;
  }
  return Object.keys(weights)[Object.keys(weights).length - 1];
}

export function createBranch(id, theme, connectFromIndex, rng = Math.random) {
  const length = 15 + Math.floor(rng() * 6); // 15-20
  const weights = BRANCH_THEMES[theme];
  const cells = [];
  for (let i = 0; i < length; i++) cells.push(createCell(weightedCellType(weights, rng)));
  return { id, theme, connectFrom: connectFromIndex, connectTo: null, cells };
}

export function extendTrunk(map, targetLength, rng = Math.random) {
  const trunk = map.trunk.slice();
  while (trunk.length < targetLength) trunk.push(createCell(randomCellType(rng)));
  return { ...map, trunk };
}

export function branchesAt(map, trunkIndex) {
  return map.branches.filter((b) => b.connectFrom === trunkIndex);
}

export function isBranchPoint(map, trunkIndex) {
  return branchesAt(map, trunkIndex).length > 0;
}

const BRANCH_SPAWN_CHANCE = 0.08;

export function ensureMapAhead(map, playerPositions, lookahead, rng = Math.random) {
  const furthestTrunkIndex = playerPositions
    .filter((p) => p.track === 'trunk')
    .reduce((max, p) => Math.max(max, p.index), 0);

  const targetLength = furthestTrunkIndex + lookahead + 1;
  const extended = extendTrunk(map, targetLength, rng);
  const branches = extended.branches.slice();

  for (let i = map.trunk.length; i < extended.trunk.length; i++) {
    if (isBranchPoint({ branches }, i)) continue;
    if (rng() < BRANCH_SPAWN_CHANCE) {
      const theme = BRANCH_THEME_NAMES[Math.floor(rng() * BRANCH_THEME_NAMES.length)];
      const branch = createBranch(`branch-${i}`, theme, i, rng);
      branch.connectTo = i + 5 + Math.floor(rng() * 5); // 5-9マス先で合流
      branches.push(branch);
    }
  }

  return { ...extended, branches };
}
