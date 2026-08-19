// importの ?v=... はブラウザ/GitHub Pagesのキャッシュ対策(src/main.js冒頭のコメント参照)。
import { createInitialMap, ensureMapAhead, trimOldTrunkCells, branchesAt, getCell } from './mapGenerator.js?v=20260819a';
import { CHARACTERS, rollCharacterAttack } from './characters.js?v=20260818g';
import { BOSSES, calculateTargetedBalance, calculateTurnLimit, rollBossAttack } from './boss.js?v=20260819a';

export function rollDie(rng = Math.random) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

export function getPlayerProgressIndex(player, map) {
  if (!map) return 0;
  if (player.position.track === 'trunk') return player.position.index;
  const branch = map.branches.find((entry) => entry.id === player.position.track);
  return branch ? branch.connectFrom + 1 + player.position.index : player.position.index;
}

export function sortPlayersByProgress(players, map) {
  return [...players].sort((a, b) => getPlayerProgressIndex(b, map) - getPlayerProgressIndex(a, map));
}

// turnLimitOverride: これまでのターン数指定。targetMinutes が指定されればそれに
// 優先順位が置かれ、プレイ時間からボス HP・プレイヤー HP・攻撃力・ターン数を逆算する。
export function createGameState(playerSelections, bossId, rng = Math.random, turnLimitOverride = null, targetMinutes = null) {
  const targetBalance = Number.isFinite(targetMinutes) && Number(targetMinutes) > 0
    ? calculateTargetedBalance(playerSelections.length, Number(targetMinutes))
    : null;
  const boss = targetBalance ? BOSSES[targetBalance.bossId] ?? BOSSES[bossId] : BOSSES[bossId];

  const players = playerSelections.map((sel) => {
    const character = CHARACTERS[sel.characterId];
    const hpScale = targetBalance ? targetBalance.playerHpScale : 1;
    const maxHp = Math.round(character.maxHp * hpScale);
    return {
      id: sel.id,
      name: sel.name,
      characterId: sel.characterId,
      hp: maxHp,
      maxHp,
      attackScale: targetBalance ? targetBalance.attackScale : 1,
      position: { track: 'trunk', index: 0 },
      dead: false,
      deathAttempt: 0,
      buffs: [],
    };
  });

  const turnLimit = Number.isInteger(turnLimitOverride) && turnLimitOverride > 0
    ? turnLimitOverride
    : (targetBalance ? targetBalance.turnLimit : calculateTurnLimit(boss.maxHp, players.length));
  const bossHp = targetBalance ? targetBalance.bossHp : boss.maxHp;

  return {
    turn: 0,
    turnLimit,
    boss: { id: boss.id, name: boss.name, hp: bossHp, maxHp: bossHp },
    players,
    map: createInitialMap(rng),
  };
}

export function moveOnePlayer(map, position, steps, chooseBranch) {
  let { track, index } = position;
  for (let i = 0; i < steps; i++) {
    const forks = track === 'trunk' ? branchesAt(map, index) : [];
    if (forks.length > 0) {
      const choice = chooseBranch(forks);
      if (choice) {
        track = choice;
        index = 0;
        continue;
      }
    }
    index += 1;
    if (track !== 'trunk') {
      const branch = map.branches.find((b) => b.id === track);
      if (index >= branch.cells.length) {
        track = 'trunk';
        index = branch.connectTo;
      }
    }
  }
  return { track, index };
}

// 最後尾のプレイヤーからこの値より後ろの幹マスは毎ターン削除する(エンドレス
// マップがどこまでも肥大化しないようにするため)。
const TRIM_KEEP_BEHIND = 5;

export function resolveMovement(state, moves, chooseBranchFns, rng = Math.random) {
  const positions = state.players.map((p) => p.position);
  const map = ensureMapAhead(state.map, positions, 20, rng);

  const players = state.players.map((player) => {
    const steps = moves[player.id];
    const chooseBranch = chooseBranchFns[player.id] || (() => null);
    const position = moveOnePlayer(map, player.position, steps, chooseBranch);
    return { ...player, position };
  });

  const { map: trimmedMap, positions: trimmedPositions } = trimOldTrunkCells(
    map,
    players.map((p) => p.position),
    TRIM_KEEP_BEHIND,
  );
  const trimmedPlayers = players.map((player, i) => ({ ...player, position: trimmedPositions[i] }));

  return { ...state, map: trimmedMap, players: trimmedPlayers };
}

