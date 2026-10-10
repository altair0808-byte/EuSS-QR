// Остатки химии: общий запас по каждой химии и кнопка «Перелить в дозатор».
// Правило: объём выбранного дозатора увеличивается ровно на сумму остатков; новую бутыль это не заменяет.
// Дозатор НЕ выбран по умолчанию: подтвердить без выбора нельзя. Суперадмин может исправить дозатор у уже записанного подключения.
// Работает и на панели смены (index.html), и в бланке замены химии (form.html).
// Нужны глобальные sb (supabase), toast; стили подключаются сами.
const Leftover = (() => {
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const N = (n, d = 6) => Num.fmt(n, d);   // без округления: 0,175 → «0,175», 0,350 → «0,35» (num.js)
  const prim = c => (+c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null));
  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const conv = (c, v, from, to) => { if (from === to) return v; const d = dens(c); if (!d) return 0; return from === 'l' ? v * d : v / d; };
  const U = p => p === 'l' ? 'л' : 'кг';
  const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const safeUrl = u => /^https?:\/\/\S+$/i.test(String(u || '').trim()) ? String(u).trim().replace(/^http:\/\//i, 'https://') : '';
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

  // «дозатор 1» = машины 1–10 (1_10), «дозатор 2» = машины 11–12 (11_12)
  const dozName = g => g === '11_12' ? 'дозатор 2' : 'дозатор 1';
  const dozOf = g => g === '11_12' ? 'дозатора 2' : 'дозатора 1';        // «из дозатора 1»
  const GRPS = ['1_10', '11_12'];
  const grpOf = g => g === '11_12' ? '11_12' : '1_10';
  // количество одной записи сразу в кг и в литрах (то, что записано, берём как есть; недостающее считаем по плотности)
  const kgl = (c, x) => ({
    kg: +x.leftover_kg > 0 ? +x.leftover_kg : (+x.leftover_l > 0 ? conv(c, +x.leftover_l, 'l', 'kg') : 0),
    l: +x.leftover_l > 0 ? +x.leftover_l : (+x.leftover_kg > 0 ? conv(c, +x.leftover_kg, 'kg', 'l') : 0) });
  // «2,98 кг (2,887 л)»; если плотность неизвестна, показываем только то, что известно
  const amtTxt = a => a.kg > 0 && a.l > 0 ? `${N(a.kg, 3)} кг (${N(a.l, 3)} л)` : a.kg > 0 ? `${N(a.kg, 3)} кг` : `${N(a.l, 3)} л`;
  // Модель окна «Перелить в дозатор»: по ней рисуется окно, по ней же проверяют тесты.
  //   s — запас одной химии (summary), g — выбранный дозатор или null (по умолчанию не выбран).
  function pourModel(s, g) {
    const by = {};
    s.items.forEach(x => { const k = grpOf(x.machine_group), a = kgl(s.c, x), r = by[k] || (by[k] = { g: k, kg: 0, l: 0 }); r.kg += a.kg; r.l += a.l; });
    const from = GRPS.filter(k => by[k]).map(k => by[k]);
    const total = from.reduce((t, r) => ({ kg: t.kg + r.kg, l: t.l + r.l }), { kg: 0, l: 0 });
    const chosen = GRPS.includes(g) ? g : null;
    return { from, total, totalTxt: amtTxt(total), chosen, canConfirm: !!chosen,
      fromTxt: from.map(r => `из ${dozOf(r.g)}: ${amtTxt(r)}` + (chosen ? `, будет добавлено в ${dozName(chosen)}` : '')),
      resultTxt: chosen ? `В ${dozName(chosen)} будет добавлено ${amtTxt(total)}` : 'Выберите дозатор, в который вы выливаете остаток',
      btnTxt: chosen ? `Перелить в ${dozName(chosen)}` : 'Выберите дозатор' };
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
  const thumb = c => `<span class="lo-i" style="--h:${hue(c.name)}"><b><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h5v3h-5z"/><path d="M8.5 5.5h7l2 3.2v10.8a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8.7z"/><rect x="8.5" y="12" width="7" height="5" rx="1"/></svg></b>${safeUrl(c.image_url) ? `<img src="${E(safeUrl(c.image_url))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;

  function css() {
    if (document.getElementById('lo-css')) return;
    const s = document.createElement('style'); s.id = 'lo-css';
    s.textContent = `
.lo-w{--o:#de6e29;--od:#a74900;--ot:#ffefdd;--ik:var(--ink,var(--fg,#123));--ln:var(--ln,var(--bd,#d6e3e6));--mu:var(--mut,var(--mf,#566));display:grid;gap:.6rem}
.lo-w *{box-sizing:border-box}
.lo-c{border:1px solid var(--ln);border-left:5px solid var(--o);border-radius:.5rem;background:#fff;padding:.8rem .9rem;box-shadow:0 1px 2px rgb(0 0 0/.05);color:var(--ik)}
.lo-top{display:flex;align-items:center;gap:.7rem}
.lo-i{position:relative;flex:none;display:grid;place-items:center;width:2.75rem;height:2.75rem;overflow:hidden;border-radius:.5rem;background:linear-gradient(135deg,hsl(var(--h) 62% 91%),hsl(calc(var(--h) + 30) 55% 80%))}
.lo-i b{font-family:Sora,sans-serif;color:hsl(var(--h) 45% 32%)}.lo-i img{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;padding:.15rem;object-fit:contain;background:#fff}
.lo-nm{flex:1;min-width:0}.lo-nm b{display:block;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lo-nm small,.lo-tot small{display:block;font-size:.72rem;color:var(--mu)}
.lo-tot{text-align:right;flex:none}.lo-tot b{display:block;font-family:Sora,sans-serif;font-size:1.45rem;line-height:1.1;color:var(--od)}
.lo-l{list-style:none;margin:.6rem 0 0;padding:.5rem 0 0;border-top:1px dashed var(--ln);display:grid;gap:.25rem;font-size:.82rem}
.lo-l li{display:flex;justify-content:space-between;gap:.5rem}.lo-l em{font-style:normal;color:var(--mu);text-align:right;font-size:.75rem}
.lo-b{display:flex;align-items:center;justify-content:center;width:100%;min-height:2.9rem;margin-top:.7rem;border:0;border-radius:.5rem;background:var(--o);color:#fff;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;touch-action:manipulation}
.lo-b:active{transform:scale(.98)}.lo-b:disabled{opacity:.5}
.lo-b2{display:flex;align-items:center;justify-content:center;width:100%;min-height:2.5rem;margin-top:.4rem;border:1px solid var(--ln);border-radius:.5rem;background:#fff;color:#b42318;font:inherit;font-weight:600;font-size:.82rem;cursor:pointer;touch-action:manipulation}
.lo-b2:active{transform:scale(.98)}
.lo-ck{display:grid;gap:.4rem;margin-top:.9rem}.lo-ck label{display:flex;align-items:center;gap:.6rem;min-height:2.75rem;padding:.4rem .7rem;border:1px solid var(--ln,#d6e3e6);border-radius:.5rem;font-size:.88rem;cursor:pointer}
.lo-ck input{width:1.15rem;height:1.15rem;flex:none}.lo-ck em{font-style:normal;margin-left:auto;font-size:.75rem;color:var(--mut,var(--mf,#566));text-align:right}
.lo-go.dg{background:#b42318}
.lo-e{padding:.8rem .9rem;border:1px dashed var(--ln);border-radius:.5rem;font-size:.85rem;color:var(--mu)}
.lo-ov{position:fixed;top:0;right:0;bottom:0;left:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;background:rgb(10 40 55/.3)}
.lo-pn{--o:#de6e29;--od:#a74900;width:100%;max-width:28rem;max-height:92vh;max-height:92dvh;overflow:auto;overscroll-behavior:contain;padding:1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));border-radius:1rem 1rem 0 0;background:#fff;color:var(--ink,var(--fg,#123));box-shadow:0 20px 50px rgb(0 0 0/.25)}
.lo-pn h2{margin:.2rem 0 0;font-family:Sora,sans-serif;font-size:1.3rem}.lo-pn p{margin:.4rem 0 0;font-size:.85rem;color:var(--mut,var(--mf,#566))}
.lo-pn .k{font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--od);margin:0}
.lo-dz{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:1rem}
.lo-dz button{display:flex;flex-direction:column;align-items:flex-start;gap:.1rem;min-height:4.8rem;padding:.8rem;border:2px solid var(--ln,var(--bd,#d6e3e6));border-radius:.6rem;background:#fff;font:inherit;text-align:left;cursor:pointer;color:inherit}
.lo-dz button b{font-family:Sora,sans-serif;font-size:1.5rem;line-height:1.1}.lo-dz button small{font-size:.72rem;color:var(--mut,var(--mf,#566))}
.lo-dz button.sel{border-color:var(--o);background:var(--ot,#fff4e8);box-shadow:0 0 0 3px var(--o);box-shadow:0 0 0 3px color-mix(in oklab,var(--o) 20%,transparent)}.lo-dz button.sel b{color:var(--od)}
.lo-go{display:flex;align-items:center;justify-content:center;width:100%;min-height:3.25rem;margin-top:1.1rem;border:0;border-radius:.5rem;background:var(--o);color:#fff;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
.lo-go:disabled{opacity:.5}.lo-gh{display:flex;align-items:center;justify-content:center;width:100%;min-height:2.75rem;margin-top:.3rem;border:0;background:none;font:inherit;font-weight:600;color:var(--od);cursor:pointer}
.lo-q{margin:.9rem 0 0;font-size:.95rem;color:var(--ink,var(--fg,#123))}.lo-pn p.lo-q{color:var(--ink,var(--fg,#123))}
.lo-src{list-style:none;margin:.45rem 0 0;padding:0;display:grid;gap:.2rem;font-size:.85rem;color:var(--mut,var(--mf,#566))}
.lo-res{margin:.9rem 0 0;padding:.8rem .9rem;border:2px dashed var(--ln,#d6e3e6);border-radius:.6rem;font-family:Sora,sans-serif;font-size:1.05rem;font-weight:700;line-height:1.3;color:var(--mut,#566)}
.lo-res.on{border:2px solid var(--o);border-style:solid;background:var(--ot,#fff4e8);color:var(--od);font-size:1.25rem}
.lo-fx{margin-top:1rem;border:1px solid var(--ln);border-radius:.5rem;background:#fff;padding:.5rem .8rem;color:var(--ik,#123)}.lo-fx summary{cursor:pointer;font-weight:700;font-size:.88rem;min-height:2.2rem;display:flex;align-items:center}
.lo-fx ul{list-style:none;margin:.4rem 0 0;padding:0;display:grid;gap:.4rem}.lo-fx li{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.45rem 0;border-top:1px dashed var(--ln);font-size:.82rem}
.lo-fx li span{flex:1;min-width:10rem}.lo-fx li em{font-style:normal;color:var(--mut,#566);font-size:.75rem}
.lo-fx button{min-height:2.4rem;padding:0 .8rem;border:1px solid var(--ln);border-radius:.5rem;background:#fff;font:inherit;font-weight:600;font-size:.8rem;cursor:pointer;color:var(--od,#a74900)}
.lo-dz button:disabled{opacity:.45;cursor:not-allowed}
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
      ${o.can ? `<button class="lo-b" data-lo="${s.c.id}">Перелить в дозатор</button>` : ''}
      ${o.canWriteoff ? `<button class="lo-b2" data-lw="${s.c.id}">Списать остаток</button>` : ''}</article>`).join('')}</div>`;
  }

  function bind(root, rows, chems, names, o, onDone) {
    const sum = summary(rows, chems);
    root.querySelectorAll('[data-lo]').forEach(b => b.onclick = () => panel(sum.find(s => String(s.c.id) === b.dataset.lo), o, onDone));
    root.querySelectorAll('[data-lw]').forEach(b => b.onclick = () => writeoffPanel(sum.find(s => String(s.c.id) === b.dataset.lw), names, o, onDone));
  }

  // Списание остатка (суперадмин). Списанное пропадает из запаса и нигде не показывается в истории, журнале и отчёте.
  function writeoffPanel(s, names, o, onDone) {
    if (!s) return;
    css();
    const d = document.createElement('div'); d.className = 'lo-ov';
    d.innerHTML = `<section class="lo-pn" role="dialog" aria-modal="true" aria-label="Списать остаток">
      <p class="k" style="color:#b42318">Списать остаток</p><h2>${E(s.c.name)} · ${N(s.total)} ${U(s.p)}</h2>
      <p>Отметьте, что списать. Списанное пропадёт из запаса и не будет показано в истории и отчётах. Расход за период не изменится.</p>
      <div class="lo-ck" id="lwck">${s.items.map(x => `<label><input type="checkbox" value="${E(x.id)}" data-a="${x.amt}" checked><span>${N(x.amt)} ${U(s.p)}</span><em>${dayLabel(x.shift_date, o.today)}${names[x.created_by] ? ' · ' + E(names[x.created_by]) : ''} · дозатор ${grpName(x.machine_group)}</em></label>`).join('')}</div>
      <button class="lo-go dg" id="lwgo" type="button">Списать</button><button class="lo-gh" id="lwcl" type="button" style="color:#566">Отмена</button></section>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape' && !document.querySelector('form[role=dialog]')) close(); };
    document.addEventListener('keydown', esc);
    d.onmousedown = e => { if (e.target === d) close(); };
    d.querySelector('#lwcl').onclick = close;
    const sel = () => [...d.querySelectorAll('#lwck input:checked')];
    const upd = () => { const a = sel().reduce((t, i) => t + (+i.dataset.a || 0), 0); const b = d.querySelector('#lwgo'); b.disabled = !sel().length; b.textContent = sel().length ? 'Списать ' + N(a) + ' ' + U(s.p) : 'Ничего не выбрано'; };
    d.querySelector('#lwck').onchange = upd; upd();
    d.querySelector('#lwgo').onclick = async () => {
      const ids = sel().map(i => i.value); if (!ids.length) return;
      const a = sel().reduce((t, i) => t + (+i.dataset.a || 0), 0);
      const ok = await withPw('Списать ' + N(a) + ' ' + U(s.p) + '?', s.c.name + '\nСписанное не будет отображаться в истории.', pw => rpcAsk('writeoff_leftovers', { p_chemical: +s.c.id, p_ids: ids, p_pw: pw }));
      if (!ok) return;
      close(); toast('Списано: ' + s.c.name); if (onDone) onDone();
    };
  }

  // Окно «Перелить в дозатор». Дозатор по умолчанию НЕ выбран; пока не выбран, подтвердить нельзя.
  function panel(s, o, onDone) {
    if (!s) return;
    css();
    let g = null;
    const m0 = pourModel(s, null);
    const d = document.createElement('div'); d.className = 'lo-ov';
    d.innerHTML = `<section class="lo-pn" role="dialog" aria-modal="true" aria-label="Перелить в дозатор">
      <p class="k">Перелить в дозатор</p><h2>${E(s.c.name)} · ${E(m0.totalTxt)}</h2>
      <p class="lo-q"><b>В какой дозатор вы выливаете остаток?</b></p>
      <ul class="lo-src" id="losrc">${m0.fromTxt.map(t => `<li>${E(t)}</li>`).join('')}</ul>
      <div class="lo-dz" id="lodz">${[['1_10', '1', 'Основной дозатор', 'машины 1–10'], ['11_12', '2', 'Отдельный дозатор', 'машины 11–12']].map(([v, b, n, ms]) => `<button type="button" data-v="${v}" aria-pressed="false"><b>${b}</b><span>${n}</span><small>${ms}</small></button>`).join('')}</div>
      <div class="lo-res" id="lores" role="status" aria-live="polite">${E(m0.resultTxt)}</div>
      <p>Остатки (${s.items.map(x => N(x.amt) + ' ' + U(s.p)).join(' + ')}) считаются одним запасом и выливаются в один дозатор. Объём выбранного дозатора увеличится на эту сумму; новую бутыль это не заменяет. Весь запас этой химии отметится как перелитый и пропадёт из остатков.</p>
      <button class="lo-go" id="logo" type="button" disabled>${E(m0.btnTxt)}</button><button class="lo-gh" id="locl" type="button">Отмена</button></section>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    d.onmousedown = e => { if (e.target === d) close(); };
    d.querySelector('#locl').onclick = close;
    const draw = () => {
      const m = pourModel(s, g);
      d.querySelectorAll('#lodz button').forEach(x => { const on = x.dataset.v === g; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      d.querySelector('#losrc').innerHTML = m.fromTxt.map(t => `<li>${E(t)}</li>`).join('');
      const r = d.querySelector('#lores'); r.textContent = m.resultTxt; r.classList.toggle('on', m.canConfirm);
      const b = d.querySelector('#logo'); b.textContent = m.btnTxt; b.disabled = !m.canConfirm;
    };
    d.querySelector('#lodz').onclick = e => { const b = e.target.closest('button'); if (!b || !GRPS.includes(b.dataset.v)) return; g = b.dataset.v; draw(); };
    d.querySelector('#logo').onclick = async () => {
      if (!g) { toast('Выберите дозатор'); return; }       // подстраховка: кнопка и так неактивна
      const b = d.querySelector('#logo'); b.disabled = true;
      const { error } = await sb.rpc('connect_leftovers', { p_chemical: +s.c.id, p_group: g });
      if (error) { toast('Не удалось: ' + error.message); b.disabled = false; return; }
      close(); toast('Остаток перелит в ' + dozName(g) + ': ' + s.c.name); if (onDone) onDone();
    };
  }

  // ---- Исправление уже записанного подключения (только суперадмин, с паролем) ----
  // Подключения читаем через report_connects (права: отчёты). Запись правит connect_set_group (stage23.sql).
  async function fetchConnects(today, days = 45) {
    const day = k => new Date(Date.parse(today + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
    const r = await sb.rpc('report_connects', { d1: day(-days), d2: day(1) });
    return r.error ? null : (r.data || []).slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }
  const connAmt = (c, k) => amtTxt(kgl(c, { leftover_kg: k.amount_kg, leftover_l: k.amount_l }));
  // Описание того, что произойдёт при смене дозатора (по нему же рисуется окно и пишут тесты)
  function fixModel(c, k, to) {
    const from = grpOf(k.machine_group), a = connAmt(c, k), ok = GRPS.includes(to) && to !== from;
    return { from, to: ok ? to : null, amt: a, canConfirm: ok,
      nowTxt: `Сейчас записано в ${dozName(from)}`,
      resultTxt: ok ? `Запись перейдёт из ${dozOf(from)} в ${dozName(to)}: в ${dozName(to)} будет +${a}, из ${dozOf(from)} это количество уберётся` : 'Выберите дозатор, в который на самом деле налили',
      btnTxt: ok ? `Записать в ${dozName(to)}` : 'Выберите другой дозатор' };
  }
  function fixHtml(rows, chems, names, o) {
    css();
    if (rows == null) return '<details class="lo-fx"><summary>Исправить дозатор у подключения</summary><p class="lo-e">Список подключений не загрузился. Обновите страницу.</p></details>';
    const hm = ts => new Date(new Date(ts).getTime() + (o.tz ?? 5) * 3600e3).toISOString().slice(11, 16);
    const list = rows.slice(0, 15).map(k => { const c = chems.find(x => +x.id === +k.chemical_id) || { name: 'Химия #' + k.chemical_id };
      return `<li><span><b>${E(c.name)}</b> · ${E(connAmt(c, k))}<br><em>${dayLabel(k.shift_date, o.today)} ${hm(k.ts)} · записано в ${E(dozName(k.machine_group))}${names[k.created_by] ? ' · ' + E(names[k.created_by]) : ''}</em></span><button type="button" data-lx="${E(k.id)}">Изменить дозатор</button></li>`; }).join('');
    return `<details class="lo-fx" id="lofxd"><summary>Исправить дозатор у подключения (суперадмин)</summary>${rows.length ? `<ul>${list}</ul>${rows.length > 15 ? '<p class="lo-e">Показаны 15 последних подключений.</p>' : ''}` : '<p class="lo-e">Подключений за последние недели нет.</p>'}</details>`;
  }
  function fixBind(root, rows, chems, names, o, onDone) {
    (rows || []).forEach(k => { const b = root.querySelector(`[data-lx="${k.id}"]`); if (b) b.onclick = () => fixPanel(k, chems.find(x => +x.id === +k.chemical_id) || { name: 'Химия #' + k.chemical_id }, o, onDone); });
  }
  function fixPanel(k, c, o, onDone) {
    css();
    let to = null;
    const m0 = fixModel(c, k, null);
    const d = document.createElement('div'); d.className = 'lo-ov';
    d.innerHTML = `<section class="lo-pn" role="dialog" aria-modal="true" aria-label="Изменить дозатор у подключения">
      <p class="k" style="color:#b42318">Исправить подключение</p><h2>${E(c.name)} · ${E(m0.amt)}</h2>
      <p>${E(m0.nowTxt)}. В какой дозатор остаток налили на самом деле?</p>
      <div class="lo-dz" id="fxdz">${[['1_10', '1', 'Основной дозатор', 'машины 1–10'], ['11_12', '2', 'Отдельный дозатор', 'машины 11–12']].map(([v, b, n, ms]) => `<button type="button" data-v="${v}" aria-pressed="false" ${v === grpOf(k.machine_group) ? 'disabled' : ''}><b>${b}</b><span>${v === grpOf(k.machine_group) ? 'сейчас здесь' : n}</span><small>${ms}</small></button>`).join('')}</div>
      <div class="lo-res" id="fxres" role="status" aria-live="polite">${E(m0.resultTxt)}</div>
      <p>Нужен пароль. Правка попадёт в журнал со старым и новым дозатором. Если запись относится к закрытому периоду, закрытие получит пометку «нужен пересчёт».</p>
      <button class="lo-go dg" id="fxgo" type="button" disabled>${E(m0.btnTxt)}</button><button class="lo-gh" id="fxcl" type="button">Отмена</button></section>`;
    document.body.appendChild(d);
    const close = () => { d.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape' && !document.querySelector('form[role=dialog]')) close(); };
    document.addEventListener('keydown', esc);
    d.onmousedown = e => { if (e.target === d) close(); };
    d.querySelector('#fxcl').onclick = close;
    const draw = () => {
      const m = fixModel(c, k, to);
      d.querySelectorAll('#fxdz button').forEach(x => { const on = x.dataset.v === to; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      const r = d.querySelector('#fxres'); r.textContent = m.resultTxt; r.classList.toggle('on', m.canConfirm);
      const b = d.querySelector('#fxgo'); b.textContent = m.btnTxt; b.disabled = !m.canConfirm;
    };
    d.querySelector('#fxdz').onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled || !GRPS.includes(b.dataset.v)) return; to = b.dataset.v; draw(); };
    d.querySelector('#fxgo').onclick = async () => {
      const m = fixModel(c, k, to); if (!m.canConfirm) return;
      let res = null;
      const ok = await withPw('Изменить дозатор?', `${c.name}: ${m.amt}\n${dozName(m.from)} → ${dozName(m.to)}`, async pw => { res = await rpcAsk('connect_set_group', { p_id: k.id, p_group: m.to, p_pw: pw }); return res; });
      if (!ok) return;
      close();
      toast(res && res.closed_period ? 'Исправлено. Запись в закрытом периоде: закрытие помечено «нужен пересчёт», пересчитайте его в отчёте по закрытиям' : 'Дозатор исправлен: ' + dozName(m.to));
      if (onDone) onDone();
    };
  }

  return { fetch, summary, html, bind, panel, pourModel, writeoffPanel, fetchConnects, fixModel, fixHtml, fixBind, fixPanel, css, N, U, grpName, dozName, dozOf, dayLabel };
})();
