// src/main.js
// 各importの末尾の ?v=YYYYMMDDn はブラウザ/GitHub Pagesのキャッシュ対策。
// このファイルが読み込む側のファイルに変更を入れたら、そのファイルへのimport
// 行(このファイル・他のsrc/*.js内の該当import両方)の番号を上げること。
// 上げ忘れると、ユーザーのブラウザがそのファイルだけ古いキャッシュのまま
// 動き続けてしまう(修正したのに直っていないように見える不具合の原因になる)。
import { CHARACTERS, rollCharacterAttack } from './characters.js?v=20260818a';
import { createGameState, moveOnePlayer, playTurn, rollDie, sortPlayersByProgress, rollItemBuff } from './engine.js?v=20260818a';
import { rollBossAttack, calculateTurnLimit, calculateTargetedBalance, BOSSES } from './boss.js?v=20260818d';
import { branchesAt, ensureMapAhead, getCell } from './mapGenerator.js?v=20260818d';
import { renderGame } from './render.js?v=20260818d';
import { startBgm, playSfx, toggleMuted, isMuted } from './audio.js?v=20260818d';
import * as net from './network.js?v=20260818d';
import { generateJoinCode } from './network.js?v=20260818d';

const app = document.getElementById('app');
let state = null;
let pendingMoves = {};
let rollingDice = {};
let effectRolls = {};
let rollingEffectDice = {};
let phase = 'move';
let activeMovePlayerId = null;

// オンライン対戦(同じWiFi内、サーバーレス)関連の状態。
// onlineRole: null=ローカル対戦 / 'host' / 'guest'
// localPlayerId: オンライン時、この端末が操作できるプレイヤーID(サイコロは
// これ以外のプレイヤー分は押せないようにする)。
let onlineRole = null;
let localPlayerId = null;
let roomCode = null;
let hostInfo = null; // { name, characterId }
let hostGuestRoster = []; // ホスト側: [{ conn, name, characterId }] 参加順
let hostTargetMinutes = 30;
let guestRosterView = []; // ゲスト側: ホストから受け取った参加者一覧の表示用コピー
let pendingRemoteEffectResolve = null; // ホスト側: 他プレイヤーの効果マス出目待ち
let pendingRemoteBranchResolve = null; // ホスト側: 他プレイヤーの分岐選択待ち

// ターン数から大まかな目安時間を出す(1ターンあたり移動+効果判定+ボス攻撃の
// ポップアップ演出でおよそ20秒とみて概算)。あくまで目安の表示用。
const SECONDS_PER_TURN_ESTIMATE = 20;

function estimateMinutes(turns) {
  return Math.max(1, Math.round((turns * SECONDS_PER_TURN_ESTIMATE) / 60));
}

wireMuteButton();
renderModeSelectScreen();

function syncMuteButton() {
  const muteToggle = document.getElementById('muteToggle');
  if (!muteToggle) return;
  muteToggle.textContent = isMuted() ? '🔇' : '🔊';
  muteToggle.title = isMuted() ? '音を戻す' : '音を消す';
}

function wireMuteButton() {
  const muteToggle = document.getElementById('muteToggle');
  if (!muteToggle) return;
  muteToggle.addEventListener('click', () => {
    toggleMuted();
    syncMuteButton();
  });
  syncMuteButton();
}

function appendBackButton(label, onClick) {
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'back-button';
  backButton.textContent = label;
  backButton.addEventListener('click', onClick);
  app.appendChild(backButton);
  return backButton;
}

// ---------- モード選択・オンライン対戦の部屋まわり ----------

function renderModeSelectScreen() {
  net.disconnectAll();
  onlineRole = null;
  localPlayerId = null;
  roomCode = null;
  hostGuestRoster = [];
  guestRosterView = [];
  state = null;

  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'mode-select';
  wrap.innerHTML = `<h1>双六RPG</h1><p class="mode-select-lead">遊び方を選んでください</p>`;

  const localButton = document.createElement('button');
  localButton.type = 'button';
  localButton.className = 'mode-button';
  localButton.innerHTML = '<strong>ローカル対戦</strong><span>1台の画面をみんなで回して遊ぶ</span>';
  localButton.addEventListener('click', () => {
    playSfx('confirm');
    renderSetupScreen();
  });

  const onlineButton = document.createElement('button');
  onlineButton.type = 'button';
  onlineButton.className = 'mode-button';
  onlineButton.innerHTML = '<strong>オンライン対戦</strong><span>同じWiFi内でそれぞれの端末から参加</span>';
  onlineButton.addEventListener('click', () => {
    playSfx('confirm');
    renderOnlineChoiceScreen();
  });

  wrap.appendChild(localButton);
  wrap.appendChild(onlineButton);
  app.appendChild(wrap);
}

