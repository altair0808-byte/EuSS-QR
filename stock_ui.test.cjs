// Этап 2: экран «Химия» (storage-anim.js) — общий запас, «Поступление», «Списать из запаса».
// Запуск: node tests/stock_ui.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const root = p => path.join(__dirname, '..', p);
const NOW = Date.now(), iso = m => new Date(NOW + m * 60e3).toISOString();
const shiftDate = new Date(NOW + (5 - 6) * 3600e3).toISOString().slice(0, 10);   // tz=5, st=6
const d0 = Date.parse(shiftDate + 'T00:00:00Z') + (6 - 5) * 3600e3;
const chems = [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 }];
const calls = [];
let data;
const sb = { rpc: (fn, args) => {
  calls.push({ fn, args });
  const resp = fn === 'chem_receipt' || fn === 'chem_move' ? { data: 'id', error: null } : fn === 'stock_writeoff' ? { data: { ok: true }, error: null } : { data: data[fn] === undefined ? [] : data[fn], error: data[fn] === null ? { message: 'нет функции' } : null };
  const r = { then: (res, rej) => Promise.resolve(resp).then(res, rej), range: () => r }; return r; } };
const els = {};
const mkEl = () => new Proxy({ style: {}, classList: { toggle() {} }, dataset: {}, value: '', textContent: '', disabled: false, innerHTML: '', focus() {} }, { get: (t, k) => k in t ? t[k] : undefined, set: (t, k, v) => { t[k] = v; return true; } });
const doc = { head: { insertAdjacentHTML() {} }, body: { appendChild(o) { doc.last = o; } }, addEventListener() {}, removeEventListener() {},
  createElement() { const o = mkEl(); const cache = {}; o.querySelector = s => cache[s] || (cache[s] = mkEl()); o.querySelectorAll = () => []; o.remove = () => { doc.last = null; }; return o; } };
const ctx = { sb, document: doc, Date, Math, String, Promise, Object, Array, JSON, setInterval: () => 0, clearInterval() {}, isFinite, parseFloat, Number };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(root('num.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(root('storage-anim.js'), 'utf8') + ';this.SA=StorageAnim;', ctx);
const refs = { water: 55, chemicals: chems, recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }] };
const mkHost = () => { const cache = {}; const el = mkEl(); el.querySelector = s => s.includes(':focus') ? null : (cache[s] || (cache[s] = mkEl())); el.querySelectorAll = () => []; el.isConnected = true; return el; };
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n    ', e.message); } };

