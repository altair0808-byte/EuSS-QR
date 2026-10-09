// Автовыход при бездействии. Не касается админов и суперадмина (is_admin() = суперадмин или роль admin на любом бланке).
// Время простоя (минуты) можно переопределить в config.js: IDLE_MINUTES: 15
(function () {
  if (typeof sb === 'undefined') return;
  const MIN = Number(window.CFG && CFG.IDLE_MINUTES) > 0 ? Number(CFG.IDLE_MINUTES) : 15;
  const LIMIT = MIN * 60000, WARN = Math.min(60000, LIMIT / 3), KEY = 'euss_last_activity';

  const rd = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return 0; } };
  const wr = t => { try { localStorage.setItem(KEY, String(t)); } catch (e) {} };

  // время последнего действия считываем СРАЗУ, до того как этот заход на страницу сам что-то обновит
  const lastAtLoad = rd() || Date.now();
  let last = lastAtLoad, exempt = null, active = false, tick = null, banner = null, leaving = false;

  function touch() {
    const n = Date.now();
    if (n - last < 3000) return;            // не пишем в хранилище чаще раза в 3 с
    last = n; wr(n); hideWarn();
  }
  ['pointerdown', 'keydown', 'touchstart', 'input', 'wheel', 'scroll'].forEach(ev =>
    window.addEventListener(ev, touch, { passive: true, capture: true }));

  function showWarn(left) {
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(1rem + env(safe-area-inset-bottom));z-index:200;max-width:92vw;padding:.7rem 1rem;border-radius:.6rem;background:#123;color:#fff;font:600 .9rem Manrope,system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0/.3);text-align:center';
      document.body.appendChild(banner);
    }
    banner.textContent = 'Нет действий. Выход через ' + Math.max(1, Math.ceil(left / 1000)) + ' с — коснитесь экрана, чтобы остаться';
  }
  function hideWarn() { if (banner) { banner.remove(); banner = null; } }

  async function leave() {
    if (leaving) return; leaving = true; stop();
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}   // только это устройство, другие входы не трогаем
    location.replace('index.html');
  }

  function check() {
    if (!active || exempt !== false) return;      // админ, суперадмин или статус ещё неизвестен — не выходим
    last = Math.max(last, rd());                  // действия в других вкладках тоже считаются
    const idle = Date.now() - last;
    if (idle >= LIMIT) { leave(); return; }
    if (LIMIT - idle <= WARN) showWarn(LIMIT - idle); else hideWarn();
  }
  function stop() { active = false; clearInterval(tick); tick = null; hideWarn(); }

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { stop(); return; }
    let adm = null;
    try { const r = await sb.rpc('is_admin'); if (!r.error) adm = !!r.data; } catch (e) {}
    exempt = adm;                                 // null = не удалось узнать: ничего не делаем
    if (exempt !== false) { stop(); return; }
    active = true;
    if (Date.now() - lastAtLoad >= LIMIT) { leave(); return; }   // вернулись в приложение после долгого перерыва
    if (!tick) tick = setInterval(check, 2000);
    check();
  }

  // телефон замораживает таймеры в фоне — проверяем при возврате в приложение
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pageshow', check);
  window.addEventListener('focus', check);

  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'SIGNED_OUT') { stop(); exempt = null; }
    else if (ev === 'SIGNED_IN') setTimeout(init, 0);
  });
  init();
})();