function renderOnlineChoiceScreen() {
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'mode-select';
  wrap.innerHTML = `<h1>オンライン対戦</h1><p class="mode-select-lead">同じWiFiに繋がっている人同士で遊べます(サーバー不要)</p>`;

  const hostButton = document.createElement('button');
  hostButton.type = 'button';
  hostButton.className = 'mode-button';
  hostButton.innerHTML = '<strong>部屋を作る</strong><span>ホストになって合言葉を発行する</span>';
  hostButton.addEventListener('click', () => {
    playSfx('confirm');
    renderHostSetupScreen();
  });

  const joinButton = document.createElement('button');
  joinButton.type = 'button';
  joinButton.className = 'mode-button';
  joinButton.innerHTML = '<strong>部屋に入る</strong><span>合言葉を入力して参加する</span>';
  joinButton.addEventListener('click', () => {
    playSfx('confirm');
    renderGuestJoinScreen();
  });

  wrap.appendChild(hostButton);
  wrap.appendChild(joinButton);
  app.appendChild(wrap);
  appendBackButton('戻る', () => renderModeSelectScreen());
}

function renderHostSetupScreen() {
  app.innerHTML = '';
  const form = document.createElement('form');
  form.innerHTML = `
    <h1>部屋を作る</h1>
    <label>自分の名前
      <input type="text" id="hostName" placeholder="ホスト" value="ホスト" />
    </label>
    <label>自分の職業
      <select id="hostCharacter">
        ${Object.values(CHARACTERS).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
    </label>
    <label>目標プレイ時間(分)
      <input type="number" id="hostTargetMinutes" min="10" max="120" value="30" />
    </label>
    <button type="submit">部屋を作る</button>
  `;
  app.appendChild(form);
  appendBackButton('戻る', () => renderOnlineChoiceScreen());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = '接続中…';

    hostInfo = {
      name: form.querySelector('#hostName').value || 'ホスト',
      characterId: form.querySelector('#hostCharacter').value,
    };
    hostTargetMinutes = Math.min(120, Math.max(5, Number(form.querySelector('#hostTargetMinutes').value) || 30));
    hostGuestRoster = [];

    let joined = false;
    let lastError = null;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts && !joined; attempt++) {
      submitButton.textContent = attempt === 0 ? '接続中…' : `接続中…(試行 ${attempt + 1}/${maxAttempts})`;
      const code = generateJoinCode();
      try {
        // eslint-disable-next-line no-await-in-loop
        await net.hostRoom(code, {
          onGuestLeave: (conn) => {
            hostGuestRoster = hostGuestRoster.filter((g) => g.conn !== conn);
            broadcastRoster();
            if (!state) renderHostLobbyScreen();
          },
        });
        roomCode = code;
        joined = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (!joined) {
      submitButton.disabled = false;
      submitButton.textContent = '部屋を作る';
      alert(`部屋を作れませんでした(通信サーバーが混み合っている可能性があります。時間をおいて再度お試しください): ${lastError?.message ?? lastError}`);
      return;
    }

    onlineRole = 'host';
    localPlayerId = 'p0';
    net.onMessage(handleHostMessage);
    renderHostLobbyScreen();
  });
}

function broadcastRoster() {
  const roster = [
    { name: hostInfo.name, characterId: hostInfo.characterId, isHost: true },
    ...hostGuestRoster.map((g) => ({ name: g.name, characterId: g.characterId, isHost: false })),
  ];
  net.broadcast({ type: 'roster', roster });
}

function renderHostLobbyScreen() {
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'lobby';
  const totalPlayers = 1 + hostGuestRoster.length;
  const balance = calculateTargetedBalance(totalPlayers, hostTargetMinutes);
  wrap.innerHTML = `
    <h1>部屋を作りました</h1>
    <div class="room-code-display">${roomCode}</div>
    <p class="mode-select-lead">この合言葉を他の人に伝えてください(同じWiFi推奨)</p>
    <div class="lobby-roster">
      <div class="lobby-roster-item">${hostInfo.name}(${CHARACTERS[hostInfo.characterId]?.name ?? hostInfo.characterId})・ホスト</div>
      ${hostGuestRoster.map((g) => `<div class="lobby-roster-item">${g.name}(${CHARACTERS[g.characterId]?.name ?? g.characterId})</div>`).join('')}
    </div>
    <p class="turn-limit-hint">目標 ${hostTargetMinutes}分 / 現在${totalPlayers}人 → ボス ${balance.bossName} / 予想${balance.turnLimit}ターン</p>
    <button type="button" id="startOnlineGame">ゲーム開始</button>
  `;
  app.appendChild(wrap);
  appendBackButton('部屋を閉じる', () => renderModeSelectScreen());

  wrap.querySelector('#startOnlineGame').addEventListener('click', () => {
    playSfx('confirm');
    startOnlineHostGame();
  });
}

function startOnlineHostGame() {
  const selections = [
    { id: 'p0', name: hostInfo.name, characterId: hostInfo.characterId },
    ...hostGuestRoster.map((g, i) => ({ id: `p${i + 1}`, name: g.name, characterId: g.characterId })),
  ];
  startGame(selections, null, hostTargetMinutes);
  hostGuestRoster.forEach((g, i) => {
    g.conn.send({ type: 'gameStart', state, yourPlayerId: `p${i + 1}` });
  });
}

