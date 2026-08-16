// src/main.js
import { CHARACTERS, rollCharacterAttack } from './characters.js';
import { createGameState, moveOnePlayer, playTurn, rollDie, sortPlayersByProgress, rollItemBuff } from './engine.js';
import { rollBossAttack } from './boss.js';
import { branchesAt, ensureMapAhead, getCell } from './mapGenerator.js';
import { renderGame } from './render.js';

const app = document.getElementById('app');
let state = null;
let pendingMoves = {};
let rollingDice = {};
let effectRolls = {};
let rollingEffectDice = {};
let bossRolling = false;
let phase = 'move';

renderSetupScreen();

function renderSetupScreen() {
  app.innerHTML = '';
  const form = document.createElement('form');
  form.innerHTML = `
    <h1>双六RPG - プレイヤー設定</h1>
    <label>プレイヤー人数(2〜8)
      <input type="number" id="playerCount" min="2" max="8" value="2" />
    </label>
    <div id="playerSlots"></div>
    <button type="submit">ゲーム開始</button>
  `;
  app.appendChild(form);

  const slotsContainer = form.querySelector('#playerSlots');
  const countInput = form.querySelector('#playerCount');

  function renderSlots() {
    const count = Math.min(8, Math.max(2, Number(countInput.value) || 2));
    slotsContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.innerHTML = `
        <input type="text" name="name-${i}" placeholder="プレイヤー${i + 1}" value="プレイヤー${i + 1}" />
        <select name="character-${i}">
          ${Object.values(CHARACTERS)
            .map((c) => `<option value="${c.id}">${c.name}</option>`)
            .join('')}
        </select>
      `;
      slotsContainer.appendChild(row);
    }
  }
  countInput.addEventListener('input', renderSlots);
  renderSlots();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const count = Math.min(8, Math.max(2, Number(countInput.value) || 2));
    const selections = [];
    for (let i = 0; i < count; i++) {
      selections.push({
        id: `p${i}`,
        name: form.querySelector(`[name="name-${i}"]`).value || `プレイヤー${i + 1}`,
        characterId: form.querySelector(`[name="character-${i}"]`).value,
      });
    }
    startGame(selections);
  });
}

function clearDiceIntervals() {
  for (const entry of Object.values(rollingDice)) {
    if (entry?.interval) clearInterval(entry.interval);
  }
  for (const entry of Object.values(rollingEffectDice)) {
    if (entry?.interval) clearInterval(entry.interval);
  }
  rollingDice = {};
  rollingEffectDice = {};
}

function startGame(selections) {
  state = createGameState(selections, 'fireDragon');
  pendingMoves = {};
  effectRolls = {};
  clearDiceIntervals();
  bossRolling = false;
  phase = 'move';
  renderTurnScreen();
}

function renderDiceTray(displayState = state, valueSet = 'move') {
  const tray = document.createElement('div');
  tray.className = 'dice-tray';

  if (displayState?.boss && displayState.boss.lastRoll !== undefined && displayState.boss.lastRoll !== null) {
    const bossSlot = document.createElement('div');
    bossSlot.className = 'dice-slot';
    const bossBox = document.createElement('div');
    bossBox.className = `dice-box ${bossRolling ? 'rolling' : ''}`;
    bossBox.textContent = String(displayState.boss.lastRoll);
    const bossLabel = document.createElement('span');
    bossLabel.className = 'dice-label';
    bossLabel.textContent = 'ボス';
    bossSlot.appendChild(bossBox);
    bossSlot.appendChild(bossLabel);
    tray.appendChild(bossSlot);
  }

  for (const player of displayState.players) {
    const slot = document.createElement('div');
    slot.className = 'dice-slot';

    const square = document.createElement('div');
    square.className = 'dice-box';
    square.dataset.playerId = player.id;
    const values = valueSet === 'effect' ? effectRolls : pendingMoves;
    square.textContent = values[player.id] ?? '·';

    const label = document.createElement('span');
    label.className = 'dice-label';
    label.textContent = player.name;

    slot.appendChild(square);
    slot.appendChild(label);
    tray.appendChild(slot);
  }

  return tray;
}

