import { createInitialMap, ensureMapAhead, branchesAt, getCell } from './mapGenerator.js';
import { CHARACTERS, rollCharacterAttack } from './characters.js';
import { BOSSES, calculateTurnLimit, rollBossAttack } from './boss.js';

export function rollDie(rng = Math.random) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

export function createGameState(playerSelections, bossId, rng = Math.random) {
  const boss = BOSSES[bossId];
  const players = playerSelections.map((sel) => {
    const character = CHARACTERS[sel.characterId];
    return {
      id: sel.id,
      name: sel.name,
      characterId: sel.characterId,
      hp: character.maxHp,
      maxHp: character.maxHp,
      position: { track: 'trunk', index: 0 },
      skipNextEffect: false,
    };
  });
  return {
    turn: 0,
    turnLimit: calculateTurnLimit(boss.maxHp, players.length),
    boss: { id: boss.id, name: boss.name, hp: boss.maxHp, maxHp: boss.maxHp },
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

export function resolveMovement(state, moves, chooseBranchFns, rng = Math.random) {
  const positions = state.players.map((p) => p.position);
  const map = ensureMapAhead(state.map, positions, 20, rng);

  const players = state.players.map((player) => {
    const steps = moves[player.id];
    const chooseBranch = chooseBranchFns[player.id] || (() => null);
    const position = moveOnePlayer(map, player.position, steps, chooseBranch);
    return { ...player, position };
  });

  return { ...state, map, players };
}

const HEAL_RADIUS = 3;
const HEAL_AMOUNT = 8;

function trackDistance(posA, posB) {
  if (posA.track !== posB.track) return Infinity;
  return Math.abs(posA.index - posB.index);
}

export function resolveEffects(state, attackRolls, damageRolls, rng = Math.random) {
  let players = state.players.map((p) => ({ ...p }));
  let boss = { ...state.boss };
  const log = [];

  // 1. 回復
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'heal') {
      for (const target of players) {
        if (trackDistance(player.position, target.position) <= HEAL_RADIUS) {
          const before = target.hp;
          target.hp = Math.min(target.maxHp, target.hp + HEAL_AMOUNT);
          if (target.hp !== before) log.push({ type: 'heal', by: player.id, target: target.id, amount: target.hp - before });
        }
      }
    }
  }

  // 2. 攻撃
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'attack') {
      const dieValue = attackRolls[player.id];
      const result = rollCharacterAttack(player.characterId, dieValue);
      boss.hp = Math.max(0, boss.hp - result.power);
      log.push({ type: 'attack', by: player.id, damage: result.power, special: result.special ?? null });
    }
  }

  // 3. 防御(同一マスの味方も対象)
  const defendedPlayerIds = new Set();
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'defense') {
      for (const target of players) {
        if (target.position.track === player.position.track && target.position.index === player.position.index) {
          defendedPlayerIds.add(target.id);
        }
      }
    }
  }

  // ダメージマス(防御は適用されない = プレイヤー自身のマス由来のダメージなので防御の対象外とする)
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'damage') {
      const dieValue = damageRolls[player.id];
      const damage = dieValue <= 2 ? 0 : dieValue;
      if (damage > 0) {
        player.hp = Math.max(0, player.hp - damage);
        log.push({ type: 'damage', target: player.id, amount: damage });
      }
    }
  }

  // 4. ボス攻撃(防御中のプレイヤーは無効)
  if (boss.hp > 0) {
    const bossDie = rollDie(rng);
    const bossAttack = rollBossAttack(boss.id, bossDie);
    for (const player of players) {
      if (!defendedPlayerIds.has(player.id)) {
        player.hp = Math.max(0, player.hp - bossAttack.damage);
      }
    }
    log.push({ type: 'bossAttack', name: bossAttack.name, damage: bossAttack.damage });
  }

  // 死亡プレイヤーの即時復活(ペナルティ: HP半分・次の効果を1回無効化)
  players = players.map((p) => {
    if (p.hp <= 0) {
      log.push({ type: 'revive', target: p.id });
      return { ...p, hp: Math.floor(p.maxHp / 2), skipNextEffect: true };
    }
    return p;
  });

  return { ...state, players, boss, log };
}

export function checkGameOver(state) {
  if (state.boss.hp <= 0) return { over: true, result: 'win' };
  if (state.turn >= state.turnLimit) return { over: true, result: 'lose' };
  return { over: false, result: null };
}

export function playTurn(state, moves, chooseBranchFns, attackRolls, damageRolls, rng = Math.random) {
  const movedState = resolveMovement(state, moves, chooseBranchFns, rng);
  const resolvedState = resolveEffects(movedState, attackRolls, damageRolls, rng);
  const nextState = { ...resolvedState, turn: resolvedState.turn + 1 };
  const gameOver = checkGameOver(nextState);
  return { state: nextState, gameOver };
}