function renderGuestJoinScreen() {
  app.innerHTML = '';
  const form = document.createElement('form');
  form.innerHTML = `
    <h1>部屋に入る</h1>
    <label>合言葉(4桁)
      <input type="text" id="joinCode" inputmode="numeric" maxlength="4" placeholder="1234" style="letter-spacing:0.3em;" />
    </label>
    <label>自分の名前
      <input type="text" id="guestName" placeholder="プレイヤー" value="プレイヤー" />
    </label>
    <label>自分の職業
      <select id="guestCharacter">
        ${Object.values(CHARACTERS).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
    </label>
    <button type="submit">参加する</button>
  `;
  app.appendChild(form);
  appendBackButton('戻る', () => renderOnlineChoiceScreen());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    const code = form.querySelector('#joinCode').value.trim();
    if (!/^\d{4}$/.test(code)) {
      alert('4桁の数字で入力してください');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = '接続中…';
    const guestName = form.querySelector('#guestName').value || 'プレイヤー';
    const guestCharacterId = form.querySelector('#guestCharacter').value;

    let joined = false;
    let lastError = null;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts && !joined; attempt++) {
      submitButton.textContent = attempt === 0 ? '接続中…' : `接続中…(試行 ${attempt + 1}/${maxAttempts})`;
      try {
        // eslint-disable-next-line no-await-in-loop
        await net.joinRoom(code, {
          onError: () => {
            if (!state) {
              alert('ホストとの接続が切れました');
              renderModeSelectScreen();
            }
          },
        });
        joined = true;
      } catch (err) {
        lastError = err;
        // 合言葉自体が間違っている(部屋が存在しない)場合は何度試しても無駄なので
        // 通信エラーとは分けて即座にあきらめる。
        if (err?.type === 'peer-unavailable') break;
      }
    }

    if (!joined) {
      submitButton.disabled = false;
      submitButton.textContent = '参加する';
      const message = lastError?.type === 'peer-unavailable'
        ? '部屋が見つかりませんでした。合言葉を確認してください。'
        : `部屋に入れませんでした(通信サーバーが混み合っている可能性があります。時間をおいて再度お試しください): ${lastError?.message ?? lastError}`;
      alert(message);
      return;
    }

    onlineRole = 'guest';
    roomCode = code;
    guestRosterView = [];
    net.onMessage(handleGuestMessage);
    net.send({ type: 'join', name: guestName, characterId: guestCharacterId });
    renderGuestWaitingScreen();
  });
}

function renderGuestWaitingScreen() {
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'lobby';
  wrap.innerHTML = `
    <h1>参加しました</h1>
    <p class="mode-select-lead">ホストがゲームを開始するのを待っています…</p>
    <div class="lobby-roster">
      ${guestRosterView.map((g) => `<div class="lobby-roster-item">${g.name}(${CHARACTERS[g.characterId]?.name ?? g.characterId})${g.isHost ? '・ホスト' : ''}</div>`).join('')}
    </div>
  `;
  app.appendChild(wrap);
  appendBackButton('退出する', () => renderModeSelectScreen());
}

// ---------- ホスト/ゲスト間のメッセージ処理 ----------

function handleHostMessage(msg, conn) {
  if (msg.type === 'join') {
    const existing = hostGuestRoster.find((g) => g.conn === conn);
    if (existing) {
      existing.name = msg.name;
      existing.characterId = msg.characterId;
    } else {
      hostGuestRoster.push({ conn, name: msg.name, characterId: msg.characterId });
    }
    broadcastRoster();
    if (!state) renderHostLobbyScreen();
    return;
  }
  if (msg.type === 'moveRoll') {
    spinDice(msg.playerId, msg.value, 'move');
    net.broadcast({ type: 'moveRoll', playerId: msg.playerId, value: msg.value }, conn);
    return;
  }
  if (msg.type === 'effectRollValue') {
    if (pendingRemoteEffectResolve && pendingRemoteEffectResolve.playerId === msg.playerId) {
      const resolve = pendingRemoteEffectResolve.resolve;
      pendingRemoteEffectResolve = null;
      resolve(msg.value);
    }
    return;
  }
  if (msg.type === 'branchChoice') {
    if (pendingRemoteBranchResolve && pendingRemoteBranchResolve.playerId === msg.playerId) {
      const resolve = pendingRemoteBranchResolve.resolve;
      pendingRemoteBranchResolve = null;
      resolve(msg.choice);
    }
    return;
  }
}

