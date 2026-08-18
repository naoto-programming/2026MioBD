// src/render.js
// importの ?v=... はブラウザ/GitHub Pagesのキャッシュ対策(src/main.js冒頭のコメント参照)。
import { getCell } from './mapGenerator.js?v=20260818e';

const BOARD_WINDOW = 10; // 各プレイヤーの前後何マスを表示するか
const CELL_LABELS = { attack: '攻撃', defense: '守備', heal: '回復', item: '宝', damage: 'ダメージ' };
const CELL_ICONS = { attack: '⚔️', defense: '🛡️', heal: '💚', item: '🎁', damage: '💥' };

// 8人分の彩度高めの「パーティゲーム」トークンカラー。
export const PLAYER_COLORS = ['#FF5B39', '#4FC3F7', '#3DDC97', '#FFC94A', '#FF4FA3', '#B388FF', '#C6FF4A', '#FFA24A'];

// 盤面のマス1個ぶんの実寸(style.cssの.cellと同じ値を共有する)。
// 分岐の位置合わせ計算(renderBoard内)がこの値に依存するため、CSS側の
// --cell-width / --cell-gap を変更する場合はここも合わせて変更すること。
// モバイル対応のために動的に値を取得する
function getCellDimensions() {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
    return { width: 70, gap: 6, stride: 76 };
  }
  return { width: 132, gap: 16, stride: 148 };
}

// 互換性のために定数も残すが、実際の使用ではgetCellDimensions()を優先
const CELL_WIDTH = 132;
const CELL_GAP = 16;
const CELL_STRIDE = CELL_WIDTH + CELL_GAP;

export function renderGame(state, container) {
  container.innerHTML = '';
  // モバイルの場合はCSSのorderプロパティで表示順序を制御
  container.appendChild(renderBoss(state));
  container.appendChild(renderBoard(state));
  container.appendChild(renderPlayers(state));
}

function renderBoss(state) {
  const section = document.createElement('section');
  section.className = 'boss-panel';
  const hpPercent = Math.round((state.boss.hp / state.boss.maxHp) * 100);
  const bossRollValue = state.boss?.lastRoll ?? '·';
  section.innerHTML = `
    <div class="boss-header">
      <h2><span class="boss-emoji">🔥</span> ${state.boss.name}</h2>
      <div class="boss-header-right">
        <div class="boss-dice-box ${state.boss?.lastRoll !== undefined ? 'locked' : 'idle'}">${bossRollValue}</div>
        <span class="turn-pill">ターン ${state.turn + 1} / ${state.turnLimit}</span>
      </div>
    </div>
    <div class="hp-bar boss-hp-bar"><div class="hp-bar-fill" style="width:${hpPercent}%"></div></div>
    <p class="boss-hp-label">HP ${state.boss.hp} / ${state.boss.maxHp}</p>
  `;
  return section;
}

export function computeBoardWindowRange(state, windowSize = BOARD_WINDOW) {
  const positions = [];

  for (const player of state.players) {
    if (player.position.track === 'trunk') {
      positions.push(player.position.index);
      continue;
    }

    const branch = state.map.branches.find((entry) => entry.id === player.position.track);
    if (branch) {
      positions.push(branch.connectFrom + 1 + player.position.index);
    }
  }

  for (const branch of state.map.branches) {
    positions.push(branch.connectFrom, branch.connectTo ?? branch.connectFrom);
  }

  if (positions.length === 0) {
    return { start: 0, end: Math.min(state.map.trunk.length, windowSize) };
  }

  const earliest = Math.min(...positions);
  const furthest = Math.max(...positions);
  const start = Math.max(0, earliest - windowSize);
  const end = Math.min(state.map.trunk.length, furthest + windowSize);

  return { start, end };
}

