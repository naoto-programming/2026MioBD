// src/network.js
// 同じWiFi内でのオンライン対戦用の通信レイヤー。シグナリングサーバーを一切
// 使わず、WebRTCのオファー/アンサーをQRコード経由で手動でやり取りして接続を
// 確立する(接続確立後の実際のゲームデータはホストとゲスト間で直接P2P通信する。
// ホストが唯一の正となり、ゲストはホストとだけ繋がるスター型)。
// STUNサーバー(公開・無料・ステートレスなIP発見用で、アプリのデータには
// 一切関与しない)だけは接続の当て推量を助けるためのフォールバックとして使う。
// このファイルはRTCPeerConnection/RTCDataChannelといったブラウザAPIに依存する
// ため、テストからは encodeSignal/decodeSignal のみを使う。

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const ICE_GATHER_TIMEOUT_MS = 4000;

export function encodeSignal(desc) {
  return JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', s: desc.sdp });
}

export function decodeSignal(text) {
  const parsed = JSON.parse(text);
  return { type: parsed.t === 'o' ? 'offer' : 'answer', sdp: parsed.s };
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
