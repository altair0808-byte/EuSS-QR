// Этап 2 «Учёт химикатов»: поступление в общий запас, распределение по дозаторам, списание, остатки.
// Запуск: node tests/stock.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcReport, chemUsed, calcClosing, calcReserve, reserveAtKg, dispenserLevelsAt, dispenserFlows } = sb.module.exports;

// химикат 1: бутыль 20 л = 22 кг (плотность 1,1)
const CH = { id: 1, name: 'E', kind: 'main', bottle_l: 20, bottle_kg: 22 };
const refs = { water: 55, washTypes: [{ id: 1, name: 'W' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 10 }], chemicals: [CH] };
let n = 0;
const id = p => p + (++n);
const mv = o => ({ id: id('m'), chemical_id: 1, machine_group: '1_10', ts: '2026-10-07T02:00:00Z', ...o });
const rc = (kg, ts, o) => mv({ kind: 'receipt', machine_group: 'stock', amount_kg: kg, amount_l: kg / 1.1, ts, ...o });
const po = (kg, g, ts, o) => mv({ kind: 'pour', machine_group: g, amount_kg: kg, amount_l: kg / 1.1, ts, ...o });
const tk = (kg, g, ts, o) => mv({ kind: 'take', machine_group: g, amount_kg: kg, amount_l: kg / 1.1, ts, ...o });
const wo = (kg, ts, o) => mv({ kind: 'writeoff', machine_group: 'stock', amount_kg: kg, amount_l: kg / 1.1, ts, ...o });
const chg = o => ({ id: id('c'), chemical_id: 1, machine_group: '1_10', ts: '2026-10-07T05:00:00Z', ...o });