(async () => {
  data = { report_changes: [], report_connects: [], report_loads: [], report_levels: [],
    report_moves: [
      { id: 'r1', ts: iso(-120), shift_date: shiftDate, chemical_id: 1, machine_group: 'stock', kind: 'receipt', amount_l: 50, amount_kg: 55 },
      { id: 'w1', ts: iso(-60), shift_date: shiftDate, chemical_id: 1, machine_group: 'stock', kind: 'writeoff', amount_l: 5, amount_kg: 5.5 },
      { id: 'p1', ts: iso(-30), shift_date: shiftDate, chemical_id: 1, machine_group: '11_12', kind: 'pour', amount_l: 10, amount_kg: 11 }],
    stock_now: null };   // без stage19: расчёт по событиям

  await t('карточка «Общий запас»: поступило 50 − списано 5 − залито 10 = 35 л, дозатор 11–12 вырос', async () => {
    const el = mkHost(); await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: true, toast() {} });
    const h = text(el.innerHTML);
    assert.ok(h.includes('Общий запас'), 'нет заголовка «Общий запас»');
    assert.ok(/В запасе 35 л/.test(h), 'запас должен быть 35 л: ' + h.slice(h.indexOf('Общий запас'), h.indexOf('Общий запас') + 260));
    assert.ok(/Поступило за смену \+50 л/.test(h), 'не видно «Поступило за смену»');
    assert.ok(/Списано за смену −5 л/.test(h), 'не видно «Списано за смену»');
    assert.ok(/Всего с дозаторами/.test(h), 'нет «Всего с дозаторами»');
    assert.ok(/Поступление/.test(el.innerHTML) && /Списать из запаса/.test(el.innerHTML), 'нет кнопок');
  });
  await t('бригадир (не суперадмин): есть «Поступление», нет «Списать из запаса»', async () => {
    const el = mkHost(); await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: false, toast() {} });
    assert.ok(/data-m="rcpt"/.test(el.innerHTML)); assert.ok(!/data-m="wo"/.test(el.innerHTML));
  });
  await t('без прав «can»: кнопок поступления и списания нет', async () => {
    const el = mkHost(); await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: false, isSuper: false, toast() {} });
    assert.ok(!/data-m="rcpt"/.test(el.innerHTML)); assert.ok(!/data-m="wo"/.test(el.innerHTML));
  });
  await t('точный запас из базы (stock_now) заменяет расчёт за 60 дней', async () => {
    data.stock_now = [{ chemical_id: 1, stock_l: 123.5, stock_kg: 135.85 }];
    const el = mkHost(); await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: true, toast() {} });
    assert.ok(/В запасе 123,5 л/.test(text(el.innerHTML)), text(el.innerHTML).slice(0, 400));
  });
  await t('«Поступление»: вызывает chem_receipt с литрами, примечанием и дозатором', async () => {
    const el = mkHost(), toasts = []; await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: true, toast: m => toasts.push(m) });
    el.onclick({ target: { closest: () => ({ dataset: { m: 'rcpt' } }) } });
    const P = doc.last; assert.ok(P, 'окно не открылось'); assert.ok(/Поступление/.test(P.innerHTML));
    const q = P.querySelector; P.querySelector('#rc-a').value = '40'; P.querySelector('#rc-u').value = 'l'; P.querySelector('#rc-g').value = '1'; P.querySelector('#rc-n').value = ' накладная 17 ';
    calls.length = 0; await P.querySelector('#rc-ok').onclick();
    const c = calls.find(x => x.fn === 'chem_receipt'); assert.ok(c, 'chem_receipt не вызван');
    assert.deepStrictEqual({ ...c.args }, { p_chemical: 1, p_amount_l: 40, p_amount_kg: null, p_note: 'накладная 17', p_pour_group: '11_12' });
    assert.ok(toasts.some(m => /Принято: 40 л в дозатор 11–12/.test(m)), toasts.join('|'));
  });
  await t('«Поступление» в кг без заливки: p_amount_kg, p_pour_group = null', async () => {
    const el = mkHost(); await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: false, toast() {} });
    el.onclick({ target: { closest: () => ({ dataset: { m: 'rcpt' } }) } });
    const P = doc.last; P.querySelector('#rc-a').value = '22'; P.querySelector('#rc-u').value = 'kg'; P.querySelector('#rc-g').value = '';
    calls.length = 0; await P.querySelector('#rc-ok').onclick();
    const c = calls.find(x => x.fn === 'chem_receipt'); assert.deepStrictEqual({ ...c.args }, { p_chemical: 1, p_amount_l: null, p_amount_kg: 22, p_note: null, p_pour_group: null });
  });
  await t('«Списать из запаса»: пароль и причина обязательны, вызывается stock_writeoff в кг', async () => {
    const el = mkHost(), toasts = []; await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: true, toast: m => toasts.push(m) });
    el.onclick({ target: { closest: () => ({ dataset: { m: 'wo' } }) } });
    const P = doc.last; assert.ok(/Списать из запаса/.test(P.innerHTML));
    P.querySelector('#wo-a').value = '10'; P.querySelector('#wo-u').value = 'l'; P.querySelector('#wo-n').value = 'просрочено'; P.querySelector('#wo-p').value = 'secret';
    P.oninput({ target: P.querySelector('#wo-a') });
    assert.strictEqual(P.querySelector('#wo-ok').disabled, false, 'кнопка должна включиться');
    P.querySelector('#wo-p').value = ''; P.oninput({ target: P.querySelector('#wo-p') });
    assert.strictEqual(P.querySelector('#wo-ok').disabled, true, 'без пароля кнопка выключена');
    P.querySelector('#wo-p').value = 'secret'; calls.length = 0; await P.querySelector('#wo-ok').onclick();
    const c = calls.find(x => x.fn === 'stock_writeoff'); assert.ok(c, 'stock_writeoff не вызван');
    assert.ok(Math.abs(c.args.p_amount_kg - 11) < 1e-9, 'литры → кг: ' + c.args.p_amount_kg); assert.strictEqual(c.args.p_pw, 'secret'); assert.strictEqual(c.args.p_note, 'просрочено');
  });
  await t('списать больше, чем есть в запасе, нельзя', async () => {
    const el = mkHost(); await ctx.SA.mount(el, { refs, date: shiftDate, st: 6, tz: 5, can: true, isSuper: true, toast() {} });
    el.onclick({ target: { closest: () => ({ dataset: { m: 'wo' } }) } });
    const P = doc.last; P.querySelector('#wo-a').value = '100000'; P.querySelector('#wo-u').value = 'kg'; P.querySelector('#wo-n').value = 'x'; P.querySelector('#wo-p').value = 'p'; P.oninput({ target: P.querySelector('#wo-a') });
    assert.strictEqual(P.querySelector('#wo-ok').disabled, true); assert.ok(/только/.test(P.querySelector('#wo-h').textContent));
  });
  console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
})();
