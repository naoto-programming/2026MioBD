// 早めの短時間プレイを許容するため、目標時間と人数でボスの難易度を切り替える。
// 5分程度の軽いゲームでは軽いボスを選び、最低HPも下げる。長時間プレイでは
// より重いボスを選び、HP/攻撃も上げる。
export const BOSSES = {
  emberWisp: {
    id: 'emberWisp',
    name: '火の小鬼',
    maxHp: 520,
    diceTable: {
      1: { name: '小突き', damage: 6 },
      2: { name: '火の粉', damage: 8 },
      3: { name: '火の粉', damage: 8 },
      4: { name: '焦り', damage: 7 },
      5: { name: '全体の火花', damage: 12 },
      6: { name: '爆発の火炎', damage: 18 },
    },
  },
  fireDragon: {
    id: 'fireDragon',
    name: '炎竜',
    maxHp: 1200,
    diceTable: {
      1: { name: '爪撃', damage: 10 }, // rollBossAttackが1目を強制的に失敗(0)にするため実際には使われない
      2: { name: '火球', damage: 12 },
      3: { name: '火球', damage: 12 },
      4: { name: '咆哮', damage: 8 },
      5: { name: '全体火炎', damage: 20 },
      6: { name: '大火炎', damage: 35 },
    },
  },
  magmaTitan: {
    id: 'magmaTitan',
    name: '熔岩王',
    maxHp: 1750,
    diceTable: {
      1: { name: '地割れ', damage: 12 },
      2: { name: '溶岩弾', damage: 16 },
      3: { name: '溶岩弾', damage: 16 },
      4: { name: '戦慄の咆哮', damage: 12 },
      5: { name: '全体溶岩', damage: 24 },
      6: { name: '天上火砕', damage: 42 },
    },
  },
};

export function pickBossForSettings(playerCount = 2, targetMinutes = 30) {
  const players = Math.min(8, Math.max(1, Number(playerCount) || 2));
  const minutes = Math.min(120, Math.max(5, Number(targetMinutes) || 30));
  const pressure = minutes + (players - 2) * 4;

  if (minutes <= 8 || pressure <= 12) return BOSSES.emberWisp;
  if (minutes >= 45 || players >= 6) return BOSSES.magmaTitan;
  return BOSSES.fireDragon;
}

export function rollBossAttack(bossId, dieValue) {
  const boss = BOSSES[bossId] ?? pickBossForSettings();
  if (dieValue === 1) return { name: '失敗', damage: 0 };
  return boss.diceTable[dieValue];
}

export function calculateTargetedBalance(playerCount, targetMinutes = 30) {
  const players = Math.min(8, Math.max(1, Number(playerCount) || 2));
  const minutes = Number.isFinite(targetMinutes) ? Math.max(5, Math.min(120, Number(targetMinutes))) : 30;
  const boss = pickBossForSettings(players, minutes);
  const shortnessFactor = Math.max(0.55, Math.min(1.45, 0.8 + (minutes - 5) * 0.018));
  const playerFactor = 1 + (players - 2) * 0.14;
  const turnLimit = Math.max(8, Math.round(minutes * (minutes <= 10 ? 1.9 : minutes <= 20 ? 1.7 : 1.5)));
  const bossHp = Math.max(Math.round(boss.maxHp * shortnessFactor * playerFactor), Math.round(boss.maxHp * 0.55));
  const playerHpScale = Math.max(0.8, Math.min(1.7, 0.88 + (minutes - 5) * 0.02));
  const attackScale = Math.max(1, 0.95 + (minutes - 5) * 0.012);
  return { bossId: boss.id, bossName: boss.name, turnLimit, bossHp, playerHpScale, attackScale };
}

// avgDamagePerPlayerPerTurn は現在の実測と死亡時の休み(restTurns)ペナルティを反映した値。
// プレイヤーは攻撃マスに止まったターンにしか攻撃できず、マスの種類は5種類の一様分布
// なので攻撃マスに止まる確率は1/5(=0.2)。キャラクター威力の平均は約90.7なので
// 0.2×90.7≈18.1が理論値、ここでは18を採用(maxHpが約9.2倍になったのに対応して
// 1.15→2.3→18とほぼ同じ倍率で引き上げている)。詳細な検証は
// test/engine.test.js のMonte Carloテストを参照。
export function calculateTurnLimit(maxHp, playerCount, avgDamagePerPlayerPerTurn = 18, safetyFactor = 1.5) {
  if (playerCount < 1) {
    // A playerCount of 0 (e.g. from an unvalidated empty player-count input
    // elsewhere) would silently divide by zero and produce Infinity instead
    // of failing loudly, soft-locking the game with no dice buttons and no
    // way to recover. Fail fast here instead.
    throw new Error(`calculateTurnLimit: playerCount must be at least 1, got ${playerCount}`);
  }
  return Math.ceil((maxHp / (playerCount * avgDamagePerPlayerPerTurn)) * safetyFactor);
}
