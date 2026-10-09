// Показ личного QR пользователя и отправка его картинкой (WhatsApp, Telegram и т.д.). Только для суперадмина:
// читать таблицу badges другим не дают правила базы. Нужны: sb, $, toast (app.js) и библиотека QRCode.
const BadgeShare = (() => {
  const PREFIX = 'euss-badge:';
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const newCode = () => {
    const a = new Uint8Array(24); crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');   // 32 символа
  };

  // QR -> матрица модулей. Библиотека рисует в canvas с неравным полем справа и снизу, поэтому берём только сам код.
  function matrix(text) {
    const h = document.createElement('div');
    new QRCode(h, { text, width: 512, height: 512, correctLevel: QRCode.CorrectLevel.Q });
    const cv = h.querySelector('canvas'); if (!cv) return null;
    const W = cv.width, H = cv.height, d = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const dark = (x, y) => { const i = (y * W + x) * 4; return d[i + 3] > 128 && d[i] < 128; };
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    let run = 0; while (x0 + run < W && dark(x0 + run, y0)) run++;       // верхняя кромка угловой метки = 7 модулей
    const m = run / 7, n = Math.round((x1 - x0 + 1) / m), cells = [];
    for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(dark(Math.min(W - 1, Math.round(x0 + (c + .5) * m)), Math.min(H - 1, Math.round(y0 + (r + .5) * m)))); cells.push(row); }
    return { n, cells };
  }

  // векторная картинка для печати
  function qrSvg(text) {
    const m = matrix(text); if (!m) return '';
    let path = '';
    m.cells.forEach((row, r) => row.forEach((on, c) => { if (on) path += `M${c} ${r}h1v1h-1z`; }));
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.n} ${m.n}" shape-rendering="crispEdges"><path d="${path}" fill="#000"/></svg>`);
  }

  const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

  // бейдж 60x90 мм одной картинкой PNG (1080x1620): так же выглядит, как на печатном листе
  async function badgePng(code, name, login) {
    const W = 1080, H = 1620, F = 'Manrope, Arial, sans-serif';
    try { if (document.fonts) { await document.fonts.load('800 40px Manrope'); await document.fonts.load('700 40px Manrope'); } } catch (e) {}
    const m = matrix(PREFIX + code); if (!m) throw new Error('Не удалось построить QR');
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.save(); rr(c, 8, 8, W - 16, H - 16, 64); c.clip();
    c.strokeStyle = '#9fc3ca'; c.lineWidth = 6;
    // логотип
    const lg = await loadImg('euss-logo.png');
    if (lg) { const h = 150, w = h * lg.width / lg.height; c.drawImage(lg, (W - w) / 2, 70, w, h); }
    // подпись
    c.fillStyle = '#0097a8'; c.font = `800 38px ${F}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ПРОПУСК · ВХОД ПО QR', W / 2, 290);
    // рамка с кодом
    const fs = 720, fx = (W - fs) / 2, fy = 350;
    rr(c, fx, fy, fs, fs, 56); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 7; c.strokeStyle = '#0097a8'; c.stroke();
    const pad = 56, cell = Math.floor((fs - pad * 2) / m.n), qs = cell * m.n, qx = fx + (fs - qs) / 2, qy = fy + (fs - qs) / 2;
    c.fillStyle = '#000';
    m.cells.forEach((row, r) => row.forEach((on, k) => { if (on) c.fillRect(qx + k * cell, qy + r * cell, cell, cell); }));
    // имя: до двух строк, шрифт подбирается под длину
    let size = 84, lines = [name];
    const fit = () => { c.font = `800 ${size}px ${F}`; return c.measureText(name).width <= W - 140; };
    while (size > 48 && !fit()) size -= 4;
    if (!fit()) {
      size = 64; c.font = `800 ${size}px ${F}`;
      const words = name.split(/\s+/); lines = ['', '']; let i = 0;
      words.forEach(w => { const t = (lines[i] ? lines[i] + ' ' : '') + w; if (c.measureText(t).width > W - 140 && i === 0) { i = 1; lines[1] = w; } else lines[i] = t; });
      lines = lines.filter(Boolean);
    }
    c.font = `800 ${size}px ${F}`; c.fillStyle = '#002f3e';
    const ny = 1160 + (lines.length === 1 ? 40 : 0);
    lines.forEach((t, i) => c.fillText(t, W / 2, ny + i * (size * 1.15)));
    // логин
    c.font = `700 44px ${F}`;
    let lt = login; while (lt.length > 3 && c.measureText(lt).width > W - 300) lt = lt.slice(0, -2) + '…';
    const lw = c.measureText(lt).width + 70;
    rr(c, (W - lw) / 2, 1360, lw, 80, 40); c.fillStyle = '#e8f3f3'; c.fill();
    c.fillStyle = '#4f6f79'; c.fillText(lt, W / 2, 1402);
    // низ
    const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#00808e'); g.addColorStop(1, '#0097a8');
    c.fillStyle = g; c.fillRect(0, H - 120, W, 120);
    c.fillStyle = '#fff'; c.font = `700 38px ${F}`; c.fillText('Поднесите к камере на экране входа', W / 2, H - 58);
    c.restore();
    rr(c, 8, 8, W - 16, H - 16, 64); c.strokeStyle = '#9fc3ca'; c.lineWidth = 6; c.stroke();
    return cv;
  }

  const blobOf = cv => new Promise(res => cv.toBlob(res, 'image/png'));

  // u = { id, name, login, level: 'super' | 'admin' | '' }, onChange() вызывается после создания QR
  async function show(u, onChange) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:1rem;overflow:auto;background:rgb(10 40 55/.55)';
    const label = u.level === 'super' ? 'Суперадмин' : u.level === 'admin' ? 'Админ' : 'Сотрудник';
    d.innerHTML = `<div role="dialog" aria-modal="true" style="width:100%;max-width:23rem;margin:auto;padding:1.1rem;border-radius:.75rem;background:#fff;color:#123;box-shadow:0 20px 50px rgb(0 0 0/.3);font:inherit">
      <p style="margin:0;font-size:.72rem;font-weight:800;text-transform:uppercase;color:#566">QR для входа · ${label}</p>
      <h2 style="margin:.25rem 0 .6rem;font-size:1.2rem;overflow-wrap:anywhere">${E(u.name)}</h2>
      <div data-body style="text-align:center;min-height:6rem"><p style="color:#566">Загрузка…</p></div>
      ${u.level ? '<p style="margin:.6rem 0 0;padding:.5rem .65rem;border-radius:.5rem;background:#fff4e5;color:#7a4b00;font-size:.82rem">Этот QR открывает аккаунт «' + label.toLowerCase() + '» без пароля. Отправляйте его только самому владельцу.</p>' : ''}
      <div data-acts style="display:flex;flex-direction:column;gap:.5rem;margin-top:.8rem"></div></div>`;
    document.body.appendChild(d);
    const body = d.querySelector('[data-body]'), acts = d.querySelector('[data-acts]');
    const close = () => { d.remove(); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    d.onclick = e => { if (e.target === d) close(); };
    const btn = (t, fn, main) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.onclick = fn;
      b.style.cssText = 'min-height:2.9rem;border-radius:.5rem;font:inherit;font-weight:700;cursor:pointer;border:' + (main ? '0;background:#2aa3b5;color:#fff' : '1px solid #c5d3d7;background:#fff;color:#123'); acts.appendChild(b); return b; };

    async function render() {
      acts.innerHTML = '';
      const { data, error } = await sb.from('badges').select('code').eq('user_id', u.id).maybeSingle();
      if (error) { body.innerHTML = '<p style="color:#b42318">Не удалось загрузить: ' + E(error.message) + '</p>'; btn('Закрыть', close); return; }
      if (!data) {
        body.innerHTML = '<p style="color:#566">У этого пользователя ещё нет QR.</p>';
        btn('Создать QR', async () => {
          const { error: e2 } = await sb.from('badges').upsert({ user_id: u.id, code: newCode(), created_at: new Date().toISOString(), last_used_at: null });
          if (e2) { toast('Не удалось: ' + e2.message); return; }
          toast('QR создан'); if (onChange) onChange(); render();
        }, true);
        btn('Закрыть', close); return;
      }
      let cv;
      try { cv = await badgePng(data.code, u.name, u.login); } catch (e) { body.innerHTML = '<p style="color:#b42318">' + E(e.message) + '</p>'; btn('Закрыть', close); return; }
      body.innerHTML = '<img alt="QR" style="display:block;width:100%;max-width:17rem;margin:0 auto;border-radius:.6rem;box-shadow:0 2px 12px rgb(0 0 0/.18)">';
      body.querySelector('img').src = cv.toDataURL('image/png');
      const fname = 'qr-' + (u.login || 'user').replace(/[^a-z0-9._-]/gi, '_') + '.png';
      const blob = await blobOf(cv), file = new File([blob], fname, { type: 'image/png' });
      const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
      btn('Отправить фото (WhatsApp и др.)', async () => {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'QR для входа — ' + u.name }); } catch (e) { if (e && e.name !== 'AbortError') toast('Не удалось открыть «Поделиться»'); }
        } else { download(); toast('Фото сохранено. Прикрепите его в WhatsApp'); }
      }, true);
      btn('Скачать фото', () => { download(); toast('Фото сохранено'); });
      btn('Закрыть', close);
    }
    render();
  }

  return { show, newCode, qrSvg };
})();
