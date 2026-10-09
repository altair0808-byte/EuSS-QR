// Автовыход при бездействии. Не касается админов и суперадмина (суперадмин или роль admin на любом бланке).
// Время простоя (минуты) можно переопределить в config.js: IDLE_MINUTES: 15
// Админство проверяется двумя способами: функцией is_admin() и прямым чтением ролей. Если хоть один способ
// сказал «админ» - не выходим. Выходим только когда роли прочитаны и админом пользователь точно не является.
(function () {
  if (typeof sb === 'undefined') return;
  const MIN = Number(window.CFG && CFG.IDLE_MINUTES) > 0 ? Number(CFG.IDLE_MINUTES) : 15;
  const LIMIT = MIN * 60000, WARN = Math.min(60000, LIMIT / 3), KEY = 'euss_last_activity', CK = 'euss_idle_staff:';

  const rd = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return 0; } };
  const wr = t => { try { localStorage.setItem(KEY, String(t)); } catch (e) {} };

  // время последнего действия считываем СРАЗУ, до того как этот заход на страницу сам что-то обновит
  const lastAtLoad = rd() || Date.now();
  let last = lastAtLoad, exempt = null, active = false, tick = null, banner = null, leaving = false, seq = 0, uidNow = '';

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

  // true = админ или суперадмин, false = обычный сотрудник/бригадир, null = узнать не удалось
  async function adminState(uid) {
    let viaFn = null, viaRows = null;
    try { const r = await sb.rpc('is_admin'); if (!r.error && typeof r.data === 'boolean') viaFn = r.data; } catch (e) {}
    if (viaFn === true) return true;
    try {
      const [p, a] = await Promise.all([
        sb.from('profiles').select('role').eq('id', uid).maybeSingle(),
        sb.from('form_access').select('role').eq('user_id', uid).eq('role', 'admin').limit(1)]);
      if (!p.error && !a.error) viaRows = !!((p.data && p.data.role === 'superadmin') || (a.data && a.data.length));
    } catch (e) {}
    return viaRows;                            // без прямого чтения ролей сотрудником не считаем
  }

  async function leave() {
    if (leaving) return;
    if (await adminState(uidNow) === true) { exempt = true; stop(); return; }   // последняя проверка: админа не выкидываем
    leaving = true; stop();
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
    const my = ++seq;
    const { data: { session } } = await sb.auth.getSession();
    if (my !== seq) return;
    if (!session) { stop(); return; }
    uidNow = session.user.id;
    let adm = await adminState(uidNow);
    if (my !== seq) return;
    try {                                          // запоминаем последний точный ответ на случай сбоя сети
      if (adm === null) { const c = localStorage.getItem(CK + uidNow); adm = c === null ? null : c !== '1'; }
      else localStorage.setItem(CK + uidNow, adm ? '0' : '1');
    } catch (e) {}
    exempt = adm;                                  // true админ; false сотрудник; null не удалось узнать: ничего не делаем
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
    if (ev === 'SIGNED_OUT') { seq++; stop(); exempt = null; }
    else if (ev === 'SIGNED_IN') setTimeout(init, 0);
  });
  init();
})();