const HEAL_RADIUS = 3;
// 回復は出目に比例する(固定値ではない)。1目=12〜6目=72。
const HEAL_PER_DIE = 12;
// 防御(軽減量)も出目に比例する。1目=15〜6目=90。6目の最大軽減量(90)は
// 標準ボスfireDragonの最大威力(6目=90、boss.js参照)とちょうど釣り合うように
// 調整してある。
const DEFENSE_PER_DIE = 15;
// ダメージマスも同様に倍率制(1〜2目は0、3〜6目=30/40/50/60)。旧版は
// 3〜6ダメージ固定だったが、HP平均250に対しては誤差レベルで意味を失っていたため
// heal/defenseと同じ桁数になるよう引き上げた。
const DAMAGE_PER_DIE = 10;
// 死亡中プレイヤーは毎ターン、自分のマス効果の代わりに「復活ロール」を振る。
// 5・6: 代償なしで最大HPの半分まで回復して即時復活。
// 1: 生存中の他プレイヤー全員からHPを10ずつ徴収する代償で、人数xDEATH_COSTLY_REVIVE_HP_PER_PLAYER
//    のHPで即時復活。
// 2・3・4: 復活できず、ボスのHPがDEATH_STRUGGLE_BOSS_HEALだけ回復する。これが
//    DEATH_MAX_ATTEMPTS回目(3回目)の挑戦だった場合は、それでも代償なしで
//    最大HPの1/4まで回復して即時復活する(無限に足止めされないための保証)。
const DEATH_MAX_ATTEMPTS = 3;
const DEATH_FREE_REVIVE_HP_RATIO = 0.5;
const DEATH_GUARANTEED_REVIVE_HP_RATIO = 0.25;
const DEATH_COSTLY_REVIVE_HP_PER_PLAYER = 10;
// 代償で徴収する側は0まで削らない(このメカニクス単体の巻き添えで別の死亡が
// 連鎖するのを避けるための下限)。
const DEATH_COSTLY_DRAIN_PER_OTHER = 10;
const DEATH_COSTLY_DRAIN_FLOOR = 1;
const DEATH_STRUGGLE_BOSS_HEAL = 20;

function trackDistance(posA, posB) {
  if (posA.track !== posB.track) return Infinity;
  return Math.abs(posA.index - posB.index);
}

// 宝(item)マスのバフ表。出目が「種類」と「強さ・持続ターン数」を両方決める。
// バフは対象の行動(heal/defense/attack)にだけ乗る。他人には影響しない。
// 1人につき同時に1つまで(新しいバフで上書き)。「持続」は使用回数ではなく
// ターン数のカウントダウンで、使わなくても毎ターン1減って自然に切れる。
const ITEM_BUFF_TABLE = {
  1: { type: 'heal', bonus: 2, duration: 2 },
  2: { type: 'heal', bonus: 3, duration: 3 },
  3: { type: 'defense', bonus: 3, duration: 2 },
  4: { type: 'defense', bonus: 4, duration: 3 },
  5: { type: 'attack', bonus: 4, duration: 2 },
  6: { type: 'attack', bonus: 6, duration: 3 },
};

export function rollItemBuff(dieValue) {
  return ITEM_BUFF_TABLE[dieValue];
}

function buffBonusFor(player, type) {
  if (!player.buffs) return 0;
  return player.buffs.filter((b) => b.type === type).reduce((sum, b) => sum + b.bonus, 0);
}

// 職業ごとの固有効果(6目)。攻撃威力表そのものは既に高めだが、ここでさらに
// 「効果の質」で差別化する: critical=倍率, extraHit=追加の固定ダメージ,
// bigMagic=大きめの固定ダメージ, stealItem=お宝を1つ追加で引く(ダメージ量は変えない)。
function applyCharacterSpecial(special, power, player, itemRolls, log) {
  if (special === 'critical') {
    return { power: Math.round(power * 1.5) };
  }
  if (special === 'extraHit') {
    log.push({ type: 'special', by: player.id, special: 'extraHit', detail: '追加の矢: +4' });
    return { power: power + 4 };
  }
  if (special === 'bigMagic') {
    log.push({ type: 'special', by: player.id, special: 'bigMagic', detail: '大魔法の余波: +6' });
    return { power: power + 6 };
  }
  if (special === 'stealItem') {
    const stolenRoll = itemRolls[player.id] ?? 1;
    const rolled = rollItemBuff(stolenRoll);
    log.push({ type: 'special', by: player.id, special: 'stealItem', detail: `お宝を追加で1つ入手` });
    return { power, grantedBuff: { type: rolled.type, bonus: rolled.bonus, remainingTurns: rolled.duration } };
  }
  return { power };
}

