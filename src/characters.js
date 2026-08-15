export const CHARACTERS = {
  warrior: {
    id: 'warrior',
    name: '剣士',
    maxHp: 30,
    diceTable: {
      1: { power: 3 },
      2: { power: 4 },
      3: { power: 5 },
      4: { power: 6 },
      5: { power: 7 },
      6: { power: 10, special: 'critical' },
    },
  },
  archer: {
    id: 'archer',
    name: '弓士',
    maxHp: 24,
    diceTable: {
      1: { power: 3 },
      2: { power: 4 },
      3: { power: 5 },
      4: { power: 6 },
      5: { power: 7 },
      6: { power: 8, special: 'extraHit' },
    },
  },
  thief: {
    id: 'thief',
    name: '盗賊',
    maxHp: 22,
    diceTable: {
      1: { power: 2 },
      2: { power: 3 },
      3: { power: 4 },
      4: { power: 5 },
      5: { power: 6 },
      6: { power: 6, special: 'stealItem' },
    },
  },
  mage: {
    id: 'mage',
    name: '魔法使い',
    maxHp: 20,
    diceTable: {
      1: { power: 4 },
      2: { power: 5 },
      3: { power: 6 },
      4: { power: 7 },
      5: { power: 8 },
      6: { power: 12, special: 'bigMagic' },
    },
  },
};

export function rollCharacterAttack(characterId, dieValue) {
  return CHARACTERS[characterId].diceTable[dieValue];
}
