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