function startDiceLoop(playerId, valueSet = 'move') {
  const box = document.querySelector(`.dice-box[data-player-id="${playerId}"]`);
  const values = valueSet === 'effect' ? effectRolls : pendingMoves;
  const rollingState = valueSet === 'effect' ? rollingEffectDice : rollingDice;
  if (!box || values[playerId] !== undefined || rollingState[playerId]) return;

  box.classList.add('rolling');
  const interval = window.setInterval(() => {
    const value = 1 + Math.floor(Math.random() * 6);
    box.textContent = value;
  }, 100);
  rollingState[playerId] = { interval };
}

function startBossDiceLoop() {
  const bossBox = document.querySelector('.boss-dice-box');
  if (!bossBox || bossRolling) return;
  bossRolling = true;
  bossBox.classList.add('rolling');
  const interval = window.setInterval(() => {
    const value = 1 + Math.floor(Math.random() * 6);
    bossBox.textContent = value;
  }, 110);
  bossBox.dataset.intervalId = String(interval);
}

function stopBossDiceLoop(finalValue) {
  const bossBox = document.querySelector('.boss-dice-box');
  if (!bossBox) return;
  const intervalId = Number(bossBox.dataset.intervalId || 0);
  if (intervalId) window.clearInterval(intervalId);
  bossBox.classList.remove('rolling');
  bossBox.textContent = String(finalValue);
  bossBox.dataset.intervalId = '';
  bossRolling = false;
  if (state?.boss) state.boss.lastRoll = finalValue;
}

function animateBossRoll(finalValue, durationMs = 1000) {
  const bossBox = document.querySelector('.boss-dice-box');
  if (!bossBox) return;

  bossRolling = true;
  bossBox.classList.add('rolling');
  bossBox.textContent = String(1 + Math.floor(Math.random() * 6));
  bossBox.dataset.intervalId = String(window.setInterval(() => {
    bossBox.textContent = String(1 + Math.floor(Math.random() * 6));
  }, 120));

  window.setTimeout(() => {
    const intervalId = Number(bossBox.dataset.intervalId || 0);
    if (intervalId) window.clearInterval(intervalId);
    bossBox.classList.remove('rolling');
    bossBox.textContent = String(finalValue);
    bossBox.dataset.intervalId = '';
    bossRolling = false;
    if (state?.boss) state.boss.lastRoll = finalValue;
  }, durationMs);
}

function spinDice(playerId, finalValue, valueSet = 'move') {
  const box = document.querySelector(`.dice-box[data-player-id="${playerId}"]`);
  if (!box) return;

  if (valueSet === 'move' && phase !== 'move') return;
  if (valueSet === 'effect' && phase !== 'effect') return;

  const rollingState = valueSet === 'effect' ? rollingEffectDice : rollingDice;
  if (rollingState[playerId]) {
    clearInterval(rollingState[playerId].interval);
    delete rollingState[playerId];
  }

  box.classList.remove('rolling');
  box.textContent = String(finalValue);

  if (valueSet === 'effect') {
    effectRolls[playerId] = finalValue;
  } else {
    pendingMoves[playerId] = finalValue;
  }

  if (valueSet === 'move') {
    const allRolled = state.players.every((entry) => pendingMoves[entry.id] !== undefined);
    if (allRolled) {
      renderTurnScreen();
    }
  }
}