function handleGuestMessage(msg) {
  if (msg.type === 'roster') {
    guestRosterView = msg.roster;
    if (!state) renderGuestWaitingScreen();
    return;
  }
  if (msg.type === 'gameStart') {
    state = msg.state;
    localPlayerId = msg.yourPlayerId;
    pendingMoves = {};
    effectRolls = {};
    clearDiceIntervals();
    phase = 'move';
    activeMovePlayerId = state.players[0]?.id ?? null;
    startBgm();
    playSfx('confirm');
    renderTurnScreen();
    return;
  }
  if (msg.type === 'moveRoll') {
    spinDice(msg.playerId, msg.value, 'move');
    playSfx('diceConfirm');
    return;
  }
  if (msg.type === 'scene') {
    state = msg.state;
    renderGame(state, app);
    return;
  }
  if (msg.type === 'banner') {
    app.appendChild(renderPhaseBanner(msg.title, msg.subtitle));
    playSfx('confirm');
    return;
  }
  if (msg.type === 'overlay') {
    applyRemoteOverlay(msg.html, msg.meta);
    if (msg.meta?.type === 'bossAttack') {
      playSfx('bossAttack');
    }
    return;
  }
  if (msg.type === 'turnReset') {
    pendingMoves = {};
    effectRolls = {};
    clearDiceIntervals();
    phase = 'move';
    activeMovePlayerId = null;
    playSfx('confirm');
    renderTurnScreen();
    return;
  }
  if (msg.type === 'gameOver') {
    state = msg.state;
    renderGame(state, app);
    const banner = document.createElement('h1');
    banner.textContent = msg.result === 'win' ? '勝利!' : '敗北...';
    app.appendChild(banner);
    app.appendChild(renderEventLogForState(state));
    if (msg.result === 'win') {
      playSfx('bossDefeated');
    }
    return;
  }
}

function mirrorScene(displayState = state) {
  if (onlineRole === 'host') net.broadcast({ type: 'scene', state: displayState });
}

function mirrorBanner(title, subtitle) {
  if (onlineRole === 'host') net.broadcast({ type: 'banner', title, subtitle });
}

function mirrorOverlay(html, meta = null) {
  if (onlineRole === 'host') net.broadcast({ type: 'overlay', html, meta });
}

function ensureRemoteOverlay() {
  let overlay = document.querySelector('.remote-mirror-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'turn-popup-overlay remote-mirror-overlay';
  const panel = document.createElement('div');
  panel.className = 'turn-popup';
  const contentDiv = document.createElement('div');
  contentDiv.className = 'remote-overlay-content';
  const actionDiv = document.createElement('div');
  actionDiv.className = 'remote-overlay-action';
  panel.appendChild(contentDiv);
  panel.appendChild(actionDiv);
  overlay.appendChild(panel);
  app.appendChild(overlay);
  return overlay;
}

function applyRemoteOverlay(html, meta) {
  const overlay = ensureRemoteOverlay();
  overlay.querySelector('.remote-overlay-content').innerHTML = html;
  const actionDiv = overlay.querySelector('.remote-overlay-action');

  const isMine = !!(meta && meta.playerId === localPlayerId);
  const key = isMine ? `${meta.kind}:${meta.playerId}` : '';
  if (actionDiv.dataset.mirrorKey === key && key !== '') return;
  actionDiv.dataset.mirrorKey = key;
  actionDiv.innerHTML = '';
  if (!isMine) return;

  if (meta.kind === 'effectRoll') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'turn-button remote-roll-button';
    button.textContent = 'このプレイヤーのサイコロを振る';
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = '結果を送信中…';
      const value = rollDie();
      playSfx('diceConfirm');
      net.send({ type: 'effectRollValue', playerId: meta.playerId, value });
    });
    actionDiv.appendChild(button);
  } else if (meta.kind === 'branchChoice') {
    const choices = document.createElement('div');
    choices.className = 'branch-choice-list';
    const trunkButton = document.createElement('button');
    trunkButton.type = 'button';
    trunkButton.className = 'branch-choice-button';
    trunkButton.textContent = '幹ルートを進む';
    trunkButton.addEventListener('click', () => {
      playSfx('confirm');
      net.send({ type: 'branchChoice', playerId: meta.playerId, choice: null });
      actionDiv.innerHTML = '';
    });
    choices.appendChild(trunkButton);
    for (const fork of meta.forks ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'branch-choice-button';
      button.textContent = `${fork.theme}へ進む`;
      button.addEventListener('click', () => {
        playSfx('confirm');
        net.send({ type: 'branchChoice', playerId: meta.playerId, choice: fork.id });
        actionDiv.innerHTML = '';
      });
      choices.appendChild(button);
    }
    actionDiv.appendChild(choices);
  }
}

