// src/main.js
import { CHARACTERS } from './characters.js';
import { createGameState, playTurn, rollDie } from './engine.js';
import { getCell } from './mapGenerator.js';
import { renderGame } from './render.js';

const app = document.getElementById('app');
let state = null;
let pendingMoves = {};

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
    const count = Number(countInput.value);
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
    const count = Number(countInput.value);
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

function startGame(selections) {
  state = createGameState(selections, 'fireDragon');
  pendingMoves = {};
  renderTurnScreen();
}

function renderTurnScreen() {
  renderGame(state, app);

  const controls = document.createElement('section');
  controls.className = 'controls';
  for (const player of state.players) {
    const button = document.createElement('button');
    const rolled = pendingMoves[player.id] !== undefined;
    button.textContent = rolled ? `${player.name}: ${pendingMoves[player.id]}` : `${player.name} サイコロを振る`;
    button.disabled = rolled;
    button.addEventListener('click', () => {
      pendingMoves[player.id] = rollDie();
      renderTurnScreen();
    });
    controls.appendChild(button);
  }
  app.appendChild(controls);

  const allRolled = state.players.every((p) => pendingMoves[p.id] !== undefined);
  if (allRolled) {
    const resolveButton = document.createElement('button');
    resolveButton.textContent = 'ターンを解決する';
    resolveButton.addEventListener('click', resolveTurn);
    app.appendChild(resolveButton);
  }
}

function resolveTurn() {
  const chooseBranchFns = {};
  for (const player of state.players) {
    chooseBranchFns[player.id] = (forks) => {
      if (forks.length === 0) return null;
      const names = forks.map((f, i) => `${i + 1}: ${f.theme}`).join('\n');
      const answer = window.prompt(`${player.name}: 分岐があります。番号を選んでください(未入力で幹を直進)\n${names}`);
      const index = Number(answer) - 1;
      return forks[index] ? forks[index].id : null;
    };
  }

  const attackRolls = {};
  const damageRolls = {};
  for (const player of state.players) {
    attackRolls[player.id] = rollDie();
    damageRolls[player.id] = rollDie();
  }

  const { state: nextState, gameOver } = playTurn(state, pendingMoves, chooseBranchFns, attackRolls, damageRolls);
  state = nextState;
  pendingMoves = {};

  if (gameOver.over) {
    renderGame(state, app);
    const banner = document.createElement('h1');
    banner.textContent = gameOver.result === 'win' ? '勝利!' : '敗北...';
    app.appendChild(banner);
    return;
  }

  renderTurnScreen();
}
