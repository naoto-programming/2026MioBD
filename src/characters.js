// HPと威力はいずれも旧版のおよそ2倍(boss.jsのダメージ・avgDamagePerPlayerPerTurnと
// セットで調整済み)。「HPを高くする代わりにボスのダメージも上げる」という方針により、
// 1ヒットの数字が大きく・重く感じられるようにしつつ、ターン数は短縮する。
export const CHARACTERS = {
  warrior: {
    id: 'warrior',
    name: '剣士',
    maxHp: 60,
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
    maxHp: 48,
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
    maxHp: 44,
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
    maxHp: 40,
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
