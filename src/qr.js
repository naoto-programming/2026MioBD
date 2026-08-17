// src/qr.js
// QRコードの生成・読み取り。index.htmlでCDN読み込みしている
// `QRCode`(davidshimjs/qrcodejs)と`jsQR`のグローバルに依存するため
// ブラウザ専用。WebRTCのオファー/アンサーをやり取りするためだけに使う。

export function renderQrCode(container, text) {
  container.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(container, {
    text,
    width: 260,
    height: 260,
    // eslint-disable-next-line no-undef
    correctLevel: QRCode.CorrectLevel.L,
  });
}

// videoElementにカメラ映像を流しつつ、QRコードを読み取れたらonDecoded(text)を
// 一度だけ呼ぶ。呼び出し元はstop()でカメラを止めること。
export async function startQrScanner(videoElement, onDecoded) {
  // facingMode: 'environment' を必須(exact)指定にすると、背面カメラを持たない
  // 端末(PCやカメラが1つしかない端末)でNotSupportedError/OverconstrainedErrorに
  // なる。ideal指定にして「あれば使う、無ければフォールバック」にする。
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  videoElement.srcObject = stream;
  await videoElement.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let rafId = null;

  function tick() {
    if (stopped) return;
    if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // eslint-disable-next-line no-undef
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        stopped = true;
        stop();
        onDecoded(code.data);
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    for (const track of stream.getTracks()) track.stop();
  }

  rafId = requestAnimationFrame(tick);
  return { stop };
}
