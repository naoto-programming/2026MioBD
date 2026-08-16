export const BOSSES = {
  fireDragon: {
    id: 'fireDragon',
    name: '炎竜',
    maxHp: 300,
    diceTable: {
      1: { name: '爪撃', damage: 4 },
      2: { name: '火球', damage: 6 },
      3: { name: '火球', damage: 6 },
      4: { name: '咆哮', damage: 3 },
      5: { name: '全体火炎', damage: 8 },
      6: { name: '大火炎', damage: 14 },
    },
  },
};

export function rollBossAttack(bossId, dieValue) {
  return BOSSES[bossId].diceTable[dieValue];
}

// avgDamagePerPlayerPerTurn = 1.2 は実測に基づく較正値(プレースホルダーではない)。
// プレイヤーは攻撃マスに止まったターンにしか攻撃できず、マスの種類は5種類の一様分布
// なので攻撃マスに止まる確率は1/5(=0.2)。4キャラクターの平均攻撃力はおよそ5.7。
// よって1人1ターンあたりの期待ダメージは 0.2 * 5.7 ≈ 1.15。1.2はこの実測値にわずかな
// 余裕を持たせた値で、safetyFactor(1.5)の安全マージンを実質的に保つために選んだ。
// 将来バランス調整する際は、この値を再導出する必要はない。
export function calculateTurnLimit(maxHp, playerCount, avgDamagePerPlayerPerTurn = 1.2, safetyFactor = 1.5) {
  if (playerCount < 1) {
    // A playerCount of 0 (e.g. from an unvalidated empty player-count input
    // elsewhere) would silently divide by zero and produce Infinity instead
    // of failing loudly, soft-locking the game with no dice buttons and no
    // way to recover. Fail fast here instead.
    throw new Error(`calculateTurnLimit: playerCount must be at least 1, got ${playerCount}`);
  }
  return Math.ceil((maxHp / (playerCount * avgDamagePerPlayerPerTurn)) * safetyFactor);
}
