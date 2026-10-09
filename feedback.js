// Обратная связь после записи: галочка по центру экрана (сама гаснет) и окно ошибки.
// Fb.ok('Текст')  — короткая анимация успеха, не мешает нажимать на экран.
// Fb.err(error)   — окно с причиной (нет доступа / нет связи / не сохранилось), закрывается кнопкой.
const Fb = (() => {
  let css = false;
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function addCss() {
    if (css) return; css = true;
    document.head.insertAdjacentHTML('beforeend', `<style>
.fbok{position:fixed;top:0;right:0;bottom:0;left:0;z-index:400;display:flex;align-items:center;justify-content:center;pointer-events:none}
.fbok .fbc{display:flex;flex-direction:column;align-items:center;gap:.6rem;animation:fbpop .38s cubic-bezier(.2,1.3,.4,1) both,fbout .4s ease-in 1.15s forwards}
.fbok .fbd{width:7rem;height:7rem;border-radius:50%;background:#1f9d55;box-shadow:0 12px 40px rgb(0 0 0/.28);display:flex;align-items:center;justify-content:center}
.fbok svg{width:4rem;height:4rem;display:block}
.fbok path{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:50;stroke-dashoffset:50;animation:fbdraw .35s ease-out .18s forwards}
.fbok .fbt{max-width:min(80vw,18rem);padding:.35rem .9rem;border-radius:99px;background:rgb(18 32 40/.82);color:#fff;font:700 .95rem/1.3 inherit;text-align:center}
@keyframes fbpop{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
@keyframes fbdraw{to{stroke-dashoffset:0}}
@keyframes fbout{to{opacity:0;transform:scale(.92)}}
.fber{position:fixed;top:0;right:0;bottom:0;left:0;z-index:410;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgb(10 40 55/.5)}
.fber section{width:100%;max-width:22rem;padding:1.4rem 1.25rem 1.1rem;border-radius:1rem;background:#fff;color:#123;text-align:center;box-shadow:0 20px 50px rgb(0 0 0/.35);animation:fbpop .28s ease-out both}
.fber .fbx{width:3.6rem;height:3.6rem;margin:0 auto .6rem;border-radius:50%;background:#d92d20;display:flex;align-items:center;justify-content:center}
.fber .fbx svg{width:1.9rem;height:1.9rem}.fber .fbx path{fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round}
.fber h2{margin:0;font-size:1.25rem}.fber p{margin:.45rem 0 0;font-size:.92rem;color:#455}
.fber small{display:block;margin-top:.5rem;font-size:.78rem;color:#788;word-break:break-word}
.fber button{display:block;width:100%;min-height:3rem;margin-top:1rem;border:0;border-radius:.6rem;background:#123;color:#fff;font:inherit;font-weight:700;cursor:pointer}
@media(prefers-reduced-motion:reduce){.fbok .fbc{animation:fbout .3s linear 1.2s forwards}.fbok path{animation:none;stroke-dashoffset:0}.fber section{animation:none}}
</style>`);
  }
  let okEl = null, okT = 0;
  function ok(text) {
    addCss(); if (okEl) okEl.remove(); clearTimeout(okT);
    okEl = document.createElement('div'); okEl.className = 'fbok'; okEl.setAttribute('role', 'status'); okEl.setAttribute('aria-live', 'polite');
    okEl.innerHTML = `<div class="fbc"><div class="fbd"><svg viewBox="0 0 52 52" aria-hidden="true"><path d="M14 27l8 8 16-17"/></svg></div>${text ? `<div class="fbt">${E(text)}</div>` : ''}</div>`;
    document.body.appendChild(okEl);
    try { navigator.vibrate && navigator.vibrate(40); } catch (e) {}
    const el = okEl; okT = setTimeout(() => { el.remove(); if (okEl === el) okEl = null; }, 1700);
  }
  // тип ошибки: нет прав / нет связи / прочее
  const kind = x => {
    const m = String((x && x.message) || x || ''), c = String((x && x.code) || ''), s = x && x.status;
    if (c === '42501' || s === 401 || s === 403 || /row-level security|permission denied|not allowed|jwt|forbidden|access denied|нет прав|не хватает прав/i.test(m)) return 'access';
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|network request|load failed|fetch/i.test(m)) return 'net';
    return 'other';
  };
  const TXT = {
    access: ['Нет доступа', 'У вас нет прав на это действие. Запись не сохранена. Обратитесь к администратору.'],
    net: ['Нет связи', 'Запись не отправлена. Проверьте интернет и повторите.'],
    other: ['Не удалось сохранить', 'Запись не сохранена. Попробуйте ещё раз.']
  };
  let erEl = null;
  function err(x, title) {
    addCss(); if (erEl) erEl.remove();
    const k = kind(x), t = TXT[k], raw = String((x && x.message) || (typeof x === 'string' ? x : '') || '');
    erEl = document.createElement('div'); erEl.className = 'fber';
    erEl.innerHTML = `<section role="alertdialog" aria-modal="true" aria-label="${E(title || t[0])}"><div class="fbx"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></div>
      <h2>${E(title || t[0])}</h2><p>${E(t[1])}</p>${raw && k === 'other' ? `<small>${E(raw)}</small>` : ''}<button type="button">Понятно</button></section>`;
    document.body.appendChild(erEl);
    const el = erEl, key = e => { if (e.key === 'Escape') close(); };
    const close = () => { el.remove(); document.removeEventListener('keydown', key); if (erEl === el) erEl = null; };
    document.addEventListener('keydown', key);
    el.querySelector('button').onclick = close;
    el.onmousedown = e => { if (e.target === el) close(); };
    el.querySelector('button').focus();
    try { navigator.vibrate && navigator.vibrate([80, 60, 80]); } catch (e) {}
  }
  return { ok, err };
})();
