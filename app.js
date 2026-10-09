const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const q = new URLSearchParams(location.search);

// ---- вход по логину ----
const LOGIN_MIN = 4, LOGIN_RE = /^[a-z0-9._-]+$/;
const normLogin = v => String(v || '').trim().toLowerCase();
// «ivan» -> «ivan@euss.local»; если введена полная почта (старый суперадмин), она остаётся как есть
const loginToEmail = v => { v = normLogin(v); return v.includes('@') ? v : v + '@' + CFG.LOGIN_DOMAIN; };
// для показа: «ivan@euss.local» -> «ivan», настоящую почту не трогаем
const showLogin = e => { e = String(e || ''); const sfx = '@' + CFG.LOGIN_DOMAIN; return e.toLowerCase().endsWith(sfx) ? e.slice(0, -sfx.length) : e; };
// пароль для Supabase: у сотрудников (вход по логину) короткий пароль дополняется скрытым хвостом, у почтовых аккаунтов пароль как есть
const pwFix = (login, pw) => (!normLogin(login).includes('@') && String(pw).length < 6) ? pw + CFG.PW_PAD : pw;
// текст ошибки или '' если логин подходит
const loginError = v => { v = normLogin(v); if (v.length < LOGIN_MIN) return 'Логин: не меньше ' + LOGIN_MIN + ' символов'; if (v.length > 32) return 'Логин: не больше 32 символов'; if (!LOGIN_RE.test(v)) return 'Логин: только латинские буквы, цифры и символы . _ -'; return ''; };

async function need() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.href = 'index.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
    return null;
  }
  return session;
}

function toast(t) {
  let e = $('#toast');
  if (!e) { e = document.createElement('div'); e.id = 'toast'; document.body.append(e); }
  e.textContent = t; e.className = 'show';
  clearTimeout(toast.t); toast.t = setTimeout(() => e.className = '', 1800);
}

// выбор одной кнопки в контейнере
function pick(sel, cb) {
  const c = $(sel);
  c.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    c.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset.v);
  };
}
function unpick(sel) { document.querySelectorAll(sel + ' button').forEach(x => x.classList.remove('on')); }

// кнопка «Отменить последнюю запись» (10 минут)
function undoBtn(table) {
  const b = $('#undo'); let ids = [];
  b.onclick = async () => { b.disabled = true; const { error } = await sb.from(table).delete().in('id', ids); b.disabled = false; if (error) { toast('Не удалось отменить: ' + error.message); return; } b.hidden = true; toast(ids.length > 1 ? 'Записи отменены' : 'Запись отменена'); };
  return i => { ids = [].concat(i); b.textContent = ids.length > 1 ? 'Отменить последние ' + ids.length + ' записи' : 'Отменить последнюю запись'; b.hidden = false; clearTimeout(undoBtn.t); undoBtn.t = setTimeout(() => b.hidden = true, 6e5); };
}

// ---- подтверждение паролем (правки админа, списание остатка) ----
// Вызов функции базы: неверный пароль приходит как { ok:false, error }, любая другая ошибка как исключение базы.
const rpcAsk = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  return data && typeof data === 'object' ? data : { ok: true };
};
// Окно «введите пароль». run(пароль) должна вернуть { ok:true } или { ok:false, error }.
// При ошибке окно остаётся открытым, можно ввести пароль ещё раз. Возвращает true, если действие выполнено.
function withPw(title, text, run) {
  return new Promise(async res => {
    const { data: { session } } = await sb.auth.getSession();
    const login = showLogin(session ? session.user.email : '');
    const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgb(10 40 55/.45)';
    d.innerHTML = `<form role="dialog" aria-modal="true" style="width:100%;max-width:22rem;padding:1.25rem;border-radius:.75rem;background:#fff;color:#123;box-shadow:0 20px 50px rgb(0 0 0/.3);font:inherit">
      <p style="margin:0;font-size:.72rem;font-weight:800;text-transform:uppercase;color:#566">Подтверждение паролем</p>
      <h2 style="margin:.25rem 0 0;font-size:1.2rem">${E(title)}</h2>
      ${text ? `<p style="margin:.5rem 0 0;font-size:.88rem;color:#566;white-space:pre-line">${E(text)}</p>` : ''}
      <input type="password" autocomplete="current-password" placeholder="Ваш пароль" required style="display:block;width:100%;height:3rem;margin-top:.9rem;padding:0 .75rem;border:1px solid #c5d3d7;border-radius:.5rem;font:inherit;font-size:1rem;box-sizing:border-box">
      <p role="alert" style="margin:.5rem 0 0;min-height:1.2em;font-size:.85rem;color:#b42318"></p>
      <button type="submit" style="display:block;width:100%;min-height:3rem;margin-top:.5rem;border:0;border-radius:.5rem;background:#2aa3b5;color:#fff;font:inherit;font-weight:700;cursor:pointer">Подтвердить</button>
      <button type="button" data-no style="display:block;width:100%;min-height:2.75rem;margin-top:.25rem;border:0;background:none;font:inherit;font-weight:600;color:#566;cursor:pointer">Отмена</button></form>`;
    document.body.appendChild(d);
    const f = d.querySelector('form'), inp = d.querySelector('input'), er = d.querySelector('[role=alert]'), go = d.querySelector('[type=submit]');
    const key = e => { if (e.key === 'Escape') close(false); };
    const close = ok => { d.remove(); document.removeEventListener('keydown', key); res(ok); };
    document.addEventListener('keydown', key);
    d.querySelector('[data-no]').onclick = () => close(false);
    f.onsubmit = async e => {
      e.preventDefault(); if (!inp.value) return;
      go.disabled = true; er.textContent = '';
      let r; try { r = await run(pwFix(login, inp.value)); } catch (x) { r = { ok: false, error: x.message }; }
      if (r && r.ok) { close(true); return; }
      er.textContent = (r && r.error) || 'Не удалось выполнить'; go.disabled = false; inp.select();
    };
    inp.focus();
  });
}
