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

// PeerJSのデフォルト設定はSTUNのみのことがあり、対称NAT/制限の強いルーター
// (WiFi中継機、一部の家庭用ルーター等)の組み合わせだとSTUNだけでは直接経路が
// 見つからず接続できないことがある。中継(TURN)経路も明示的に加えて成功率を
// 上げる。
// 
// 注: Open Relay Projectの無料TURNサーバーは2022年以降不安定になったため、
// 代わりにfreeTURN.netの無料TURNサービス(開発・テスト用、2MBit/s制限)を
// 使用する。これもダメな場合はユーザーに代替手段を提案する。
const ICE_SERVERS = [
  // Google STUN servers (高速で安定)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // その他の公共STUNサーバー
  { urls: 'stun:stun.1.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com:3478' },
  // freeTURN.netの無料TURNサーバー(開発・テスト用、2MBit/s制限)
  { urls: 'turn:freeturn.net:3478', username: 'free', credential: 'free' },
  { urls: 'turn:freeturn.net:3478?transport=tcp', username: 'free', credential: 'free' },
  { urls: 'turns:freeturn.net:5349', username: 'free', credential: 'free' },
];
// PeerJS Cloudは不安定だが、最も互換性が高い。再接続ロジックで対応する。
const PEER_OPTIONS = { 
  debug: 0, 
  config: { iceServers: ICE_SERVERS },
  // WebSocket接続が不安定な場合の再接続設定
  pingInterval: 3000,  // 3秒ごとにpingを送信して接続を維持
};

let peer = null;
let role = null; // 'host' | 'guest' | null
let hostConnections = []; // ホスト側: 接続中の全ゲストDataConnection
let guestConnection = null; // ゲスト側: ホストへの単一DataConnection
let messageHandler = () => {};
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 1000; // 初期再接続遅延1秒

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
// TURNサーバー経由の接続は直接接続より時間がかかるため、タイムアウトを
// 30秒に延長する。
const CONNECT_TIMEOUT_MS = 30000;

export function hostRoom(roomCode, { onGuestJoin, onGuestLeave, onError, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') {
      reject(new Error('通信ライブラリの読み込みに失敗しました。通信環境を確認してください。'));
      return;
    }
    role = 'host';
    hostConnections = [];
    reconnectAttempts = 0;
    console.log(`[Network] Hosting room: ${ROOM_ID_PREFIX + roomCode}`);
    peer = new Peer(ROOM_ID_PREFIX + roomCode, PEER_OPTIONS);

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      peer?.destroy();
      console.error('[Network] Host room connection timeout');
      reject(new Error('通信サーバーへの接続がタイムアウトしました(この端末の通信環境をご確認ください)。もう一度お試しください。'));
    }, timeoutMs);

    peer.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reconnectAttempts = 0; // 接続成功でリセット
      console.log(`[Network] Host room opened successfully: ${roomCode}`);
      resolve(roomCode);
    });
    
    peer.on('disconnected', () => {
      if (!settled) return; // 初期接続中は無視
      
      console.warn(`[Network] Host peer disconnected, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
      
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1); // 指数バックオフ
        console.log(`[Network] Reconnecting in ${delay}ms...`);
        setTimeout(() => {
          if (peer && !peer.destroyed) {
            peer.reconnect();
          }
        }, delay);
      } else {
        console.error('[Network] Max reconnection attempts reached');
        onError?.(new Error('シグナリングサーバーとの接続が失われました。'));
      }
    });
    
    peer.on('error', (err) => {
      console.error('[Network] Host peer error:', err.type, err);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
        return;
      }
      // 接続確立後のエラーはonErrorコールバックへ
      onError?.(err);
    });
    
    peer.on('connection', (conn) => {
      console.log('[Network] Guest connection attempt from peer:', conn.peer);
      hostConnections.push(conn);
      attachDataHandlers(
        conn,
        () => {
          console.log('[Network] Guest connection established:', conn.peer);
          onGuestJoin?.(conn);
        },
        () => {
          console.log('[Network] Guest connection closed:', conn.peer);
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
    reconnectAttempts = 0;
    console.log(`[Network] Joining room: ${ROOM_ID_PREFIX + roomCode}`);
    peer = new Peer(undefined, PEER_OPTIONS);

    let settled = false;
    let brokerConnected = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      peer?.destroy();
      // ブローカー(0.peerjs.com)にはつながったが、ホストとの直接接続(WebRTC)が
      // 確立できなかった場合と、そもそもブローカーに届かなかった場合を区別する。
      // 前者はホスト側の回線・ルーターの制限、後者はこの端末側の通信環境が原因の
      // ことが多い。
      console.error('[Network] Join room timeout. Broker connected:', brokerConnected);
      const message = brokerConnected
        ? 'ホストとの接続がタイムアウトしました(お互いのネットワークの制限で直接つながれない可能性があります)。'
        : '通信サーバーへの接続がタイムアウトしました(この端末の通信環境をご確認ください)。';
      reject(new Error(`${message}もう一度お試しください。`));
    }, timeoutMs);

    peer.on('open', () => {
      brokerConnected = true;
      reconnectAttempts = 0; // 接続成功でリセット
      console.log('[Network] Broker connected, attempting to connect to host:', ROOM_ID_PREFIX + roomCode);
      const conn = peer.connect(ROOM_ID_PREFIX + roomCode, { reliable: true });
      guestConnection = conn;
      attachDataHandlers(
        conn,
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          console.log('[Network] Successfully connected to host');
          resolve(conn);
        },
        () => {
          console.error('[Network] Host connection failed or closed');
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
      if (!settled) return; // 初期接続中は無視
      
      console.warn(`[Network] Guest peer disconnected, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
      
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1); // 指数バックオフ
        console.log(`[Network] Reconnecting in ${delay}ms...`);
        setTimeout(() => {
          if (peer && !peer.destroyed) {
            peer.reconnect();
          }
        }, delay);
      } else {
        console.error('[Network] Max reconnection attempts reached');
        onError?.(new Error('シグナリングサーバーとの接続が失われました。'));
      }
    });
    
    peer.on('error', (err) => {
      console.error('[Network] Guest peer error:', err.type, err);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
        return;
      }
      // 接続確立後のエラーはonErrorコールバックへ
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
  reconnectAttempts = 0; // 再接続カウンターをリセット
}
