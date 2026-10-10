// Этап 3 «Сравнение химии»: подробный вид, светофор, источники чисел, Excel, страницы. Запуск: node tests/compare_detail.test.cjs [файл.xlsx]
// В конце — таблица «ожидалось / получилось» по шести сценариям из задания.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const ta = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) < eps, `${m}: ожидалось ${b}, получено ${a}`);

const mkCtx = () => { const sb = { module: { exports: {} }, console, TextEncoder, Uint8Array, Date, Math, Promise, setImmediate, JSON }; vm.createContext(sb);
  ['num.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js', 'xlsx-writer.js', 'compare-detail.js', 'compare-xlsx.js', 'compare-data.js'].forEach(f => vm.runInContext(rd(f), sb, { filename: f })); return sb; };
const SB = mkCtx(), ev = s => vm.runInContext(s, SB);
const V = ev('CompareView'), D = ev('CompareDetail'), X = ev('CompareXlsx'), calcCompare = ev('calcCompare');

// ---------- общие данные: местное время UTC+5, смена с 06:00 ----------
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const chemicals = [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 }];
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }], chemicals };
const W = 0.1815;                                              // 55 л × 3 мл/л = 0,165 л × плотность 1,1 = 0,1815 кг на стирку
const C0 = loc('2026-10-08', 18), C1 = loc('2026-10-09', 18), C2 = loc('2026-10-10', 18);
const ld = []; for (let i = 0; i < 20; i++) ld.push({ id: 'l' + i, ts: loc('2026-10-09', 7 + (i % 9), 10 + i), machine: (i % 12) + 1, weight_kg: 25, wash_type_id: 1 });
const take = (g, kg, ts, cid, id) => ({ id, chemical_id: 1, machine_group: g, kind: 'take', amount_kg: kg, amount_l: kg / 1.1, ts, closing_id: cid, created_by: 'u1' });
const pour = (g, kg, ts, id) => ({ id, chemical_id: 1, machine_group: g, kind: 'pour', amount_kg: kg, amount_l: kg / 1.1, ts, created_by: 'u1' });
const cl = (id, ts, a, b, kind = 'interval') => ({ id, at_ts: ts, kind, measures: { '1:1_10': a, '1:11_12': b } });
const resAll = {}; for (let d = 6; d <= 12; d++) resAll['2026-10-' + String(d).padStart(2, '0')] = 100;      // проживающие введены за все смены
const base = { tz: 5, st: 6, loads: ld, changes: [], connects: [], levels: [], residents: resAll };
const mv1 = [take('1_10', 10, C0, 'c0', 'm1'), take('11_12', 6, C0, 'c0', 'm2'), pour('1_10', 10, loc('2026-10-08', 18, 5), 'm3'), pour('11_12', 6, loc('2026-10-08', 18, 5), 'm4'), take('1_10', 4, C1, 'c1', 'm5'), take('11_12', 3, C1, 'c1', 'm6')];
const names = { u1: 'Админ Иван' }, meta = { c0: { closed_by: 'u1', closed_at: C0, kind: 'start' }, c1: { closed_by: 'u1', closed_at: C1, kind: 'interval' }, c2: { closed_by: 'u1', closed_at: C2 } };
const ctxOf = (extra) => ({ refs, names, meta, tz: 5, st: 6, etalon: null, prev: null, ...(extra || {}) });
const run = (extra) => { const inp = { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1, ...(extra || {}) }; return { inp, res: calcCompare(refs, inp) }; };
const row = (r, g = 'all', id = 1) => r.rows.find(x => x.chemical_id === id && x.group === g);
const codes = (tr, g) => tr.items.find(i => i.group === g).reasons.map(r => r.code);
const lvl = (tr, g) => tr.items.find(i => i.group === g).level;

// ---------- таблица «ожидалось / получилось» ----------
const T6 = []; const chk = (sc, what, exp, got, same) => { const good = typeof exp === 'number' && typeof got === 'number' ? Math.abs(exp - got) < 1e-6 : (same ? same(exp, got) : String(exp) === String(got)); T6.push({ sc, what, exp, got, good }); assert.ok(good, `${sc}. ${what}: ожидалось ${exp}, получилось ${got}`); };

console.log('1. Светофор: красные условия');
{
  const { res } = run(); const r2 = run({ moves: [take('1_10', 10, C0, 'c0', 'm1'), take('11_12', 6, C0, 'c0', 'm2')] }).res;
  t('расход отрицательный → красный, причина «negative»', () => { const tr = D.trust(r2, { isAdmin: true }); assert.strictEqual(lvl(tr, '1_10'), 'red'); assert.ok(codes(tr, '1_10').includes('negative')); assert.ok(codes(tr, '11_12').includes('negative')); });
  t('после закрытия остаток не залит обратно, а дозатор расходовал химию → красный «not_returned»', () => { const tr = D.trust(r2, { isAdmin: true }); assert.ok(codes(tr, '1_10').includes('not_returned')); assert.ok(codes(tr, '11_12').includes('not_returned')); });
  t('остаток залит обратно полностью → «not_returned» нет', () => { const tr = D.trust(res, { isAdmin: true }); assert.ok(!codes(tr, '1_10').includes('not_returned')); assert.ok(!codes(tr, '1_10').includes('partly_returned')); });
  t('залито меньше половины → красный; залито 70% → только жёлтое «partly_returned»', () => {
    const lowP = run({ moves: [take('1_10', 10, C0, 'c0', 'm1'), take('11_12', 6, C0, 'c0', 'm2'), pour('1_10', 3, loc('2026-10-08', 18, 5), 'p1'), pour('11_12', 6, loc('2026-10-08', 18, 5), 'p2'), take('1_10', 4, C1, 'c1', 'm5'), take('11_12', 3, C1, 'c1', 'm6')] }).res;
    assert.ok(codes(D.trust(lowP, { isAdmin: true }), '1_10').includes('not_returned'));
    const midP = run({ moves: [take('1_10', 10, C0, 'c0', 'm1'), take('11_12', 6, C0, 'c0', 'm2'), pour('1_10', 7, loc('2026-10-08', 18, 5), 'p1'), pour('11_12', 6, loc('2026-10-08', 18, 5), 'p2')] }).res;
    const c = codes(D.trust(midP, { isAdmin: true }), '1_10'); assert.ok(c.includes('partly_returned') && !c.includes('not_returned'));
  });
  t('замеров нет → красный «no_measures»', () => { const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [], moves: [] }); const tr = D.trust(r, { isAdmin: true }); assert.strictEqual(lvl(tr, '1_10'), 'red'); assert.ok(codes(tr, '1_10').includes('no_measures')); });
  t('замер на конец не введён по одному дозатору → красный только у него', () => { const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), { id: 'c1', at_ts: C1, kind: 'interval', measures: { '1:1_10': 4 } }], moves: mv1 }); const tr = D.trust(r, { isAdmin: true }); assert.ok(codes(tr, '11_12').includes('no_measures')); assert.ok(!codes(tr, '1_10').includes('no_measures')); });
  t('плотность или «1 шт = кг» не заданы → красный «no_density»', () => {
    const r = calcCompare({ ...refs, chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main' }] }, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
    const tr = D.trust(r, { isAdmin: true }); assert.strictEqual(lvl(tr, '1_10'), 'red'); assert.ok(codes(tr, '1_10').includes('no_density'));
    const r2b = calcCompare({ ...refs, chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20 }] }, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
    assert.ok(codes(D.trust(r2b, { isAdmin: true }), '1_10').includes('no_density'), '«1 шт = кг» не задано');
  });
}

