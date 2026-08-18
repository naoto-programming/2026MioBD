// src/network.js
// 同じWiFi内でのオンライン対戦用の通信レイヤー。サーバーは自前で立てず、
// PeerJSの公開シグナリングサーバー経由でWebRTC接続を確立し、その後は
// ホストとゲスト間でP2P通信する(ホストが唯一の正となり、ゲストはホストと
// だけ繋がるスター型)。ブラウザの`Peer`(index.htmlでCDN読み込み)に依存するため
// このファイルはブラウザ専用で、テストからは generateJoinCode のみを使う。

const ROOM_ID_PREFIX = 'sugoroku6-';

// 合言葉は4桁(1万通り)しかなく、PeerJSのブローカー上は誰でも部屋IDを推測して
// つなぎに行けるため、Math.randomではなくWeb Crypto(crypto.getRandomValues)由来の
// 乱数を使う(予測困難性を上げる。剰余バイアスを避けるため棄却法を使う)。
// rngを明示的に渡した場合はテスト用の決定的な値として扱う。
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

let peer = null;
let role = null; // 'host' | 'guest' | null
let hostConnections = []; // ホスト側: 接続中の全ゲストDataConnection
let guestConnection = null; // ゲスト側: ホストへの単一DataConnection
let messageHandler = () => {};

export function getRole() {
  return role;
}

export function onMessage(handler) {
  messageHandler = handler;
}

function attachDataHandlers(conn, onOpen, onClose) {
  conn.on('data', (data) => messageHandler(data, conn));
  conn.on('close', () => onClose?.(conn));
  conn.on('error', () => onClose?.(conn));
  if (conn.open) {
    onOpen?.(conn);
  } else {
    conn.on('open', () => onOpen?.(conn));
  }
}

// 無料の公開シグナリングサーバー(0.peerjs.com)はSLAのないベストエフォートの
// サービスで、混雑時は接続確立に数秒〜まれに失敗することがある。ここで
// タイムアウトを切って呼び出し元(main.js)が「新しい合言葉でもう一度」を
// 試せるようにする。接続確立後に一時的に切れた場合は自動で1回だけ再接続を試みる。
const CONNECT_TIMEOUT_MS = 15000;

export function hostRoom(roomCode, { onGuestJoin, onGuestLeave, onError, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') {
      reject(new Error('通信ライブラリの読み込みに失敗しました。通信環境を確認してください。'));
      return;
    }
    role = 'host';
    hostConnections = [];
    peer = new Peer(ROOM_ID_PREFIX + roomCode, { debug: 0 });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      peer?.destroy();
      reject(new Error('接続がタイムアウトしました(サーバーが混み合っている可能性があります)。もう一度お試しください。'));
    }, timeoutMs);

    peer.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(roomCode);
    });
    peer.on('disconnected', () => {
      if (settled) peer?.reconnect();
    });
    peer.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
        return;
      }
      onError?.(err);
    });
    peer.on('connection', (conn) => {
      hostConnections.push(conn);
      attachDataHandlers(
        conn,
        () => onGuestJoin?.(conn),
        () => {
          hostConnections = hostConnections.filter((c) => c !== conn);
          onGuestLeave?.(conn);
        },
      );
    });
  });
}

export function joinRoom(roomCode, { onError, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') {
      reject(new Error('通信ライブラリの読み込みに失敗しました。通信環境を確認してください。'));
      return;
    }
    role = 'guest';
    peer = new Peer(undefined, { debug: 0 });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      peer?.destroy();
      reject(new Error('接続がタイムアウトしました(サーバーが混み合っている可能性があります)。もう一度お試しください。'));
    }, timeoutMs);

    peer.on('open', () => {
      const conn = peer.connect(ROOM_ID_PREFIX + roomCode, { reliable: true });
      guestConnection = conn;
      attachDataHandlers(
        conn,
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(conn);
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error('部屋が見つかりませんでした。合言葉を確認してください。'));
          } else {
            onError?.(new Error('ホストとの接続が切れました'));
          }
        },
      );
    });
    peer.on('disconnected', () => {
      if (settled) peer?.reconnect();
    });
    peer.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
        return;
      }
      onError?.(err);
    });
  });
}

// ゲスト -> ホスト
export function send(message) {
  guestConnection?.send(message);
}

// ホスト -> 全ゲスト(excludeConnで送信元への折り返しを避けられる)
export function broadcast(message, excludeConn = null) {
  for (const conn of hostConnections) {
    if (conn === excludeConn) continue;
    conn.send(message);
  }
}

export function guestCount() {
  return hostConnections.length;
}

export function disconnectAll() {
  for (const conn of hostConnections) conn.close();
  guestConnection?.close();
  hostConnections = [];
  guestConnection = null;
  peer?.destroy();
  peer = null;
  role = null;
}