function focusPlayerBoard(playerId) {
  const playerCard = document.querySelector(`.player-card [data-player-id="${playerId}"]`)?.closest('.player-card');
  if (!playerCard) return;
  playerCard.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

function focusBoardOnPlayer(playerId) {
  const board = document.querySelector('.board');
  if (!board) return;

  const player = state?.players.find((entry) => entry.id === playerId);
  if (!player) return;

  const target = board.querySelector(`.player-token[data-player-id="${playerId}"]`);
  if (!target) return;

  const boardRect = board.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = board.scrollLeft + (targetRect.left - boardRect.left) - (boardRect.width / 2) + (targetRect.width / 2);
  board.scrollTo({ left: offset, behavior: 'auto' });
}

function getPlayerProgressIndex(player, map = state?.map) {
  if (!map) return 0;
  if (player.position.track === 'trunk') return player.position.index;
  const branch = map.branches.find((entry) => entry.id === player.position.track);
  return branch ? branch.connectFrom + 1 + player.position.index : player.position.index;
}

function focusBoardOnFrontPlayer() {
  if (!state?.players.length) return;
  const frontPlayer = sortPlayersByProgress(state.players, state.map)[0];
  if (frontPlayer) focusBoardOnPlayer(frontPlayer.id);
}

function renderTurnScreen() {
  clearDiceIntervals();
  renderGame(state, app);
  app.appendChild(renderDiceTray());

  for (const player of state.players) {
    if (pendingMoves[player.id] === undefined) {
      startDiceLoop(player.id, 'move');
    }
  }

  const controls = document.createElement('section');
  controls.className = 'controls';
  for (const player of state.players) {
    const button = document.createElement('button');
    const rolled = pendingMoves[player.id] !== undefined;
    const dieLabel = rolled ? `🎲 ${pendingMoves[player.id]} 目` : 'サイコロを振る';
    button.textContent = `${player.name}: ${dieLabel}`;
    button.disabled = rolled;
    button.className = 'turn-button';
    button.addEventListener('click', () => {
      if (pendingMoves[player.id] !== undefined) return;
      const finalValue = Number(document.querySelector(`.dice-box[data-player-id="${player.id}"]`)?.textContent || rollDie());
      spinDice(player.id, finalValue, 'move');
    });
    controls.appendChild(button);
  }
  app.appendChild(controls);

  const allRolled = state.players.every((p) => pendingMoves[p.id] !== undefined);
  if (allRolled) {
    const resolveButton = document.createElement('button');
    resolveButton.textContent = '次に進む';
    resolveButton.className = 'resolve-button';
    resolveButton.addEventListener('click', resolveTurn);
    app.appendChild(resolveButton);
  }

  requestAnimationFrame(() => focusBoardOnFrontPlayer());
}

function renderPhaseBanner(title, subtitle) {
  const banner = document.createElement('div');
  banner.className = 'phase-banner';
  banner.innerHTML = `
    <div class="phase-kicker">ターンの流れ</div>
    <div class="phase-title">${title}</div>
    <div class="phase-subtitle">${subtitle}</div>
  `;
  return banner;
}

function getPlayerName(playerId) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return player ? player.name : '不明';
}

function renderEventLogForState(displayState = state) {
  const entries = displayState.log ?? [];
  if (!entries.length) return null;

  const panel = document.createElement('section');
  panel.className = 'event-log';
  const heading = document.createElement('h3');
  heading.textContent = '戦闘結果';
  panel.appendChild(heading);

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'log-item';

    let text = '';
    if (entry.type === 'heal') {
      text = `${getPlayerName(entry.by)}が${getPlayerName(entry.target)}を${entry.amount}回復した`;
    } else if (entry.type === 'attack') {
      text = `${getPlayerName(entry.by)}がボスに${entry.damage}ダメージ与えた`;
      if (entry.special) text += ` (${entry.special})`;
    } else if (entry.type === 'damage') {
      text = `${getPlayerName(entry.target)}が${entry.amount}ダメージを受けた`;
    } else if (entry.type === 'defense') {
      text = `${getPlayerName(entry.by)}の防御力上昇`;
    } else if (entry.type === 'bossAttack') {
      text = `${entry.name}: ボスが${getPlayerName(entry.target)}に${entry.damage}ダメージ`;
    } else if (entry.type === 'revive') {
      text = `${getPlayerName(entry.target)}が生き返った!`;
    } else if (entry.type === 'item') {
      const label = BUFF_TYPE_LABELS[entry.buffType] ?? entry.buffType;
      text = `${getPlayerName(entry.by)}が宝箱を開けた: ${label}+${entry.bonus}(${entry.duration}ターン)`;
    } else if (entry.type === 'special') {
      text = `${getPlayerName(entry.by)}の固有効果: ${entry.detail}`;
    }

    if (!text) continue;

    const badge = document.createElement('span');
    badge.className = 'log-badge';
    badge.textContent = {
      heal: '回復',
      attack: '攻撃',
      damage: '被ダメ',
      defense: '防御',
      bossAttack: 'ボス攻撃',
      revive: '蘇生',
      item: '宝箱',
      special: '固有効果',
    }[entry.type] || '効果';

    row.appendChild(badge);
    const msg = document.createElement('span');
    msg.textContent = text;
    row.appendChild(msg);
    panel.appendChild(row);
  }

  return panel;
}

