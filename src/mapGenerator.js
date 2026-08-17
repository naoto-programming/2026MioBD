export const CELL_TYPES = ['attack', 'defense', 'heal', 'item', 'damage'];

export function randomCellType(rng = Math.random) {
  const index = Math.min(CELL_TYPES.length - 1, Math.floor(rng() * CELL_TYPES.length));
  return CELL_TYPES[index];
}

export function createCell(type) {
  return { type };
}

// 同じマス種が3つ以上連続しないようにする(体感で偏って見えるのを防ぐ)。
// 完全ランダムだと統計的には妥当でも、プレイヤーの目には「同じマスばかり」と
// 映りやすいための調整。rngが定数(テスト用)の場合はguardで打ち切り、
// 元の(偏った)結果にフォールバックする。
const MAX_STREAK = 2;

function pickAvoidingStreak(recentTypes, pick) {
  let type = pick();
  let guard = 0;
  while (
    recentTypes.length >= MAX_STREAK &&
    recentTypes.slice(-MAX_STREAK).every((t) => t === type) &&
    guard < 6
  ) {
    type = pick();
    guard += 1;
  }
  return type;
}

export function createInitialMap(rng = Math.random) {
  const trunk = [];
  const recent = [];
  for (let i = 0; i < 20; i++) {
    const type = pickAvoidingStreak(recent, () => randomCellType(rng));
    trunk.push(createCell(type));
    recent.push(type);
    if (recent.length > MAX_STREAK) recent.shift();
  }
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
  const recent = [];
  for (let i = 0; i < length; i++) {
    const type = pickAvoidingStreak(recent, () => weightedCellType(weights, rng));
    cells.push(createCell(type));
    recent.push(type);
    if (recent.length > MAX_STREAK) recent.shift();
  }
  return { id, theme, connectFrom: connectFromIndex, connectTo: null, cells, length };
}

export function extendTrunk(map, targetLength, rng = Math.random) {
  const trunk = map.trunk.slice();
  const recent = trunk.slice(-MAX_STREAK).map((c) => c.type);
  while (trunk.length < targetLength) {
    const type = pickAvoidingStreak(recent, () => randomCellType(rng));
    trunk.push(createCell(type));
    recent.push(type);
    if (recent.length > MAX_STREAK) recent.shift();
  }
  return { ...map, trunk };
}

export function branchesAt(map, trunkIndex) {
  return map.branches.filter((b) => b.connectFrom === trunkIndex);
}

export function isBranchPoint(map, trunkIndex) {
  return branchesAt(map, trunkIndex).length > 0;
}

// 最後尾(幹上で最も進んでいないプレイヤー)からkeepBehindマスより後ろの幹セルを
// 削除する。例: 最後尾がマス10、keepBehind=5なら、削除の閾値は10-5=5、つまり
// マス0〜5(5を含む6マス)を削除し、マス6以降(最後尾の5マス手前まで)を残す。
// 幹だけでなく、削除した分だけ枝のconnectFrom/connectToと全プレイヤーの
// (幹上の)位置インデックスも一緒にシフトする(結果を返り値のpositionsで反映)。
export function trimOldTrunkCells(map, playerPositions, keepBehind = 5) {
  const trunkProgress = playerPositions
    .filter((p) => p.track === 'trunk')
    .map((p) => p.index);

  if (trunkProgress.length === 0) {
    return { map, positions: playerPositions };
  }

  const earliest = Math.min(...trunkProgress);
  const removeThreshold = earliest - keepBehind; // このインデックス以下を削除
  const keepFrom = removeThreshold + 1;

  if (keepFrom <= 0) {
    return { map, positions: playerPositions };
  }

  const trimmedTrunk = map.trunk.slice(keepFrom);
  const offset = keepFrom;
  const trimmedBranches = map.branches.map((branch) => ({
    ...branch,
    connectFrom: Math.max(0, branch.connectFrom - offset),
    connectTo: branch.connectTo === null ? null : Math.max(0, branch.connectTo - offset),
    cells: branch.cells.slice(),
  }));

  const shiftedPositions = playerPositions.map((position) => (
    position.track === 'trunk' ? { ...position, index: Math.max(0, position.index - offset) } : position
  ));

  return {
    map: { ...map, trunk: trimmedTrunk, branches: trimmedBranches },
    positions: shiftedPositions,
  };
}

const BRANCH_SPAWN_CHANCE = 0.08;

export function ensureMapAhead(map, playerPositions, lookahead, rng = Math.random) {
  const furthestTrunkIndex = playerPositions.reduce((max, p) => {
    if (p.track === 'trunk') return Math.max(max, p.index);
    const branch = map.branches.find((b) => b.id === p.track);
    return branch ? Math.max(max, branch.connectTo) : max;
  }, 0);

  const targetLength = furthestTrunkIndex + lookahead + 1;
  let extended = extendTrunk(map, targetLength, rng);
  const branches = extended.branches.slice();
  const scanEnd = extended.trunk.length;

  for (let i = map.trunk.length; i < scanEnd; i++) {
    if (isBranchPoint({ branches }, i)) continue;
    if (rng() < BRANCH_SPAWN_CHANCE) {
      const theme = BRANCH_THEME_NAMES[Math.floor(rng() * BRANCH_THEME_NAMES.length)];
      const branch = createBranch(`branch-${i}`, theme, i, rng);
      const branchLength = branch.cells.length;
      const connectionDistance = branchLength + 5 + Math.floor(rng() * 6);
      const rawConnectTo = i + connectionDistance;
      if (rawConnectTo >= extended.trunk.length) {
        extended = extendTrunk(extended, rawConnectTo + 1, rng);
      }
      branch.connectTo = rawConnectTo;
      branches.push(branch);
    }
  }

  return { ...extended, branches };
}
