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
  if (track === 'trunk') {
    const cell = map.trunk[index];
    if (cell === undefined) {
      throw new Error(`getCell: trunk index ${index} is out of range (trunk length ${map.trunk.length})`);
    }
    return cell;
  }
  const branch = map.branches.find((b) => b.id === track);
  if (!branch) {
    throw new Error(`getCell: no branch found with id ${track}`);
  }
  const cell = branch.cells[index];
  if (cell === undefined) {
    throw new Error(`getCell: branch ${track} index ${index} is out of range (branch length ${branch.cells.length})`);
  }
  return cell;
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
  // A player currently on a branch will guarantee-rejoin the trunk at that
  // branch's connectTo, so their "future trunk position" for lookahead
  // purposes is connectTo, not their (branch-track) index. Without this, if
  // every player is on a branch, furthestTrunkIndex collapses to 0 and the
  // trunk stops extending, leaving dangling branch.connectTo values pointing
  // past the end of the trunk.
  const furthestTrunkIndex = playerPositions.reduce((max, p) => {
    if (p.track === 'trunk') return Math.max(max, p.index);
    const branch = map.branches.find((b) => b.id === p.track);
    return branch ? Math.max(max, branch.connectTo) : max;
  }, 0);

  const targetLength = furthestTrunkIndex + lookahead + 1;
  let extended = extendTrunk(map, targetLength, rng);
  const branches = extended.branches.slice();
  // Loop bound is captured once: the branch-spawn scan only considers indices
  // that were "new" as of this call, even though `extended` may grow further
  // below to make room for a late-spawning branch's connectTo.
  const scanEnd = extended.trunk.length;

  for (let i = map.trunk.length; i < scanEnd; i++) {
    if (isBranchPoint({ branches }, i)) continue;
    if (rng() < BRANCH_SPAWN_CHANCE) {
      const theme = BRANCH_THEME_NAMES[Math.floor(rng() * BRANCH_THEME_NAMES.length)];
      const branch = createBranch(`branch-${i}`, theme, i, rng);
      const rawConnectTo = i + 5 + Math.floor(rng() * 5); // 5-9マス先で合流
      // Guarantee connectFrom < connectTo <= trunk.length - 1 right now, at
      // generation time, rather than clamping down into a degenerate branch
      // that loops back to its own connectFrom when it spawns near the edge
      // of the currently-generated trunk: grow the trunk to fit instead.
      if (rawConnectTo >= extended.trunk.length) {
        extended = extendTrunk(extended, rawConnectTo + 1, rng);
      }
      branch.connectTo = rawConnectTo;
      branches.push(branch);
    }
  }

  return { ...extended, branches };
}
