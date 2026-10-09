// Визуал панелей: анимированные стиральные машины (сотрудник) и контейнеры с химией (бригадир).
// Подключается в index.html после report-calc.js и leftover.js. Нужны глобальные sb (supabase) и addDaysISO (report-calc.js).
// Контейнер: уровень = ёмкость с момента последней замены (или подключённого остатка) минус расход по рецептам всех стирок после неё.
const Vis = (() => {
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const N = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('ru-RU');
  const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const safeUrl = u => /^https?:\/\/\S+$/i.test(String(u || '').trim()) ? String(u).trim().replace(/^http:\/\//i, 'https://') : '';
  const prim = c => (+c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null));
  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const conv = (c, v, from, to) => { if (from === to) return v; const d = dens(c); if (!d) return null; return from === 'l' ? v * d : v / d; };
  const U = p => p === 'l' ? 'л' : 'кг';
  const groupOf = m => (+m <= 10 ? '1_10' : '11_12');
  const GROUPS = [['1_10', 'Дозатор 1 · машины 1–10'], ['11_12', 'Дозатор 2 · машины 11–12']];

  function css() {
    if (document.getElementById('vis-css')) return;
    const s = document.createElement('style'); s.id = 'vis-css';
    s.textContent = `
/* ---------- стиральная машина ---------- */
.mc .mv{aspect-ratio:auto;justify-content:flex-start;padding:.7rem .4rem .6rem;gap:.35rem}
.wm{display:block;width:min(100%,8rem);height:auto;overflow:visible}
.wm-body{fill:#fff;stroke:var(--bd);stroke-width:2}
.wm-panel{fill:var(--sec)}
.wm-line{stroke:var(--bd);stroke-width:1.5}
.wm-n{font-family:Sora,Manrope,sans-serif;font-size:13px;font-weight:700;fill:var(--fg)}
.wm-disp{fill:#0e3440}
.wm-d{font-family:Sora,Manrope,sans-serif;font-size:10px;font-weight:700;fill:#8ff0ff}
.wm-led{fill:var(--mf);opacity:.35}
.wm-trk{fill:var(--bd)}.wm-prg{fill:var(--pri)}
.wm-ring{fill:#ebf5f6;fill:color-mix(in oklab,var(--pri) 10%,#fff);stroke:#98c5cc;stroke:color-mix(in oklab,var(--pri) 35%,var(--bd));stroke-width:5}
.wm-glass{fill:#f3f9fa;fill:color-mix(in oklab,var(--pri) 6%,#fff)}
.wm-holes{fill:none;stroke:#b8dae0;stroke:color-mix(in oklab,var(--pri) 35%,#fff);stroke-width:2.2;stroke-dasharray:1.5 7;stroke-linecap:round}
.wm-w1{fill:#7fbec9;fill:color-mix(in oklab,var(--pri) 62%,#fff);opacity:.8}
.wm-w2{fill:var(--pri);opacity:.35}
.wm-c1{fill:#a3d0d8;fill:color-mix(in oklab,var(--pri) 45%,#fff)}.wm-c2{fill:#f4b581}.wm-c3{fill:#fff;stroke:var(--bd);stroke-width:1}
.wm-bub{fill:#fff;opacity:0;stroke:#aed5dc;stroke:color-mix(in oklab,var(--pri) 40%,#fff);stroke-width:.8}
.wm-shine{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;opacity:.75}
.wm.on .wm-led{fill:#2fbf71;opacity:1;animation:wmb 1s steps(2,jump-none) infinite}
.wm.on .wm-b{animation:wmv .35s linear infinite}
.wm.on .wm-drum{transform-box:fill-box;transform-origin:center;animation:wmspin 3.4s linear infinite}
.wm.on .wm-w1{animation:wmw 1.3s linear infinite}
.wm.on .wm-w2{animation:wmw2 1.9s linear infinite}
.wm.on .wm-bub{animation:wmup 2.6s ease-in infinite}
.mc.on .mv{border-color:#88bec7;border-color:color-mix(in oklab,var(--pri) 45%,var(--bd))}
@keyframes wmspin{to{transform:rotate(360deg)}}
@keyframes wmw{to{transform:translateX(32px)}}
@keyframes wmw2{to{transform:translateX(-32px)}}
@keyframes wmv{0%{transform:translate(0,0)}25%{transform:translate(.6px,-.4px)}50%{transform:translate(-.5px,.4px)}75%{transform:translate(.4px,.5px)}100%{transform:translate(0,0)}}
@keyframes wmb{0%{opacity:1}50%{opacity:.25}}
@keyframes wmup{0%{transform:translateY(0);opacity:0}15%{opacity:.9}100%{transform:translateY(-44px);opacity:0}}

/* ---------- контейнер с химией ---------- */
.cng{display:grid;grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr));gap:.75rem}
.cn{--c:hsl(var(--h) 68% 54%);position:relative;display:flex;flex-direction:column;align-items:center;gap:.7rem;min-width:0;padding:1.5rem .75rem .9rem;border:1px solid var(--bd);border-bottom:3px solid var(--c);border-radius:var(--r);background:var(--card);box-shadow:0 1px 2px rgb(0 0 0/.05)}
.cn-vis{position:relative;display:flex;flex-direction:column;align-items:center;width:7.2rem;height:10.6rem}
.cn-cap{width:2.5rem;height:.7rem;border-radius:.25rem .25rem 0 0;background:hsl(var(--h) 45% 36%)}
.cn-neck{width:2.9rem;height:.55rem;border:2px solid #b8cdd3;border-bottom:0;background:#eef6f8}
.cn-body{position:relative;flex:1;width:100%;overflow:hidden;border:2px solid #b8cdd3;border-radius:1.2rem 1.2rem .8rem .8rem;background:linear-gradient(90deg,#f3fafb,#fff 40%,#e8f3f5)}
.cn-liq{position:absolute;left:0;right:0;bottom:0;height:0;background:var(--c);transition:height 1.8s cubic-bezier(.22,.7,.2,1)}
.cn-liq::before,.cn-liq::after{content:"";position:absolute;left:50%;top:-.7rem;width:15rem;height:15rem;margin-left:-7.5rem;border-radius:42%;background:var(--c);opacity:.5;animation:cnrot 7s linear infinite}
.cn-liq::after{border-radius:40%;opacity:.35;animation-duration:11s;animation-direction:reverse}
.cn-liq.z{opacity:0}
.cn-tk i{position:absolute;right:0;width:.5rem;height:2px;background:rgb(0 0 0/.2);z-index:2}
.cn-tk i:nth-child(1){bottom:25%}.cn-tk i:nth-child(2){bottom:50%}.cn-tk i:nth-child(3){bottom:75%}
.cn-lab{position:absolute;left:50%;top:50%;z-index:3;display:grid;place-items:center;width:68%;aspect-ratio:1/1.05;transform:translate(-50%,-50%);overflow:hidden;border-radius:.5rem;background:#fff;box-shadow:0 2px 8px rgb(0 0 0/.22)}
.cn-lab b{font-family:Sora,sans-serif;font-size:1.8rem;color:hsl(var(--h) 45% 32%)}
.cn-lab img{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;padding:.2rem;object-fit:contain;background:#fff}
.cn-sh{position:absolute;left:.35rem;top:.7rem;bottom:.8rem;z-index:4;width:.3rem;border-radius:99px;background:linear-gradient(#fffc,#fff3)}
.cn-pop{position:absolute;left:50%;top:-1.3rem;z-index:5;transform:translateX(-50%);font-family:Sora,sans-serif;font-size:.9rem;font-weight:700;white-space:nowrap;color:hsl(var(--h) 55% 38%);animation:cnpop 2.6s ease-out forwards;pointer-events:none}
.cn-in{display:grid;gap:.1rem;width:100%;text-align:center}
.cn-in b{font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-in strong{font-family:Sora,sans-serif;font-size:1.5rem;line-height:1.15;color:hsl(var(--h) 55% 34%)}
.cn-in small{font-size:.72rem;color:var(--mf)}
.cn-no{padding:.9rem 1rem;border:1px dashed var(--bd);border-radius:var(--r);font-size:.85rem;color:var(--mf)}
@keyframes cnrot{to{transform:rotate(360deg)}}
@keyframes cnpop{0%{opacity:0;transform:translate(-50%,.6rem)}15%{opacity:1}100%{opacity:0;transform:translate(-50%,-.9rem)}}
@media(prefers-reduced-motion:reduce){.wm *,.cn-liq,.cn-liq::before,.cn-liq::after,.cn-pop{animation:none!important}.cn-liq{transition:none}}`;
    document.head.appendChild(s);
  }

  // ---------- стиральная машина ----------
  const wavePath = (y, bottom) => { let d = `M-32 ${y}`; for (let x = -32; x < 140; x += 32) d += ' q8 -5 16 0 t16 0'; return d + ` V${bottom} H-32 Z`; };
  // m: { id, status: 'working'|'ready', left (мин), w: вид стирки }
  function machine(m) {
    css();
    const on = m.status === 'working', id = +m.id, num = String(id).padStart(2, '0');
    const total = +(m.w && m.w.minutes) || 0;
    const prog = on && total > 0 ? Math.min(1, Math.max(0, 1 - m.left / total)) : 0;
    const cp = 'wmc' + id;
    const inner = on ? `
      <g clip-path="url(#${cp})">
        <path class="wm-w2" d="${wavePath(70, 125)}"/><path class="wm-w1" d="${wavePath(67, 125)}"/>
        <g class="wm-drum" data-p="3.4"><circle cx="60" cy="86" r="26" fill="none"/>
          <circle class="wm-holes" cx="60" cy="86" r="22"/>
          <ellipse class="wm-c1" cx="48" cy="93" rx="10" ry="6.5" transform="rotate(-25 48 93)"/>
          <circle class="wm-c2" cx="71" cy="80" r="7.5"/>
          <rect class="wm-c3" x="55" y="98" width="15" height="9" rx="4" transform="rotate(20 62 102)"/></g>
        <circle class="wm-bub" cx="46" cy="112" r="2.2" data-p="2.6"/><circle class="wm-bub" cx="62" cy="116" r="1.6" data-p="2.6" style="animation-delay:-.9s"/>
        <circle class="wm-bub" cx="76" cy="112" r="2.6" data-p="2.6" style="animation-delay:-1.7s"/><circle class="wm-bub" cx="54" cy="118" r="1.4" data-p="2.6" style="animation-delay:-2.2s"/>
      </g>` : `
      <g clip-path="url(#${cp})"><circle class="wm-holes" cx="60" cy="86" r="22"/></g>`;
    return `<svg class="wm ${on ? 'on' : ''}" viewBox="0 0 120 140" aria-hidden="true" focusable="false">
      <defs><clipPath id="${cp}"><circle cx="60" cy="86" r="31"/></clipPath></defs>
      <g class="wm-b">
        <rect class="wm-body" x="6" y="4" width="108" height="130" rx="12"/>
        <path class="wm-panel" d="M7 34V16a11 11 0 0 1 11-11h84a11 11 0 0 1 11 11v18z"/>
        <line class="wm-line" x1="7" y1="34" x2="113" y2="34"/>
        <rect class="wm-trk" x="14" y="29" width="92" height="2.2" rx="1"/><rect class="wm-prg" x="14" y="29" width="${(92 * prog).toFixed(1)}" height="2.2" rx="1"/>
        <text class="wm-n" x="14" y="24">${num}</text><circle class="wm-led" cx="44" cy="17.5" r="2.6" data-p="1"/>
        <rect class="wm-disp" x="60" y="9" width="46" height="16" rx="3"/><text class="wm-d" x="83" y="21" text-anchor="middle">${on ? m.left + ' мин' : '—'}</text>
        <circle class="wm-ring" cx="60" cy="86" r="36"/><circle class="wm-glass" cx="60" cy="86" r="31"/>
        ${inner}
        <path class="wm-shine" d="M40 72a24 24 0 0 1 14-11"/>
        <rect x="18" y="130" width="12" height="4" rx="2" fill="var(--bd)"/><rect x="90" y="130" width="12" height="4" rx="2" fill="var(--bd)"/>
      </g></svg>`;
  }

  // ---------- уровни химии ----------
  const amt = (c, x) => {
    const p = prim(c);
    return p === 'l' ? (x.amount_l != null ? +x.amount_l : x.amount_kg != null ? conv(c, +x.amount_kg, 'kg', 'l') : null)
                     : (x.amount_kg != null ? +x.amount_kg : x.amount_l != null ? conv(c, +x.amount_l, 'l', 'kg') : null);
  };
  // последнее событие (замена бутыли или подключение остатка) по каждой паре «химия × дозатор»
  function lastEvents(refs, changes, connects) {
    const out = {};
    (refs.chemicals || []).filter(c => c.kind === 'main' && prim(c)).forEach(c => {
      GROUPS.forEach(([g]) => {
        const ev = [];
        (changes || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).forEach(x => ev.push({ k: 0, t: new Date(x.ts).getTime() || 0, x }));
        (connects || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).forEach(x => ev.push({ k: 1, t: new Date(x.ts).getTime() || 0, x }));
        ev.sort((a, b) => a.t - b.t || a.k - b.k);
        if (ev.length) out[c.id + ':' + g] = { ...ev[ev.length - 1], c, g };
      });
    });
    return out;
  }
  function levels(refs, d) {
    const rec = {}; (refs.recipes || []).forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
    const water = +refs.water || 55, res = [];
    Object.values(lastEvents(refs, d.changes, d.connects)).forEach(e => {
      const { c, g } = e, p = prim(c), size = p === 'l' ? +c.bottle_l : +c.bottle_kg;
      let cap = size;
      if (e.k === 1) { const a = amt(c, e.x); if (a > 0) cap = a; }
      let usedL = 0, n = 0;
      (d.loads || []).forEach(l => {
        if (groupOf(l.machine) !== g || (new Date(l.ts).getTime() || 0) <= e.t) return;
        n++; usedL += water * (rec[l.wash_type_id + ':' + c.id] || 0) / 1000;
      });
      const used = p === 'l' ? usedL : (conv(c, usedL, 'l', 'kg') ?? 0);
      const rem = Math.max(0, cap - used), pct = cap > 0 ? Math.min(100, rem / cap * 100) : 0;
      res.push({ c, g, p, cap, rem, pct, n, fromLeft: e.k === 1 });
    });
    return res.sort((a, b) => (a.c.sort ?? 0) - (b.c.sort ?? 0) || a.c.id - b.c.id);
  }

  // постраничная загрузка (в Supabase по умолчанию не больше 1000 строк за запрос)
  async function page(fn, args) {
    const out = [];
    for (let i = 0; i < 30; i++) {
      const r = await sb.rpc(fn, args).range(i * 1000, i * 1000 + 999);
      if (r.error) return { error: r.error, data: out };
      out.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    return { data: out };
  }
  // Нужны замены и подключения за 90 дней, а стирки — только начиная с последней замены
  async function fetchChem(refs, today) {
    const d1 = addDaysISO(today, -90);
    const [ch, cn] = await Promise.all([page('report_changes', { d1, d2: today }), page('report_connects', { d1, d2: today })]);
    if (ch.error) return { error: ch.error };
    const changes = ch.data, connects = cn.error ? [] : cn.data;
    let from = today;
    Object.values(lastEvents(refs, changes, connects)).forEach(e => { const sd = e.x.shift_date; if (sd && sd < from) from = sd; });
    const lo = await page('report_loads', { d1: from, d2: today });
    if (lo.error) return { error: lo.error };
    return { changes, connects, loads: lo.data };
  }

  // ---------- контейнеры ----------
  const prev = {};
  function card(L) {
    const { c } = L, img = safeUrl(c.image_url), key = c.id + ':' + L.g;
    return `<article class="cn" style="--h:${hue(c.name)}" data-k="${key}" data-to="${L.pct.toFixed(2)}" data-rem="${L.rem.toFixed(3)}" data-u="${U(L.p)}">
      <div class="cn-vis"><span class="cn-cap"></span><span class="cn-neck"></span>
        <div class="cn-body"><div class="cn-liq" style="height:${L.pct.toFixed(2)}%"></div>
          <span class="cn-tk"><i></i><i></i><i></i></span>
          <div class="cn-lab"><b><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h5v3h-5z"/><path d="M8.5 5.5h7l2 3.2v10.8a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8.7z"/><rect x="8.5" y="12" width="7" height="5" rx="1"/></svg></b>${img ? `<img src="${E(img)}" alt="${E(c.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
          <span class="cn-sh"></span></div></div>
      <div class="cn-in"><b>${E(c.name)}</b><strong>${N(L.rem)} ${U(L.p)}</strong>
        <small>из ${N(L.cap)} ${U(L.p)} · ${N(L.pct, 0)}%${L.fromLeft ? ' · подключён остаток' : ''}</small>
        <small>с замены: ${L.n} ${L.n % 10 === 1 && L.n % 100 !== 11 ? 'стирка' : (L.n % 10 >= 2 && L.n % 10 <= 4 && (L.n % 100 < 10 || L.n % 100 >= 20)) ? 'стирки' : 'стирок'}</small></div>
    </article>`;
  }
  function containersHtml(data, refs) {
    css();
    if (!data) return '';
    if (data.error) return '<p class="hint" style="margin:1rem 0 0">Контейнеры появятся после выполнения stage6.sql.</p>';
    const L = levels(refs, data);
    if (!L.length) return '<section aria-label="Контейнеры с химией"><p class="gl" style="color:var(--chd,inherit)">Контейнеры с химией</p><p class="cn-no">Контейнеры появятся после первой отметки замены химии.</p></section>';
    return `<section aria-label="Контейнеры с химией"><p class="gl" style="color:var(--chd,inherit)">Контейнеры с химией · остаток по рецептам</p>
      ${GROUPS.map(([g, t]) => { const items = L.filter(x => x.g === g); return items.length ? `<p class="gl" style="margin-top:.9rem">${t}</p><div class="cng">${items.map(card).join('')}</div>` : ''; }).join('')}
      <p class="hint" style="margin:.75rem 0 0">Уровень считается с момента последней замены: ёмкость минус расход по рецептам каждой стирки.</p></section>`;
  }

  // после вставки html: подхватить фазу анимации по часам (чтобы перерисовка не сбивала вращение) и плавно сменить уровень
  function after(root) {
    root.querySelectorAll('[data-p]').forEach(el => { const p = +el.dataset.p || 1, ph = -((Date.now() / 1000) % p); if (!el.style.animationDelay) el.style.animationDelay = ph.toFixed(2) + 's'; });
    root.querySelectorAll('.cn-liq,.cn-liq::before').forEach(() => {});
    root.querySelectorAll('.cn').forEach(el => {
      const k = el.dataset.k, to = +el.dataset.to, rem = +el.dataset.rem, liq = el.querySelector('.cn-liq'), was = prev[k];
      liq.classList.toggle('z', to <= 0.5);
      liq.style.height = (was ? was.pct : 0) + '%';        // первый показ: наполняется с нуля
      void liq.offsetHeight;
      requestAnimationFrame(() => { liq.style.height = to + '%'; });
      if (was && was.rem - rem >= 0.05) {
        const pop = document.createElement('span'); pop.className = 'cn-pop'; pop.textContent = '−' + N(was.rem - rem, 2) + ' ' + el.dataset.u;
        el.querySelector('.cn-vis').appendChild(pop); setTimeout(() => pop.remove(), 2700);
      }
      prev[k] = { pct: to, rem };
    });
    // фазы волн жидкости
    root.querySelectorAll('.cn-liq').forEach(l => { l.style.setProperty('--ph', 0); });
  }

  return { css, machine, fetchChem, levels, containersHtml, after };
})();
