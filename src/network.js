// src/network.js
// 同じWiFi内でのオンライン対戦用の通信レイヤー。実際のゲームデータは常に
// ホストとゲスト間で直接P2P通信する(ホストが唯一の正となり、ゲストはホストと
// だけ繋がるスター型)。最初の接続確立(シグナリング=WebRTCのオファー/アンサーの
// 受け渡し)だけ、常時稼働で信頼性の高いFirebase Realtime DatabaseをREST API+
// SSEで薄く仲介として使う(自前のサーバーコードは一切書かない。ゲーム中は
// 一切経由しない)。STUNサーバー(公開・無料・ステートレスなIP発見用で、
// アプリのデータには一切関与しない)は接続の当て推量を助けるフォールバック。
// このファイルはRTCPeerConnection/RTCDataChannel/fetch/EventSourceといった
// ブラウザAPIに依存するため、テストからは encodeSignal/decodeSignal/
// generateJoinCode のみを使う。

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const ICE_GATHER_TIMEOUT_MS = 4000;

// Firebaseプロジェクトを作ったら、Realtime DatabaseのURLをここに設定する
// (例: 'https://xxxx-default-rtdb.asia-southeast1.firebasedatabase.app')。
const FIREBASE_DB_URL = '';

export function encodeSignal(desc) {
  return JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', s: desc.sdp });
}

export function decodeSignal(text) {
  const parsed = JSON.parse(text);
  return { type: parsed.t === 'o' ? 'offer' : 'answer', sdp: parsed.s };
}

// 合言葉は4桁(1万通り)しかなく総当たりされ得る空間なので、Math.randomではなく
// Web Crypto(crypto.getRandomValues)由来の乱数を使う(予測困難性を上げる。
// 剰余バイアスを避けるため棄却法を使う)。rngを明示的に渡した場合はテスト用の
// 決定的な値として扱う。
function cryptoRandomInt(maxExclusive) {
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % maxExclusive;
}

export function generateJoinCode(rng) {
  const n = rng ? Math.floor(rng() * 10000) : cryptoRandomInt(10000);
  return String(n).padStart(4, '0');
}

function roomPath(code, key) {
  return `${FIREBASE_DB_URL}/rooms/${code}/${key}.json`;
}

async function firebasePut(code, key, value) {
  await fetch(roomPath(code, key), { method: 'PUT', body: JSON.stringify(value) });
}

async function firebaseGet(code, key) {
  const res = await fetch(roomPath(code, key));
  if (!res.ok) return null;
  return res.json();
}

async function firebaseDeleteRoom(code) {
  if (!FIREBASE_DB_URL) return;
  await fetch(`${FIREBASE_DB_URL}/rooms/${code}.json`, { method: 'DELETE' }).catch(() => {});
}

// ホスト側: 4桁コードの衝突(まれに他の実行中の部屋やゴミデータと被る)を避ける
// ため、既に使われていないコードを探す。
export async function reserveJoinCode({ attempts = 5 } = {}) {
  if (!FIREBASE_DB_URL) {
    throw new Error('通信の仲介先(Firebase)が設定されていません。src/network.jsのFIREBASE_DB_URLを確認してください。');
  }
  for (let i = 0; i < attempts; i++) {
    const code = generateJoinCode();
    // eslint-disable-next-line no-await-in-loop
    const existing = await firebaseGet(code, 'offer');
    if (existing === null || existing === undefined) return code;
  }
  throw new Error('合言葉の発行に失敗しました。もう一度お試しください。');
}

// ホスト側: オファーを公開する。
export async function publishOffer(code, payload) {
  await firebasePut(code, 'offer', payload);
}

// ゲスト側: コードに対応するオファーを取得する(ホストの書き込みと多少前後
// する可能性があるので、数回リトライする)。見つからなければnull。
export async function fetchOffer(code, { attempts = 6, intervalMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    const value = await firebaseGet(code, 'offer');
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// ゲスト側: アンサーを公開する。
export async function publishAnswer(code, payload) {
  await firebasePut(code, 'answer', payload);
}

// ホスト側: アンサーが書き込まれるのをリアルタイムに待つ(SSE)。
// 呼び出すと購読解除用の関数を返す。
export function awaitAnswer(code, onAnswer) {
  if (!FIREBASE_DB_URL) return () => {};
  const source = new EventSource(roomPath(code, 'answer'));
  let done = false;
  const handlePut = (event) => {
    if (done) return;
    try {
      const parsed = JSON.parse(event.data);
      if (parsed?.data) {
        done = true;
        source.close();
        onAnswer(parsed.data);
      }
    } catch {
      // 不正なイベントは無視する
    }
  };
  source.addEventListener('put', handlePut);
  source.addEventListener('patch', handlePut);
  return () => {
    done = true;
    source.close();
  };
}

// ペアリング完了/中断後、次の合言葉のために部屋のデータを片付ける。
export async function clearRoom(code) {
  await firebaseDeleteRoom(code);
}

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
  });
}