console.log('2. Светофор: жёлтые условия и зелёный');
{
  const nl = [{ id: 'ch1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-09', 12), leftover_kg: null, leftover_l: null, created_by: 'u1' }];
  const mvCh = mv1.slice(0, 4).concat([take('1_10', 28, C1, 'c1', 'm5'), take('11_12', 3, C1, 'c1', 'm6')]);
  const closCh = [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 28, 3)];
  const r3 = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: closCh, moves: mvCh, changes: nl });
  t('замена бутыли без остатка → жёлтое «no_leftover», не красный', () => { const tr = D.trust(r3, { isAdmin: true }); assert.ok(codes(tr, '1_10').includes('no_leftover')); assert.notStrictEqual(lvl(tr, '1_10'), 'red'); assert.strictEqual(tr.items.find(i => i.group === '1_10').reasons.find(r => r.code === 'no_leftover').level, 'yellow'); });
  t('остаток больше ёмкости → жёлтое «clipped»', () => { const ch = [{ ...nl[0], leftover_kg: 40 }]; const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: closCh, moves: mvCh, changes: ch }); assert.ok(codes(D.trust(r, { isAdmin: true }), '1_10').includes('clipped')); });
  t('отклонение больше порога → жёлтое «deviation» (и недорасход тоже)', () => {
    const { res } = run(); assert.ok(codes(D.trust(res, { isAdmin: true }), '1_10').includes('deviation'));
    const under = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 12.5, 3.2)], moves: mv1.slice(0, 4).concat([take('1_10', 12.5, C1, 'c1', 'x1'), take('11_12', 3.2, C1, 'c1', 'x2')]) });
    assert.ok(codes(D.trust(under, { isAdmin: true }), '11_12').includes('deviation'));
  });
  t('не введены проживающие → жёлтое «residents»; введены не за все смены → тоже', () => {
    const { res } = run({ residents: null }); assert.ok(codes(D.trust(res, { isAdmin: true }), '1_10').includes('residents'));
    const part = run({ residents: { '2026-10-08': 100 } }).res; assert.ok(codes(D.trust(part, { isAdmin: true }), '1_10').includes('residents'));
    assert.ok(!codes(D.trust(run().res, { isAdmin: true }), '1_10').includes('residents'), 'введены за все смены — предупреждения нет');
  });
  t('период включает неполную смену (замер в 18:00) → жёлтое «partial_shift»; замеры в 06:00 → нет', () => {
    assert.ok(codes(D.trust(run().res, { isAdmin: true }), '1_10').includes('partial_shift'));
    const a = loc('2026-10-08', 6), b = loc('2026-10-09', 6);
    const full = calcCompare(refs, { ...base, fromTs: a, toTs: b, closings: [cl('a', a, 10, 6, 'start'), cl('b', b, 4, 3)], moves: [take('1_10', 10, a, 'a', 'z1'), take('11_12', 6, a, 'a', 'z2'), pour('1_10', 10, loc('2026-10-08', 6, 5), 'z3'), pour('11_12', 6, loc('2026-10-08', 6, 5), 'z4'), take('1_10', 4, b, 'b', 'z5'), take('11_12', 3, b, 'b', 'z6')] });
    assert.ok(!codes(D.trust(full, { isAdmin: true }), '1_10').includes('partial_shift'));
  });
  t('зелёный: замеры есть, остатки внесены, расход ≥ 0, проживающие введены, граница в 06:00, расход близок к теории', () => {
    const a = loc('2026-10-08', 6), b = loc('2026-10-09', 6), loads = [];
    for (let i = 0; i < 20; i++) loads.push({ id: 'g' + i, ts: loc('2026-10-08', 8 + (i % 9), 10 + i), machine: (i % 12) + 1, weight_kg: 25, wash_type_id: 1 });
    const f1 = 1.5, f2 = 1.8;                                                            // теория 3,63 кг на оба дозатора (по стиркам 10 : 10 → 1,815 + 1,815)
    const r = calcCompare(refs, { ...base, loads, fromTs: a, toTs: b, closings: [cl('a', a, 10, 6, 'start'), cl('b', b, 10 - f1, 6 - f2)],
      moves: [take('1_10', 10, a, 'a', 'z1'), take('11_12', 6, a, 'a', 'z2'), pour('1_10', 10, loc('2026-10-08', 6, 5), 'z3'), pour('11_12', 6, loc('2026-10-08', 6, 5), 'z4'), take('1_10', 10 - f1, b, 'b', 'z5'), take('11_12', 6 - f2, b, 'b', 'z6')] });
    const tr = D.trust(r, { isAdmin: true }); assert.deepStrictEqual(tr.items.map(i => i.level), ['green', 'green'], JSON.stringify(tr.items.map(i => i.reasons.map(x => x.code))));
    assert.strictEqual(tr.worst, 'green'); assert.ok(/Можно ли верить цифрам/.test(D.trustHTML(r, 'all', { isAdmin: true })));
  });
}

console.log('3. «Что исправить», доступ только админу');
{
  const { res } = run({ moves: [take('1_10', 10, C0, 'c0', 'm1'), take('11_12', 6, C0, 'c0', 'm2')] });
  t('у каждого предупреждения есть кнопка «Что исправить» и текст на простом языке', () => {
    const h = D.trustHTML(res, 'all', { isAdmin: true }); const n = (h.match(/class="fx"/g) || []).length, bx = (h.match(/class="fixbox" hidden/g) || []).length;
    assert.ok(n > 0 && n === bx, `кнопок ${n}, текстов ${bx}`); assert.ok(/Что исправить/.test(h)); assert.ok(/залить|Залить/.test(h));
    Object.keys(D.FIX).forEach(k => { assert.ok(D.FIX[k][2].length > 60, k); assert.ok(!/NaN|undefined/.test(D.FIX[k][2])); });
  });
  t('не админу (бригадир, сотрудник) светофор и предупреждения не показываются', () => { assert.strictEqual(D.trustHTML(res, 'all', { isAdmin: false }), ''); const tr = D.trust(res, { isAdmin: false }); assert.strictEqual(tr.visible, false); assert.strictEqual(tr.items.length, 0);
    assert.ok(!/class="dr"/.test(V.screenHTML(res, 'all', 5)), 'без opts — без кнопок «Подробно»'); });
  t('по одному дозатору показывается только он', () => { const h = D.trustHTML(res, '1_10', { isAdmin: true }); assert.ok(/дозатор 1/.test(h) && !/дозатор 2/.test(h)); });
  t('блок светофора стоит перед таблицей', () => { const h = V.screenHTML(res, 'all', 5, { before: D.trustHTML(res, 'all', { isAdmin: true }), detail: true }); assert.ok(h.indexOf('Можно ли верить цифрам') > 0 && h.indexOf('Можно ли верить цифрам') < h.indexOf('<table>')); });
  t('кнопка «Подробно» и скрытая строка есть в каждой строке химии; ИТОГО без кнопки', () => { const h = V.tableHTML(res, 'all', { detail: true }); assert.strictEqual((h.match(/class="mr"/g) || []).length, 1); assert.strictEqual((h.match(/class="dr" hidden/g) || []).length, 1); assert.ok(/<th><\/th>/.test(h)); });
  t('старый вид таблицы без opts не изменился', () => { const h = V.tableHTML(res, 'all'); assert.ok(!/class="mr"/.test(h) && /<tr><td>EMULSIFIER<\/td>/.test(h)); });
}

