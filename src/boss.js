// ダメージは旧版のおよそ2倍(characters.jsのHP・威力とセットで調整済み)。
// 1のみ「失敗」として据え置き、ミス演出を残す。
export const BOSSES = {
  fireDragon: {
    id: 'fireDragon',
    name: '炎竜',
    maxHp: 130,
    diceTable: {
      1: { name: '爪撃', damage: 8 },
      2: { name: '火球', damage: 12 },
      3: { name: '火球', damage: 12 },
      4: { name: '咆哮', damage: 6 },
      5: { name: '全体火炎', damage: 16 },
      6: { name: '大火炎', damage: 28 },
    },
  },
};

export function rollBossAttack(bossId, dieValue) {
  if (dieValue === 1) return { name: '失敗', damage: 0 };
  return BOSSES[bossId].diceTable[dieValue];
}

// avgDamagePerPlayerPerTurn は現在の実測と skipNextEffect のペナルティを反映した値。
// プレイヤーは攻撃マスに止まったターンにしか攻撃できず、マスの種類は5種類の一様分布
// なので攻撃マスに止まる確率は1/5(=0.2)。キャラクター威力がおよそ2倍になったのに
// 合わせてこの値もおよそ2倍(1.15→2.3)にしてある。ゲームのテンポを重視し、
// maxHpは300→130に引き下げて短めのターン数(3人プレイで概ね20〜40ターン)になるよう
// 調整した。詳細な検証は test/engine.test.js のMonte Carloテストを参照。
export function calculateTurnLimit(maxHp, playerCount, avgDamagePerPlayerPerTurn = 2.3, safetyFactor = 1.5) {
  if (playerCount < 1) {
    // A playerCount of 0 (e.g. from an unvalidated empty player-count input
    // elsewhere) would silently divide by zero and produce Infinity instead
    // of failing loudly, soft-locking the game with no dice buttons and no
    // way to recover. Fail fast here instead.
    throw new Error(`calculateTurnLimit: playerCount must be at least 1, got ${playerCount}`);
  }
  return Math.ceil((maxHp / (playerCount * avgDamagePerPlayerPerTurn)) * safetyFactor);
}
