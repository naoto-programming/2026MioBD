// src/audio.js
// 効果音とBGMの再生。BGMはループさせず、1曲終わるたびに別のランダムな曲へ
// 切り替える(同じ曲が連続しないようにする)。
//
// オンライン対戦のホスト以外の参加者は、効果音・BGMを鳴らすきっかけの
// ほとんどが「自分の操作」ではなく「ネットワーク越しに届いたメッセージ」
// (banner/overlay/gameStart等)になる。モバイルブラウザ(特にSafari)は
// Audio要素ごとに「ユーザー操作の直下で一度再生されたか」で以後の自動再生
// 可否を判定するため、毎回new Audio()していると要素ごとに未アンロックの
// ままとなり、ゲスト側だけ音が鳴らない状態になる。これを防ぐため、SFX/BGM
// 用のAudio要素をあらかじめ全てプールしておき、ページ内で最初に起きる
// クリック/タップ操作でまとめて一度だけ無音再生→即停止して「アンロック」
// する(以後はどの要素も自由に再生できる)。

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
let unlocked = false;

function sfxPath(name) {
  return `audio/sfx/${encodeURIComponent(SFX_FILES[name])}`;
}

function bgmPath(file) {
  return `audio/bgm/${encodeURIComponent(file)}`;
}

// SFX名ごとに1つのAudio要素を使い回す(毎回new Audioすると要素ごとの
// アンロックが必要なブラウザで意味がなくなるため)。
const sfxPool = {};
for (const name of Object.keys(SFX_FILES)) {
  const audio = new Audio(sfxPath(name));
  audio.volume = SFX_VOLUME;
  audio.preload = 'auto';
  sfxPool[name] = audio;
}

// BGMも同様に全曲分をあらかじめ用意しておき、切り替え時は使い回す
// (曲ごとに新しいAudioを作らない)。
const bgmPool = BGM_FILES.map((file) => {
  const audio = new Audio(bgmPath(file));
  audio.volume = BGM_VOLUME;
  audio.preload = 'auto';
  return audio;
});

let currentBgmAudio = null;
let currentBgmIndex = -1;
let bgmStarted = false;

export function playSfx(name) {
  if (muted) return;
  const audio = sfxPool[name];
  if (!audio) return;
  audio.currentTime = 0;
  // ブラウザの自動再生制限などで失敗しても無視する(効果音が鳴らないだけで
  // ゲーム進行には影響させない)。
  audio.play().catch(() => {});
}

function pickNextBgmIndex() {
  if (bgmPool.length <= 1) return 0;
  let index;
  do {
    index = Math.floor(Math.random() * bgmPool.length);
  } while (index === currentBgmIndex);
  return index;
}

function playNextBgm() {
  if (currentBgmAudio) {
    currentBgmAudio.removeEventListener('ended', playNextBgm);
    currentBgmAudio.pause();
  }
  currentBgmIndex = pickNextBgmIndex();
  currentBgmAudio = bgmPool[currentBgmIndex];
  currentBgmAudio.currentTime = 0;
  currentBgmAudio.volume = muted ? 0 : BGM_VOLUME;
  currentBgmAudio.addEventListener('ended', playNextBgm);
  currentBgmAudio.play().catch(() => {});
}

// ゲーム開始時(ホストのボタン操作、またはゲスト側でgameStartメッセージを
// 受け取った時)に呼ぶ。既に再生中なら何もしない。
export function startBgm() {
  if (bgmStarted) return;
  bgmStarted = true;
  playNextBgm();
}

export function setMuted(value) {
  muted = value;
  if (currentBgmAudio) currentBgmAudio.volume = muted ? 0 : BGM_VOLUME;
}

export function isMuted() {
  return muted;
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

// ページ内で最初に起きるクリック/タップ/キー操作で、SFX・BGM全要素を
// 無音で一度再生→即停止して「アンロック」する。これにより、以後は
// ネットワークメッセージなどユーザー操作を伴わないタイミングでの
// play()呼び出しもブロックされなくなる。
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  for (const audio of [...Object.values(sfxPool), ...bgmPool]) {
    const restoreVolume = audio.volume;
    audio.volume = 0;
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = restoreVolume;
      })
      .catch(() => {
        audio.volume = restoreVolume;
      });
  }
}

if (typeof document !== 'undefined') {
  const unlockOnce = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', unlockOnce);
    document.removeEventListener('keydown', unlockOnce);
  };
  document.addEventListener('pointerdown', unlockOnce, { once: true });
  document.addEventListener('keydown', unlockOnce, { once: true });
}
