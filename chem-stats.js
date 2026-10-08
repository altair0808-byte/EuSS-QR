// Статистика химии за период: «залито в дозатор» и «израсходовано (теория)», факт по замерам добавится позже.
// Нажатие на химикат открывает список: кто, где (машина, дозатор) и во сколько потратил или залил.
// Расчёты берут то, что уже есть в report-calc.js (calcReport, dispenserFlows), новых способов не придумывают.
//
// Что такое «залито»: полные бутыли по заменам + подключённый остаток + «залили» + «добавил суперадмин» − «забрал»
// (то же, что «приход» в закрытии, но без вычета остатка из убранной бутыли). Показания «реальный уровень» сюда не входят.
// Считается только для основной химии и для доп. средств, отмеченных «ведётся на дозаторе» (chemicals.in_closing).
// Что такое «израсходовано (теория)»: по рецептам и загрузкам, как в отчёте по сменам.
const ChemStats = (() => {
  const GROUPS = ['1_10', '11_12'];
  const GL = { all: 'оба дозатора', '1_10': 'дозатор 1 · машины 1–10', '11_12': 'дозатор 2 · машины 11–12' };
  const RC = () => (typeof module !== 'undefined' && typeof dispenserFlows === 'undefined') ? require('./report-calc.js') : { dispenserFlows, boundaryTs, addDaysISO };
  const fmt = n => (typeof Num !== 'undefined' ? Num.fmt(n) : String(n));
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dmy = d => String(d).split('-').reverse().join('.');
  const grpOfMachine = m => (+m <= 10 ? '1_10' : '11_12');
  const tracked = c => c.kind === 'main' || c.in_closing === true;

  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  // значение сразу в литрах, кг и штуках (штука = бутыль из настроек, только для основной химии); u — единица исходного числа: 'l' или 'kg'
  function both(c, v, u) {
    const d = dens(c);
    const l = u === 'l' ? v : d ? v / d : null, kg = u === 'kg' ? v : d ? v * d : null;
    const pc = c.kind === 'extra' ? null : (l != null && +c.bottle_l > 0 ? l / +c.bottle_l : kg != null && +c.bottle_kg > 0 ? kg / +c.bottle_kg : null);
    return { l, kg, pc };
  }
  const theoryUnit = c => (c.kind === 'extra' && c.per_unit_unit === 'g') ? 'kg' : 'l';

  // теория одной загрузки по одному химикату (в единицах theoryUnit) — те же формулы, что в calcReport
  function loadTheory(refs, load, c) {
    if (c.kind === 'main') {
      const r = (refs.recipes || []).find(x => +x.wash_type_id === +load.wash_type_id && +x.chemical_id === +c.id);
      return (+refs.water || 0) * ((r && +r.ml_per_l) || 0) / 1000;
    }
    const q = (load.extras || {})[c.id] != null ? +(load.extras || {})[c.id] : 0;
    return q > 0 ? q * (+c.per_unit || 0) / 1000 : 0;
  }

  const add = (a, b) => ({ l: a.l == null || b.l == null ? null : a.l + b.l, kg: a.kg == null || b.kg == null ? null : a.kg + b.kg, pc: a.pc == null || b.pc == null ? null : a.pc + b.pc });

  // model: по каждому химикату и дозатору — залито и теория за период [from, to] (даты смен)
  // ev: { changes, connects, moves, levels } с запасом назад (60 дней), rep: результат calcReport за тот же период (или null)
  function calc(refs, rep, ev, from, to, tz, st) {
    const { dispenserFlows, boundaryTs, addDaysISO } = RC();
    const t0 = boundaryTs(from, tz, st), t1 = boundaryTs(addDaysISO(to, 1), tz, st);
    const rows = (refs.chemicals || []).map(c => {
      const out = { id: c.id, name: c.name, kind: c.kind, c, tracked: tracked(c), g: {} };
      GROUPS.forEach(g => {
        let poured = null, need = false;
        if (out.tracked) {
          const f = dispenserFlows(c, g, t0, t1, ev);
          need = !!(f.needDensity || f.needSize);
          const gross = f.bottles + f.connects + f.replacedByConnect + f.pours + f.adds - f.takes;
          poured = need ? null : both(c, gross, 'kg');
        }
        const th = rep && rep.groups[g].chem.find(x => +x.id === +c.id);
        out.g[g] = { poured, need, theory: th ? th.theory : null };
      });
      const a = out.g['1_10'], b = out.g['11_12'];
      out.g.all = { poured: a.poured && b.poured ? add(a.poured, b.poured) : null, need: a.need || b.need,
        theory: a.theory && b.theory ? add(a.theory, b.theory) : (rep ? (rep.groups.all.chem.find(x => +x.id === +c.id) || {}).theory || null : null) };
      return out;
    });
    return { rows, from, to };
  }

  // общие итоги по набору химикатов: сумма по тем, где значение известно
  function totals(model, key) {
    const t = { poured: { l: 0, kg: 0, nL: 0, nKg: 0, n: 0 }, theory: { l: 0, kg: 0, nL: 0, nKg: 0, n: 0 }, all: 0 };
    model.rows.forEach(r => {
      if (!r.tracked) return;
      t.all++;
      const x = r.g[key];
      ['poured', 'theory'].forEach(k => {
        const v = x[k]; if (!v) return;
        t[k].n++;
        if (v.l != null) { t[k].l += v.l; t[k].nL++; }
        if (v.kg != null) { t[k].kg += v.kg; t[k].nKg++; }
      });
    });
    return t;
  }

  // события для списка «кто, где, во сколько»
  function events(refs, ctx, c, key) {
    const { ev, loads, from, to, nm } = ctx;
    const inP = x => x.shift_date >= from && x.shift_date <= to;
    const ok = x => key === 'all' || (x.machine_group || '1_10') === key;
    const who = id => (id && nm && nm[id]) || '';
    const wn = {}; (refs.washTypes || []).forEach(w => { wn[w.id] = w.name; });
    const prim = +c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null);
    const amtP = x => {
      if (!prim) return null;
      const u = prim, o = both(c, 0, u);
      const l = x.amount_l != null ? +x.amount_l : null, kg = x.amount_kg != null ? +x.amount_kg : null;
      if (u === 'l') return l != null ? both(c, l, 'l') : kg != null ? both(c, kg, 'kg') : o;
      return kg != null ? both(c, kg, 'kg') : l != null ? both(c, l, 'l') : o;
    };
    const use = [], fill = [];
    (loads || []).filter(l => inP(l) && (key === 'all' || grpOfMachine(l.machine) === key)).forEach(l => {
      const v = loadTheory(refs, l, c); if (!(v > 0)) return;
      use.push({ k: 'use', ts: l.ts, shift_date: l.shift_date, who: who(l.created_by), machine: l.machine, group: grpOfMachine(l.machine), wash: wn[l.wash_type_id] || '', weight: +l.weight_kg || 0, amt: both(c, v, theoryUnit(c)), by: l.created_by || null });
    });
    if (tracked(c)) {
      const mine = a => (a || []).filter(x => +x.chemical_id === +c.id && inP(x) && ok(x));
      mine(ev.changes).forEach(x => {
        const lf = x.leftover_l != null && +x.leftover_l > 0 ? both(c, +x.leftover_l, 'l') : x.leftover_kg != null && +x.leftover_kg > 0 ? both(c, +x.leftover_kg, 'kg') : null;
        fill.push({ k: 'chg', ts: x.ts, shift_date: x.shift_date, who: who(x.created_by), group: x.machine_group || '1_10', title: 'Замена бутыли', amt: +c.bottle_kg > 0 ? both(c, +c.bottle_kg, 'kg') : (+c.bottle_l > 0 ? both(c, +c.bottle_l, 'l') : null), left: lf, sign: 1 });
      });
      mine(ev.connects).forEach(x => fill.push({ k: 'con', ts: x.ts, shift_date: x.shift_date, who: who(x.created_by), group: x.machine_group || '1_10', title: 'Подключён остаток', amt: amtP(x), sign: 1 }));
      mine(ev.moves).forEach(x => {
        const kind = x.kind === 'take' ? 'take' : x.kind === 'add' ? 'add' : 'pour';
        fill.push({ k: kind, ts: x.ts, shift_date: x.shift_date, who: who(x.created_by), group: x.machine_group || '1_10', title: kind === 'take' ? 'Забрали из дозатора' : kind === 'add' ? 'Добавил суперадмин' : 'Залили из запаса', amt: amtP(x), sign: kind === 'take' ? -1 : 1 });
      });
      mine(ev.levels).forEach(x => fill.push({ k: 'lvl', ts: x.ts, shift_date: x.shift_date, who: who(x.created_by), group: x.machine_group || '1_10', title: 'Указан реальный уровень', amt: amtP(x), sign: 0 }));
    }
    const by = (a, f) => a.sort((p, q) => f * (new Date(p.ts) - new Date(q.ts)));
    by(use, -1); by(fill, -1);
    // сводка по сотрудникам и машинам (теория)
    const sum = (k, label) => { const m = {}; use.forEach(r => { const id = label(r); const e = m[id] || (m[id] = { name: id, n: 0, v: 0 }); e.n++; e.v += r.amt[theoryUnit(c)] != null ? r.amt[theoryUnit(c)] : 0; }); return Object.values(m).sort((a, b) => b.v - a.v); };
    return { use, fill, byWho: sum('who', r => r.who || 'не указан'), byMachine: sum('machine', r => 'Машина ' + r.machine) };
  }

  // ---------- вывод ----------
  const one = (c, o) => !o ? '–' : [o.pc != null ? fmt(o.pc) + ' шт' : '', o.l != null ? fmt(o.l) + ' л' : '', o.kg != null ? fmt(o.kg) + ' кг' : ''].filter(Boolean).join(' · ') || '–';
  const css = `
.cs{margin-top:.5rem}.cs-tot{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--ln);border-radius:var(--r);background:#fff;box-shadow:var(--sh)}
.cs-tot>div{padding:.7rem .9rem;min-width:0}.cs-tot>div+div{border-left:1px solid var(--ln)}
.cs-tot span{display:block;font-size:.68rem;font-weight:800;text-transform:uppercase;color:var(--mut)}
.cs-tot b{display:block;margin-top:.15rem;font-family:Sora,Manrope,sans-serif;font-size:1.2rem;line-height:1.25;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cs-tot small{display:block;margin-top:.1rem;font-size:.72rem;color:var(--mut)}
.cs-l{display:grid;gap:.5rem;margin-top:.6rem}
.cs-r{display:block;width:100%;text-align:left;padding:.65rem .8rem;border:1px solid var(--ln);border-radius:var(--r);background:#fff;box-shadow:var(--sh);cursor:pointer;font:inherit;color:inherit}
.cs-r:hover{background:var(--soft)}
.cs-h{display:flex;justify-content:space-between;align-items:center;gap:.5rem}.cs-h b{font-size:.95rem}.cs-h i{font-style:normal;color:var(--mut)}
.cs-g{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.35rem}
.cs-g span{display:block;font-size:.66rem;font-weight:800;text-transform:uppercase;color:var(--mut)}
.cs-g b{display:block;font-size:.84rem;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cs-g small{display:block;font-size:.7rem;color:var(--mut)}
.cs-n{margin:.5rem 0 0;font-size:.78rem;color:var(--mut)}
@media(max-width:560px){.cs-tot{grid-template-columns:1fr}.cs-tot>div+div{border-left:0;border-top:1px solid var(--ln)}.cs-g{grid-template-columns:1fr 1fr}.cs-g>div:nth-child(3){grid-column:1/-1}}
.cs-ov{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;background:rgb(10 40 55/.3)}
.cs-pn{width:100%;max-width:34rem;max-height:92vh;max-height:92dvh;overflow:auto;overscroll-behavior:contain;padding:1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));border-radius:1rem 1rem 0 0;background:var(--card,#fff);box-shadow:0 20px 50px rgb(0 0 0/.25)}
.cs-pn h2{margin:.1rem 0 0;font-size:1.3rem}.cs-pn .hint{margin:.25rem 0 0}
.cs-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem}
.cs-x{width:2.25rem;height:2.25rem;border:0;background:none;font-size:1.1rem;cursor:pointer}
.cs-sm{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin:.75rem 0}.cs-sm>div{padding:.55rem .7rem;border:1px solid var(--ln);border-radius:var(--r);background:var(--soft)}
.cs-sm span{display:block;font-size:.66rem;font-weight:800;text-transform:uppercase;color:var(--mut)}.cs-sm b{display:block;font-size:.9rem;font-variant-numeric:tabular-nums}
.cs-tb{display:flex;gap:.4rem;margin:.5rem 0}.cs-tb button{flex:1;padding:.5rem;border:1px solid var(--ln);border-radius:var(--r);background:#fff;font:inherit;font-weight:700;cursor:pointer}.cs-tb button.on{background:var(--ac,#0a7);color:#fff;border-color:transparent}
.cs-d{margin:.8rem 0 .2rem;font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--mut);display:flex;justify-content:space-between}
.cs-e{display:flex;justify-content:space-between;gap:.6rem;padding:.5rem 0;border-top:1px solid color-mix(in oklab,var(--ln) 60%,#fff);font-size:.85rem}
.cs-e>div:first-child{min-width:0}.cs-e b{font-variant-numeric:tabular-nums}.cs-e .m{display:block;color:var(--mut);font-size:.78rem}
.cs-e>div:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.cs-e.neg>div:last-child b{color:var(--bad,#c33)}
.cs-sg{display:flex;flex-wrap:wrap;gap:.35rem;margin:.4rem 0}.cs-sg span{padding:.2rem .5rem;border:1px solid var(--ln);border-radius:99px;font-size:.78rem;background:#fff}`;
  function ensureCss() { if (typeof document === 'undefined' || document.getElementById('cs-css')) return; const s = document.createElement('style'); s.id = 'cs-css'; s.textContent = css; document.head.appendChild(s); }

  const totBox = (label, t, note) => {
    const l = t.nL ? fmt(t.l) + ' л' : '', kg = t.nKg ? fmt(t.kg) + ' кг' : '';
    return `<div><span>${label}</span><b>${l || kg ? [l, kg].filter(Boolean).join('<br>') : '–'}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  };
  function render(model, key) {
    const t = totals(model, key), miss = t.all - t.poured.n;
    const rows = model.rows.map(r => {
      const x = r.g[key];
      const pour = !r.tracked ? '<b>–</b><small>не ведётся на дозаторе</small>' : x.need ? '<b>–</b><small>задайте литры и кг в настройках</small>' : `<b>${esc(one(r.c, x.poured))}</b>`;
      return `<button type="button" class="cs-r" data-cs="${r.id}"><div class="cs-h"><b>${esc(r.name)}</b><i>›</i></div>
        <div class="cs-g"><div><span>Залито</span>${pour}</div><div><span>Израсходовано (теория)</span><b>${esc(one(r.c, x.theory))}</b></div><div><span>Факт (замеры)</span><b>–</b></div></div></button>`;
    }).join('');
    return `<div class="cs"><div class="cs-tot">${totBox('Всего залито', t.poured, miss > 0 ? `по ${t.poured.n} из ${t.all} химикатов` : '')}${totBox('Всего израсходовано (теория)', t.theory, '')}<div><span>Факт по замерам</span><b>–</b><small>считается при закрытии периода</small></div></div>
      <div class="cs-l">${rows || '<p class="hint">Нет химикатов.</p>'}</div>
      <p class="cs-n">Нажмите на химикат, чтобы увидеть, кто, где и во сколько потратил или залил за выбранный период. Залито = полные бутыли по заменам + подключённые остатки + залитое − забранное. Теория — по рецептам и загрузкам.</p></div>`;
  }

  const timeOf = (ts, tz) => new Date(new Date(ts).getTime() + tz * 3600e3).toISOString().slice(11, 16);
  function openDetail(c, ctx) {
    ensureCss();
    const key = ctx.key || 'all', ev = events(ctx.refs, ctx, c, key), model = ctx.model, row = model.rows.find(r => +r.id === +c.id), x = row.g[key];
    const tz = ctx.tz, per = ctx.from === ctx.to ? dmy(ctx.from) : dmy(ctx.from) + ' – ' + dmy(ctx.to);
    const LIM = 400;
    const days = (list, line) => {
      let html = '', cur = '', n = 0;
      const dayTot = {}; list.forEach(r => { dayTot[r.shift_date] = (dayTot[r.shift_date] || 0) + (r.sign === 0 ? 0 : (r.sign || 1) * ((r.amt && (r.amt.l != null ? r.amt.l : r.amt.kg)) || 0)); });
      const unitOf = r => r.amt && r.amt.l != null ? ' л' : ' кг';
      for (const r of list) {
        if (n++ >= LIM) { html += `<p class="cs-n">Показаны последние ${LIM} из ${list.length}.</p>`; break; }
        if (r.shift_date !== cur) { cur = r.shift_date; html += `<div class="cs-d"><span>Смена ${dmy(cur)}</span><span>${r.k === 'use' ? 'итого ' + fmt(dayTot[cur]) + unitOf(r) : ''}</span></div>`; }
        html += line(r);
      }
      return html || '<p class="hint">За выбранный период записей нет.</p>';
    };
    const useLine = r => `<div class="cs-e"><div><b>${timeOf(r.ts, tz)} · ${esc(r.who || 'не указан')}</b><span class="m">Машина ${r.machine} (дозатор ${r.group === '1_10' ? '1–10' : '11–12'})${r.wash ? ' · ' + esc(r.wash) : ''} · ${fmt(r.weight)} кг белья</span></div><div><b>${esc(one(c, r.amt))}</b></div></div>`;
    const fillLine = r => `<div class="cs-e${r.sign < 0 ? ' neg' : ''}"><div><b>${timeOf(r.ts, tz)} · ${esc(r.title)}</b><span class="m">${esc(r.who || 'не указан')} · дозатор ${r.group === '11_12' ? '11–12' : '1–10'}${r.left ? ' · остаток в бутыли ' + esc(one(c, r.left)) : ''}</span></div><div><b>${r.sign < 0 ? '−' : r.sign > 0 ? '+' : ''}${r.amt ? esc(one(c, r.amt)) : '–'}</b></div></div>`;
    const chips = a => a.length ? `<div class="cs-sg">${a.map(e => `<span>${esc(e.name)}: ${e.n} ст. · ${fmt(e.v)} ${theoryUnit(c) === 'kg' ? 'кг' : 'л'}</span>`).join('')}</div>` : '';
    const wrap = document.createElement('div'); wrap.className = 'cs-ov';
    const draw = tab => {
      wrap.innerHTML = `<section class="cs-pn" role="dialog" aria-modal="true" aria-label="${esc(c.name)}"><div class="cs-top"><div><h2>${esc(c.name)}</h2><p class="hint">${per} · ${GL[key]}</p></div><button class="cs-x" type="button" aria-label="Закрыть">✕</button></div>
        <div class="cs-sm"><div><span>Залито</span><b>${!tracked(c) ? '–' : x.need ? 'нет плотности' : esc(one(c, x.poured))}</b></div><div><span>Израсходовано (теория)</span><b>${esc(one(c, x.theory))}</b></div></div>
        <div class="cs-tb"><button type="button" data-t="use" class="${tab === 'use' ? 'on' : ''}">Израсходовано</button><button type="button" data-t="fill" class="${tab === 'fill' ? 'on' : ''}">Залито</button></div>
        ${tab === 'use' ? `<p class="hint">Расход по загрузкам белья (теория). Кто запустил, на какой машине и во сколько.</p>${chips(ev.byWho)}${chips(ev.byMachine)}${days(ev.use, useLine)}`
          : tracked(c) ? `<p class="hint">Замены бутылей, подключённые остатки и перемещения. Показание «реальный уровень» в сумму не входит.</p>${days(ev.fill, fillLine)}` : '<p class="hint">Это доп. средство не ведётся на дозаторе: залитое не считается. Включить можно в настройках.</p>'}</section>`;
      wrap.querySelector('.cs-x').onclick = close;
      wrap.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => draw(b.dataset.t); });
    };
    const close = () => { document.removeEventListener('keydown', esc2); wrap.remove(); };
    const esc2 = e => { if (e.key === 'Escape') close(); };
    wrap.onmousedown = e => { if (e.target === wrap) close(); };
    document.addEventListener('keydown', esc2);
    draw('use'); document.body.appendChild(wrap);
  }

  // ctx: { refs, rep, ev, loads, from, to, tz, st, nm, key, picker }
  // picker: true — сверху кнопки «Итого / Дозатор 1 / Дозатор 2» (для бланка, где своего переключателя нет)
  function mount(el, ctx) {
    if (!el) return;
    ensureCss();
    const model = calc(ctx.refs, ctx.rep, ctx.ev, ctx.from, ctx.to, ctx.tz, ctx.st);
    const full = { ...ctx, model };
    const draw = () => {
      const key = full.key || 'all';
      const pk = ctx.picker ? `<div class="cs-tb" role="group" aria-label="Дозатор">${[['all', 'Итого'], ['1_10', 'Дозатор 1'], ['11_12', 'Дозатор 2']].map(([k, l]) => `<button type="button" data-k="${k}" class="${k === key ? 'on' : ''}">${l}</button>`).join('')}</div>` : '';
      el.innerHTML = pk + render(model, key);
    };
    draw();
    el.onclick = e => {
      const k = e.target.closest('[data-k]'); if (k && ctx.picker) { full.key = k.dataset.k; draw(); return; }
      const b = e.target.closest('[data-cs]'); if (!b) return;
      const c = ctx.refs.chemicals.find(z => +z.id === +b.dataset.cs); if (c) openDetail(c, full);
    };
    return model;
  }

  return { calc, totals, events, render, mount, loadTheory, both };
})();
if (typeof module !== 'undefined') module.exports = ChemStats;