let ok = 0, bad = 0;
const t = (name, f) => { try { f(); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, '\n    ', e.message); } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ждали ${b}, получили ${a}`);
const row = (r, g) => r.groups[g].chem.find(c => c.id === 1);
const ev = o => ({ changes: [], connects: [], moves: [], levels: [], loads: [], ...o });

console.log('Общий запас на момент времени');
t('поступление 100 кг → запас 100 кг', () => near(reserveAtKg(CH, ev({ moves: [rc(100, '2026-10-01T00:00:00Z')] }), '2026-10-02T00:00:00Z'), 100, 'запас'));
t('запись после момента не учитывается', () => near(reserveAtKg(CH, ev({ moves: [rc(100, '2026-10-03T00:00:00Z')] }), '2026-10-02T00:00:00Z'), 0, 'запас'));
t('поступило 100, залито в дозатор 22, списано 5 → 73', () => near(reserveAtKg(CH, ev({ moves: [rc(100, '2026-10-01T00:00:00Z'), po(22, '1_10', '2026-10-02T00:00:00Z'), wo(5, '2026-10-03T00:00:00Z')] }), '2026-10-04T00:00:00Z'), 73, 'запас'));
t('забрали из дозатора 4 кг → запас растёт', () => near(reserveAtKg(CH, ev({ moves: [rc(10, '2026-10-01T00:00:00Z'), tk(4, '11_12', '2026-10-02T00:00:00Z')] }), '2026-10-04T00:00:00Z'), 14, 'запас'));
t('старая запись «add» (в дозатор напрямую) запас не меняет', () => near(reserveAtKg(CH, ev({ moves: [rc(10, '2026-10-01T00:00:00Z'), mv({ kind: 'add', amount_kg: 50, ts: '2026-10-02T00:00:00Z' })] }), '2026-10-04T00:00:00Z'), 10, 'запас'));
t('остаток замены лежит в запасе, пока не подключён; подключение его убирает', () => {
  const c1 = chg({ id: 'A', leftover_kg: 3 }), k = { id: 'K1', chemical_id: 1, machine_group: '1_10', ts: '2026-10-08T00:00:00Z' };
  near(reserveAtKg(CH, ev({ changes: [c1] }), '2026-10-09T00:00:00Z'), 3, 'до подключения');
  near(reserveAtKg(CH, ev({ changes: [{ ...c1, connect_id: 'K1' }], connects: [k] }), '2026-10-09T00:00:00Z'), 0, 'после');
  near(reserveAtKg(CH, ev({ changes: [{ ...c1, connect_id: 'K1' }], connects: [k] }), '2026-10-07T12:00:00Z'), 3, 'на момент до подключения остаток ещё в запасе');
});
t('списанный остаток замены в запас не входит', () => near(reserveAtKg(CH, ev({ changes: [chg({ leftover_kg: 3, written_off_at: '2026-10-07T07:00:00Z' })] }), '2026-10-09T00:00:00Z'), 0, 'запас'));
t('литры без кг считаются по плотности', () => near(reserveAtKg(CH, ev({ moves: [mv({ kind: 'receipt', machine_group: 'stock', amount_l: 10, ts: '2026-10-01T00:00:00Z' })] }), '2026-10-02T00:00:00Z'), 11, 'запас'));

console.log('Баланс запаса за период (calcReserve)');
const A = '2026-10-07T01:00:00Z', B = '2026-10-08T01:00:00Z';
t('баланс сходится: начало + поступило − залито − списано + забрано = конец', () => {
  const E = ev({ moves: [rc(100, '2026-10-05T00:00:00Z'), rc(40, '2026-10-07T03:00:00Z'), po(22, '1_10', '2026-10-07T04:00:00Z'), tk(3, '11_12', '2026-10-07T09:00:00Z'), wo(7, '2026-10-07T20:00:00Z')] });
  const r = calcReserve(refs, E, A, B, {})[0];
  near(r.start_kg, 100, 'начало'); near(r.receipts_kg, 40, 'поступило'); near(r.pours_kg, 22, 'залито'); near(r.takes_kg, 3, 'забрано'); near(r.writeoff_moves_kg, 7, 'списано');
  near(r.end_kg, 114, 'конец'); near(r.check_kg, 0, 'контроль');
});
t('закрытие: забор остатка дозаторов в момент замера — отдельно (close_in), не «забрано»', () => {
  const E = ev({ moves: [rc(50, '2026-10-01T00:00:00Z'), tk(8, '1_10', A, { closing_id: 'cl1' }), tk(2, '11_12', A, { closing_id: 'cl1' })] });
  const r = calcReserve(refs, E, A, B, {})[0];
  near(r.start_before_kg, 50, 'запас до замера'); near(r.close_in_kg, 10, 'ушло из дозаторов'); near(r.start_kg, 60, 'начало'); near(r.takes_kg, 0, 'забрано'); near(r.end_kg, 60, 'конец');
});
t('остаток замены + подключение + списание остатка: контроль = 0', () => {
  const old = chg({ id: 'O', leftover_kg: 4, ts: '2026-10-03T00:00:00Z', connect_id: 'K1' }), nw = chg({ id: 'N', leftover_kg: 5, ts: '2026-10-07T05:00:00Z' }), dead = chg({ id: 'D', leftover_kg: 6, ts: '2026-10-07T06:00:00Z', written_off_at: '2026-10-07T10:00:00Z' });
  const k = { id: 'K1', chemical_id: 1, machine_group: '1_10', ts: '2026-10-07T08:00:00Z' };
  const r = calcReserve(refs, ev({ changes: [old, nw, dead], connects: [k] }), A, B, {})[0];
  near(r.start_kg, 4, 'начало'); near(r.leftovers_kg, 11, 'остатки'); near(r.connected_kg, 4, 'подключено'); near(r.writeoff_leftovers_kg, 6, 'списано остатков'); near(r.end_kg, 5, 'конец'); near(r.check_kg, 0, 'контроль');
});
t('запас после прошлого закрытия (reserveStart) важнее расчёта по событиям', () => {
  const r = calcReserve(refs, ev({ moves: [rc(40, '2026-10-07T03:00:00Z')] }), A, B, {}, { 1: 100 })[0];
  near(r.start_kg, 100, 'начало'); near(r.end_kg, 140, 'конец');
});
t('замеры дозаторов на конец уходят в запас при закрытии: после = конец + замеры', () => {
  const r = calcReserve(refs, ev({ moves: [rc(10, '2026-10-07T03:00:00Z')] }), A, B, { '1:1_10': 6, '1:11_12': 2 })[0];
  near(r.end_kg, 10, 'конец'); near(r.close_out_kg, 8, 'замеры'); near(r.after_kg, 18, 'после закрытия'); near(r.disp_1_10_kg, 6, 'д1'); near(r.disp_11_12_kg, 2, 'д2');
});

console.log('Отчёт по химии (calcReport)');
const chL = (kg, ts, g) => chg({ leftover_kg: kg, ts, machine_group: g || '1_10' });
t('строка «Итого»: поступило и списано видны, запас = поступило − списано', () => {
  const r = calcReport([], [], refs, [], null, [rc(30, '2026-10-07T03:00:00Z'), wo(11, '2026-10-07T04:00:00Z')]);
  const a = row(r, 'all'); near(a.received.kg, 30, 'поступило'); near(a.writtenOff.kg, 11, 'списано'); near(a.stock.kg, 19, 'запас');
});
t('поступление и списание НЕ попадают в «залили» и не меняют расход', () => {
  const C = [chL(4, '2026-10-07T05:00:00Z')];
  const base = row(calcReport([], C, refs, [], null, []), 'all'), withR = row(calcReport([], C, refs, [], null, [rc(30, '2026-10-07T03:00:00Z'), wo(5, '2026-10-07T04:00:00Z')]), 'all');
  near(withR.actual.kg, base.actual.kg, 'расход'); assert.ok(!(withR.put && withR.put.kg > 0), 'залито должно быть 0');
});
t('по дозаторам поступление не видно (оно общее), залив виден только у своего дозатора', () => {
  const r = calcReport([], [], refs, [], null, [rc(30, '2026-10-07T03:00:00Z'), po(11, '11_12', '2026-10-07T04:00:00Z')]);
  near(row(r, '1_10').put.kg, 0, 'д1 залито'); near(row(r, '11_12').put.kg, 11, 'д2 залито'); near(row(r, '1_10').received.kg, 0, 'д1 поступило'); near(row(r, 'all').received.kg, 30, 'всего поступило'); near(row(r, 'all').stock.kg, 19, 'запас');
});
t('расход дозатора: поступление в запас не создаёт «приход» дозатора', () => {
  const f = dispenserFlows(CH, '1_10', A, B, { changes: [], connects: [], levels: [], moves: [rc(30, '2026-10-07T03:00:00Z'), wo(5, '2026-10-07T04:00:00Z')] });
  near(f.pours, 0, 'залито'); near(f.adds, 0, 'добавлено'); near(f.inflow, 0, 'приход');
});
t('заливка из запаса = приход дозатора (22 кг) и расход запаса', () => {
  const E = { changes: [], connects: [], levels: [], moves: [rc(30, '2026-10-07T03:00:00Z'), po(22, '1_10', '2026-10-07T04:00:00Z')] };
  near(dispenserFlows(CH, '1_10', A, B, E).pours, 22, 'приход дозатора'); near(reserveAtKg(CH, E, B), 8, 'запас');
});
t('chemUsed: поступление и списание не сдвигают расход замены', () => {
  const C = [chg({ id: 'X', leftover_l: 5 })];
  near(chemUsed(refs, C, [], [rc(30, '2026-10-07T03:00:00Z'), wo(5, '2026-10-07T04:00:00Z')]).used.X, 15, 'расход');
});

console.log('Остатки по дозаторам (dispenserLevelsAt)');
const load = (machine, ts) => ({ id: id('l'), machine, wash_type_id: 1, weight_kg: 25, ts });
t('после замены бутыли дозатор полон (20 л), у соседнего нет истории — тоже полный', () => {
  const L = dispenserLevelsAt(refs, ev({ changes: [chg({ ts: '2026-10-07T02:00:00Z' })] }), '2026-10-07T03:00:00Z')[1];
  near(L['1_10'], 20, 'д1'); near(L['11_12'], 20, 'д2');
});
t('стирки вычитают расход: 55 л воды × 10 мл/л = 0,55 л на стирку', () => {
  const E = ev({ changes: [chg({ ts: '2026-10-07T02:00:00Z' })], loads: [load(1, '2026-10-07T03:00:00Z'), load(2, '2026-10-07T04:00:00Z'), load(11, '2026-10-07T04:30:00Z')] });
  const L = dispenserLevelsAt(refs, E, '2026-10-07T10:00:00Z')[1]; near(L['1_10'], 20 - 1.1, 'д1');
  const E2 = ev({ changes: [chg({ ts: '2026-10-07T02:00:00Z', machine_group: '11_12' })], loads: E.loads });
  near(dispenserLevelsAt(refs, E2, '2026-10-07T10:00:00Z')[1]['11_12'], 20 - 0.55, 'д2');
});
t('залили из запаса 5 л — дозатор +5; поступление и списание дозатор не меняют', () => {
  const base = ev({ changes: [chg({ ts: '2026-10-07T02:00:00Z' })], loads: [load(1, '2026-10-07T03:00:00Z')] });
  const lv = (m) => dispenserLevelsAt(refs, { ...base, moves: m }, '2026-10-07T10:00:00Z')[1]['1_10'];
  const b = lv([]); near(lv([rc(50, '2026-10-07T03:30:00Z'), wo(5, '2026-10-07T03:40:00Z')]), b, 'поступление/списание');
  near(lv([po(5.5, '1_10', '2026-10-07T04:00:00Z')]), b + 5, 'заливка');
  near(lv([tk(2.2, '1_10', '2026-10-07T04:00:00Z')]), b - 2, 'забрали');
});
t('поступление, сразу залитое в дозатор (chem_receipt с p_pour_group): запас не меняется, дозатор растёт', () => {
  const base = ev({ changes: [chg({ ts: '2026-10-07T02:00:00Z' })] });
  const M = [rc(11, '2026-10-07T04:00:00Z'), po(11, '11_12', '2026-10-07T04:00:00Z')];
  near(dispenserLevelsAt(refs, { ...base, moves: M }, '2026-10-07T10:00:00Z')[1]['11_12'], 20 + 10, 'д2');
  near(reserveAtKg(CH, { ...base, moves: M }, '2026-10-07T10:00:00Z'), 0, 'запас');
});

console.log('Закрытие: лист «Запас»');
t('calcClosing заполняет reserve: поступило и списано попадают в закрытие', () => {
  const E = { changes: [], connects: [], levels: [], loads: [], moves: [rc(40, '2026-10-07T03:00:00Z'), wo(6, '2026-10-07T09:00:00Z')] };
  const r = calcClosing(refs, { fromTs: A, toTs: B, tz: 5, st: 6, startKg: { '1:1_10': 0, '1:11_12': 0 }, endKg: { '1:1_10': 1, '1:11_12': 1 }, reserveStart: { 1: 10 }, ...E });
  assert.strictEqual(r.reserve.length, 1); const z = r.reserve[0];
  near(z.start_kg, 10, 'начало'); near(z.receipts_kg, 40, 'поступило'); near(z.writeoff_moves_kg, 6, 'списано'); near(z.end_kg, 44, 'конец'); near(z.after_kg, 46, 'после закрытия');
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);
process.exit(bad ? 1 : 0);
