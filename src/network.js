// src/network.js
// 同じWiFi内でのオンライン対戦用の通信レイヤー。WebRTC接続を確立するための
// シグナリング(仲介)だけ signaling-server/ (自前でホストする軽量PeerServer)
// 経由で行い、確立後の実際のゲームデータはホストとゲスト間で直接P2P通信する
// (ホストが唯一の正となり、ゲストはホストとだけ繋がるスター型)。
// ブラウザの`Peer`(index.htmlでCDN読み込み)に依存するため、このファイルは
// ブラウザ専用で、テストからは generateRoomCode のみを使う。

// signaling-server/ をデプロイしたら、そのホスト名をここに設定する
// (例: 'sugoroku-signaling.onrender.com')。空文字のままだとPeerJSの無料公開
// ブローカー(0.peerjs.com)にフォールバックするが、そちらはSLAのないベスト
// エフォートのサービスで不安定なことがあるため、自前サーバーの利用を推奨する。
const SIGNALING_HOST = '';
const SIGNALING_SECURE = true;
const SIGNALING_PORT = SIGNALING_SECURE ? 443 : 80;

function peerOptions() {
  if (!SIGNALING_HOST) return { debug: 0 };
  return {
    debug: 0,
    host: SIGNALING_HOST,
    secure: SIGNALING_SECURE,
    port: SIGNALING_PORT,
    path: '/',
  };
}

const ROOM_ID_PREFIX = 'sugoroku6-';
const CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 0/O/1/I/Lなど紛らわしい文字は除外

export function generateRoomCode(rng = Math.random, length = 4) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARSET[Math.floor(rng() * CODE_CHARSET.length)];
  }
  return code;
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
    peer = new Peer(ROOM_ID_PREFIX + roomCode, peerOptions());

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
    peer = new Peer(undefined, peerOptions());

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
