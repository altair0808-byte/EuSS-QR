// Остатки химии: общий запас по каждой химии и кнопка «Подключили остаток».
// Работает и на панели смены (index.html), и в бланке замены химии (form.html).
// Нужны глобальные sb (supabase), toast; стили подключаются сами.
const Leftover = (() => {
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const N = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('ru-RU');
  const prim = c => (+c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null));
  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const conv = (c, v, from, to) => { if (from === to) return v; const d = dens(c); if (!d) return 0; return from === 'l' ? v * d : v / d; };
  const U = p => p === 'l' ? 'л' : 'кг';
  const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const safeUrl = u => /^https?:\/\/\S+$/i.test(String(u || '').trim()) ? String(u).trim() : '';
  const grpName = g => g === '11_12' ? '11–12' : '1–10';

  // количество одной записи в основной единице химии (литры или кг)
  const rowAmt = (c, x) => {
    const p = prim(c) || 'l';
    if (p === 'l') return +x.leftover_l > 0 ? +x.leftover_l : (+x.leftover_kg > 0 ? conv(c, +x.leftover_kg, 'kg', 'l') : 0);
    return +x.leftover_kg > 0 ? +x.leftover_kg : (+x.leftover_l > 0 ? conv(c, +x.leftover_l, 'l', 'kg') : 0);
  };
  // chems: справочник химии; rows: leftover_pool(). Возвращает по каждой химии общий запас и список остатков
  function summary(rows, chems) {
    const out = [];
    chems.filter(c => c.kind === 'main').forEach(c => {
      const mine = (rows || []).filter(x => +x.chemical_id === +c.id);
      if (!mine.length) return;
      const p = prim(c) || 'l', items = mine.map(x => ({ ...x, amt: rowAmt(c, x) })).filter(x => x.amt > 0);
      if (!items.length) return;
      const total = items.reduce((a, x) => a + x.amt, 0), d = dens(c);
      out.push({ c, p, total, other: d ? conv(c, total, p, p === 'l' ? 'kg' : 'l') : null, items });
    });
    return out;
  }
  async function fetch() {
    const [p, n] = await Promise.all([sb.rpc('leftover_pool'), sb.rpc('staff_names')]);
    return { rows: p.error ? null : (p.data || []), names: Object.fromEntries(((n && n.data) || []).map(x => [x.id, x.name])), error: p.error };
  }
  const dayLabel = (d, today) => {
    if (!d) return '';
    const t = new Date(today + 'T00:00:00Z').getTime(), x = new Date(d + 'T00:00:00Z').getTime(), k = Math.round((t - x) / 864e5);
    return k === 0 ? 'сегодня' : k === 1 ? 'вчера' : d.slice(8) + '.' + d.slice(5, 7);
  };
  const thumb = c => `<span class="lo-i" style="--h:${hue(c.name)}"><b>${E(String(c.name || '?').trim().charAt(0).toUpperCase())}</b>${safeUrl(c.image_url) ? `<img src="${E(safeUrl(c.image_url))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;

  function css() {
    if (document.getElementById('lo-css')) return;
    const s = document.createElement('style'); s.id = 'lo-css';
    s.textContent = `
.lo-w{--o:oklch(.66 .16 48);--od:oklch(.52 .15 48);--ot:oklch(.96 .035 70);--ik:var(--ink,var(--fg,#123));--ln:var(--ln,var(--bd,#d6e3e6));--mu:var(--mut,var(--mf,#566));display:grid;gap:.6rem}
.lo-w *{box-sizing:border-box}
.lo-c{border:1px solid var(--ln);border-left:5px solid var(--o);border-radius:.5rem;background:#fff;padding:.8rem .9rem;box-shadow:0 1px 2px rgb(0 0 0/.05);color:var(--ik)}
.lo-top{display:flex;align-items:center;gap:.7rem}
.lo-i{position:relative;flex:none;display:grid;place-items:center;width:2.75rem;height:2.75rem;overflow:hidden;border-radius:.5rem;background:linear-gradient(135deg,hsl(var(--h) 62% 91%),hsl(calc(var(--h) + 30) 55% 80%))}
.lo-i b{font-family:Sora,sans-serif;color:hsl(var(--h) 45% 32%)}.lo-i img{position:absolute;inset:0;width:100%;height:100%;padding:.15rem;object-fit:contain;background:#fff}
.lo-nm{flex:1;min-width:0}.lo-nm b{display:block;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lo-nm small,.lo-tot small{display:block;font-size:.72rem;color:var(--mu)}
.lo-tot{text-align:right;flex:none}.lo-tot b{display:block;font-family:Sora,sans-serif;font-size:1.45rem;line-height:1.1;color:var(--od)}
.lo-l{list-style:none;margin:.6rem 0 0;padding:.5rem 0 0;border-top:1px dashed var(--ln);display:grid;gap:.25rem;font-size:.82rem}
.lo-l li{display:flex;justify-content:space-between;gap:.5rem}.lo-l em{font-style:normal;color:var(--mu);text-align:right;font-size:.75rem}
.lo-b{display:flex;align-items:center;justify-content:center;width:100%;min-height:2.9rem;margin-top:.7rem;border:0;border-radius:.5rem;background:var(--o);color:#fff;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;touch-action:manipulation}
.lo-b:active{transform:scale(.98)}.lo-b:disabled{opacity:.5}
.lo-e{padding:.8rem .9rem;border:1px dashed var(--ln);border-radius:.5rem;font-size:.85rem;color:var(--mu)}
.lo-ov{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;background:rgb(10 40 55/.3)}
.lo-pn{--o:oklch(.66 .16 48);--od:oklch(.52 .15 48);width:100%;max-width:28rem;max-height:92dvh;overflow:auto;overscroll-behavior:contain;padding:1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));border-radius:1rem 1rem 0 0;background:#fff;color:var(--ink,var(--fg,#123));box-shadow:0 20px 50px rgb(0 0 0/.25)}
.lo-pn h2{margin:.2rem 0 0;font-family:Sora,sans-serif;font-size:1.3rem}.lo-pn p{margin:.4rem 0 0;font-size:.85rem;color:var(--mut,var(--mf,#566))}
.lo-pn .k{font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--od);margin:0}
.lo-dz{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:1rem}
.lo-dz button{display:flex;flex-direction:column;align-items:flex-start;gap:.1rem;min-height:4.8rem;padding:.8rem;border:2px solid var(--ln,var(--bd,#d6e3e6));border-radius:.6rem;background:#fff;font:inherit;text-align:left;cursor:pointer;color:inherit}
.lo-dz button b{font-family:Sora,sans-serif;font-size:1.5rem;line-height:1.1}.lo-dz button small{font-size:.72rem;color:var(--mut,var(--mf,#566))}
.lo-dz button.sel{border-color:var(--o);background:var(--ot,#fff4e8);box-shadow:0 0 0 3px color-mix(in oklab,var(--o) 20%,transparent)}.lo-dz button.sel b{color:var(--od)}
.lo-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:3.25rem;margin-top:1.1rem;border:0;border-radius:.5rem;background:var(--o);color:#fff;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
.lo-go:disabled{opacity:.5}.lo-gh{display:flex;align-items:center;justify-content:center;width:100%;min-height:2.75rem;margin-top:.3rem;border:0;background:none;font:inherit;font-weight:600;color:var(--od);cursor:pointer}
@media(min-width:640px){.lo-w{grid-template-columns:repeat(2,1fr)}.lo-ov{align-items:center}.lo-pn{border-radius:.75rem}}
@media(min-width:1100px){.lo-w{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(s);
  }

  function html(rows, chems, names, o) {
    css();
    const sum = summary(rows, chems);
    if (!sum.length) return '<div class="lo-w"><p class="lo-e" style="grid-column:1/-1">Остатков в запасе нет. Остаток появится после замены бутыли, если в ней что-то осталось.</p></div>';
    return `<div class="lo-w">${sum.map(s => `<article class="lo-c">
      <div class="lo-top">${thumb(s.c)}<div class="lo-nm"><b>${E(s.c.name)}</b><small>${s.items.length} ${s.items.length % 10 === 1 && s.items.length !== 11 ? 'остаток' : 'остатка'} в запасе</small></div>
        <div class="lo-tot"><b>${N(s.total)} ${U(s.p)}</b>${s.other != null ? `<small>≈ ${N(s.other)} ${s.p === 'l' ? 'кг' : 'л'}</small>` : ''}</div></div>
      <ul class="lo-l">${s.items.map(x => `<li><span>${N(x.amt)} ${U(s.p)}</span><em>${dayLabel(x.shift_date, o.today)}${names[x.created_by] ? ' · ' + E(names[x.created_by]) : ''} · дозатор ${grpName(x.machine_group)}</em></li>`).join('')}</ul>
      ${o.can ? `<button class="lo-b" data-lo="${s.c.id}">Подключили остаток</button>` : ''}</article>`).join('')}</div>`;
  }

  function bind(root, rows, chems, names, o, onDone) {
    const sum = summary(rows, chems);
    root.querySelectorAll('[data-lo]').forEach(b => b.onclick = () => panel(sum.find(s => String(s.c.id) === b.dataset.lo), o, onDone));
  }

  function panel(s, o, onDone) {
    if (!s) return;
    css();
    const last = s.items[s.items.length - 1];
    let g = last && last.machine_group || null;
    const d = document.createElement('div'); d.className = 'lo-ov';
    d.innerHTML = `<section class="lo-pn" role="dialog" aria-modal="true" aria-label="Подключить остаток">
      <p class="k">Подключить остаток</p><h2>${E(s.c.name)} · ${N(s.total)} ${U(s.p)}</h2>
      <p>Остатки (${s.items.map(x => N(x.amt) + ' ' + U(s.p)).join(' + ')}) считаются одним запасом. В какой дозатор подключили?</p>
      <div class="lo-dz" id="lodz">${[['1_10', '1–10', 'Основной дозатор'], ['11_12', '11–12', 'Отдельный дозатор']].map(([v, b, n]) => `<button type="button" data-v="${v}" class="${g === v ? 'sel' : ''}"><b>${b}</b><span>${n}</span><small>машины ${b}</small></button>`).join('')}</div>
      <p>Весь запас этой химии отметится как подключённый и пропадёт из остатков. В отчёте расход будет посчитан с учётом этого.</p>
      <button class="lo-go" id="logo" type="button">Подтвердить подключение</button><button class="lo-gh" id="locl" type="button">Отмена</button></section>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    d.onmousedown = e => { if (e.target === d) close(); };
    d.querySelector('#locl').onclick = close;
    d.querySelector('#lodz').onclick = e => { const b = e.target.closest('button'); if (!b) return; g = b.dataset.v; d.querySelectorAll('#lodz button').forEach(x => x.classList.toggle('sel', x === b)); };
    d.querySelector('#logo').onclick = async () => {
      if (!g) { toast('Выберите дозатор'); return; }
      const b = d.querySelector('#logo'); b.disabled = true;
      const { error } = await sb.rpc('connect_leftovers', { p_chemical: +s.c.id, p_group: g });
      if (error) { toast('Не удалось: ' + error.message); b.disabled = false; return; }
      close(); toast('Остаток подключён: ' + s.c.name); if (onDone) onDone();
    };
  }

  return { fetch, summary, html, bind, panel, css, N, U, grpName, dayLabel };
})();