function renderEventLog() {
  return renderEventLogForState(state);
}

function renderTurnSummaryPopup(displayState = state) {
  const entries = displayState.log ?? [];
  const bossEntries = entries.filter((entry) => entry.type === 'bossAttack');
  if (!bossEntries.length) return null;

  const overlay = document.createElement('div');
  overlay.className = 'turn-popup-overlay';

  const panel = document.createElement('div');
  panel.className = 'turn-popup';
  panel.innerHTML = '<h3>ボス攻撃</h3>';

  const list = document.createElement('div');
  list.className = 'turn-popup-list';

  for (const entry of bossEntries) {
    const item = document.createElement('div');
    item.className = 'turn-popup-item';

    const badge = document.createElement('span');
    badge.className = 'turn-popup-label';
    badge.textContent = entry.name;

    const msg = document.createElement('span');
    msg.className = 'turn-popup-message';
    msg.textContent = `${entry.damage}ダメージ`;

    item.appendChild(badge);
    item.appendChild(msg);
    list.appendChild(item);
  }

  panel.appendChild(list);
  overlay.appendChild(panel);
  return overlay;
}

async function showTurnSummary(displayState = state) {
  const popup = renderTurnSummaryPopup(displayState);
  if (!popup) return;
  renderGame(displayState, app);
  app.appendChild(popup);
  await new Promise((resolve) => window.setTimeout(resolve, 800));
  popup.remove();
}

function renderPhasePopup(title, subtitle) {
  const overlay = document.createElement('div');
  overlay.className = 'turn-popup-overlay';
  overlay.innerHTML = `
    <div class="turn-popup">
      <h3>${title}</h3>
      <div class="turn-popup-message">${subtitle}</div>
    </div>
  `;
  return overlay;
}

function renderEffectFocusPopup(playerName, cellType, amount) {
  const overlay = document.createElement('div');
  overlay.className = 'turn-popup-overlay';

  const panel = document.createElement('div');
  panel.className = 'turn-popup';

  const labelMap = {
    heal: `${playerName}の回復`,
    attack: `${playerName}の攻撃`,
    defense: `${playerName}の防御`,
    damage: `${playerName}のダメージ`,
  };

  panel.innerHTML = `
    <h3>${cellType === 'heal' ? '回復' : cellType === 'attack' ? '攻撃' : cellType === 'defense' ? '防御' : 'ダメージ'}</h3>
    <div class="turn-popup-message">${labelMap[cellType] ?? `${playerName}の効果`}</div>
  `;

  overlay.appendChild(panel);
  return overlay;
}

async function showEffectSequence(displayState = state) {
  return;
}

