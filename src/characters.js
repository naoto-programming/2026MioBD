// HPは4クラス平均が250になるよう再調整(300+260+230+210)/4=250。
// 威力表・avgDamagePerPlayerPerTurnはこの回では変更しない(ターン数・勝率への
// 影響はboss.jsのMonte Carloテストで確認済み)。ボス側のダメージはHPの上昇に
// 合わせてboss.js側で引き上げてある。
export const CHARACTERS = {
  warrior: {
    id: 'warrior',
    name: '剣士',
    maxHp: 300,
    diceTable: {
      1: { power: 6 },
      2: { power: 8 },
      3: { power: 10 },
      4: { power: 12 },
      5: { power: 14 },
      6: { power: 20, special: 'critical' },
    },
  },
  archer: {
    id: 'archer',
    name: '弓士',
    maxHp: 260,
    diceTable: {
      1: { power: 6 },
      2: { power: 8 },
      3: { power: 10 },
      4: { power: 12 },
      5: { power: 14 },
      6: { power: 16, special: 'extraHit' },
    },
  },
  thief: {
    id: 'thief',
    name: '盗賊',
    maxHp: 230,
    diceTable: {
      1: { power: 4 },
      2: { power: 6 },
      3: { power: 8 },
      4: { power: 10 },
      5: { power: 12 },
      6: { power: 12, special: 'stealItem' },
    },
  },
  mage: {
    id: 'mage',
    name: '魔法使い',
    maxHp: 210,
    diceTable: {
      1: { power: 8 },
      2: { power: 10 },
      3: { power: 12 },
      4: { power: 14 },
      5: { power: 16 },
      6: { power: 24, special: 'bigMagic' },
    },
  },
};

export function rollCharacterAttack(characterId, dieValue) {
  return CHARACTERS[characterId].diceTable[dieValue];
}
