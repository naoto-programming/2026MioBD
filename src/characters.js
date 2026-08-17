// HPは4クラス平均が250になるよう調整済み(300+260+230+210)/4=250、変更なし。
// 威力表は「ボスの体力をプレイヤーの4〜5倍(1200)に引き上げた分、プレイヤーの
// 攻撃力も増やす」という指摘に沿って全クラス x8(boss.js側のavgDamagePerPlayerPerTurn
// もこれに合わせて2.3→18に引き上げてある)。詳細な検証はboss.js内コメントと
// test/engine.test.js のMonte Carloテストを参照。
export const CHARACTERS = {
  warrior: {
    id: 'warrior',
    name: '剣士',
    maxHp: 300,
    diceTable: {
      1: { power: 48 },
      2: { power: 64 },
      3: { power: 80 },
      4: { power: 96 },
      5: { power: 112 },
      6: { power: 160, special: 'critical' },
    },
  },
  archer: {
    id: 'archer',
    name: '弓士',
    maxHp: 260,
    diceTable: {
      1: { power: 48 },
      2: { power: 64 },
      3: { power: 80 },
      4: { power: 96 },
      5: { power: 112 },
      6: { power: 128, special: 'extraHit' },
    },
  },
  thief: {
    id: 'thief',
    name: '盗賊',
    maxHp: 230,
    diceTable: {
      1: { power: 32 },
      2: { power: 48 },
      3: { power: 64 },
      4: { power: 80 },
      5: { power: 96 },
      6: { power: 96, special: 'stealItem' },
    },
  },
  mage: {
    id: 'mage',
    name: '魔法使い',
    maxHp: 210,
    diceTable: {
      1: { power: 64 },
      2: { power: 80 },
      3: { power: 96 },
      4: { power: 112 },
      5: { power: 128 },
      6: { power: 192, special: 'bigMagic' },
    },
  },
};

export function rollCharacterAttack(characterId, dieValue) {
  return CHARACTERS[characterId].diceTable[dieValue];
}