function renderSetupScreen() {
  app.innerHTML = '';
  const form = document.createElement('form');
  form.innerHTML = `
    <h1>双六RPG - プレイヤー設定</h1>
    <label>プレイヤー人数(2〜8)
      <input type="number" id="playerCount" min="2" max="8" value="2" />
    </label>
    <label>目標プレイ時間(分)
      <input type="number" id="targetMinutesInput" min="10" max="120" value="30" />
    </label>
    <p id="targetMinutesHint" class="turn-limit-hint"></p>
    <div id="playerSlots"></div>
    <button type="submit">ゲーム開始</button>
  `;
  app.appendChild(form);
  appendBackButton('戻る', () => renderModeSelectScreen());

  const slotsContainer = form.querySelector('#playerSlots');
  const countInput = form.querySelector('#playerCount');
  const targetMinutesInput = form.querySelector('#targetMinutesInput');
  const targetMinutesHint = form.querySelector('#targetMinutesHint');
  let targetMinutesTouched = false;

  function currentPlayerCount() {
    return Math.min(8, Math.max(2, Number(countInput.value) || 2));
  }

  function updateTargetMinutesInfo() {
    const shown = Math.min(120, Math.max(5, Number(targetMinutesInput.value) || 30));
    if (!targetMinutesTouched) {
      targetMinutesInput.value = String(shown);
    }
    const balance = calculateTargetedBalance(currentPlayerCount(), shown);
    targetMinutesHint.textContent = `目標 ${shown}分 → ボス ${balance.bossName} / HP ${balance.bossHp} / 予想${balance.turnLimit}ターン / 1人平均HP 約${Math.round(250 * balance.playerHpScale)}`;
  }

  targetMinutesInput.addEventListener('input', () => {
    targetMinutesTouched = true;
    updateTargetMinutesInfo();
  });

  function renderSlots() {
    const count = currentPlayerCount();
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
  countInput.addEventListener('input', () => {
    renderSlots();
    updateTargetMinutesInfo();
  });
  renderSlots();
  updateTargetMinutesInfo();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const count = currentPlayerCount();
    const selections = [];
    for (let i = 0; i < count; i++) {
      selections.push({
        id: `p${i}`,
        name: form.querySelector(`[name="name-${i}"]`).value || `プレイヤー${i + 1}`,
        characterId: form.querySelector(`[name="character-${i}"]`).value,
      });
    }
    const targetMinutes = Math.min(120, Math.max(5, Number(targetMinutesInput.value) || 30));
    startGame(selections, null, targetMinutes);
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

function startGame(selections, turnLimit = null, targetMinutes = null) {
  const balance = Number.isFinite(targetMinutes) && Number(targetMinutes) > 0
    ? calculateTargetedBalance(selections.length, Number(targetMinutes))
    : null;
  const bossId = balance ? balance.bossId : 'fireDragon';
  state = createGameState(selections, bossId, Math.random, turnLimit, targetMinutes);
  pendingMoves = {};
  effectRolls = {};
  clearDiceIntervals();
  phase = 'move';
  activeMovePlayerId = state.players[0]?.id ?? null;
  startBgm();
  playSfx('confirm');
  renderTurnScreen();
}

function renderDiceTray(displayState = state, valueSet = 'move') {
  const tray = document.createElement('div');
  tray.className = 'dice-tray';

  // ボスのサイコロは右上のボスパネルにのみ表示し、ここには表示しない
  // (render.jsのrenderBoss関数でボスパネルに表示済み)

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
    playSfx('diceConfirm');
    const remaining = state.players.find((entry) => pendingMoves[entry.id] === undefined);
    activeMovePlayerId = remaining ? remaining.id : null;
    if (remaining) {
      renderTurnScreen();
      return;
    }
    renderTurnScreen();
  }
}

function playMoveStepSound() {
  playSfx('moveStep');
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
  if (!state) return;

  const nextUnrolled = state.players.find((player) => pendingMoves[player.id] === undefined);
  if (nextUnrolled && (!activeMovePlayerId || !state.players.some((player) => player.id === activeMovePlayerId))) {
    activeMovePlayerId = nextUnrolled.id;
  }
  if (!nextUnrolled) {
    activeMovePlayerId = null;
  }

  renderGame(state, app);
  const activePlayer = activeMovePlayerId ? state.players.find((player) => player.id === activeMovePlayerId) : null;
  app.appendChild(renderPhaseBanner('移動フェーズ', activePlayer ? `${activePlayer.name}の番です。サイコロを振ってください` : '全員の移動ダイスが決定しました'));
  app.appendChild(renderDiceTray());

  const activeBox = activePlayer ? document.querySelector(`.player-card[data-player-id="${activePlayer.id}"]`) : null;
  if (activeBox) {
    activeBox.classList.add('is-rolling');
  }

  if (activePlayer && pendingMoves[activePlayer.id] === undefined) {
    startDiceLoop(activePlayer.id, 'move');
  }

  const controls = document.createElement('section');
  controls.className = 'controls';
  for (const player of state.players) {
    const button = document.createElement('button');
    const rolled = pendingMoves[player.id] !== undefined;
    const isActive = player.id === activeMovePlayerId;
    const isMine = !onlineRole || player.id === localPlayerId;
    const dieLabel = rolled ? `🎲 ${pendingMoves[player.id]} 目` : isActive ? (isMine ? 'サイコロを振る' : '振っています…') : '待機中';
    button.textContent = `${player.name}: ${dieLabel}`;
    button.disabled = rolled || !isActive || !isMine;
    button.className = 'turn-button';
    button.addEventListener('click', () => {
      if (pendingMoves[player.id] !== undefined || player.id !== activeMovePlayerId || !isMine) return;
      const finalValue = Number(document.querySelector(`.dice-box[data-player-id="${player.id}"]`)?.textContent || rollDie());
      spinDice(player.id, finalValue, 'move');
      if (onlineRole === 'host') {
        net.broadcast({ type: 'moveRoll', playerId: player.id, value: finalValue });
      } else if (onlineRole === 'guest') {
        net.send({ type: 'moveRoll', playerId: player.id, value: finalValue });
      }
    });
    controls.appendChild(button);
  }
  app.appendChild(controls);

  const allRolled = state.players.every((p) => pendingMoves[p.id] !== undefined);
  if (allRolled) {
    if (!onlineRole || onlineRole === 'host') {
      const resolveButton = document.createElement('button');
      resolveButton.textContent = '次に進む';
      resolveButton.className = 'resolve-button';
      resolveButton.addEventListener('click', () => {
        playSfx('confirm');
        resolveTurn();
      });
      app.appendChild(resolveButton);
    } else {
      const waiting = document.createElement('p');
      waiting.className = 'turn-limit-hint';
      waiting.textContent = 'ホストが次に進むのを待っています…';
      app.appendChild(waiting);
    }
    activeMovePlayerId = null;
  }

  if (activePlayer) {
    requestAnimationFrame(() => focusBoardOnPlayer(activePlayer.id));
  } else {
    requestAnimationFrame(() => focusBoardOnFrontPlayer());
  }
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
      text = `${getPlayerName(entry.by)}が守備+${entry.amount}(同じマスの仲間も対象)`;
    } else if (entry.type === 'bossAttack') {
      text = `${entry.name}: ボスが${getPlayerName(entry.target)}に${entry.damage}ダメージ`;
    } else if (entry.type === 'death') {
      text = `${getPlayerName(entry.target)}が力尽きた… HP半分で復活し、${entry.restTurns}ターン休み状態に(ボスがHP${entry.bossHeal}回復)`;
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
      death: '死亡',
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

async function chooseBranchForPlayer(player, forks) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'turn-popup-overlay';

    const panel = document.createElement('div');
    panel.className = 'turn-popup';
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = `<h3>${player.name}の番: 分岐を選択</h3>`;
    const actionDiv = document.createElement('div');
    panel.appendChild(contentDiv);
    panel.appendChild(actionDiv);
    overlay.appendChild(panel);

    const isLocalTurn = !onlineRole || player.id === localPlayerId;
    const finish = (choice) => {
      overlay.remove();
      resolve(choice);
    };

    if (isLocalTurn) {
      const choices = document.createElement('div');
      choices.className = 'branch-choice-list';

      const trunkButton = document.createElement('button');
      trunkButton.type = 'button';
      trunkButton.className = 'branch-choice-button';
      trunkButton.textContent = '幹ルートを進む';
      trunkButton.addEventListener('click', () => {
        playSfx('confirm');
        if (onlineRole === 'host') net.broadcast({ type: 'branchChoice', playerId: player.id, choice: null });
        finish(null);
      });
      choices.appendChild(trunkButton);

      for (const fork of forks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'branch-choice-button';
        button.textContent = `${fork.theme}へ進む`;
        button.addEventListener('click', () => {
          playSfx('confirm');
          if (onlineRole === 'host') net.broadcast({ type: 'branchChoice', playerId: player.id, choice: fork.id });
          finish(fork.id);
        });
        choices.appendChild(button);
      }

      actionDiv.appendChild(choices);
    } else {
      const waiting = document.createElement('div');
      waiting.className = 'turn-popup-message';
      waiting.textContent = `${player.name}が分岐を選んでいます…`;
      actionDiv.appendChild(waiting);
      pendingRemoteBranchResolve = { playerId: player.id, resolve: finish };
    }

    app.appendChild(overlay);
    mirrorOverlay(contentDiv.innerHTML, { kind: 'branchChoice', playerId: player.id, forks });

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

const BUFF_TYPE_LABELS = { heal: '回復', defense: '守備', attack: '攻撃' };

function activeBuffBonus(player, type) {
  if (!player.buffs) return 0;
  return player.buffs.filter((b) => b.type === type).reduce((sum, b) => sum + b.bonus, 0);
}

// engine.js側のHEAL_PER_DIE/DEFENSE_PER_DIEと揃える(出目 x この値 + バフ)。
const HEAL_PER_DIE = 12;
const DEFENSE_PER_DIE = 15;
const DAMAGE_PER_DIE = 10;

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
    const reduction = dieValue * DEFENSE_PER_DIE + activeBuffBonus(player, 'defense');
    return `${player.name}のマスで${dieValue}目 → 防御: ボスの攻撃を${reduction}軽減(同じマスの仲間も対象)`;
  }
  if (cell.type === 'damage') {
    const value = dieValue <= 2 ? 0 : dieValue * DAMAGE_PER_DIE;
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
    damage: [1, 2, 3, 4, 5, 6].map((face) => ({ face, value: face <= 2 ? '0ダメージ' : `${face * DAMAGE_PER_DIE}ダメージ` })),
    defense: [1, 2, 3, 4, 5, 6].map((face) => ({ face, value: `${face * DEFENSE_PER_DIE}軽減` })),
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

function describeBossDieFaceTable(bossId) {
  const tableRows = [1, 2, 3, 4, 5, 6].map((face) => {
    const result = rollBossAttack(bossId, face);
    return `
      <tr>
        <td>${face}</td>
        <td>${result.name}: ${result.damage}ダメージ</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="die-face-table">
      <thead>
        <tr><th>目</th><th>効果</th></tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

function buildEffectPopupContentHtml(playerName, cellKind, tableHtml, dieText, resultHtml = '') {
  return `
    <h3>${playerName}の番</h3>
    <div class="turn-popup-message">
      <div class="die-face-summary">${cellKind}マス</div>
      ${tableHtml}
      ${resultHtml}
    </div>
    <div class="dice-box" style="font-size:2rem;margin:0.8rem auto 0;">${dieText}</div>
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
    const isLocalTurn = !onlineRole || player.id === localPlayerId;
    const tableHtml = describeDieFaceTable(cell.type, player);

    const finalValue = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'turn-popup-overlay';

      const panel = document.createElement('div');
      panel.className = 'turn-popup';
      const contentDiv = document.createElement('div');
      const actionDiv = document.createElement('div');
      panel.appendChild(contentDiv);
      panel.appendChild(actionDiv);
      overlay.appendChild(panel);

      requestAnimationFrame(() => {
        const board = document.querySelector('.board');
        const token = board?.querySelector(`.player-token[data-player-id="${player.id}"]`);
        const targetCell = token?.closest('.cell');
        if (targetCell) {
          targetCell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      });

      const updateActivePlayerGlow = (isActive) => {
        const playerCard = document.querySelector(`.player-card[data-player-id="${player.id}"]`);
        if (!playerCard) return;
        playerCard.classList.toggle('is-rolling', isActive);
      };

      const paint = (dieText, resultHtml = '') => {
        contentDiv.innerHTML = buildEffectPopupContentHtml(player.name, cellKind, tableHtml, dieText, resultHtml);
        mirrorOverlay(contentDiv.innerHTML, { kind: 'effectRoll', playerId: player.id, cellType: cell.type });
      };

      let intervalId = null;

      const finish = (value) => {
        if (intervalId) window.clearInterval(intervalId);
        updateActivePlayerGlow(false);

        if (cell.type === 'heal') playSfx('heal');
        if (cell.type === 'attack') playSfx('playerAttack');
        if (cell.type === 'defense') playSfx('defense');
        if (cell.type === 'item') playSfx('treasure');
        if (cell.type === 'damage' && value <= 2) playSfx('miss');

        effectRolls[player.id] = value;
        const resultText = describeCellEffect(player, cell, value);
        paint(String(value), `<div class="die-face-result">→ ${resultText}</div>`);
        setTimeout(() => resolve(value), 2000);
      };

      if (isLocalTurn) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'turn-button';
        button.textContent = 'このプレイヤーのサイコロを振る';
        button.addEventListener('click', () => {
          const value = Number(contentDiv.querySelector('.dice-box')?.textContent || rollDie());
          finish(value);
          if (onlineRole === 'host') net.broadcast({ type: 'effectRollValue', playerId: player.id, value });
        });
        actionDiv.appendChild(button);
      } else {
        const waiting = document.createElement('div');
        waiting.className = 'turn-popup-message';
        waiting.textContent = `${player.name}がサイコロを振っています…`;
        actionDiv.appendChild(waiting);
        pendingRemoteEffectResolve = { playerId: player.id, resolve: finish };
      }

      renderGame(state, app);
      mirrorScene(state);
      app.appendChild(renderPhaseBanner('効果判定', `${player.name}の番`));
      mirrorBanner('効果判定', `${player.name}の番`);
      app.appendChild(overlay);
      updateActivePlayerGlow(true);
      intervalId = window.setInterval(() => {
        paint(String(1 + Math.floor(Math.random() * 6)));
      }, 100);
      paint('·');
      requestAnimationFrame(() => focusBoardOnPlayer(player.id));
    });

    const resultText = describeCellEffect(player, cell, finalValue);
    renderGame(state, app);
    mirrorScene(state);
    app.appendChild(renderPhaseBanner('効果発動', resultText));
    mirrorBanner('効果発動', resultText);
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
      playMoveStepSound();
    }

    const previewState = { ...state, map: mapWithAhead, players: animatedPlayers.map((player) => ({ ...player })) };
    renderGame(previewState, app);
    mirrorScene(previewState);
    app.appendChild(renderDiceTray(previewState));
    app.appendChild(renderPhaseBanner('移動', `${step}マスずつ前へ進む`));
    mirrorBanner('移動', `${step}マスずつ前へ進む`);
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
  const deathEntries = nextState.log.filter((entry) => entry.type === 'death');
  state = nextState;
  pendingMoves = {};
  effectRolls = {};
  clearDiceIntervals();
  phase = 'move';

  requestAnimationFrame(() => focusBoardOnFrontPlayer());

  if (deathEntries.length > 0) {
    playSfx('allyDeath');
  }

  // 死亡は目立つ形ではっきり知らせる(見落とされやすいイベントログだけに頼らない)。
  if (deathEntries.length > 0) {
    renderGame(state, app);
    mirrorScene(state);
    const deathOverlay = document.createElement('div');
    deathOverlay.className = 'turn-popup-overlay';
    const deathPanel = document.createElement('div');
    deathPanel.className = 'turn-popup';
    const deathHeading = document.createElement('h3');
    deathHeading.textContent = '力尽きたプレイヤー';
    deathPanel.appendChild(deathHeading);
    for (const entry of deathEntries) {
      const item = document.createElement('div');
      item.className = 'turn-popup-message';
      item.textContent = `${getPlayerName(entry.target)}が力尽きた… HP半分で復活し、${entry.restTurns}ターン休み状態に(ボスがHP${entry.bossHeal}回復)`;
      deathPanel.appendChild(item);
    }
    deathOverlay.appendChild(deathPanel);
    app.appendChild(deathOverlay);
    mirrorOverlay(deathPanel.innerHTML, null);
    await new Promise((resolve) => window.setTimeout(resolve, 2200));
    deathOverlay.remove();
  }

  if (gameOver.over) {
    if (gameOver.result === 'win') {
      playSfx('bossDefeated');
    }
    renderGame(state, app);
    mirrorScene(state);
    const banner = document.createElement('h1');
    banner.textContent = gameOver.result === 'win' ? '勝利!' : '敗北...';
    app.appendChild(banner);
    app.appendChild(renderEventLog());
    if (onlineRole === 'host') {
      net.broadcast({ type: 'gameOver', state, result: gameOver.result });
    }
    return;
  }

  const bossRoll = Number.isInteger(Number(state.boss.lastRoll)) ? Number(state.boss.lastRoll) : 1;
  const bossRollValue = Math.min(6, Math.max(1, bossRoll));
  state.boss.lastRoll = undefined;
  renderGame(state, app);
  mirrorScene(state);

  // ボスの技表を見せつつ出目を演出し、確定したらその出目を表と一緒に2秒表示する
  // (プレイヤーの効果判定ポップアップと同じパターンに揃えてある)。
  const bossOverlay = document.createElement('div');
  bossOverlay.className = 'turn-popup-overlay';
  const bossPanel = document.createElement('div');
  bossPanel.className = 'turn-popup';

  const bossHeading = document.createElement('h3');
  bossHeading.textContent = `${state.boss.name}の攻撃`;

  const bossDescription = document.createElement('div');
  bossDescription.className = 'turn-popup-message';
  bossDescription.innerHTML = `
    <div class="die-face-summary">ボスの技</div>
    ${describeBossDieFaceTable(state.boss.id)}
  `;

  const bossDieBox = document.createElement('div');
  bossDieBox.className = 'dice-box rolling';
  bossDieBox.style.fontSize = '2rem';
  bossDieBox.style.margin = '0 auto 12px';
  bossDieBox.textContent = '·';

  bossPanel.appendChild(bossHeading);
  bossPanel.appendChild(bossDescription);
  bossPanel.appendChild(bossDieBox);
  bossOverlay.appendChild(bossPanel);
  app.appendChild(bossOverlay);
  mirrorOverlay(bossPanel.innerHTML, { type: 'bossAttack' });
  playSfx('bossAttack');

  const bossIntervalId = window.setInterval(() => {
    bossDieBox.textContent = String(1 + Math.floor(Math.random() * 6));
    mirrorOverlay(bossPanel.innerHTML, null);
  }, 100);
  await new Promise((resolve) => window.setTimeout(resolve, 1000));
  window.clearInterval(bossIntervalId);
  bossDieBox.classList.remove('rolling');
  bossDieBox.textContent = String(bossRollValue);
  state.boss.lastRoll = bossRollValue;

  const bossAttack = rollBossAttack(state.boss.id, bossRollValue);
  if (bossAttack.damage > 0) {
    playSfx('bossAttack');
  } else {
    playSfx('miss');
  }
  bossDescription.innerHTML = `
    <div class="die-face-summary">ボスの技</div>
    ${describeBossDieFaceTable(state.boss.id)}
    <div class="die-face-result">→ ${bossAttack.name}: ${bossAttack.damage}ダメージ</div>
  `;
  mirrorOverlay(bossPanel.innerHTML, null);

  await new Promise((resolve) => window.setTimeout(resolve, 2000));
  bossOverlay.remove();

  renderTurnScreen();
  if (onlineRole === 'host') {
    net.broadcast({ type: 'turnReset' });
  }
  requestAnimationFrame(() => focusBoardOnFrontPlayer());
}