// ホスト側: 新しいゲスト1人分のオファーを作る。返り値のconnection/dataChannelは
// 呼び出し元が保持しておき、dataChannel.onopenで接続完了を検知する。
export async function createHostOffer() {
  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const dataChannel = connection.createDataChannel('game', { ordered: true });
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  await waitForIceGatheringComplete(connection);
  const payload = encodeSignal({ type: connection.localDescription.type, sdp: connection.localDescription.sdp });
  return { connection, dataChannel, payload };
}

// ホスト側: スキャンしたゲストのアンサーを適用する。
export async function acceptAnswer(connection, answerPayloadText) {
  const desc = decodeSignal(answerPayloadText);
  await connection.setRemoteDescription(desc);
}

// ゲスト側: スキャンしたホストのオファーからアンサーを作る。
export async function createAnswerFromOffer(offerPayloadText) {
  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const desc = decodeSignal(offerPayloadText);
  await connection.setRemoteDescription(desc);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
  await waitForIceGatheringComplete(connection);
  const payload = encodeSignal({ type: connection.localDescription.type, sdp: connection.localDescription.sdp });
  return { connection, payload };
}

// ゲスト側: ホストが作ったデータチャンネルが届いたら呼ばれる。
export function onDataChannelReady(connection, callback) {
  connection.ondatachannel = (event) => callback(event.channel);
}

let role = null; // 'host' | 'guest' | null
let hostChannels = []; // ホスト側: 接続中の全ゲストDataChannel
let hostConnections = []; // ホスト側: 対応するRTCPeerConnection(disconnectAll用)
let guestChannel = null; // ゲスト側: ホストへの単一DataChannel
let guestConnection = null;
let messageHandler = () => {};

export function setRole(r) {
  role = r;
}

export function getRole() {
  return role;
}

export function onMessage(handler) {
  messageHandler = handler;
}

export function registerHostChannel(connection, channel, { onClose } = {}) {
  hostConnections.push(connection);
  hostChannels.push(channel);
  channel.onmessage = (event) => {
    try {
      messageHandler(JSON.parse(event.data), channel);
    } catch {
      // 不正なメッセージは無視する
    }
  };
  channel.onclose = () => {
    hostChannels = hostChannels.filter((c) => c !== channel);
    onClose?.(channel);
  };
}

export function registerGuestChannel(connection, channel, { onClose } = {}) {
  guestConnection = connection;
  guestChannel = channel;
  channel.onmessage = (event) => {
    try {
      messageHandler(JSON.parse(event.data));
    } catch {
      // 不正なメッセージは無視する
    }
  };
  channel.onclose = () => {
    guestChannel = null;
    onClose?.();
  };
}

// ゲスト -> ホスト
export function send(message) {
  if (guestChannel && guestChannel.readyState === 'open') {
    guestChannel.send(JSON.stringify(message));
  }
}

// ホスト -> 全ゲスト(excludeChannelで送信元への折り返しを避けられる)
export function broadcast(message, excludeChannel = null) {
  const text = JSON.stringify(message);
  for (const channel of hostChannels) {
    if (channel === excludeChannel) continue;
    if (channel.readyState === 'open') channel.send(text);
  }
}

// ホスト側: 特定の1人にだけ送る(参加者ごとに異なるplayerIdを教える等に使う)。
export function sendTo(channel, message) {
  if (channel && channel.readyState === 'open') {
    channel.send(JSON.stringify(message));
  }
}

export function guestCount() {
  return hostChannels.length;
}

export function disconnectAll() {
  for (const channel of hostChannels) channel.close();
  for (const connection of hostConnections) connection.close();
  guestChannel?.close();
  guestConnection?.close();
  hostChannels = [];
  hostConnections = [];
  guestChannel = null;
  guestConnection = null;
  role = null;
}
