import { createInitialMap, ensureMapAhead, branchesAt } from './mapGenerator.js';
import { CHARACTERS } from './characters.js';
import { BOSSES, calculateTurnLimit } from './boss.js';

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
