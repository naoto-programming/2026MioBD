// 双六RPGのオンライン対戦(同じWiFi内でのP2P対戦)用のPeerJSシグナリングサーバー。
// WebRTC接続を確立するための「仲人」の役目だけを果たし、ゲームの状態やロジックには
// 一切関与しない(実際のゲームデータはホストとゲストのブラウザ同士が直接やりとりする)。
// 無料ホスティング(Renderなど)はPORTを環境変数で渡してくるのでそれに従う。
const { PeerServer } = require('peer');

const port = process.env.PORT || 9000;

const server = PeerServer({
  port,
  path: '/',
  key: 'peerjs',
  allow_discovery: false,
});

server.on('connection', (client) => {
  console.log(`peer connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`peer disconnected: ${client.getId()}`);
});

console.log(`PeerServer listening on port ${port}`);
