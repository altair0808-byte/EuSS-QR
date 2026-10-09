// Анимация хранилища химии за смену (06:00→06:00) для вкладки «Химия». Данные реальные: стирки, замены, подключения, перемещения.
// Уровень = бутыль/подключённый остаток минус расход по рецептам; «забрал»/«залил» меняют уровень именно того дозатора.
const StorageAnim = (() => {
  const DEAD = 3, G = ['1_10', '11_12'], GN = ['1–10', '11–12'], MS = 864e5;
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = x => Num.fmt(+x || 0), T = x => new Date(x.ts).getTime() || 0, hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  async function page(fn, args) { const o = []; for (let i = 0; i < 30; i++) { const r = await sb.rpc(fn, args).range(i * 1000, i * 1000 + 999); if (r.error) return o; o.push(...(r.data || [])); if ((r.data || []).length < 1000) break; } return o; }
  const addD = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  let css = false;
  function addCss() { if (css) return; css = true; document.head.insertAdjacentHTML('beforeend', `<style>.sa{--w:#8aa}.sa .sa-bar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.5rem 0}.sa .sa-clk{font:700 1.4rem/1 inherit;min-width:5ch}.sa .sa-pg{flex:1;min-width:100px;height:6px;background:#8883;border-radius:3px;overflow:hidden}.sa .sa-pg i{display:block;height:100%;background:#3b82f6;width:0}
.sa .sa-row{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem}@media(max-width:700px){.sa .sa-row{grid-template-columns:1fr}}.sa .sa-cd{border:1px solid #8885;border-radius:10px;padding:.6rem}.sa h4{margin:0 0 .4rem;font-size:.9rem}
.sa .sa-tw{display:flex;gap:.7rem;align-items:flex-end}.sa .sa-tk{position:relative;width:88px;height:190px;flex:none;border:2px solid #889;border-top-width:1px;border-radius:4px 4px 14px 14px;overflow:hidden;background:#8881}.sa .sa-lq{position:absolute;left:0;right:0;bottom:0;transition:height .35s linear}.sa .sa-dz{position:absolute;left:0;right:0;bottom:0;border-top:2px dashed #889;background:repeating-linear-gradient(135deg,transparent 0 5px,#8883 5px 7px)}
.sa .sa-lv{position:absolute;top:5px;width:100%;text-align:center;font-weight:700;line-height:1.15}.sa .sa-ct{display:flex;flex-direction:column;gap:.35rem;font-size:.8rem}.sa input[type=number]{width:64px}.sa .sa-w{color:#c0392b;font-weight:600}.sa .sa-tb{overflow-x:auto;margin-top:.6rem}.sa table{border-collapse:collapse;width:100%;font-size:.78rem;white-space:nowrap}.sa th,.sa td{padding:.25rem .5rem;text-align:right;border-bottom:1px solid #8883}.sa th:first-child,.sa td:first-child{text-align:left}
@keyframes saf{from{background:#f59e0b88}to{background:transparent}}.sa .fl{animation:saf 1.2s ease-out}@media(prefers-reduced-motion:reduce){.sa .sa-lq{transition:none}.sa .fl{animation:none}}</style>`); }

  async function load(o) {
    const { refs, date } = o, d0 = Date.parse(date + 'T00:00:00Z') + (o.st - o.tz) * 3600e3, back = addD(date, -60);
    const [ch, cn, mv, lv] = await Promise.all([page('report_changes', { d1: back, d2: date }), page('report_connects', { d1: back, d2: date }), page('report_moves', { d1: back, d2: date }), page('report_levels', { d1: back, d2: date })]);   // report_levels: stage12.sql, без него пусто
    const chems = (refs.chemicals || []).filter(c => c.kind === 'main' && +c.bottle_l > 0);
    // стирки нужны с момента последней замены до начала смены, иначе уровень на 06:00 неизвестен
    let from = date; chems.forEach(c => G.forEach(g => { const ev = [...ch, ...cn, ...lv].filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g && T(x) < d0).sort((a, b) => T(a) - T(b)).pop(); if (ev && ev.shift_date < from) from = ev.shift_date; }));
    const loads = await page('report_loads', { d1: from, d2: date });
    // общий запас по всей истории (stage19.sql); для прошлой смены и без stage19 остаётся расчёт по событиям за 60 дней
    const sn = await sb.rpc('stock_now').then(r => r.error ? null : (r.data || []), () => null);
    return { d0, chems, ch, cn, mv, lv, loads, sn };
  }
  function model(o, D) {
    const rec = {}; (o.refs.recipes || []).forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
    const water = +o.refs.water || 55, ev = [];
    D.loads.forEach(l => ev.push({ t: T(l), r: 1, k: 'L', x: l })); D.ch.forEach(x => ev.push({ t: T(x), r: 2, k: 'C', x })); D.cn.forEach(x => ev.push({ t: T(x), r: 3, k: 'K', x })); D.mv.forEach(x => ev.push({ t: T(x), r: 0, k: 'M', x })); D.lv.forEach(x => ev.push({ t: T(x), r: 4, k: 'S', x }));
    ev.sort((a, b) => a.t - b.t || a.r - b.r);
    const Z = () => D.chems.map(() => [0, 0]), S = { lvl: D.chems.map(() => [null, null]), pend: Z(), stock: D.chems.map(() => 0), recv: D.chems.map(() => 0), wo: D.chems.map(() => 0), cons: Z(), took: Z(), put: Z(), added: Z(), bot: Z(), flash: {} };
    const ix = id => D.chems.findIndex(c => +c.id === +id), a = x => +x.amount_l || 0;
    S.apply = (e, day) => {
      const x = e.x, gi = G.indexOf(x.machine_group || '1_10');   // у поступления и списания группа 'stock' (gi = -1), их обрабатывает ветка ниже
      if (e.k === 'L') { const g = +x.machine <= 10 ? 0 : 1; D.chems.forEach((c, i) => { const d = water * (rec[x.wash_type_id + ':' + c.id] || 0) / 1000; if (!d || S.lvl[i][g] == null) return; const u = Math.min(d, Math.max(0, S.lvl[i][g])); S.lvl[i][g] -= u; if (day) S.cons[i][g] += u; }); return; }
      const i = ix(x.chemical_id); if (i < 0) return;
      if (e.k === 'C') { S.lvl[i][gi] = S.pend[i][gi] > 0 ? S.pend[i][gi] : +D.chems[i].bottle_l; S.pend[i][gi] = 0; S.stock[i] += x.written_off_at ? 0 : Math.max(0, +x.leftover_l || 0); if (day) { S.bot[i][gi]++; S.flash['b' + i + gi] = 1; } }
      else if (e.k === 'S') { S.lvl[i][gi] = a(x); S.pend[i][gi] = 0; }   // «в дозаторе было X» на момент x.ts: дальше стирки вычитаются сами
      else if (e.k === 'K') { S.pend[i][gi] += a(x); S.stock[i] = Math.max(0, S.stock[i] - a(x)); }
      else if (x.kind === 'receipt' || x.kind === 'writeoff') {   // общий запас: дозаторы не трогает
        const r = x.kind === 'receipt'; S.stock[i] = Math.max(0, S.stock[i] + (r ? a(x) : -a(x)));
        if (day) { (r ? S.recv : S.wo)[i] += a(x); S.flash[(r ? 'r' : 'w') + i] = 1; } }
      else { const t = x.kind === 'take', ad = x.kind === 'add'; if (S.lvl[i][gi] == null) S.lvl[i][gi] = +D.chems[i].bottle_l; S.lvl[i][gi] = Math.max(0, S.lvl[i][gi] + (t ? -a(x) : a(x)));
        if (!ad) S.stock[i] = Math.max(0, S.stock[i] + (t ? a(x) : -a(x)));            // «добавил суперадмин» запас бригадира не трогает
        if (day) { (ad ? S.added : t ? S.took : S.put)[i][gi] += a(x); S.flash[(ad ? 'a' : t ? 't' : 'p') + i + gi] = 1; } }
    };
    let k = 0; while (k < ev.length && ev[k].t < D.d0) S.apply(ev[k++], false);
    D.chems.forEach((c, i) => G.forEach((g, j) => { if (S.lvl[i][j] == null) S.lvl[i][j] = +c.bottle_l; }));   // дозатор без истории считаем полным
    S.ev = ev.slice(k).filter(e => e.t < D.d0 + MS); return S;
  }
  async function mount(el, o) {
    addCss(); el.className = 'sa'; el.innerHTML = '<p class="hint">Загружаю хранилище…</p>';
    let D, S, sel = 0, timer = 0;
    // текущий остаток: применяем все события до «сейчас» (для прошедшей смены — до её конца)
    const build = async () => { D = await load(o); S = model(o, D); const cut = Math.min(Date.now(), D.d0 + MS); S.ev.forEach(e => { if (e.t <= cut) S.apply(e, true); });
      if (D.sn && Date.now() < D.d0 + MS) D.chems.forEach((c, i) => { const r = D.sn.find(x => +x.chemical_id === +c.id); if (r && r.stock_l != null) S.stock[i] = Math.max(0, +r.stock_l); }); };   // текущая смена: точный общий запас из базы
    await build();
    if (!D.chems.length) { el.innerHTML = '<p class="hint">Нет химии с объёмом бутыли в настройках.</p>'; return; }
    const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
    const V = (c, v) => { const d = dens(c); return `${f(v)} л${d ? ` · ${f(v * d)} кг` : ''}`; };          // литры и кг сразу
    const toL = (c, v, u) => u === 'kg' ? v / (dens(c) || 1) : v;
    const act = async (kind, g, amt, u) => { const c = D.chems[sel], l = toL(c, amt, u); if (!(l > 0)) { o.toast && o.toast('Укажите количество'); return; }
      const { error } = await sb.rpc('chem_move', { p_chemical: c.id, p_group: G[g], p_kind: kind, p_amount_l: Num.clean(l) });   // без округления до 3 знаков: 0,175 кг не превращается в 0,1749
      if (error) { o.toast && o.toast(error.message || 'Не удалось'); return; } await build(); draw(); o.toast && o.toast(kind === 'take' ? 'Остаток забран' : 'Залито в дозатор'); };
    const unit = id => `<select id="${id}"><option value="l">л</option>${dens(D.chems[sel]) ? '<option value="kg">кг</option>' : ''}</select>`;
    const conv = () => { const c = D.chems[sel], d = dens(c); el.querySelectorAll && el.querySelectorAll('output.cv').forEach(o => {
      const a = el.querySelector('#' + o.dataset.a), u = el.querySelector('#' + o.dataset.u); if (!a || !u) return;
      const v = parseFloat(String(a.value).replace(',', '.'));
      o.textContent = d && isFinite(v) && a.value !== '' ? '≈ ' + f(u.value === 'kg' ? v / d : v * d) + (u.value === 'kg' ? ' л' : ' кг') : ''; }); };
    el.oninput = el.onchange = conv;
    // окно «Указать реальный уровень»: сколько было в дозаторе на момент X (до стирок), дальше стирки вычитаются сами
    const loc = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    function levelPanel(j) {
      const c = D.chems[sel], d = dens(c), g = G[j], last = [...D.ch, ...D.cn].filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).map(T).sort((a, b) => a - b).pop();
      const now = Date.now(), def = Math.min(now, last || D.d0), ov = document.createElement('div');
      let exact = def;   // точный момент в мс; поле datetime-local режет секунды и уводило уровень раньше замены
      ov.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgb(0 0 0/.35);padding:1rem';
      ov.innerHTML = `<section role="dialog" aria-modal="true" style="background:#fff;color:#123;border-radius:.75rem;max-width:26rem;width:100%;padding:1.1rem;max-height:92vh;max-height:92dvh;overflow:auto;box-shadow:0 20px 50px rgb(0 0 0/.3)">
        <h3 style="margin:0 0 .3rem">${E(c.name)} · дозатор ${GN[j]}</h3>
        <p class="hint" style="margin:0 0 .7rem">Сколько в дозаторе было на выбранный момент (до стирок). Все стирки после него система вычтет сама, и покажет реальный остаток.</p>
        <label style="display:block;font-weight:600;margin-bottom:.2rem">Сколько было</label>
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap"><input id="lv-a" type="number" min="0" step="any" inputmode="decimal" style="width:6.5rem" placeholder="0">
          <select id="lv-u"><option value="l">л</option>${d ? '<option value="kg">кг</option>' : ''}</select><output id="lv-cv" class="cv"></output></div>
        <label style="display:block;font-weight:600;margin:.8rem 0 .2rem">На какой момент</label>
        <input id="lv-t" type="datetime-local" value="${loc(def)}" max="${loc(now)}" style="max-width:100%">
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem"><button type="button" class="btn" data-p="${last ? last : ''}" ${last ? '' : 'hidden'}>С последней замены</button><button type="button" class="btn" data-p="${Math.min(now, D.d0)}">С начала смены</button></div>
        <p id="lv-h" class="hint" style="margin:.6rem 0 0"></p>
        <div style="display:flex;gap:.5rem;margin-top:.9rem"><button type="button" class="btn" id="lv-ok" style="font-weight:700">Сохранить</button><button type="button" class="btn" id="lv-no">Отмена</button></div></section>`;
      document.body.appendChild(ov);
      const $ = q => ov.querySelector(q), close = () => { ov.remove(); document.removeEventListener('keydown', esc); }, esc = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc); ov.onmousedown = e => { if (e.target === ov) close(); }; $('#lv-no').onclick = close;
      const atMs = () => exact != null ? exact : new Date($('#lv-t').value).getTime();
      const upd = () => { const v = parseFloat($('#lv-a').value.replace(',', '.')), kg = $('#lv-u').value === 'kg', at = atMs();
        $('#lv-cv').textContent = d && isFinite(v) ? '≈ ' + f(kg ? v / d : v * d) + (kg ? ' л' : ' кг') : '';
        $('#lv-h').textContent = last && at < last ? 'Этот момент раньше последней замены бутыли: замена сбрасывает уровень, поэтому текущий остаток это не изменит.' : ''; };
      ov.oninput = ov.onchange = e => { if (e && e.target && e.target.id === 'lv-t') exact = null; upd(); }; upd();
      ov.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { exact = +b.dataset.p; $('#lv-t').value = loc(exact); upd(); });
      $('#lv-ok').onclick = async () => {
        const v = parseFloat($('#lv-a').value.replace(',', '.')), kg = $('#lv-u').value === 'kg', at = atMs();
        if (!isFinite(v) || v < 0) { o.toast && o.toast('Укажите, сколько было'); return; }
        if (!isFinite(at) || at > Date.now() + 3e5) { o.toast && o.toast('Выберите момент не позже текущего'); return; }
        const b = $('#lv-ok'); b.disabled = true;
        const { error } = await sb.rpc('set_dispenser_level', { p_chemical: +c.id, p_group: g, p_at: new Date(at).toISOString(), p_amount_l: kg ? null : v, p_amount_kg: kg ? v : null });
        if (error) { o.toast && o.toast(/set_dispenser_level/.test(error.message || '') ? 'Выполните stage12.sql в Supabase' : (error.message || 'Не удалось')); b.disabled = false; return; }
        close(); await build(); draw(); o.toast && o.toast('Уровень учтён, стирки вычтены');
      };
    }
    // окно «Добавить химию» (только суперадмин): любое количество, не обязательно целая бутыль
    function addPanel(j) {
      const c = D.chems[sel], d = dens(c), g = G[j], cap = +c.bottle_l, cur = S.lvl[sel][j], ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgb(0 0 0/.35);padding:1rem';
      ov.innerHTML = `<section role="dialog" aria-modal="true" style="background:#fff;color:#123;border-radius:.75rem;max-width:26rem;width:100%;padding:1.1rem;max-height:92vh;max-height:92dvh;overflow:auto;box-shadow:0 20px 50px rgb(0 0 0/.3)">
        <p class="hint" style="margin:0;font-weight:800;text-transform:uppercase;font-size:.7rem">Только суперадмин</p>
        <h3 style="margin:.15rem 0 .3rem">Добавить химию · ${E(c.name)} · дозатор ${GN[j]}</h3>
        <p class="hint" style="margin:0 0 .7rem">Укажите любое количество, не обязательно целая бутыль. Оно запишется как поступление в запас и сразу зальётся в этот дозатор: уровень дозатора вырастет, общий запас не изменится.</p>
        <label style="display:block;font-weight:600;margin-bottom:.2rem">Сколько добавить</label>
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap"><input id="ad-a" type="number" min="0" step="any" inputmode="decimal" style="width:7rem" placeholder="0">
          <select id="ad-u"><option value="l">л</option>${d ? '<option value="kg">кг</option>' : ''}</select><output id="ad-cv" class="cv"></output></div>
        <p id="ad-h" class="hint" style="margin:.6rem 0 0"></p>
        <div style="display:flex;gap:.5rem;margin-top:.9rem"><button type="button" class="btn" id="ad-ok" style="font-weight:700" disabled>Добавить</button><button type="button" class="btn" id="ad-no">Отмена</button></div></section>`;
      document.body.appendChild(ov);
      const $ = q => ov.querySelector(q), close = () => { ov.remove(); document.removeEventListener('keydown', esc); }, esc = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc); ov.onmousedown = e => { if (e.target === ov) close(); }; $('#ad-no').onclick = close;
      const amountL = () => { const v = Num.parse($('#ad-a').value); if (!isFinite(v) || !(v > 0)) return NaN; return $('#ad-u').value === 'kg' ? (d ? v / d : NaN) : v; };
      const upd = () => {
        const v = Num.parse($('#ad-a').value), kg = $('#ad-u').value === 'kg', l = amountL();
        $('#ad-cv').textContent = d && isFinite(v) ? '≈ ' + Num.fmt(kg ? v / d : v * d) + (kg ? ' л' : ' кг') : '';
        $('#ad-ok').disabled = !(l > 0);
        $('#ad-h').textContent = l > 0 ? `Сейчас в дозаторе ${V(c, cur)}. Станет ${V(c, cur + l)}${cur + l > cap + 1e-9 ? ` (больше полной бутыли ${f(cap)} л, проверьте)` : ''}.` : `Сейчас в дозаторе ${V(c, cur)}.`;
        $('#ad-ok').textContent = l > 0 ? 'Добавить ' + Num.fmt(v) + (kg ? ' кг' : ' л') : 'Добавить';
      };
      ov.oninput = ov.onchange = upd; upd(); $('#ad-a').focus();
      $('#ad-ok').onclick = async () => {
        const v = Num.parse($('#ad-a').value), kg = $('#ad-u').value === 'kg';
        if (!(amountL() > 0)) { o.toast && o.toast('Укажите количество больше нуля'); return; }
        const b = $('#ad-ok'); b.disabled = true;
        const { error } = await sb.rpc('chem_add', { p_chemical: +c.id, p_group: g, p_amount_l: kg ? null : Num.clean(v), p_amount_kg: kg ? Num.clean(v) : null });
        if (error) { o.toast && o.toast(/chem_add|chem_receipt/.test(error.message || '') ? 'Выполните stage19.sql в Supabase' : (error.message || 'Не удалось')); b.disabled = false; return; }
        close(); await build(); draw(); o.toast && o.toast('Добавлено в дозатор ' + GN[j] + ': ' + Num.fmt(v) + (kg ? ' кг' : ' л'));
      };
    }
    // окно «Поступление»: химия приходит в общий запас; при желании сразу заливается в дозатор
    function overlay(html) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgb(0 0 0/.35);padding:1rem';
      ov.innerHTML = `<section role="dialog" aria-modal="true" style="background:#fff;color:#123;border-radius:.75rem;max-width:26rem;width:100%;padding:1.1rem;max-height:92vh;max-height:92dvh;overflow:auto;box-shadow:0 20px 50px rgb(0 0 0/.3)">${html}</section>`;
      document.body.appendChild(ov);
      const close = () => { ov.remove(); document.removeEventListener('keydown', esc); }, esc = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', esc); ov.onmousedown = e => { if (e.target === ov) close(); };
      return { ov, close, $: q => ov.querySelector(q) };
    }
    function receiptPanel() {
      const c = D.chems[sel], d = dens(c), k = sel;
      const { ov, close, $ } = overlay(`<h3 style="margin:0 0 .3rem">Поступление · ${E(c.name)}</h3>
        <p class="hint" style="margin:0 0 .7rem">Химия попадает в общий запас. Потом её можно залить в дозатор кнопкой «Залить» или сразу здесь.</p>
        <label style="display:block;font-weight:600;margin-bottom:.2rem">Сколько поступило</label>
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap"><input id="rc-a" type="number" min="0" step="any" inputmode="decimal" style="width:7rem" placeholder="0">
          <select id="rc-u"><option value="l">л</option>${d ? '<option value="kg">кг</option>' : ''}</select><output id="rc-cv" class="cv"></output></div>
        <label style="display:block;font-weight:600;margin:.8rem 0 .2rem">Сразу залить в дозатор</label>
        <select id="rc-g"><option value="">нет, оставить в запасе</option><option value="0">дозатор 1–10</option><option value="1">дозатор 11–12</option></select>
        <label style="display:block;font-weight:600;margin:.8rem 0 .2rem">Примечание (накладная, поставщик)</label>
        <input id="rc-n" type="text" maxlength="300" style="width:100%" placeholder="необязательно">
        <p id="rc-h" class="hint" style="margin:.6rem 0 0"></p>
        <div style="display:flex;gap:.5rem;margin-top:.9rem"><button type="button" class="btn" id="rc-ok" style="font-weight:700" disabled>Принять</button><button type="button" class="btn" id="rc-no">Отмена</button></div>`);
      $('#rc-no').onclick = close;
      const amountL = () => { const v = Num.parse($('#rc-a').value); if (!isFinite(v) || !(v > 0)) return NaN; return $('#rc-u').value === 'kg' ? (d ? v / d : NaN) : v; };
      const upd = () => { const v = Num.parse($('#rc-a').value), kg = $('#rc-u').value === 'kg', l = amountL();
        $('#rc-cv').textContent = d && isFinite(v) ? '≈ ' + Num.fmt(kg ? v / d : v * d) + (kg ? ' л' : ' кг') : '';
        $('#rc-ok').disabled = !(l > 0);
        $('#rc-h').textContent = l > 0 ? `Сейчас в запасе ${V(c, S.stock[k])}. ${$('#rc-g').value === '' ? 'Станет ' + V(c, S.stock[k] + l) + '.' : 'Всё поступившее сразу уйдёт в дозатор, запас не изменится.'}` : `Сейчас в запасе ${V(c, S.stock[k])}.`; };
      ov.oninput = ov.onchange = upd; upd(); $('#rc-a').focus();
      $('#rc-ok').onclick = async () => {
        const v = Num.parse($('#rc-a').value), kg = $('#rc-u').value === 'kg', gv = $('#rc-g').value;
        if (!(amountL() > 0)) { o.toast && o.toast('Укажите количество больше нуля'); return; }
        const b = $('#rc-ok'); b.disabled = true;
        const { error } = await sb.rpc('chem_receipt', { p_chemical: +c.id, p_amount_l: kg ? null : Num.clean(v), p_amount_kg: kg ? Num.clean(v) : null, p_note: $('#rc-n').value.trim() || null, p_pour_group: gv === '' ? null : G[+gv] });
        if (error) { o.toast && o.toast(/chem_receipt/.test(error.message || '') ? 'Выполните stage19.sql в Supabase' : (error.message || 'Не удалось')); b.disabled = false; return; }
        close(); await build(); draw(); o.toast && o.toast('Принято: ' + Num.fmt(v) + (kg ? ' кг' : ' л') + (gv === '' ? ' в запас' : ' в дозатор ' + GN[+gv]));
      };
    }
    // окно «Списать из запаса» (только суперадмин, с паролем): уменьшает запас, расход периода не меняет
    function writeoffPanel() {
      const c = D.chems[sel], d = dens(c), k = sel;
      const { ov, close, $ } = overlay(`<p class="hint" style="margin:0;font-weight:800;text-transform:uppercase;font-size:.7rem">Только суперадмин</p>
        <h3 style="margin:.15rem 0 .3rem">Списать из запаса · ${E(c.name)}</h3>
        <p class="hint" style="margin:0 0 .7rem">Списание уменьшает общий запас и попадает в отчёты. Больше, чем есть в запасе, списать нельзя.</p>
        <label style="display:block;font-weight:600;margin-bottom:.2rem">Сколько списать</label>
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap"><input id="wo-a" type="number" min="0" step="any" inputmode="decimal" style="width:7rem" placeholder="0">
          <select id="wo-u">${d ? '<option value="kg">кг</option>' : ''}<option value="l">л</option></select><output id="wo-cv" class="cv"></output></div>
        <label style="display:block;font-weight:600;margin:.8rem 0 .2rem">Причина</label>
        <input id="wo-n" type="text" maxlength="300" style="width:100%" placeholder="например: просрочено, разлито">
        <label style="display:block;font-weight:600;margin:.8rem 0 .2rem">Ваш пароль</label>
        <input id="wo-p" type="text" class="pwm" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore style="width:100%">
        <p id="wo-h" class="hint" style="margin:.6rem 0 0"></p>
        <div style="display:flex;gap:.5rem;margin-top:.9rem"><button type="button" class="btn" id="wo-ok" style="font-weight:700" disabled>Списать</button><button type="button" class="btn" id="wo-no">Отмена</button></div>`);
      $('#wo-no').onclick = close;
      const amountKg = () => { const v = Num.parse($('#wo-a').value); if (!isFinite(v) || !(v > 0)) return NaN; return $('#wo-u').value === 'kg' ? v : (d ? v * d : NaN); };
      const upd = () => { const v = Num.parse($('#wo-a').value), kg = $('#wo-u').value === 'kg', a = amountKg(), have = S.stock[k] * (d || 1);
        $('#wo-cv').textContent = d && isFinite(v) ? '≈ ' + Num.fmt(kg ? v / d : v * d) + (kg ? ' л' : ' кг') : '';
        const over = a > have + 1e-9;
        $('#wo-ok').disabled = !(a > 0) || over || !$('#wo-n').value.trim() || !$('#wo-p').value;
        $('#wo-h').textContent = over ? `В запасе только ${V(c, S.stock[k])}.` : a > 0 ? `Сейчас в запасе ${V(c, S.stock[k])}. Станет ${V(c, S.stock[k] - a / (d || 1))}.` : `Сейчас в запасе ${V(c, S.stock[k])}.`; };
      ov.oninput = ov.onchange = upd; upd(); $('#wo-a').focus();
      $('#wo-ok').onclick = async () => {
        const a = amountKg(); if (!(a > 0)) { o.toast && o.toast('Укажите количество больше нуля'); return; }
        const b = $('#wo-ok'); b.disabled = true;
        const { data, error } = await sb.rpc('stock_writeoff', { p_chemical: +c.id, p_amount_kg: Num.clean(a), p_pw: $('#wo-p').value, p_note: $('#wo-n').value.trim() });
        if (error || !data || data.ok === false) { o.toast && o.toast(error ? (/stock_writeoff/.test(error.message || '') ? 'Выполните stage19.sql в Supabase' : (error.message || 'Не удалось')) : (data && data.error) || 'Не удалось'); b.disabled = false; return; }
        close(); await build(); draw(); o.toast && o.toast('Списано из запаса: ' + Num.fmt(a) + ' кг');
      };
    }
    function draw() {
      const c = D.chems[sel], cap = +c.bottle_l, col = `hsl(${hue(c.name)} 70% 50%)`, d = dens(c);
      const fo = el.querySelector('input:focus,select:focus'); if (fo) return;
      const tank = (v, dz) => `<div class="sa-tk"><div class="sa-lq" style="height:${Math.min(100, v / cap * 100)}%;background:${col}"></div>${dz ? `<div class="sa-dz" style="height:${DEAD / cap * 100}%"></div>` : ''}<div class="sa-lv">${f(v)} л${d ? `<br><small>${f(v * d)} кг</small>` : ''}</div></div>`;
      const ctl = j => `<div class="sa-ct"><span>Остаток сейчас <b>${V(c, S.lvl[sel][j])}</b></span><span>Расход за смену <b>${V(c, S.cons[sel][j])}</b></span><span>Забрано <b>−${V(c, S.took[sel][j])}</b></span><span>Залито <b>+${V(c, S.put[sel][j])}</b></span>${S.added[sel][j] > 0 ? `<span>Добавлено суперадмином <b>+${V(c, S.added[sel][j])}</b></span>` : ''}<span>Бутылей за смену <b>${S.bot[sel][j]}</b></span>${S.lvl[sel][j] <= DEAD + .02 ? '<span class="sa-w">Трубка не достаёт: забрать остаток</span>' : ''}${o.can ? `<span><input type="number" id="a${j}" value="3" min="0" step="any" inputmode="decimal"> ${unit('u' + j)} <output class="cv" data-a="a${j}" data-u="u${j}"></output> <button class="btn" data-m="take" data-g="${j}">Забрать остаток</button></span><span><button class="btn" data-m="lvl" data-g="${j}">Указать реальный уровень</button></span>` : ''}${o.isSuper ? `<span><button class="btn" data-m="add" data-g="${j}">Добавить химию</button></span>` : ''}</div>`;
      el.innerHTML = `<div class="sa-bar" data-r="tabs">${D.chems.map((x, n) => `<button class="btn" data-t="${n}" ${n === sel ? 'aria-pressed="true" style="font-weight:700;text-decoration:underline;border-left:5px solid hsl(' + hue(x.name) + ' 70% 50%)"' : 'style="border-left:5px solid hsl(' + hue(x.name) + ' 70% 50%)"'}>${E(x.name)}</button>`).join('')}</div>
        <div class="sa-row">${[0, 1].map(j => `<div class="sa-cd"><h4>Дозатор ${GN[j]}</h4><div class="sa-tw">${tank(S.lvl[sel][j], 1)}${ctl(j)}</div></div>`).join('')}
        <div class="sa-cd"><h4>Общий запас</h4><div class="sa-tw">${tank(S.stock[sel], 0)}<div class="sa-ct"><span>В запасе <b>${V(c, S.stock[sel])}</b></span><span>Всего с дозаторами <b>${V(c, S.stock[sel] + S.lvl[sel][0] + S.lvl[sel][1])}</b></span>${S.recv[sel] > 0 ? `<span>Поступило за смену <b>+${V(c, S.recv[sel])}</b></span>` : ''}${S.wo[sel] > 0 ? `<span>Списано за смену <b>−${V(c, S.wo[sel])}</b></span>` : ''}${o.can ? `<span><button class="btn" data-m="rcpt">Поступление</button></span><span><select id="tg"><option value="0">в дозатор 1–10</option><option value="1">в дозатор 11–12</option></select></span><span><input type="number" id="as" value="6" min="0" step="any" inputmode="decimal"> ${unit('us')} <output class="cv" data-a="as" data-u="us"></output> <button class="btn" data-m="pour">Залить</button></span>` : ''}${o.isSuper ? `<span><button class="btn" data-m="wo">Списать из запаса</button></span>` : ''}</div></div></div></div>
        <div class="sa-tb"><table><tr><th>Химикат</th>${GN.map(n => `<th>Дозатор ${n}: остаток</th>`).join('')}<th>Общий запас</th><th>Всего</th></tr>${D.chems.map(x => { const k = D.chems.indexOf(x); return `<tr><td>${E(x.name)}</td>${[0, 1].map(j => `<td><b>${V(x, S.lvl[k][j])}</b></td>`).join('')}<td><b>${V(x, S.stock[k])}</b></td><td><b>${V(x, S.stock[k] + S.lvl[k][0] + S.lvl[k][1])}</b></td></tr>`; }).join('')}</table></div>
        <p class="hint">Химия поступает в общий запас («Поступление»), оттуда её заливают в нужный дозатор («Залить») или сразу при поступлении. Остаток дозатора считается по рецептам от последней замены бутыли с учётом «забрано» и «залито»; списание уменьшает только запас. Обновляется раз в минуту. Кг = литры × плотность из настроек химии. Если в дозаторе было другое количество, нажмите «Указать реальный уровень»: стирки после выбранного момента вычтутся сами.</p>`;
      conv();
    }
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t != null) { sel = +b.dataset.t; draw(); }
      else if (b.dataset.m === 'take') { const g = +b.dataset.g; act('take', g, +el.querySelector('#a' + g).value, el.querySelector('#u' + g).value); }
      else if (b.dataset.m === 'lvl') levelPanel(+b.dataset.g);
      else if (b.dataset.m === 'add') { if (o.isSuper) addPanel(+b.dataset.g); }
      else if (b.dataset.m === 'rcpt') { if (o.can) receiptPanel(); }
      else if (b.dataset.m === 'wo') { if (o.isSuper) writeoffPanel(); }
      else if (b.dataset.m === 'pour') act('pour', +el.querySelector('#tg').value, +el.querySelector('#as').value, el.querySelector('#us').value); };
    draw(); conv();
    clearInterval(el._sa); el._sa = setInterval(async () => { if (!el.isConnected) return clearInterval(el._sa); try { await build(); draw(); } catch (e) {} }, 60000);
  }
  return { mount };
})();
