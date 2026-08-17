# 双六RPG シグナリングサーバー

オンライン対戦(同じWiFi内でのP2P対戦)で、ホストとゲストのブラウザが
最初につながるための「仲介」だけを行う、ごく軽量なPeerJSサーバーです。
ゲームの状態やロジックは一切扱いません(実際のゲームデータはホストと
ゲストのブラウザ同士が直接やりとりします)。

PeerJSの無料公開ブローカー(0.peerjs.com)はSLAのないベストエフォートの
サービスで、混雑時に接続できないことがあるため、代わりにこれを自分で
無料ホスティングにデプロイして使うことを推奨します。

## デプロイ手順(Render.com、無料枠)

1. https://render.com にアクセスしてアカウントを作成する(GitHubアカウントで
   ログインできます)。
2. ダッシュボードで「New +」→「Blueprint」を選び、このリポジトリ
   (`naoto-programming/2026MioBD`)を接続する。リポジトリ直下の
   `render.yaml` が自動で読み込まれ、`sugoroku-signaling` という名前の
   無料Webサービスが作られる。
   - Blueprintが使えない/見当たらない場合は、「New +」→「Web Service」を選び、
     このリポジトリを接続したうえで手動で以下を設定してください。
     - Root Directory: `signaling-server`
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Instance Type: Free
3. デプロイが完了すると `https://sugoroku-signaling-XXXX.onrender.com` の
   ようなURLが発行されます。このURL(ホスト名部分、`https://`は不要)を
   控えておいてください。
4. `src/network.js` の `SIGNALING_HOST` にそのホスト名を設定する
   (例: `const SIGNALING_HOST = 'sugoroku-signaling-xxxx.onrender.com';`)。

## 無料枠の注意点

Renderの無料Webサービスは、15分間アクセスがないとスリープし、次に
アクセスがあった時に起動し直すため(数十秒ほどかかることがあります)、
しばらく誰も遊んでいない後の最初の「部屋を作る」だけ少し時間がかかる
ことがあります。ゲーム側は接続を自動で数回リトライするようになっている
ので、そのまま少し待てば繋がります。

## ローカルでの動作確認

```bash
cd signaling-server
npm install
npm start
```

`http://localhost:9000/` にアクセスしてPeerServerの応答が返れば起動できて
います。`src/network.js` の `SIGNALING_HOST` を一時的に `'localhost'` 、
`SIGNALING_SECURE` を `false`、ポート指定を `9000` にすれば、ローカルの
このサーバー経由でオンライン対戦を試せます(確認が終わったら元に戻して
ください)。
