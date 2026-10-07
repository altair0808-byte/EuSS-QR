// Анимация хранилища химии за смену (06:00→06:00) для вкладки «Химия». Данные реальные: стирки, замены, подключения, перемещения.
// Уровень = бутыль/подключённый остаток минус расход по рецептам; «забрал»/«залил» меняют уровень именно того дозатора.
const StorageAnim = (() => {
  const DEAD = 3, G = ['1_10', '11_12'], GN = ['1–10', '11–12'], MS = 864e5;
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = x => (Math.round(x * 10) / 10).toLocaleString('ru-RU'), T = x => new Date(x.ts).getTime() || 0, hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  async function page(fn, args) { const o = []; for (let i = 0; i < 30; i++) { const r = await sb.rpc(fn, args).range(i * 1000, i * 1000 + 999); if (r.error) return o; o.push(...(r.data || [])); if ((r.data || []).length < 1000) break; } return o; }
  const addD = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  let css = false;
  function addCss() { if (css) return; css = true; document.head.insertAdjacentHTML('beforeend', `<style>.sa{--w:#8aa}.sa .bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.5rem 0}.sa .clk{font:700 1.4rem/1 inherit;min-width:5ch}.sa .pg{flex:1;min-width:100px;height:6px;background:#8883;border-radius:3px;overflow:hidden}.sa .pg i{display:block;height:100%;background:#3b82f6;width:0}
.sa .row{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}@media(max-width:700px){.sa .row{grid-template-columns:1fr}}.sa .cd{border:1px solid #8885;border-radius:10px;padding:.6rem}.sa h4{margin:0 0 .4rem;font-size:.9rem}
.sa .tw{display:flex;gap:.7rem;align-items:flex-end}.sa .tk{position:relative;width:88px;height:190px;flex:none;border:2px solid #889;border-top-width:1px;border-radius:4px 4px 14px 14px;overflow:hidden;background:#8881}.sa .lq{position:absolute;left:0;right:0;bottom:0;transition:height .35s linear}.sa .dz{position:absolute;left:0;right:0;bottom:0;border-top:2px dashed #889;background:repeating-linear-gradient(135deg,transparent 0 5px,#8883 5px 7px)}
.sa .lv{position:absolute;top:5px;width:100%;text-align:center;font-weight:700;line-height:1.15}.sa .ct{display:flex;flex-direction:column;gap:.35rem;font-size:.8rem}.sa input[type=number]{width:64px}.sa .w{color:#c0392b;font-weight:600}.sa .tb{overflow-x:auto;margin-top:.6rem}.sa table{border-collapse:collapse;width:100%;font-size:.78rem;white-space:nowrap}.sa th,.sa td{padding:.25rem .5rem;text-align:right;border-bottom:1px solid #8883}.sa th:first-child,.sa td:first-child{text-align:left}
@keyframes saf{from{background:#f59e0b88}to{background:transparent}}.sa .fl{animation:saf 1.2s ease-out}@media(prefers-reduced-motion:reduce){.sa .lq{transition:none}.sa .fl{animation:none}}</style>`); }

  async function load(o) {
    const { refs, date } = o, d0 = Date.parse(date + 'T00:00:00Z') + (o.st - o.tz) * 3600e3, back = addD(date, -60);
    const [ch, cn, mv] = await Promise.all([page('report_changes', { d1: back, d2: date }), page('report_connects', { d1: back, d2: date }), page('report_moves', { d1: back, d2: date })]);
    const chems = (refs.chemicals || []).filter(c => c.kind === 'main' && +c.bottle_l > 0);
    // стирки нужны с момента последней замены до начала смены, иначе уровень на 06:00 неизвестен
    let from = date; chems.forEach(c => G.forEach(g => { const ev = [...ch, ...cn].filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g && T(x) < d0).sort((a, b) => T(a) - T(b)).pop(); if (ev && ev.shift_date < from) from = ev.shift_date; }));
    const loads = await page('report_loads', { d1: from, d2: date });
    return { d0, chems, ch, cn, mv, loads };
  }
  function model(o, D) {
    const rec = {}; (o.refs.recipes || []).forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
    const water = +o.refs.water || 55, ev = [];
    D.loads.forEach(l => ev.push({ t: T(l), r: 1, k: 'L', x: l })); D.ch.forEach(x => ev.push({ t: T(x), r: 2, k: 'C', x })); D.cn.forEach(x => ev.push({ t: T(x), r: 3, k: 'K', x })); D.mv.forEach(x => ev.push({ t: T(x), r: 0, k: 'M', x }));
    ev.sort((a, b) => a.t - b.t || a.r - b.r);
    const Z = () => D.chems.map(() => [0, 0]), S = { lvl: D.chems.map(() => [null, null]), pend: Z(), stock: D.chems.map(() => 0), cons: Z(), took: Z(), put: Z(), bot: Z(), flash: {} };
    const ix = id => D.chems.findIndex(c => +c.id === +id), a = x => +x.amount_l || 0;
    S.apply = (e, day) => {
      const x = e.x, gi = G.indexOf(x.machine_group || '1_10');
      if (e.k === 'L') { const g = +x.machine <= 10 ? 0 : 1; D.chems.forEach((c, i) => { const d = water * (rec[x.wash_type_id + ':' + c.id] || 0) / 1000; if (!d || S.lvl[i][g] == null) return; const u = Math.min(d, Math.max(0, S.lvl[i][g])); S.lvl[i][g] -= u; if (day) S.cons[i][g] += u; }); return; }
      const i = ix(x.chemical_id); if (i < 0) return;
      if (e.k === 'C') { S.lvl[i][gi] = S.pend[i][gi] > 0 ? S.pend[i][gi] : +D.chems[i].bottle_l; S.pend[i][gi] = 0; S.stock[i] += Math.max(0, +x.leftover_l || 0); if (day) { S.bot[i][gi]++; S.flash['b' + i + gi] = 1; } }
      else if (e.k === 'K') { S.pend[i][gi] += a(x); S.stock[i] = Math.max(0, S.stock[i] - a(x)); }
      else { const t = x.kind === 'take'; if (S.lvl[i][gi] == null) S.lvl[i][gi] = +D.chems[i].bottle_l; S.lvl[i][gi] = Math.max(0, S.lvl[i][gi] + (t ? -a(x) : a(x))); S.stock[i] = Math.max(0, S.stock[i] + (t ? a(x) : -a(x))); if (day) { (t ? S.took : S.put)[i][gi] += a(x); S.flash[(t ? 't' : 'p') + i + gi] = 1; } }
    };
    let k = 0; while (k < ev.length && ev[k].t < D.d0) S.apply(ev[k++], false);
    D.chems.forEach((c, i) => G.forEach((g, j) => { if (S.lvl[i][j] == null) S.lvl[i][j] = +c.bottle_l; }));   // дозатор без истории считаем полным
    S.ev = ev.slice(k).filter(e => e.t < D.d0 + MS); return S;
  }
  async function mount(el, o) {
    addCss(); el.className = 'sa'; el.innerHTML = '<p class="hint">Загружаю хранилище…</p>';
    let D, S, sel = 0, timer = 0;
    // текущий остаток: применяем все события до «сейчас» (для прошедшей смены — до её конца)
    const build = async () => { D = await load(o); S = model(o, D); const cut = Math.min(Date.now(), D.d0 + MS); S.ev.forEach(e => { if (e.t <= cut) S.apply(e, true); }); };
    await build();
    if (!D.chems.length) { el.innerHTML = '<p class="hint">Нет химии с объёмом бутыли в настройках.</p>'; return; }
    const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
    const V = (c, v) => { const d = dens(c); return `${f(v)} л${d ? ` · ${f(v * d)} кг` : ''}`; };          // литры и кг сразу
    const toL = (c, v, u) => u === 'kg' ? v / (dens(c) || 1) : v;
    const act = async (kind, g, amt, u) => { const c = D.chems[sel], l = toL(c, amt, u); if (!(l > 0)) { o.toast && o.toast('Укажите количество'); return; }
      const { error } = await sb.rpc('chem_move', { p_chemical: c.id, p_group: G[g], p_kind: kind, p_amount_l: Math.round(l * 1000) / 1000 });
      if (error) { o.toast && o.toast(error.message || 'Не удалось'); return; } await build(); draw(); o.toast && o.toast(kind === 'take' ? 'Остаток забран' : 'Залито в дозатор'); };
    const unit = id => `<select id="${id}"><option value="l">л</option>${dens(D.chems[sel]) ? '<option value="kg">кг</option>' : ''}</select>`;
    function draw() {
      const c = D.chems[sel], cap = +c.bottle_l, col = `hsl(${hue(c.name)} 70% 50%)`, d = dens(c);
      const fo = el.querySelector('input:focus,select:focus'); if (fo) return;
      const tank = (v, dz) => `<div class="tk"><div class="lq" style="height:${Math.min(100, v / cap * 100)}%;background:${col}"></div>${dz ? `<div class="dz" style="height:${DEAD / cap * 100}%"></div>` : ''}<div class="lv">${f(v)} л${d ? `<br><small>${f(v * d)} кг</small>` : ''}</div></div>`;
      const ctl = j => `<div class="ct"><span>Остаток сейчас <b>${V(c, S.lvl[sel][j])}</b></span><span>Расход за смену <b>${V(c, S.cons[sel][j])}</b></span><span>Забрано <b>−${V(c, S.took[sel][j])}</b></span><span>Залито <b>+${V(c, S.put[sel][j])}</b></span><span>Бутылей за смену <b>${S.bot[sel][j]}</b></span>${S.lvl[sel][j] <= DEAD + .02 ? '<span class="w">Трубка не достаёт: забрать остаток</span>' : ''}${o.can ? `<span><input type="number" id="a${j}" value="3" min="0.5" step="0.5"> ${unit('u' + j)} <button class="btn" data-m="take" data-g="${j}">Забрать остаток</button></span>` : ''}</div>`;
      el.innerHTML = `<div class="bar" data-r="tabs">${D.chems.map((x, n) => `<button class="btn" data-t="${n}" ${n === sel ? 'aria-pressed="true" style="font-weight:700;text-decoration:underline;border-left:5px solid hsl(' + hue(x.name) + ' 70% 50%)"' : 'style="border-left:5px solid hsl(' + hue(x.name) + ' 70% 50%)"'}>${E(x.name)}</button>`).join('')}</div>
        <div class="row">${[0, 1].map(j => `<div class="cd"><h4>Дозатор ${GN[j]}</h4><div class="tw">${tank(S.lvl[sel][j], 1)}${ctl(j)}</div></div>`).join('')}
        <div class="cd"><h4>Запас бригадира</h4><div class="tw">${tank(S.stock[sel], 0)}<div class="ct"><span>В запасе <b>${V(c, S.stock[sel])}</b></span>${o.can ? `<span><select id="tg"><option value="0">в дозатор 1–10</option><option value="1">в дозатор 11–12</option></select></span><span><input type="number" id="as" value="6" min="0.5" step="0.5"> ${unit('us')} <button class="btn" data-m="pour">Залить</button></span>` : ''}</div></div></div></div>
        <div class="tb"><table><tr><th>Химикат</th>${GN.map(n => `<th>Дозатор ${n}: остаток</th>`).join('')}<th>Запас</th></tr>${D.chems.map(x => `<tr><td>${E(x.name)}</td>${[0, 1].map(j => `<td><b>${V(x, S.lvl[D.chems.indexOf(x)][j])}</b></td>`).join('')}<td><b>${V(x, S.stock[D.chems.indexOf(x)])}</b></td></tr>`).join('')}</table></div>
        <p class="hint">Остаток считается по рецептам от последней замены бутыли с учётом «забрано» и «залито». Обновляется раз в минуту. Кг = литры × плотность из настроек химии.</p>`;
    }
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t != null) { sel = +b.dataset.t; draw(); }
      else if (b.dataset.m === 'take') { const g = +b.dataset.g; act('take', g, +el.querySelector('#a' + g).value, el.querySelector('#u' + g).value); }
      else if (b.dataset.m === 'pour') act('pour', +el.querySelector('#tg').value, +el.querySelector('#as').value, el.querySelector('#us').value); };
    draw();
    clearInterval(el._sa); el._sa = setInterval(async () => { if (!el.isConnected) return clearInterval(el._sa); try { await build(); draw(); } catch (e) {} }, 60000);
  }
  return { mount };
})();
