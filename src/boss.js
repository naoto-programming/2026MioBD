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

// avgDamagePerPlayerPerTurn/safetyFactorは初期の仮値。実プレイで調整する想定。
export function calculateTurnLimit(maxHp, playerCount, avgDamagePerPlayerPerTurn = 6, safetyFactor = 1.5) {
  return Math.ceil((maxHp / (playerCount * avgDamagePerPlayerPerTurn)) * safetyFactor);
}
