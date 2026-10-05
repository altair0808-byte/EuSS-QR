const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const q = new URLSearchParams(location.search);

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
  const b = $('#undo'); let id;
  b.onclick = async () => { await sb.from(table).delete().eq('id', id); b.hidden = true; toast('Запись отменена'); };
  return i => { id = i; b.hidden = false; clearTimeout(undoBtn.t); undoBtn.t = setTimeout(() => b.hidden = true, 6e5); };
}