function renderPlayerTokens(state, track, index) {
  const here = state.players.filter((p) => p.position.track === track && p.position.index === index);
  if (here.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'cell-tokens';
  for (const player of here) {
    const playerIndex = state.players.findIndex((p) => p.id === player.id);
    const color = PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
    wrap.appendChild(renderPlayerToken(player, color));
  }
  return wrap;
}

function renderPlayerToken(player, color) {
  const token = document.createElement('div');
  token.className = 'player-token';
  token.dataset.playerId = player.id;
  token.title = `${player.name} (HP ${player.hp}/${player.maxHp})`;
  token.style.setProperty('--token-color', color);

  const hpPercent = Math.max(0, Math.min(100, Math.round((player.hp / player.maxHp) * 100)));
  const hpBar = document.createElement('div');
  hpBar.className = 'token-hp-bar';
  const hpFill = document.createElement('div');
  hpFill.className = 'token-hp-fill';
  hpFill.style.width = `${hpPercent}%`;
  if (hpPercent <= 30) hpFill.classList.add('token-hp-fill-low');
  hpBar.appendChild(hpFill);

  const avatar = document.createElement('div');
  avatar.className = 'token-avatar';
  avatar.textContent = (player.name || '?').trim().charAt(0).toUpperCase() || '?';

  token.appendChild(hpBar);
  token.appendChild(avatar);
  return token;
}

function buildCellElement(state, track, index, cell, extraClass = '') {
  const cellEl = document.createElement('div');
  cellEl.className = `cell cell-${cell.type}${extraClass}`;

  const iconBadge = document.createElement('span');
  iconBadge.className = 'cell-icon-badge';
  iconBadge.textContent = CELL_ICONS[cell.type] ?? '❓';
  cellEl.appendChild(iconBadge);

  const indexEl = document.createElement('span');
  indexEl.className = 'cell-index';
  indexEl.textContent = String(index);
  cellEl.appendChild(indexEl);

  const labelEl = document.createElement('span');
  labelEl.className = 'cell-label';
  labelEl.textContent = CELL_LABELS[cell.type] ?? '';
  cellEl.appendChild(labelEl);

  const tokens = renderPlayerTokens(state, track, index);
  if (tokens) {
    cellEl.classList.add('occupied');
    cellEl.appendChild(tokens);
  }

  return cellEl;
}

function renderBoard(state) {
  const section = document.createElement('section');
  section.className = 'board';

  const trunkRow = document.createElement('div');
  trunkRow.className = 'board-row board-row-trunk';

  const { start, end } = computeBoardWindowRange(state);
  const dims = getCellDimensions();

  for (let i = start; i < end; i++) {
    const cell = state.map.trunk[i];
    const isBranchPoint = state.map.branches.some((branch) => branch.connectFrom === i);
    const isRejoinPoint = state.map.branches.some((branch) => branch.connectTo === i);
    const extraClass = `${isBranchPoint ? ' branch-point' : ''}${isRejoinPoint ? ' rejoin-point' : ''}`;
    const cellEl = buildCellElement(state, 'trunk', i, cell, extraClass);

    if (isBranchPoint) {
      const branchBadge = document.createElement('span');
      branchBadge.className = 'branch-point-badge';
      branchBadge.textContent = '分岐';
      cellEl.appendChild(branchBadge);
      cellEl.title = '分岐点';
    }

    if (isRejoinPoint) {
      const rejoinBadge = document.createElement('span');
      rejoinBadge.className = 'rejoin-badge';
      rejoinBadge.textContent = '合流';
      cellEl.appendChild(rejoinBadge);
      cellEl.title = '枝の合流地点';
    }

    trunkRow.appendChild(cellEl);
  }
  section.appendChild(trunkRow);

  if (state.map.branches.length > 0) {
    const branchRow = document.createElement('div');
    branchRow.className = 'board-row board-row-branches';
    for (const branch of state.map.branches) {
      // 分岐に入った直後の1マス目は分岐点(connectFrom)の1つ右の列、
      // 合流直前の最終マスは合流点(connectTo)の1つ左の列に来るように
      // 配置する(=分岐に入る/戻る移動も他の1マス移動と同じ見た目になる)。
      const startCol = branch.connectFrom + 1;
      const endCol = Math.max(startCol, (branch.connectTo ?? startCol) - 1);
      const span = endCol - startCol;

      const branchPanel = document.createElement('div');
      branchPanel.className = 'branch-panel';
      branchPanel.style.marginLeft = `${Math.max(0, (startCol - start) * dims.stride)}px`;
      branchPanel.style.width = `${Math.max(dims.width, (span + 1) * dims.stride - dims.gap)}px`;

      const branchHeader = document.createElement('div');
      branchHeader.className = 'branch-header';
      branchHeader.textContent = `${branch.theme}路`;
      branchPanel.appendChild(branchHeader);

      for (let i = 0; i < branch.cells.length; i++) {
        const cell = branch.cells[i];
        const isRejoinCell = i === branch.cells.length - 1;
        const xOffset = branch.cells.length === 1 ? 0 : (i / (branch.cells.length - 1)) * span;
        const cellEl = buildCellElement(state, branch.id, i, cell, ' branch-cell' + (isRejoinCell ? ' rejoin-cell' : ''));
        cellEl.style.left = `${xOffset * dims.stride}px`;

        if (isRejoinCell) {
          const rejoinBadge = document.createElement('span');
          rejoinBadge.className = 'rejoin-badge';
          rejoinBadge.textContent = '合流';
          cellEl.appendChild(rejoinBadge);
          cellEl.title = `枝の合流地点: 幹 ${branch.connectTo}`;
        }

        branchPanel.appendChild(cellEl);
      }
      branchRow.appendChild(branchPanel);
    }
    section.appendChild(branchRow);
  }

  return section;
}

function trackDisplayLabel(map, position) {
  if (position.track === 'trunk') return '幹';
  const branch = map.branches.find((b) => b.id === position.track);
  return `枝(${branch.theme})`;
}

function renderPlayers(state) {
  const section = document.createElement('section');
  section.className = 'players';
  for (const [index, player] of state.players.entries()) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    const color = PLAYER_COLORS[index % PLAYER_COLORS.length];
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.playerId = player.id;
    card.style.setProperty('--player-color', color);

    const nameRow = document.createElement('div');
    nameRow.className = 'player-header';
    const avatar = document.createElement('span');
    avatar.className = 'player-card-avatar';
    avatar.style.setProperty('--token-color', color);
    avatar.textContent = (player.name || '?').trim().charAt(0).toUpperCase() || '?';
    const nameEl = document.createElement('strong');
    nameEl.textContent = player.name;
    nameRow.appendChild(avatar);
    nameRow.appendChild(nameEl);

    const hpBar = document.createElement('div');
    hpBar.className = 'hp-bar player-hp-bar';
    const hpFill = document.createElement('div');
    hpFill.className = 'hp-bar-fill';
    const hpPercent = Math.max(0, Math.min(100, Math.round((player.hp / player.maxHp) * 100)));
    hpFill.style.width = `${hpPercent}%`;
    hpBar.appendChild(hpFill);

    const hpEl = document.createElement('span');
    hpEl.className = 'player-hp-label';
    hpEl.textContent = `HP ${player.hp} / ${player.maxHp}`;
    const cellEl = document.createElement('span');
    const trackLabel = trackDisplayLabel(state.map, player.position);
    cellEl.textContent = `現在地: ${trackLabel} ${player.position.index} · ${CELL_LABELS[cell.type]}`;

    const buffRow = renderBuffRow(player);

    const rollEl = document.createElement('span');
    rollEl.className = 'dice-pill';
    rollEl.textContent = '出目未定';
    rollEl.dataset.playerId = player.id;

    card.appendChild(nameRow);
    card.appendChild(hpBar);
    card.appendChild(hpEl);
    card.appendChild(cellEl);
    if (buffRow) card.appendChild(buffRow);
    card.appendChild(rollEl);
    section.appendChild(card);
  }
  return section;
}

const BUFF_LABELS = {
  attack: { icon: '⚔️', label: '攻撃UP' },
  defense: { icon: '🛡️', label: '守備UP' },
  heal: { icon: '💚', label: '回復UP' },
};

function renderBuffRow(player) {
  if (!player.buffs || player.buffs.length === 0) return null;
  const row = document.createElement('div');
  row.className = 'buff-row';
  for (const buff of player.buffs) {
    const info = BUFF_LABELS[buff.type] ?? { icon: '✨', label: buff.type };
    const chip = document.createElement('span');
    chip.className = 'buff-chip';
    chip.textContent = `${info.icon} ${info.label} ×${buff.remainingTurns}`;
    chip.title = `${info.label}(残り${buff.remainingTurns}ターン)`;
    row.appendChild(chip);
  }
  return row;
}
