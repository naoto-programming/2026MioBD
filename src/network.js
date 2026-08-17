// src/network.js
// 同じWiFi内でのオンライン対戦用の通信レイヤー。サーバーは自前で立てず、
// PeerJSの公開シグナリングサーバー経由でWebRTC接続を確立し、その後は
// ホストとゲスト間でP2P通信する(ホストが唯一の正となり、ゲストはホストと
// だけ繋がるスター型)。ブラウザの`Peer`(index.htmlでCDN読み込み)に依存するため
// このファイルはブラウザ専用で、テストからは generateRoomCode のみを使う。

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

export function hostRoom(roomCode, { onGuestJoin, onGuestLeave, onError } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') {
      reject(new Error('通信ライブラリの読み込みに失敗しました。通信環境を確認してください。'));
      return;
    }
    role = 'host';
    hostConnections = [];
    peer = new Peer(ROOM_ID_PREFIX + roomCode, { debug: 0 });

    peer.on('open', () => resolve(roomCode));
    peer.on('error', (err) => {
      reject(err);
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

export function joinRoom(roomCode, { onError } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') {
      reject(new Error('通信ライブラリの読み込みに失敗しました。通信環境を確認してください。'));
      return;
    }
    role = 'guest';
    peer = new Peer(undefined, { debug: 0 });

    peer.on('open', () => {
      const conn = peer.connect(ROOM_ID_PREFIX + roomCode, { reliable: true });
      guestConnection = conn;
      let settled = false;
      attachDataHandlers(
        conn,
        () => {
          if (settled) return;
          settled = true;
          resolve(conn);
        },
        () => {
          if (!settled) {
            settled = true;
            reject(new Error('部屋が見つかりませんでした。合言葉を確認してください。'));
          } else {
            onError?.(new Error('ホストとの接続が切れました'));
          }
        },
      );
    });
    peer.on('error', (err) => {
      reject(err);
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
