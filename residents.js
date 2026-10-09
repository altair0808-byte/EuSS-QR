// Проживающие: сколько человек проживает в каждую смену. Ввод и просмотр только для админов и суперадмина.
// Данные лежат в таблице resident_counts (stage13.sql). Таблица закрыта для прямого доступа: читать и писать
// можно только через функции is_admin / get_residents / set_residents, и каждая проверяет роль на стороне базы.
// Для остальных сотрудников (работники, бригадиры) карточка не рисуется вообще, а запрос к базе вернёт пусто или ошибку.
// Нужны глобальные sb (supabase) и toast (app.js).
const Residents = (() => {
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const dLabel = d => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;
  const cache = {};                                    // дата → число (или null, если не заполнено)
  let dirty = false;

  // админ ли текущий пользователь (проверяет база; до выполнения stage13.sql вернёт false)
  async function isAdmin() {
    try { const { data, error } = await sb.rpc('is_admin'); return !error && data === true; } catch (e) { return false; }
  }
  // { 'YYYY-MM-DD': число } за период; null, если нет доступа или не выполнен stage13.sql
  async function range(d1, d2) {
    const { data, error } = await sb.rpc('get_residents', { d1, d2 });
    if (error) return null;
    const out = {}; (data || []).forEach(x => { out[x.day] = x.cnt; });
    return out;
  }

  function css() {
    if (document.getElementById('rs-css')) return;
    const s = document.createElement('style'); s.id = 'rs-css';
    s.textContent = `
.rs-c{--ik:var(--ink,var(--fg,#123));--ln:var(--ln,var(--bd,#d6e3e6));--mu:var(--mf,var(--mut,#566));--pr:var(--ac,var(--pri,#2aa3b5));margin:1rem 0;padding:.9rem 1rem;border:1px solid var(--ln);border-left:5px solid var(--pr);border-radius:.5rem;background:#fff;color:var(--ik);box-shadow:0 1px 2px rgb(0 0 0/.05)}
.rs-c *{box-sizing:border-box}
.rs-k{margin:0;font-size:.7rem;font-weight:800;text-transform:uppercase;color:var(--pr)}
.rs-c h3{margin:.15rem 0 0;font-family:Sora,Manrope,sans-serif;font-size:1.05rem;text-transform:none;color:var(--ik)}
.rs-c small{display:block;margin-top:.15rem;font-size:.78rem;color:var(--mu)}
.rs-r{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem}
.rs-f{display:flex;gap:.5rem;align-items:center}
.rs-f input{width:6.5rem;height:3rem;padding:0 .6rem;border:1px solid var(--ln);border-radius:.5rem;font:inherit;font-size:1.25rem;font-weight:700;text-align:center;background:#fff;color:var(--ik)}
.rs-f input:focus-visible{outline:2px solid var(--pr);outline-offset:1px}
.rs-f button{min-height:3rem;padding:0 1.1rem;border:0;border-radius:.5rem;background:var(--pr);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.rs-f button:disabled{opacity:.5;cursor:default}
.rs-m{margin:.5rem 0 0;min-height:1.2em;font-size:.82rem;color:var(--mu)}
.rs-m.ok{color:#00764c}.rs-m.er{color:#b42318}
@media(max-width:520px){.rs-f{width:100%}.rs-f input{flex:1}}`;
    document.head.appendChild(s);
  }

  // Карточка ввода за одну смену. el — контейнер, date — дата смены (YYYY-MM-DD).
  // opts.today — дата текущей смены: на будущие дни вводить нельзя. Возвращает Promise, который заканчивается после показа числа.
  async function mount(el, date, opts = {}) {
    if (!el) return;
    css();
    const toastF = opts.toast || (typeof toast === 'function' ? toast : () => {});
    const future = opts.today && date > opts.today;
    const draw = (val, msg, cls) => {
      el.innerHTML = `<section class="rs-c" aria-label="Проживающие">
        <div class="rs-r"><div><p class="rs-k">Видят только админы</p><h3>Проживающие · ${E(dLabel(date))}</h3><small>Сколько человек проживает в эту смену. Вводится раз в день.</small></div>
        ${future ? '' : `<form class="rs-f" id="rs-form"><input id="rs-n" type="number" min="0" max="100000" step="1" inputmode="numeric" placeholder="0" aria-label="Количество проживающих" value="${val == null ? '' : val}"><button type="submit" id="rs-s">Сохранить</button></form>`}</div>
        <p class="rs-m ${cls || ''}" id="rs-msg" role="status">${E(msg || (future ? 'На будущие смены вводить нельзя.' : val == null ? 'За эту смену число ещё не введено.' : ''))}</p></section>`;
      const f = el.querySelector('#rs-form'); if (!f) return;
      const inp = f.querySelector('#rs-n'), btn = f.querySelector('#rs-s'), m = el.querySelector('#rs-msg');
      dirty = false;
      inp.oninput = () => { dirty = true; };
      f.onsubmit = async e => {
        e.preventDefault();
        const raw = inp.value.trim();
        const n = raw === '' ? null : Number(raw);
        if (n !== null && (!Number.isInteger(n) || n < 0)) { m.className = 'rs-m er'; m.textContent = 'Введите целое число людей, 0 или больше.'; return; }
        btn.disabled = true;
        const { error } = await sb.rpc('set_residents', { p_day: date, p_cnt: n });
        btn.disabled = false;
        if (error) { m.className = 'rs-m er'; m.textContent = /set_residents|is_admin/.test(error.message || '') ? 'Выполните stage13.sql в Supabase.' : (error.message || 'Не сохранено'); return; }
        cache[date] = n; dirty = false;
        if (opts.onValue) opts.onValue(n);
        m.className = 'rs-m ok'; m.textContent = n == null ? 'Число удалено.' : `Сохранено: ${n} чел.`;
        toastF(n == null ? 'Число проживающих удалено' : 'Проживающих: ' + n);
      };
    };
    if (date in cache) { draw(cache[date]); if (opts.onValue) opts.onValue(cache[date]); } else draw(null, 'Загружаю…');   // сначала то, что уже знаем, потом свежее значение
    if (el.querySelector('#rs-n') && dirty) return;                       // не затираем то, что человек уже печатает
    const r = await range(date, date);
    if (r === null) { el.innerHTML = '<section class="rs-c"><p class="rs-k">Видят только админы</p><h3>Проживающие</h3><p class="rs-m">Раздел появится после выполнения stage13.sql в Supabase.</p></section>'; return; }
    cache[date] = date in r ? r[date] : null;
    if (opts.onValue) opts.onValue(cache[date]);
    const inp = el.querySelector('#rs-n');
    if (inp && document.activeElement === inp) return;                    // человек уже печатает, не перерисовываем
    draw(cache[date]);
  }

  // true, пока в поле идёт ввод или есть несохранённое число: страница не должна перерисовываться
  const reset = () => { Object.keys(cache).forEach(k => delete cache[k]); dirty = false; };   // при выходе из аккаунта
  const busy = () => dirty || (document.activeElement && document.activeElement.id === 'rs-n');

  const get = d => (d in cache ? cache[d] : undefined);   // число за день из кэша; undefined, если ещё не загружено
  return { isAdmin, range, mount, busy, reset, get };
})();