console.log('4. Баланс факта, теория, расход на кг, источники');
{
  const mv5 = mv1.concat([pour('1_10', 4, loc('2026-10-09', 18, 5), 'm7'), pour('11_12', 3, loc('2026-10-09', 18, 5), 'm8'), take('1_10', 1, C2, 'c2', 'm9'), take('11_12', 1, C2, 'c2', 'm10')]);
  const ld2 = ld.concat([{ id: 'x1', ts: loc('2026-10-10', 8), machine: 1, weight_kg: 25, wash_type_id: 1 }, { id: 'x2', ts: loc('2026-10-10', 9), machine: 11, weight_kg: 25, wash_type_id: 1 }]);
  const chain = [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3), cl('c2', C2, 1, 1)];
  const inp5 = { ...base, loads: ld2, fromTs: C0, toTs: C2, closings: chain, moves: mv5 }, r5 = calcCompare(refs, inp5);
  const { inp: inp1, res: r1 } = run();
  t('баланс складывается в факт для всех строк: на начало − в запас + приход − на конец', () => {
    [r1, r5].forEach(r => r.rows.forEach(x => { if (!x.balance) return; const L = D.balanceLines(x.balance), g = k => L.find(l => l.key === k).kg;
      near(g('start_measured') - g('to_reserve') + g('inflow') - g('end'), x.fact_kg, 'факт ' + x.group); near(g('fact'), x.fact_kg, 'строка «Факт» ' + x.group); }));
  });
  t('12 строк баланса из задания по порядку', () => { const L = D.balanceLines(row(r1).balance).map(l => l.label); ['На начало (замер)', 'Ушло в запас при прошлом закрытии', 'Новые бутыли', 'Остатки замен (ушли из дозатора)', 'Подключённые остатки', 'Залито из запаса', 'Добавлено суперадмином', 'Забрано из дозатора', 'Поправка по уровню', 'Приход нетто', 'На конец (замер)', 'Факт расхода'].forEach(x => assert.ok(L.includes(x), x)); });
  t('сценарий 1: на начало 16, ушло в запас 16, залито 16, на конец 7, факт 9', () => { const b = row(r1).balance; near(b.start_measured_kg, 16, 'начало'); near(b.to_reserve_kg, 16, 'в запас'); near(b.pours, 16, 'залито'); near(b.end_kg, 7, 'конец'); near(row(r1).fact_kg, 9, 'факт'); });
  t('два отрезка: баланс по отрезкам складывается в общий (колонки «Отрезок 1», «Отрезок 2»)', () => { const h = D.balanceHTML(r5, row(r5), ctxOf()); assert.ok(/Отрезок 1/.test(h) && /Отрезок 2/.test(h) && /Итого, кг/.test(h)); near(row(r5).fact_kg, 14, 'факт'); });
  t('теория по видам стирок = итог в таблице (стирок × вода × норма)', () => {
    [r1, r5].forEach((r, i) => ['1_10', '11_12', 'all'].forEach(g => { const tl = D.theoryLines(r, i ? inp5 : inp1, ctxOf(), 1, g); assert.ok(tl.matches, 'совпадение ' + g); near(tl.total_kg, row(r, g).theory_kg, 'кг ' + g); }));
    const tl = D.theoryLines(r1, inp1, ctxOf(), 1, 'all'); assert.strictEqual(tl.lines[0].n, 20); near(tl.lines[0].norm_ml_per_l, 3, 'норма'); near(tl.lines[0].water_l, 55, 'вода'); near(tl.lines[0].total_l, 3.3, 'литры'); near(tl.total_kg, 20 * W, 'кг');
  });
  t('теория доп. средства: шт × норма на 1 шт', () => {
    const ch2 = chemicals.concat([{ id: 2, name: 'Vanish', kind: 'extra', in_closing: true, bottle_l: 5, bottle_kg: 5, per_unit: 10, per_unit_unit: 'ml' }]); const rf = { ...refs, chemicals: ch2 };
    const lds = ld.map((l, i) => i < 3 ? { ...l, extras: { 2: 2 } } : l), cls = chain.slice(0, 2).map(c => ({ ...c, measures: { ...c.measures, '2:1_10': 1, '2:11_12': 1 } }));
    const i2 = { ...base, loads: lds, fromTs: C0, toTs: C1, closings: cls, moves: mv1 }, r = calcCompare(rf, i2); const tl = D.theoryLines(r, i2, { ...ctxOf(), refs: rf }, 2, 'all');
    near(tl.lines[0].qty, 6, 'шт'); near(tl.lines[0].per_unit, 10, 'норма'); near(tl.total_l, 0.06, 'литры'); assert.ok(tl.matches);
  });
  t('расход на кг белья, на стирку, на жителя — с единицей (мл)', () => { const x = row(r1); const h = D.usageHTML(r1, x); near(x.per_kg_laundry, 9 / 1.1 * 1000 / 500, 'на кг'); assert.ok(/мл\/кг белья/.test(h) && /мл\/стирку/.test(h) && /житель/.test(h)); near(x.per_resident_day, 9 / 1.1 * 1000 / r1.totals.resident_days, 'на жителя'); });
  t('порошок — граммы: единица «г»', () => {
    const rp = { ...refs, chemicals: [{ id: 1, name: 'Порошок', kind: 'main', bottle_kg: 25 }] }; const r = calcCompare(rp, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
    assert.strictEqual(row(r).unit_small, 'г'); assert.ok(/г\/кг белья/.test(D.usageHTML(r, row(r))));
  });
  t('любое число баланса открывается до записей: непустой список для каждой ненулевой строки', () => {
    [[r1, inp1], [r5, inp5]].forEach(([r, i]) => r.rows.forEach(x => { if (!x.balance) return; D.balanceLines(x.balance).forEach(l => { if (Math.abs(l.kg || 0) < 1e-9) return; const s = D.sources(i, r, ctxOf(), 1, x.group, l.key); assert.ok(s.length > 0, `${x.group}/${l.key} пусто`); }); }));
  });
  t('сумма записей-источников равна числу: залито, забрано, замеры', () => {
    const sum = a => a.reduce((s, x) => s + (x.kg || 0), 0);
    near(sum(D.sources(inp5, r5, ctxOf(), 1, 'all', 'pours')), row(r5).balance.pours, 'залито'); near(sum(D.sources(inp5, r5, ctxOf(), 1, 'all', 'to_reserve')), row(r5).balance.to_reserve_kg, 'в запас');
    near(sum(D.sources(inp5, r5, ctxOf(), 1, 'all', 'start_measured')), row(r5).balance.start_measured_kg, 'начало'); near(sum(D.sources(inp5, r5, ctxOf(), 1, 'all', 'end')), row(r5).balance.end_kg, 'конец');
    near(sum(D.sources(inp1, r1, ctxOf(), 1, '1_10', 'end')), 4, 'конец, дозатор 1');
  });
  t('у записей есть время и «кто внёс»; сотрудник показан по имени', () => { const s = D.sources(inp1, r1, ctxOf(), 1, 'all', 'pours'); assert.ok(s.length === 2 && s.every(x => x.ts && x.who === 'Админ Иван' && x.id)); const h = D.sourcesHTML(s, 5); assert.ok(/08\.10\.2026 18:05/.test(h) && /Админ Иван/.test(h) && /journal\.html\?ts=/.test(h)); const m = D.sourcesHTML(D.sources(inp1, r1, ctxOf(), 1, 'all', 'end'), 5); assert.ok(/closings-report\.html\?id=c1/.test(m) && /внесено 09\.10\.2026 18:00/.test(m)); });
  t('теория: источники — стирки периода; по виду стирки и по дозатору', () => { assert.strictEqual(D.sources(inp1, r1, ctxOf(), 1, 'all', 'theory').length, 20); assert.strictEqual(D.sources(inp1, r1, ctxOf(), 1, '1_10', 'theory').length + D.sources(inp1, r1, ctxOf(), 1, '11_12', 'theory').length, 20); assert.strictEqual(D.sources(inp1, r1, ctxOf(), 1, 'all', 'theory', '1').length, 20); assert.strictEqual(D.sources(inp1, r1, ctxOf(), 1, 'all', 'theory', '99').length, 0); });
  t('все кнопки-числа в карточке ссылаются на существующие ключи (ничего не падает)', () => {
    const h = D.cardHTML(r5, inp5, ctxOf(), 1, 'all'); const keys = [...h.matchAll(/data-src="([^"]*)"/g)].map(m => m[1]); assert.ok(keys.length > 30, 'кнопок: ' + keys.length);
    keys.forEach(k => { const p = k.replace(/&amp;/g, '&').split('|'); const s = D.sources(inp5, r5, ctxOf(), p[0], p[1], p[2], p[3]); assert.ok(Array.isArray(s), k); });
  });
  t('сегмент: источники одного отрезка не смешиваются с другим', () => { const a = D.sources(inp5, r5, ctxOf(), 1, 'all', 'pours', 0), b = D.sources(inp5, r5, ctxOf(), 1, 'all', 'pours', 1); assert.strictEqual(a.length, 2); assert.strictEqual(b.length, 2); assert.ok(a.every(x => Date.parse(x.ts) < Date.parse(C1)) && b.every(x => Date.parse(x.ts) > Date.parse(C1))); });
  t('нажатие на число раскрывает список, повторное — скрывает; «Что исправить» открывает текст', () => {
    const box = { hidden: true, classList: { contains: c => c === 'sb' }, firstElementChild: { innerHTML: '' } }, tr = { nextElementSibling: box };
    const btn = { dataset: { src: '1|all|pours|' }, closest: s => s === 'tr' ? tr : null }, tgt = { closest: s => s === 'button.nb' ? btn : null };
    const st = () => ({ res: r1, inp: inp1, ctx: ctxOf() });
    assert.ok(D.onClick({ target: tgt }, st)); assert.strictEqual(box.hidden, false); assert.ok(/Залито из запаса/.test(box.firstElementChild.innerHTML)); D.onClick({ target: tgt }, st); assert.strictEqual(box.hidden, true);
    const fb = { hidden: true }, fx = { nextElementSibling: fb, setAttribute() {} }; D.onClick({ target: { closest: s => s === 'button.fx' ? fx : null } }, st); assert.strictEqual(fb.hidden, false);
  });
  t('хронология: замены, заливки, замеры по времени, кто внёс', () => {
    const chg = [{ id: 'ch1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-09', 12), leftover_kg: 3, created_by: 'u1' }]; const i = { ...inp1, changes: chg }, r = calcCompare(refs, i);
    const tl = D.timeline(i, r, ctxOf(), 1, 'all'); const types = tl.map(e => e.type); assert.ok(types.includes('measure') && types.includes('pour') && types.includes('change') && types.includes('take'));
    assert.ok(tl.every((e, k) => k === 0 || Date.parse(tl[k - 1].ts) <= Date.parse(e.ts)), 'по времени'); assert.ok(tl.every(e => e.who)); assert.strictEqual(tl[0].type, 'measure'); assert.strictEqual(tl[tl.length - 1].type, 'measure');
    const h = D.timelineHTML(tl, 5); assert.ok(/Замена бутыли/.test(h) && /Заливка из запаса/.test(h) && /Замер остатка/.test(h) && /внёс: Админ Иван/.test(h));
  });
  t('график: накопительно по закрытиям, а не по дням (3 точки на 2 отрезка: 0 → 9 → 14)', () => {
    const c = D.cumulative(r5, 1, 'all', 1.1); assert.strictEqual(c.points.length, 3); assert.strictEqual(c.unit, 'л'); near(c.points[0].fact, 0, 'старт'); near(c.points[1].fact, 9 / 1.1, 'на 1-м закрытии'); near(c.points[2].fact, 14 / 1.1, 'на 2-м закрытии'); near(c.points[2].theory, 22 * W / 1.1, 'теория');
    const svg = D.chartSVG(c, 5, 'проверка'); assert.ok(/<svg[^>]*class="chart"/.test(svg) && /<polyline class="fc"/.test(svg) && /<polyline class="th"/.test(svg) && (svg.match(/<circle/g) || []).length === 6);
    assert.ok(/нужно хотя бы одно закрытие/.test(D.chartSVG({ points: [], unit: 'л' })));
  });
  t('график за месяц использует данные месяца (monthRes), а не выбранного периода', () => { const ctx = ctxOf({ monthRes: r5 }); const b = D.chartBlock(r1, ctx, row(r1)); assert.ok(/Месяц: октябрь 2026/.test(b)); assert.strictEqual((b.match(/<circle/g) || []).length, 6); assert.ok(/Выбранный период/.test(D.chartBlock(r1, ctxOf(), row(r1)))); });
  t('сравнение с эталоном и прошлым закрытием: рост красным, снижение зелёным', () => {
    const cur = row(r1).per_kg_laundry; const snap = (v) => ({ rows: [{ chemical_id: 1, group: 'all', per_kg_laundry: v, per_wash: v * 25, unit_small: 'мл' }] });
    const a = D.refCompare(cur, cur / 1.2), b = D.refCompare(cur, cur * 1.25), c = D.refCompare(cur, cur * 1.001);
    assert.strictEqual(a.cls, 'up'); near(a.pct, 20, 'рост %'); assert.strictEqual(b.cls, 'down'); assert.strictEqual(c.cls, 'eq'); assert.strictEqual(D.refCompare(null, 1), null);
    const h = D.refHTML(r1, row(r1), ctxOf({ etalon: { id: 'e', at_ts: C0, snapshot: snap(cur / 1.2) }, prev: { id: 'p', at_ts: C0, snapshot: snap(cur * 1.25) } }));
    assert.ok(/class="d up">▲ \+20%/.test(h), 'рост красным'); assert.ok(/class="d down">▼ -20%/.test(h), 'снижение зелёным');
    assert.ok(/не задано/.test(D.refHTML(r1, row(r1), ctxOf())), 'нет эталона'); assert.ok(/нет расчёта/.test(D.refHTML(r1, row(r1), ctxOf({ prev: { id: 'p', at_ts: C0, snapshot: null } }))));
  });
  t('карточка «Подробно» содержит все 6 разделов; для «оба дозатора» — три карточки', () => {
    const h = D.cardHTML(r1, inp1, ctxOf(), 1, 'all'); ['Баланс факта', 'Теория', 'Расход на кг белья, на стирку, на жителя в сутки', 'Сравнение с эталоном и с предыдущим закрытием', 'Накопительный расход', 'Хронология событий периода'].forEach(x => assert.ok(h.includes(x), x));
    assert.strictEqual((h.match(/class="dcard"/g) || []).length, 3); assert.strictEqual((D.cardHTML(r1, inp1, ctxOf(), 1, '1_10').match(/class="dcard"/g) || []).length, 1);
    assert.ok(/Что исправить/.test(h) && /class="dot y"/.test(h)); assert.ok(!/Что исправить/.test(D.cardHTML(r1, inp1, ctxOf(), 1, '1_10', { isAdmin: false })), 'не админу без предупреждений');
  });
  t('имена экранируются в карточке и светофоре', () => { const r = JSON.parse(JSON.stringify(r1)); r.rows.forEach(x => x.name = '<b>X</b>'); assert.ok(!D.cardHTML(r, inp1, ctxOf(), 1, 'all').includes('<b>X</b>')); assert.ok(!D.trustHTML(r, 'all', { isAdmin: true }).includes('<b>X</b>')); });
}

