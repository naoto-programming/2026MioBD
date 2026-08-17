// src/audio.js
// 効果音とBGMの再生。BGMはループさせず、1曲終わるたびに別のランダムな曲へ
// 切り替える(同じ曲が連続しないようにする)。

const SFX_FILES = {
  moveStep: '1マス進む.mp3',
  treasure: 'お宝.mp3',
  diceConfirm: 'ダイス確定.mp3',
  playerAttack: 'プレイヤーアタック.mp3',
  bossAttack: 'ボスアタック.mp3',
  bossDefeated: 'ボス撃破.mp3',
  allyDeath: '味方死亡.mp3',
  heal: '回復.mp3',
  miss: '攻撃などが失敗.mp3',
  confirm: '決定音.mp3',
  defense: '防御.mp3',
};

const BGM_FILES = ['BGM1.mp3', 'BGM2.mp3', 'BGM3.mp3', 'BGM4.mp3', 'BGM5.mp3', 'BGM6.mp3', 'BGM7.mp3'];

const SFX_VOLUME = 0.9;
const BGM_VOLUME = 0.18;

let muted = false;
let currentBgm = null;
let lastBgmIndex = -1;

function sfxPath(name) {
  return `audio/sfx/${encodeURIComponent(SFX_FILES[name])}`;
}

function bgmPath(file) {
  return `audio/bgm/${encodeURIComponent(file)}`;
}

export function playSfx(name) {
  if (muted) return;
  if (!SFX_FILES[name]) return;
  const audio = new Audio(sfxPath(name));
  audio.volume = SFX_VOLUME;
  // ブラウザの自動再生制限などで失敗しても無視する(効果音が鳴らないだけで
  // ゲーム進行には影響させない)。
  audio.play().catch(() => {});
}

function pickNextBgmIndex() {
  if (BGM_FILES.length <= 1) return 0;
  let index;
  do {
    index = Math.floor(Math.random() * BGM_FILES.length);
  } while (index === lastBgmIndex);
  return index;
}

function playNextBgm() {
  const index = pickNextBgmIndex();
  lastBgmIndex = index;
  currentBgm = new Audio(bgmPath(BGM_FILES[index]));
  currentBgm.volume = muted ? 0 : BGM_VOLUME;
  currentBgm.addEventListener('ended', playNextBgm);
  currentBgm.play().catch(() => {});
}

// ユーザー操作(ゲーム開始ボタンなど)から呼ぶこと。ブラウザの自動再生制限を
// 満たすため。既に再生中なら何もしない。
export function startBgm() {
  if (currentBgm) return;
  playNextBgm();
}

export function setMuted(value) {
  muted = value;
  if (currentBgm) currentBgm.volume = muted ? 0 : BGM_VOLUME;
}

export function isMuted() {
  return muted;
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}