async function chooseBranchForPlayer(player, forks) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'turn-popup-overlay';

    const panel = document.createElement('div');
    panel.className = 'turn-popup';
    panel.innerHTML = `<h3>${player.name}の分岐</h3>`;

    const choices = document.createElement('div');
    choices.className = 'branch-choice-list';

    const trunkButton = document.createElement('button');
    trunkButton.type = 'button';
    trunkButton.className = 'branch-choice-button';
    trunkButton.textContent = '幹ルートを進む';
    trunkButton.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    choices.appendChild(trunkButton);

    for (const fork of forks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'branch-choice-button';
      button.textContent = `${fork.theme}へ進む`;
      button.addEventListener('click', () => {
        overlay.remove();
        resolve(fork.id);
      });
      choices.appendChild(button);
    }

    panel.appendChild(choices);
    overlay.appendChild(panel);
    app.appendChild(overlay);

    const focusTarget = state?.players.find((entry) => entry.id === player.id);
    if (focusTarget) {
      requestAnimationFrame(() => focusBoardOnPlayer(player.id));
    }
  });
}

async function moveOneStepWithBranchChoice(map, player, currentPosition, chooseBranch) {
  let { track, index } = currentPosition;
  const forks = track === 'trunk' ? branchesAt(map, index) : [];
  if (forks.length > 0) {
    const choice = await chooseBranch(forks);
    if (choice) {
      return { track: choice, index: 0 };
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

  return { track, index };
}

async function showPhaseSequence(displayState = state) {
  return;
}

const BUFF_TYPE_LABELS = { heal: '回復', defense: '守備', attack: '攻撃' };

function activeBuffBonus(player, type) {
  if (!player.buffs) return 0;
  return player.buffs.filter((b) => b.type === type).reduce((sum, b) => sum + b.bonus, 0);
}

// engine.js側のHEAL_PER_DIEと揃える(回復量は出目 x この値 + バフ)。
const HEAL_PER_DIE = 12;

function describeCellEffect(player, cell, dieValue) {
  if (cell.type === 'heal') {
    const amount = dieValue * HEAL_PER_DIE + activeBuffBonus(player, 'heal');
    return `${player.name}のマスで${dieValue}目 → 回復: 周囲の味方を${amount}回復`;
  }
  if (cell.type === 'attack') {
    const result = rollCharacterAttack(player.characterId, dieValue);
    const power = result.power + activeBuffBonus(player, 'attack');
    const specialNote = result.special ? `(固有効果: ${result.special})` : '';
    return `${player.name}のマスで${dieValue}目 → 攻撃: ${power}ダメージ${specialNote}`;
  }
  if (cell.type === 'defense') {
    const reduction = dieValue + activeBuffBonus(player, 'defense');
    return `${player.name}のマスで${dieValue}目 → 防御: ボスの攻撃を${reduction}軽減`;
  }
  if (cell.type === 'damage') {
    const value = dieValue <= 2 ? 0 : dieValue;
    return `${player.name}のマスで${dieValue}目 → ダメージ: ${value}ダメージ`;
  }
  if (cell.type === 'item') {
    const buff = rollItemBuff(dieValue);
    return `${player.name}のマスで${dieValue}目 → 宝箱: ${BUFF_TYPE_LABELS[buff.type]}+${buff.bonus} を${buff.duration}ターン獲得`;
  }
  return `${player.name}のマスで${dieValue}目 → 効果なし`;
}

function describeDieFaceTable(cellType, player) {
  const rows = {
    attack: [1, 2, 3, 4, 5, 6].map((face) => {
      const result = rollCharacterAttack(player.characterId, face);
      const note = result.special ? `(${result.special})` : '';
      return { face, value: `${result.power}ダメージ${note}` };
    }),
    damage: [
      { face: 1, value: '0ダメージ' },
      { face: 2, value: '0ダメージ' },
      { face: 3, value: '3ダメージ' },
      { face: 4, value: '4ダメージ' },
      { face: 5, value: '5ダメージ' },
      { face: 6, value: '6ダメージ' },
    ],
    defense: [1, 2, 3, 4, 5, 6].map((face) => ({ face, value: `${face}軽減` })),
    heal: [1, 2, 3, 4, 5, 6].map((face) => ({ face, value: `${face * HEAL_PER_DIE}回復` })),
    item: [1, 2, 3, 4, 5, 6].map((face) => {
      const buff = rollItemBuff(face);
      return { face, value: `${BUFF_TYPE_LABELS[buff.type]}+${buff.bonus}(${buff.duration}ターン)` };
    }),
  };

  const tableRows = (rows[cellType] ?? []).map(({ face, value }) => `
    <tr>
      <td>${face}</td>
      <td>${value}</td>
    </tr>
  `).join('');

  return `
    <table class="die-face-table">
      <thead>
        <tr><th>目</th><th>効果</th></tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

async function renderEffectRollScreen() {
  phase = 'effect';
  clearDiceIntervals();
  effectRolls = {};

  for (const player of state.players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (!['heal', 'attack', 'defense', 'damage', 'item'].includes(cell.type)) continue;
    const cellKind = { heal: '回復', attack: '攻撃', defense: '防御', damage: 'ダメージ', item: '宝箱' }[cell.type];

    const finalValue = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'turn-popup-overlay';

      const panel = document.createElement('div');
      panel.className = 'turn-popup';

      const heading = document.createElement('h3');
      heading.textContent = `${player.name}の視点`;

      const description = document.createElement('div');
      description.className = 'turn-popup-message';
      description.innerHTML = `
        <div class="die-face-summary">${cellKind}マス</div>
        ${describeDieFaceTable(cell.type, player)}
      `;
      requestAnimationFrame(() => {
        const board = document.querySelector('.board');
        const token = board?.querySelector(`.player-token[data-player-id="${player.id}"]`);
        const targetCell = token?.closest('.cell');
        if (targetCell) {
          targetCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      });

      const dieBox = document.createElement('div');
      dieBox.className = 'dice-box';
      dieBox.style.fontSize = '2rem';
      dieBox.style.margin = '0 auto 12px';
      dieBox.textContent = '·';

      const intervalId = window.setInterval(() => {
        dieBox.textContent = String(1 + Math.floor(Math.random() * 6));
      }, 100);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'turn-button';
      button.textContent = 'このプレイヤーのサイコロを振る';

      const updateActivePlayerGlow = (isActive) => {
        const playerCard = document.querySelector(`.player-card[data-player-id="${player.id}"]`);
        if (!playerCard) return;
        playerCard.classList.toggle('is-rolling', isActive);
      };
      updateActivePlayerGlow(true);

      button.addEventListener('click', () => {
        window.clearInterval(intervalId);
        const value = Number(dieBox.textContent || rollDie());
        dieBox.textContent = String(value);
        effectRolls[player.id] = value;
        updateActivePlayerGlow(false);

        const resultText = describeCellEffect(player, cell, value);
        description.innerHTML = `
          <div class="die-face-summary">${cellKind}マス</div>
          ${describeDieFaceTable(cell.type, player)}
          <div class="die-face-result">→ ${resultText}</div>
        `;

        const resultPopup = document.createElement('div');
        resultPopup.className = 'turn-popup';
        resultPopup.innerHTML = `
          <h3>${player.name}</h3>
          <div class="turn-popup-message">${resultText}</div>
        `;
        panel.innerHTML = '';
        panel.appendChild(resultPopup.firstElementChild);
        panel.appendChild(resultPopup.lastElementChild);
        setTimeout(() => resolve(value), 700);
      });

      panel.appendChild(heading);
      panel.appendChild(description);
      panel.appendChild(dieBox);
      panel.appendChild(button);
      overlay.appendChild(panel);

      renderGame(state, app);
      app.appendChild(renderPhaseBanner('効果判定', `${player.name}の視点`));
      app.appendChild(overlay);
      requestAnimationFrame(() => focusBoardOnPlayer(player.id));
    });

    const resultText = describeCellEffect(player, cell, finalValue);
    renderGame(state, app);
    app.appendChild(renderPhaseBanner('効果発動', resultText));
    await new Promise((resolve) => window.setTimeout(resolve, 600));
  }
}

async function resolveTurn() {
  const chooseBranchFns = {};
  for (const player of state.players) {
    chooseBranchFns[player.id] = async (forks) => {
      if (forks.length === 0) return null;
      return chooseBranchForPlayer(player, forks);
    };
  }

  const mapWithAhead = ensureMapAhead(state.map, state.players.map((p) => p.position), 20, Math.random);
  const animatedPlayers = state.players.map((player) => ({
    ...player,
    position: { ...player.position },
  }));

  const maxSteps = Math.max(0, ...state.players.map((player) => pendingMoves[player.id] ?? 0));
  for (let step = 1; step <= maxSteps; step++) {
    const movingOrder = sortPlayersByProgress(animatedPlayers, mapWithAhead);
    for (const player of movingOrder) {
      if ((pendingMoves[player.id] ?? 0) < step) continue;
      const chooseBranch = chooseBranchFns[player.id] || (async () => null);
      player.position = await moveOneStepWithBranchChoice(mapWithAhead, player, player.position, chooseBranch);
    }

    const previewState = { ...state, map: mapWithAhead, players: animatedPlayers.map((player) => ({ ...player })) };
    renderGame(previewState, app);
    app.appendChild(renderDiceTray(previewState));
    app.appendChild(renderPhaseBanner('移動', `${step}マスずつ前へ進む`));
    await new Promise((resolve) => window.setTimeout(resolve, 180));
  }

  state = { ...state, map: mapWithAhead, players: animatedPlayers.map((player) => ({ ...player, position: { ...player.position } })) };

  rollingDice = {};
  rollingEffectDice = {};
  effectRolls = {};
  await renderEffectRollScreen();

  // effectRolls is reused for attack/damage/defense/item rolls: a given
  // player is only ever on one cell type per turn, so the same die value is
  // unambiguous no matter which of the four it's read as. rngOrDefenseRolls
  // slot 6 is duck-typed as defenseRolls (not a function); slot 7 is left
  // undefined so playTurn falls back to Math.random for the boss's own die.
  const { state: nextState, gameOver } = playTurn(state, {}, chooseBranchFns, effectRolls, effectRolls, effectRolls, undefined, effectRolls);
  state = nextState;
  pendingMoves = {};
  effectRolls = {};
  clearDiceIntervals();
  phase = 'move';

  requestAnimationFrame(() => focusBoardOnFrontPlayer());

  if (gameOver.over) {
    renderGame(state, app);
    const banner = document.createElement('h1');
    banner.textContent = gameOver.result === 'win' ? '勝利!' : '敗北...';
    app.appendChild(banner);
    app.appendChild(renderEventLog());
    return;
  }

  const bossRoll = Number.isInteger(Number(state.boss.lastRoll)) ? Number(state.boss.lastRoll) : 1;
  const bossRollValue = Math.min(6, Math.max(1, bossRoll));
  state.boss.lastRoll = undefined;
  renderGame(state, app);

  const bossBox = document.querySelector('.boss-dice-box');
  if (bossBox) {
    bossBox.classList.add('rolling');
    bossBox.dataset.intervalId = '';
  }

  animateBossRoll(bossRollValue, 1200);
  await new Promise((resolve) => window.setTimeout(resolve, 1400));

  const bossAttack = rollBossAttack(state.boss.id, bossRollValue);
  const attackPopup = document.createElement('div');
  attackPopup.className = 'turn-popup-overlay';
  attackPopup.innerHTML = `
    <div class="turn-popup">
      <h3>ボス攻撃</h3>
      <div class="turn-popup-message">${bossAttack.name}: ${bossAttack.damage}ダメージ</div>
    </div>
  `;
  app.appendChild(attackPopup);
  await new Promise((resolve) => window.setTimeout(resolve, 1200));
  attackPopup.remove();

  renderTurnScreen();
  requestAnimationFrame(() => focusBoardOnFrontPlayer());
}
