// src/render.js
import { getCell } from './mapGenerator.js';

const BOARD_WINDOW = 10; // 各プレイヤーの前後何マスを表示するか

export function renderGame(state, container) {
  container.innerHTML = '';
  container.appendChild(renderBoss(state));
  container.appendChild(renderBoard(state));
  container.appendChild(renderPlayers(state));
}

function renderBoss(state) {
  const section = document.createElement('section');
  section.className = 'boss-panel';
  const hpPercent = Math.round((state.boss.hp / state.boss.maxHp) * 100);
  section.innerHTML = `
    <h2>${state.boss.name}</h2>
    <div class="hp-bar"><div class="hp-bar-fill" style="width:${hpPercent}%"></div></div>
    <p>HP ${state.boss.hp} / ${state.boss.maxHp}</p>
    <p>ターン ${state.turn + 1} / ${state.turnLimit}</p>
  `;
  return section;
}

const CELL_ICONS = { attack: '⚔', defense: '🛡', heal: '♥', item: '🎁', damage: '💥' };

function renderBoard(state) {
  const section = document.createElement('section');
  section.className = 'board';
  const furthest = state.players.reduce((max, p) => (p.position.track === 'trunk' ? Math.max(max, p.position.index) : max), 0);
  const start = Math.max(0, furthest - BOARD_WINDOW);
  const end = Math.min(state.map.trunk.length, furthest + BOARD_WINDOW);

  for (let i = start; i < end; i++) {
    const cell = state.map.trunk[i];
    const cellEl = document.createElement('span');
    cellEl.className = 'cell';
    cellEl.textContent = CELL_ICONS[cell.type];
    const here = state.players.filter((p) => p.position.track === 'trunk' && p.position.index === i);
    if (here.length > 0) {
      cellEl.title = here.map((p) => p.name).join(', ');
      cellEl.classList.add('occupied');
    }
    section.appendChild(cellEl);
  }
  return section;
}

// プレイヤーが幹上/分岐上のどちらにいるかを示すラベルを組み立てる
// (分岐上ならテーマ名も添える。renderPlayersがボード上に表示されない
// 分岐上プレイヤーの現在地を判別できるようにするための表示専用ヘルパー)
function trackDisplayLabel(map, position) {
  if (position.track === 'trunk') return '幹';
  const branch = map.branches.find((b) => b.id === position.track);
  return `枝(${branch.theme})`;
}

function renderPlayers(state) {
  const section = document.createElement('section');
  section.className = 'players';
  for (const player of state.players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    const card = document.createElement('div');
    card.className = 'player-card';

    const nameEl = document.createElement('strong');
    nameEl.textContent = player.name;
    const hpEl = document.createElement('span');
    hpEl.textContent = `HP ${player.hp} / ${player.maxHp}`;
    const cellEl = document.createElement('span');
    const trackLabel = trackDisplayLabel(state.map, player.position);
    cellEl.textContent = `現在地: ${trackLabel} ${player.position.index} ${CELL_ICONS[cell.type]}`;

    card.appendChild(nameEl);
    card.appendChild(hpEl);
    card.appendChild(cellEl);
    section.appendChild(card);
  }
  return section;
}