console.log('5. Excel');
const unzip = buf => { const f = {}; let o = 0; while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) { const csz = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28); f[buf.slice(o + 30, o + 30 + nl).toString('utf8')] = buf.slice(o + 30 + nl + el, o + 30 + nl + el + csz); o += 30 + nl + el + csz; } return f; };
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const readXlsx = bytes => { const f = unzip(Buffer.from(bytes)), wbx = f['xl/workbook.xml'].toString(); const nm = [...wbx.matchAll(/<sheet name="([^"]*)"/g)].map(m => unesc(m[1]));
  return { styles: f['xl/styles.xml'].toString(), sheets: nm.map((n, i) => { const x = f['xl/worksheets/sheet' + (i + 1) + '.xml'].toString(), cells = {};
    for (const m of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const body = m[3] || '', nv = /<v>([^<]*)<\/v>/.exec(body), ts = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body); cells[m[1]] = { v: nv ? +nv[1] : ts ? unesc(ts[1]) : null, f: /<f[ >]/.test(body), s: (/s="(\d+)"/.exec(m[2]) || [])[1] }; } return { name: n, cells, xml: x }; }) }; };
const colOf = (sheet, r, label) => { const h = Object.entries(sheet.cells).filter(([k, c]) => k.endsWith(String(r)) && /^[A-Z]+\d+$/.test(k) && c.v === label); return h.length ? h[0][0].replace(/\d+/, '') : null; };
const genAt = '2026-10-10T07:30:00.000Z';
let fullBook, briefBook, bytesFull;
{
  const { inp, res } = run(); const ctx = ctxOf();
  t('подробная книга: 7 листов в нужном порядке', () => { const w = X.build(res, inp, ctx, { view: 'full', isAdmin: true, generatedAt: genAt }); bytesFull = w.toBytes(); fullBook = readXlsx(bytesFull); assert.deepStrictEqual(fullBook.sheets.map(s => s.name), ['Кратко', 'По дозаторам', 'Баланс прихода', 'Замеры', 'Стирки', 'Предупреждения', 'Как считается']); });
  t('краткая книга: «Кратко», «Предупреждения», «Как считается»', () => { briefBook = readXlsx(X.build(res, inp, ctx, { view: 'brief', isAdmin: true, generatedAt: genAt }).toBytes()); assert.deepStrictEqual(briefBook.sheets.map(s => s.name), ['Кратко', 'Предупреждения', 'Как считается']); });
  t('в шапке каждого листа: период и время формирования (местное)', () => { fullBook.sheets.forEach(s => { assert.ok(/^Период: 08\.10\.2026 18:00 → 09\.10\.2026 18:00/.test(s.cells.A2.v), s.name + ' ' + s.cells.A2.v); assert.ok(/Сформировано: 10\.10\.2026 12:30/.test(s.cells.A3.v), s.name); }); });
  t('значения — числами, формул нет', () => { fullBook.sheets.forEach(s => { assert.ok(!/<f[ >]/.test(s.xml), s.name + ': формулы'); }); const k = fullBook.sheets[0], c = colOf(k, 5, 'Факт, л'); assert.ok(c); const v = k.cells[c + '8'].v; assert.strictEqual(typeof v, 'number'); });
  t('единицы подписаны в заголовках (кг, л, мл, %)', () => { const k = fullBook.sheets[0]; ['Теория, л', 'Факт, л', 'Разница, л', 'Отклонение, %', 'Теория, кг', 'Факт, кг', 'Разница, кг'].forEach(h => assert.ok(colOf(k, 5, h), h)); const d = fullBook.sheets[1]; assert.ok(colOf(d, 5, 'На кг белья, мл или г') && colOf(d, 5, 'Белья, кг')); const b = fullBook.sheets[2]; assert.ok(colOf(b, 5, 'На начало (замер), кг') && colOf(b, 5, 'Факт, кг')); });
  t('формат чисел: 2 знака (#,##0.00); текст-«числа» не пишутся строками', () => { assert.ok(/numFmtId="4"/.test(fullBook.styles)); const k = fullBook.sheets[0]; Object.values(k.cells).forEach(c => { if (typeof c.v === 'string') assert.ok(!/^-?\d+([.,]\d+)?$/.test(c.v), 'число строкой: ' + c.v); }); });
  t('цвета как на экране: перерасход FDECEA / 7A1A12, отклонение B42318', () => { ['FFFDECEA', 'FF7A1A12', 'FFB42318'].forEach(c => assert.ok(fullBook.styles.includes(c), c)); const k = fullBook.sheets[0]; assert.ok(Object.values(k.cells).some(c => c.v === 'перерасход')); });
  t('лист «Баланс прихода»: колонки баланса и факт 9 кг в итоговой строке', () => { const b = fullBook.sheets[2], f = colOf(b, 5, 'Факт, кг'); const rowsV = Object.entries(b.cells).filter(([k, c]) => k.startsWith(f) && typeof c.v === 'number').map(([, c]) => c.v); assert.ok(rowsV.some(v => Math.abs(v - 9) < 1e-9), JSON.stringify(rowsV)); assert.ok(colOf(b, 5, 'Ушло в запас при прошлом закрытии, кг') && colOf(b, 5, 'Залито из запаса, кг') && colOf(b, 5, 'Добавлено суперадмином, кг') && colOf(b, 5, 'Приход нетто, кг')); });
  t('лист «Замеры»: 4 строки замеров (2 закрытия × 2 дозатора), кто и когда внёс', () => { const z = fullBook.sheets[3], c = colOf(z, 5, 'Остаток, кг'); const vals = Object.entries(z.cells).filter(([k, x]) => k.startsWith(c) && typeof x.v === 'number').map(([, x]) => x.v).sort((a, b) => a - b); assert.deepStrictEqual(vals, [3, 4, 6, 10]); assert.ok(Object.values(z.cells).some(x => x.v === 'Админ Иван')); });
  t('лист «Стирки»: 20 стирок, норма 3 мл/л, вода 55 л, теория 3,3 л', () => { const s = fullBook.sheets[4]; const v = c => Object.entries(s.cells).filter(([k, x]) => k.startsWith(colOf(s, 5, c)) && typeof x.v === 'number').map(([, x]) => x.v); assert.ok(v('Стирок, шт').includes(20)); assert.ok(v('Вода, л').includes(55)); assert.ok(v('Теория, л (для порошка — кг)').some(x => Math.abs(x - 3.3) < 1e-9)); });
  t('лист «Предупреждения»: уровень, что случилось и «Что исправить» простым языком', () => { const w = fullBook.sheets[5]; assert.ok(Object.values(w.cells).some(c => /Жёлтый: проверьте/.test(c.v || ''))); assert.ok(Object.values(w.cells).some(c => /Проверьте|Что сделать|Внесите/.test(c.v || ''))); assert.ok(colOf(w, 5, 'Что исправить')); });
  t('лист «Как считается»: формулы, смена 06:00, порог, светофор', () => { const h = fullBook.sheets[6]; const all = Object.values(h.cells).map(c => c.v).join('\n'); ['Факт = остаток', '06:00', '±25%', 'Красный:', 'Дозатор 1 — машины 1–10'].forEach(x => assert.ok(all.includes(x), x)); });
  t('не админ: без листа «Предупреждения» и без колонки светофора', () => { const w = readXlsx(X.build(...(() => { const { inp, res } = run(); return [res, inp, ctxOf(), { view: 'full', isAdmin: false, generatedAt: genAt }]; })()).toBytes()); assert.ok(!w.sheets.some(s => s.name === 'Предупреждения')); assert.ok(!colOf(w.sheets[0], 5, 'Можно ли верить цифрам')); });
  t('цвета сравнения с эталоном в Excel: рост красным, снижение зелёным', () => {
    const { inp, res } = run(), cur = row(res).per_kg_laundry, snap = v => ({ rows: [{ chemical_id: 1, group: 'all', per_kg_laundry: v, per_wash: v * 25, unit_small: 'мл' }] });
    const w = readXlsx(X.build(res, inp, ctxOf({ etalon: { id: 'e', at_ts: C0, snapshot: snap(cur / 1.2) }, prev: { id: 'p', at_ts: C0, snapshot: snap(cur * 1.25) } }), { view: 'full', isAdmin: true, generatedAt: genAt }).toBytes());
    assert.ok(/FFB42318/.test(w.styles) && /FF14532D/.test(w.styles)); const d = w.sheets[1], e = colOf(d, 5, 'Изменение к эталону, %'), p = colOf(d, 5, 'Изменение к прошлому, %');
    const vv = c => Object.entries(d.cells).filter(([k, x]) => k.startsWith(c) && typeof x.v === 'number').map(([, x]) => x.v); assert.ok(vv(e).some(x => Math.abs(x - 20) < 1e-6)); assert.ok(vv(p).some(x => Math.abs(x + 20) < 1e-6));
  });
  t('имя файла: вид и период', () => assert.strictEqual(X.fileName(run().res, 'full', 5), 'EuSS_сравнение-химии_подробно_2026-10-08_18-00_2026-10-09_18-00.xlsx'));
  t('два отрезка: лист «Баланс прихода» показывает отрезки и итог', () => {
    const mv5 = mv1.concat([pour('1_10', 4, loc('2026-10-09', 18, 5), 'm7'), pour('11_12', 3, loc('2026-10-09', 18, 5), 'm8'), take('1_10', 1, C2, 'c2', 'm9'), take('11_12', 1, C2, 'c2', 'm10')]);
    const inp = { ...base, fromTs: C0, toTs: C2, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3), cl('c2', C2, 1, 1)], moves: mv5 }, r = calcCompare(refs, inp); const w = readXlsx(X.build(r, inp, ctxOf(), { view: 'full', isAdmin: true, generatedAt: genAt }).toBytes());
    const all = Object.values(w.sheets[2].cells).map(c => c.v); assert.ok(all.some(v => /Итого по периоду/.test(v || '')) && all.some(v => /08\.10\.2026 18:00 → 09\.10\.2026 18:00/.test(v || '')));
  });
}

