// Сканер QR-кодов бейджей. Камера открывается поверх страницы, код читается автоматически.
// Используется встроенный BarcodeDetector (Chrome/Android), на iPhone — библиотека jsQR.
const QrScan = (() => {
  const PREFIX = 'euss-badge:', CODE_RE = /^[A-Za-z0-9_-]{20,64}$/;
  let jsqrP = null;
  const loadJsQR = () => jsqrP || (jsqrP = new Promise((res, rej) => {
    if (window.jsQR) return res(window.jsQR);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = () => res(window.jsQR);
    s.onerror = () => { jsqrP = null; rej(new Error('Не удалось загрузить сканер, проверьте интернет')); };
    document.head.appendChild(s);
  }));

  // text -> код бейджа или ''
  const parse = t => { t = String(t || '').trim(); if (!t.startsWith(PREFIX)) return ''; const c = t.slice(PREFIX.length); return CODE_RE.test(c) ? c : ''; };

  function open(onCode) {
    const ov = document.createElement('div');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Сканирование QR-кода');
    ov.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:300;background:#000;display:flex;flex-direction:column;color:#fff;font:600 1rem Manrope,system-ui,sans-serif';
    ov.innerHTML = `<video playsinline muted style="position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
        <div style="width:70vmin;height:70vmin;max-width:18rem;max-height:18rem;border:4px solid #fff;border-radius:1rem;box-shadow:0 0 0 100vmax rgb(0 0 0/.55)"></div></div>
      <div style="position:relative;padding:calc(1rem + env(safe-area-inset-top)) 1rem 0;text-align:center;text-shadow:0 1px 4px #000">
        <p style="margin:0">Поднесите бейдж к камере</p><p data-msg style="margin:.4rem 0 0;font-size:.9rem;min-height:1.3em;color:#ffd8d8"></p></div>
      <div style="position:relative;margin-top:auto;display:flex;gap:.6rem;padding:1rem 1rem calc(1rem + env(safe-area-inset-bottom))">
        <button type="button" data-flip style="flex:1;min-height:3rem;border:1px solid #fff8;border-radius:.6rem;background:#0008;color:#fff;font:inherit">Сменить камеру</button>
        <button type="button" data-no style="flex:1;min-height:3rem;border:0;border-radius:.6rem;background:#fff;color:#123;font:inherit">Отмена</button></div>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video'), msg = ov.querySelector('[data-msg]');
    let stream = null, facing = 'user', alive = true, done = false, raf = 0, last = 0, detector = null, canvas = null, ctx2 = null;

    const stop = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
    const close = () => { alive = false; cancelAnimationFrame(raf); stop(); ov.remove(); };
    ov.querySelector('[data-no]').onclick = close;
    ov.querySelector('[data-flip]').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCam(); };

    async function startCam() {
      stop(); msg.textContent = '';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Камера недоступна (нужен безопасный адрес https)'; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!alive) { stop(); return; }
        video.srcObject = stream; await video.play();
      } catch (e) {
        msg.textContent = /NotAllowed|Permission/i.test(e.name + e.message) ? 'Разрешите доступ к камере в настройках браузера' : 'Не удалось включить камеру';
      }
    }

    async function prepare() {
      if ('BarcodeDetector' in window) {
        try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) { detector = new BarcodeDetector({ formats: ['qr_code'] }); return; } } catch (e) {}
      }
      await loadJsQR();
      canvas = document.createElement('canvas'); ctx2 = canvas.getContext('2d', { willReadFrequently: true });
    }

    async function read() {
      if (detector) { const r = await detector.detect(video); return r.length ? r[0].rawValue : ''; }
      const w = video.videoWidth, h = video.videoHeight; if (!w || !h) return '';
      const k = Math.min(1, 640 / w); canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      ctx2.drawImage(video, 0, 0, canvas.width, canvas.height);
      const d = ctx2.getImageData(0, 0, canvas.width, canvas.height);
      const r = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
      return r ? r.data : '';
    }

    async function loop(ts) {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (done || ts - last < 130 || video.readyState < 2) return;
      last = ts;
      let t = ''; try { t = await read(); } catch (e) {}
      if (!t || done || !alive) return;
      const code = parse(t);
      if (!code) { msg.textContent = 'Это не бейдж EuSS'; return; }
      done = true; close(); onCode(code);
    }

    (async () => {
      await startCam();
      try { await prepare(); } catch (e) { msg.textContent = e.message; return; }
      raf = requestAnimationFrame(loop);
    })();
    return close;
  }
  return { open, parse, PREFIX };
})();