export function resolveEffects(state, attackRolls = {}, damageRolls = {}, rngOrDefenseRolls = Math.random, maybeDefenseRolls = {}, itemRolls = {}) {
  const defenseRolls = typeof rngOrDefenseRolls === 'function' ? maybeDefenseRolls : rngOrDefenseRolls;
  const rng = typeof rngOrDefenseRolls === 'function' ? rngOrDefenseRolls : (typeof maybeDefenseRolls === 'function' ? maybeDefenseRolls : Math.random);

  let players = state.players.map((p) => ({ ...p }));
  let boss = { ...state.boss, lastRoll: state.boss?.lastRoll ?? null };
  const log = [];

  // 死亡中(前ターン以前に力尽きて、まだ復活していない)プレイヤー。
  // このターンの開始時点での状態を記録しておく(効果解決中に上書きされる前に)。
  const deadIds = new Set(players.filter((p) => p.dead).map((p) => p.id));

  // 1. マス効果はプレイヤー順に順番に処理する(死亡中のプレイヤーは対象外、
  //    代わりに後段の復活ロールで処理される)。
  //    これにより、回復・攻撃・防御・ダメージの演出が一斉ではなく、個別の視点で見える。
  const defendedPlayerIds = new Set();
  const defenseAmounts = new Map();
  const buffedThisTurn = new Set();
  for (const player of players) {
    if (deadIds.has(player.id)) continue;
    const cell = getCell(state.map, player.position.track, player.position.index);

    if (cell.type === 'heal') {
      // attackRollsは全マス種共通のロールチャンネルを流用している(mainからは
      // 常に同じeffectRollsが渡される)。未指定時は最低目(1)にフォールバック。
      const dieValue = attackRolls[player.id] ?? 1;
      const scale = player.attackScale ?? 1;
      const healAmount = (dieValue * HEAL_PER_DIE + buffBonusFor(player, 'heal')) * scale;
      for (const target of players) {
        if (target.id === player.id) continue;
        if (trackDistance(player.position, target.position) <= HEAL_RADIUS) {
          const before = target.hp;
          target.hp = Math.min(target.maxHp, target.hp + healAmount);
          if (target.hp !== before) log.push({ type: 'heal', by: player.id, target: target.id, amount: target.hp - before });
        }
      }
    }

    if (cell.type === 'attack') {
      const dieValue = attackRolls[player.id];
      const result = rollCharacterAttack(player.characterId, dieValue);
      const scale = player.attackScale ?? 1;
      const buffedPower = (result.power * scale) + buffBonusFor(player, 'attack');
      const { power, grantedBuff } = applyCharacterSpecial(result.special, buffedPower, player, itemRolls, log);
      boss.hp = Math.max(0, boss.hp - power);
      log.push({ type: 'attack', by: player.id, damage: power, special: result.special ?? null });
      if (grantedBuff) {
        player.buffs = [grantedBuff];
        buffedThisTurn.add(player.id);
      }
    }

    if (cell.type === 'defense') {
      const hasExplicitRoll = Object.prototype.hasOwnProperty.call(defenseRolls, player.id);
      const dieValue = hasExplicitRoll ? Number(defenseRolls[player.id]) : 1;
      const scale = player.attackScale ?? 1;
      const defenseValue = (dieValue * DEFENSE_PER_DIE + buffBonusFor(player, 'defense')) * scale;
      // 止まったプレイヤー自身に加え、同じマスにいる仲間も防御対象にする
      // (企画書の「同じマスにいるプレイヤーも防御対象になる」要件)。
      for (const target of players) {
        if (target.position.track !== player.position.track || target.position.index !== player.position.index) continue;
        defendedPlayerIds.add(target.id);
        defenseAmounts.set(target.id, (defenseAmounts.get(target.id) ?? 0) + defenseValue);
      }
      log.push({ type: 'defense', by: player.id, amount: defenseValue });
    }

    if (cell.type === 'damage') {
      const dieValue = damageRolls[player.id] ?? 1;
      const scale = player.attackScale ?? 1;
      const damage = dieValue <= 2 ? 0 : dieValue * DAMAGE_PER_DIE * scale;
      if (damage > 0) {
        player.hp = Math.max(0, player.hp - damage);
        log.push({ type: 'damage', target: player.id, amount: damage });
      } else {
        log.push({ type: 'damage', target: player.id, amount: 0 });
      }
    }

    if (cell.type === 'item') {
      const dieValue = itemRolls[player.id] ?? 1;
      const rolled = rollItemBuff(dieValue);
      player.buffs = [{ type: rolled.type, bonus: rolled.bonus, remainingTurns: rolled.duration }];
      buffedThisTurn.add(player.id);
      log.push({ type: 'item', by: player.id, buffType: rolled.type, bonus: rolled.bonus, duration: rolled.duration });
    }
  }

  // 2. 死亡中のプレイヤーは、通常のマス効果の代わりに復活ロールを処理する
  //    (このターン開始時点で死亡していた者のみ。今ターン新たに死亡した者は
  //    次のターンから対象になる)。
  for (const player of players) {
    if (!deadIds.has(player.id)) continue;
    const dieValue = attackRolls[player.id] ?? 1;

    if (dieValue === 5 || dieValue === 6) {
      const reviveHp = Math.floor(player.maxHp * DEATH_FREE_REVIVE_HP_RATIO);
      player.hp = reviveHp;
      player.dead = false;
      player.deathAttempt = 0;
      log.push({ type: 'deathRoll', target: player.id, value: dieValue, outcome: 'reviveFree', hp: reviveHp });
    } else if (dieValue === 1) {
      const reviveHp = players.length * DEATH_COSTLY_REVIVE_HP_PER_PLAYER;
      const donors = players.filter((other) => other.id !== player.id && !other.dead);
      for (const donor of donors) {
        donor.hp = Math.max(DEATH_COSTLY_DRAIN_FLOOR, donor.hp - DEATH_COSTLY_DRAIN_PER_OTHER);
      }
      player.hp = reviveHp;
      player.dead = false;
      player.deathAttempt = 0;
      log.push({ type: 'deathRoll', target: player.id, value: dieValue, outcome: 'reviveCostly', hp: reviveHp, donorIds: donors.map((d) => d.id) });
    } else {
      // 2, 3, 4
      boss.hp = Math.min(boss.maxHp, boss.hp + DEATH_STRUGGLE_BOSS_HEAL);
      const attempt = player.deathAttempt + 1;
      if (attempt >= DEATH_MAX_ATTEMPTS) {
        const reviveHp = Math.floor(player.maxHp * DEATH_GUARANTEED_REVIVE_HP_RATIO);
        player.hp = reviveHp;
        player.dead = false;
        player.deathAttempt = 0;
        log.push({ type: 'deathRoll', target: player.id, value: dieValue, outcome: 'reviveGuaranteed', hp: reviveHp, bossHeal: DEATH_STRUGGLE_BOSS_HEAL });
      } else {
        player.deathAttempt = attempt;
        log.push({ type: 'deathRoll', target: player.id, value: dieValue, outcome: 'struggle', attempt, bossHeal: DEATH_STRUGGLE_BOSS_HEAL });
      }
    }
  }

  // 3. ボス攻撃は最後にまとめて処理する(死亡中のプレイヤーは対象外)。
  if (boss.hp > 0) {
    const bossDie = rollDie(rng);
    boss.lastRoll = bossDie;
    const bossAttack = rollBossAttack(boss.id, bossDie);
    for (const player of players) {
      if (player.dead) continue;
      const reduction = defendedPlayerIds.has(player.id) ? defenseAmounts.get(player.id) ?? 0 : 0;
      const netDamage = Math.max(0, bossAttack.damage - reduction);
      if (!defendedPlayerIds.has(player.id) || netDamage > 0) {
        player.hp = Math.max(0, player.hp - netDamage);
      }
      log.push({ type: 'bossAttack', name: bossAttack.name, target: player.id, damage: netDamage, blocked: reduction });
    }
  }

  // 4. このターン新たに力尽きたプレイヤーを死亡状態にする(復活ロールは次の
  //    ターンから)。
  players = players.map((p) => {
    if (!p.dead && p.hp <= 0) {
      log.push({ type: 'death', target: p.id });
      return { ...p, hp: 0, dead: true, deathAttempt: 0 };
    }
    return p;
  });

  // お宝バフの残りターン数を消費する。このターン新たに付与されたバフは
  // まだ1ターンも経過していないので消費しない(buffedThisTurnで除外)。
  players = players.map((p) => {
    if (buffedThisTurn.has(p.id) || !p.buffs || p.buffs.length === 0) return p;
    const buffs = p.buffs
      .map((b) => ({ ...b, remainingTurns: b.remainingTurns - 1 }))
      .filter((b) => b.remainingTurns > 0);
    return { ...p, buffs };
  });

  return { ...state, players, boss, log };
}

export function checkGameOver(state) {
  if (state.boss.hp <= 0) return { over: true, result: 'win' };
  if (state.turn >= state.turnLimit) return { over: true, result: 'lose' };
  return { over: false, result: null };
}

export function playTurn(state, moves, chooseBranchFns, attackRolls, damageRolls, rngOrDefenseRolls = Math.random, maybeDefenseRolls = {}, itemRolls = {}) {
  const defenseRolls = typeof rngOrDefenseRolls === 'function' ? maybeDefenseRolls : rngOrDefenseRolls;
  const rng = typeof rngOrDefenseRolls === 'function' ? rngOrDefenseRolls : (typeof maybeDefenseRolls === 'function' ? maybeDefenseRolls : Math.random);

  const movedState = resolveMovement(state, moves, chooseBranchFns, rng);
  const resolvedState = resolveEffects(movedState, attackRolls, damageRolls, rng, defenseRolls, itemRolls);
  const nextState = { ...resolvedState, turn: resolvedState.turn + 1 };
  const gameOver = checkGameOver(nextState);
  return { state: nextState, gameOver };
}