console.log('6. Страницы');
const page = rd('compare.html'), dpage = rd('compare-detail.html');
t('compare.html: скрипты в правильном порядке, кнопка «Скачать Excel», ссылка «Подробно», стили', () => {
  const o = ['num.js', 'app.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js', 'xlsx-writer.js', 'compare-detail.js', 'compare-xlsx.js', 'compare-data.js'].map(s => page.indexOf('src="' + s + '"')); o.forEach((x, i) => assert.ok(x > 0, 'нет ' + i)); assert.deepStrictEqual(o, o.slice().sort((a, b) => a - b));
  assert.ok(/id="xl"[^>]*>Скачать Excel</.test(page) && /href="compare-detail\.html"/.test(page) && /compare-detail\.css/.test(page));
});
t('compare-detail.html: скрипты, кнопка Excel, переключатели периода и дозатора, доступ только админам', () => {
  const o = ['num.js', 'app.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js', 'xlsx-writer.js', 'compare-detail.js', 'compare-xlsx.js', 'compare-data.js'].map(s => dpage.indexOf('src="' + s + '"')); o.forEach((x, i) => assert.ok(x > 0, 'нет ' + i)); assert.deepStrictEqual(o, o.slice().sort((a, b) => a - b));
  ['id="xl"', 'Скачать Excel', 'data-m="last"', 'data-m="month"', 'data-m="custom"', 'data-g="all"', 'data-g="1_10"', 'data-g="11_12"', 'id="out"', 'Сравнение химии — подробно'].forEach(x => assert.ok(dpage.includes(x), x));
  assert.ok(/доступно админам и суперадмину/.test(dpage) && /is_admin/.test(dpage));
});
t('скрипты страниц без синтаксических ошибок; service worker кэширует новые файлы', () => {
  [page, dpage].forEach(p => { const inl = [...p.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]; new vm.Script(inl); });
  const sw = rd('sw.js'); ['compare-detail.html', 'compare-detail.js', 'compare-xlsx.js', 'compare-data.js', 'compare-detail.css', 'xlsx-writer.js'].forEach(f => assert.ok(sw.includes("'" + f + "'"), f)); assert.ok(!/euss-v14/.test(sw), 'версия кэша обновлена');
});
t('журнал открывается по ссылке ?ts= (записи вокруг момента)', () => { const j = rd('journal.html'); assert.ok(/get\('ts'\)/.test(j) && /lte\('ts'/.test(j)); });
t('ссылка «Закрытие» из источников ведёт на существующий параметр id', () => assert.ok(/get\('id'\)/.test(rd('closings-report.html'))));

(async () => {
  const mk = () => { const els = {}; const el = id => els[id] || (els[id] = { id, innerHTML: '', hidden: true, onclick: null, onchange: null, dataset: {}, classList: { toggle() {} }, value: '', href: '' }); return { getElementById: el, querySelectorAll: () => [], els }; };
  const runPage = async (src, data) => {
    const c = mkCtx(), doc = mk(), calls = [];
    const builder = table => { const b = { select: () => b, order: () => b, eq: () => b, in: () => b, maybeSingle: () => Promise.resolve({ data: data.profiles }), then: (res, rej) => Promise.resolve({ data: data[table] || [], error: null }).then(res, rej) }; return b; };
    c.document = doc; c.sb = { auth: {}, from: builder, rpc: (fn) => { calls.push(fn); return Promise.resolve({ data: fn === 'is_admin' ? data.admin : (data.rpc[fn] || []), error: null }); } };
    c.need = async () => ({ user: { id: 'u1' } }); c.Date = Date;
    vm.runInContext([...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1], c, { filename: 'page' });
    for (let i = 0; i < 80; i++) await new Promise(r => setImmediate(r));
    return { out: doc.els.out.innerHTML, doc, calls, c };
  };
  const data = {
    profiles: { role: 'admin' }, admin: true,
    settings: [{ key: 'tz_offset', value: 5 }, { key: 'shift_start', value: 6 }, { key: 'water_l', value: 55 }, { key: 'close_warn_pct', value: 25 }],
    chemicals, wash_types: refs.washTypes, recipes: refs.recipes,
    closings: [{ id: 'c1', at_ts: C1, kind: 'interval', closed_by: 'u1', closed_at: C1 }, { id: 'c0', at_ts: C0, kind: 'start', closed_by: 'u1', closed_at: C0 }],
    closing_measures: [{ closing_id: 'c0', chemical_id: 1, machine_group: '1_10', amount_kg: 10 }, { closing_id: 'c0', chemical_id: 1, machine_group: '11_12', amount_kg: 6 }, { closing_id: 'c1', chemical_id: 1, machine_group: '1_10', amount_kg: 4 }, { closing_id: 'c1', chemical_id: 1, machine_group: '11_12', amount_kg: 3 }],
    rpc: { report_loads: ld, report_moves: mv1, staff_names: [{ id: 'u1', name: 'Админ Иван' }] }
  };
  console.log('7. Страницы целиком: запуск скриптов с подставной базой');
  await ta('краткий экран админа: светофор перед таблицей, «Подробно» у строки, Excel включён, цифры те же', async () => {
    const r = await runPage(page, data);
    assert.ok(/Можно ли верить цифрам/.test(r.out) && r.out.indexOf('Можно ли верить цифрам') < r.out.indexOf('<table>')); assert.ok(/class="mr"[^>]*>Подробно</.test(r.out)); assert.ok(r.out.includes('<td>8,18</td>') && r.out.includes('+147,9%') && r.out.includes('перерасход'));
    assert.strictEqual(r.doc.els.xl.hidden, false); assert.strictEqual(typeof r.doc.els.xl.onclick, 'function'); assert.ok(/compare-detail\.html\?m=last&g=all/.test(r.doc.els.todet.href), r.doc.els.todet.href); assert.ok(r.calls.includes('staff_names'));
  });
  await ta('краткий экран не админа: ни светофора, ни данных', async () => { const r = await runPage(page, { ...data, admin: false, profiles: { role: 'worker' } }); assert.ok(/доступно админам и суперадмину/.test(r.out) && !/Можно ли верить/.test(r.out) && !r.calls.includes('report_loads')); assert.strictEqual(r.doc.els.xl ? r.doc.els.xl.hidden : true, true); });
  await ta('экран «подробно»: те же итоги, 6 разделов, светофор, кнопка Excel', async () => {
    const r = await runPage(dpage, data); ['Можно ли верить цифрам', 'Баланс факта', 'Хронология событий периода', 'По химикатам', 'Итоги'].forEach(x => assert.ok(r.out.includes(x), x));
    assert.ok(r.out.includes('<td>8,18</td>') && r.out.includes('+147,9%'), 'итоги как в кратком виде'); assert.strictEqual(r.doc.els.xl.hidden, false); assert.strictEqual((r.out.match(/class="dcard"/g) || []).length, 3);
  });
  await ta('экран «подробно» не админу: отказ, данные не запрашиваются', async () => { const r = await runPage(dpage, { ...data, admin: false, profiles: { role: 'worker' } }); assert.ok(/доступно админам и суперадмину/.test(r.out) && !r.calls.includes('report_loads')); });
  await ta('ошибка базы показывается текстом на экране «подробно»', async () => { const r = await runPage(dpage, { ...data, rpc: { ...data.rpc, report_loads: undefined } }); assert.ok(r.out.length > 0); });

  // =========================== шесть сценариев из задания ===========================
  console.log('\n8. Сценарии из задания');
  t('сценарий 1: замер 10 и 6 → 4 и 3, залито обратно всё, 20 стирок по 25 кг', () => {
    const { res, inp } = run(), x = row(res);
    chk(1, 'факт, кг', 9, x.fact_kg); chk(1, 'теория по рецепту, кг (20 × 0,1815)', 3.63, x.theory_kg); chk(1, 'расхождение, кг', 9 - 3.63, x.diff_kg); chk(1, 'расхождение, %', (9 - 3.63) / 3.63 * 100, x.dev_pct);
    chk(1, 'дозатор 1: факт, кг', 6, row(res, '1_10').fact_kg); chk(1, 'дозатор 2: факт, кг', 3, row(res, '11_12').fact_kg); chk(1, 'статус', 'over', x.status); chk(1, 'стирок / кг белья', '20 / 500', res.totals.washes + ' / ' + res.totals.laundry_kg);
    chk(1, 'светофор: красных нет', 'нет красных', D.trust(res, { isAdmin: true }).summary.red ? 'есть красные' : 'нет красных');
  });
  t('сценарий 2: после закрытия остаток не залит обратно', () => {
    const { res } = run({ moves: [take('1_10', 10, C0, 'c0', 'm1'), take('11_12', 6, C0, 'c0', 'm2')] }), x = row(res), tr = D.trust(res, { isAdmin: true });
    chk(2, 'расход (факт), кг', -7, x.fact_kg); chk(2, 'статус строки', 'check', x.status); chk(2, 'светофор дозатора 1', 'red', lvl(tr, '1_10')); chk(2, 'светофор дозатора 2', 'red', lvl(tr, '11_12'));
    chk(2, 'причина «не залит обратно»', 'да', codes(tr, '1_10').includes('not_returned') ? 'да' : 'нет'); chk(2, 'причина «расход отрицательный»', 'да', codes(tr, '1_10').includes('negative') ? 'да' : 'нет');
  });
  t('сценарий 3: замена бутыли без остатка', () => {
    const nl = [{ id: 'ch1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-09', 12), leftover_kg: null, leftover_l: null, created_by: 'u1' }];
    const mvCh = mv1.slice(0, 4).concat([take('1_10', 28, C1, 'c1', 'm5'), take('11_12', 3, C1, 'c1', 'm6')]);
    const inp = { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 28, 3)], moves: mvCh, changes: nl }, res = calcCompare(refs, inp), tr = D.trust(res, { isAdmin: true }), it = tr.items.find(i => i.group === '1_10');
    chk(3, 'предупреждение «нет остатка»', 'да', it.reasons.some(r => r.code === 'no_leftover') ? 'да' : 'нет'); chk(3, 'его уровень', 'yellow', it.reasons.find(r => r.code === 'no_leftover').level); chk(3, 'светофор не красный', 'не красный', it.level === 'red' ? 'красный' : 'не красный');
    chk(3, 'остаток принят, кг', 0, row(res, '1_10').balance.leftovers); chk(3, 'замен без остатка', 1, row(res, '1_10').balance.noLeft); chk(3, 'в источниках видно «не указан»', 'да', /не указан/.test(D.sources(inp, res, ctxOf(), 1, '1_10', 'leftovers')[0].text) ? 'да' : 'нет');
  });
  t('сценарий 4: период не по границам закрытий — факт только за закрытые отрезки', () => {
    const outside = [{ id: 'o1', ts: loc('2026-10-07', 10), machine: 1, weight_kg: 25, wash_type_id: 1 }, { id: 'o2', ts: loc('2026-10-07', 11), machine: 2, weight_kg: 25, wash_type_id: 1 }, { id: 'o3', ts: loc('2026-10-10', 20), machine: 3, weight_kg: 25, wash_type_id: 1 }];
    const inp = { ...base, loads: ld.concat(outside), fromTs: loc('2026-10-07', 6), toTs: loc('2026-10-11', 6), closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 }, res = calcCompare(refs, inp), x = row(res);
    chk(4, 'факт, кг (только отрезок между замерами)', 9, x.fact_kg); chk(4, 'теория для сравнения — за тот же отрезок, кг', 20 * W, x.theory_kg); chk(4, 'теория за весь период (справка), кг', 23 * W, x.theory_requested_kg);
    chk(4, 'факт посчитан от', new Date(C0).toISOString(), res.coverage.fact_from_ts); chk(4, 'факт посчитан до', new Date(C1).toISOString(), res.coverage.fact_to_ts); chk(4, 'покрытие полное?', 'нет', res.coverage.full ? 'да' : 'нет');
    chk(4, 'стирок в факте / в запросе', '20 / 23', res.totals.washes + ' / ' + res.coverage.washes_requested);
    chk(4, 'теория в подробном виде — за отрезок, кг', 20 * W, D.theoryLines(res, inp, ctxOf(), 1, 'all').total_kg);
  });
  t('сценарий 5: закрытие в 18:00 посреди смены — стирки после 18:00 уходят в следующий период', () => {
    const l = [{ id: 'a', ts: loc('2026-10-09', 17, 59), machine: 1, weight_kg: 25, wash_type_id: 1 }, { id: 'b', ts: loc('2026-10-09', 18, 0), machine: 1, weight_kg: 25, wash_type_id: 1 }, { id: 'c', ts: loc('2026-10-09', 18, 30), machine: 11, weight_kg: 25, wash_type_id: 1 }];
    const mv = mv1.concat([pour('1_10', 4, loc('2026-10-09', 18, 5), 'm7'), pour('11_12', 3, loc('2026-10-09', 18, 5), 'm8'), take('1_10', 1, C2, 'c2', 'm9'), take('11_12', 1, C2, 'c2', 'm10')]);
    const p1 = calcCompare(refs, { ...base, loads: l, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv });
    const p2 = calcCompare(refs, { ...base, loads: l, fromTs: C1, toTs: C2, closings: [cl('c1', C1, 4, 3, 'interval'), cl('c2', C2, 1, 1)], moves: mv });
    chk(5, 'стирок в периоде до 18:00', 1, p1.totals.washes); chk(5, 'стирок в следующем периоде', 2, p2.totals.washes); chk(5, 'всего без потерь и повторов', 3, p1.totals.washes + p2.totals.washes);
    chk(5, 'теория первого периода, кг (1 стирка)', W, row(p1).theory_kg); chk(5, 'теория следующего, кг (2 стирки)', 2 * W, row(p2).theory_kg); chk(5, 'предупреждение «неполная смена»', 'да', codes(D.trust(p1, { isAdmin: true }), '1_10').includes('partial_shift') ? 'да' : 'нет');
    chk(5, 'в подробном виде 18:00 и 18:30 не в первом', 0, D.sources({ loads: l }, p1, ctxOf(), 1, 'all', 'theory').filter(x => Date.parse(x.ts) >= Date.parse(C1)).length);
  });
  t('сценарий 6: краткий и подробный вид показывают одни и те же итоги (экран и Excel)', () => {
    const { res, inp } = run(), ctx = ctxOf(), x = row(res);
    const br = readXlsx(X.build(res, inp, ctx, { view: 'brief', isAdmin: true, generatedAt: genAt }).toBytes()).sheets[0], fl = readXlsx(X.build(res, inp, ctx, { view: 'full', isAdmin: true, generatedAt: genAt }).toBytes()).sheets[0];
    const cell = (sh, h, r) => { const c = colOf(sh, 5, h); return c ? sh.cells[c + r] && sh.cells[c + r].v : null; };
    const numsOf = sh => Object.entries(sh.cells).filter(([, c]) => typeof c.v === 'number').map(([k, c]) => k + '=' + c.v).join(';');
    chk(6, 'лист «Кратко»: числа краткой и подробной книги', 'совпадают', numsOf(br) === numsOf(fl) ? 'совпадают' : 'различаются');
    chk(6, 'Excel «Кратко»: факт, л (оба дозатора)', x.fact_l, cell(fl, 'Факт, л', 8)); chk(6, 'Excel «Кратко»: теория, л', x.theory_l, cell(fl, 'Теория, л', 8)); chk(6, 'Excel «Кратко»: отклонение, %', x.dev_pct, cell(fl, 'Отклонение, %', 8));
    const bal = D.balanceLines(x.balance); chk(6, 'подробно: строка «Факт расхода», кг', x.fact_kg, bal.find(l => l.key === 'fact').kg);
    const tl = D.theoryLines(res, inp, ctxOf(), 1, 'all'); chk(6, 'подробно: итог теории, кг', x.theory_kg, tl.total_kg);
    const screen = V.tableHTML(res, 'all'), card = D.cardHTML(res, inp, ctx, 1, 'all');
    chk(6, 'экран кратко: «Факт, л» в таблице', 'есть', screen.includes('<td>' + V.num(x.fact_l) + '</td>') ? 'есть' : 'нет'); chk(6, 'экран подробно: «Факт расхода» (кг) в карточке', 'есть', card.includes('>' + V.num(x.fact_kg) + '</button>') ? 'есть' : 'нет');
    chk(6, 'экран подробно: итог теории в карточке', 'есть', card.includes(V.num(x.theory_kg)) ? 'есть' : 'нет');
    const tbk = res.totals_by_kind.main.all; chk(6, 'итог «основная химия», л: экран = Excel', tbk.fact_l, Object.entries(fl.cells).filter(([k, c]) => c.v === 'ИТОГО основная химия').map(([k]) => fl.cells[colOf(fl, 5, 'Факт, л') + k.replace(/\D+/, '')].v).pop());
  });

  // ---------- вывод таблицы ----------
  const w = [10, 54, 22, 22, 3]; const f = v => typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : String(v);
  const line = c => c.map((x, i) => (' ' + x).padEnd(w[i] + 1)).join('|');
  console.log('\nОжидалось / получилось по сценариям из задания:');
  console.log(line(['Сценарий', 'Что проверяем', 'Ожидалось', 'Получилось', '✓'])); console.log(w.map(n => '-'.repeat(n + 1)).join('+'));
  T6.forEach(r => console.log(line(['№ ' + r.sc, r.what.slice(0, w[1]), f(r.exp).slice(0, w[2]), f(r.got).slice(0, w[3]), r.good ? '✓' : '✗'])));
  console.log(`\nСценарии: ${T6.filter(r => r.good).length} из ${T6.length} проверок совпали.`);
  if (bytesFull) fs.writeFileSync(process.argv[2] || '/tmp/compare_full.xlsx', Buffer.from(bytesFull));
  console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);
  process.exit(bad ? 1 : 0);
})();
