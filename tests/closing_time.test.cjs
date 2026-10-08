// Этап 1 (закрытие отчётов): закрытие в любую минуту, забор остатка при закрытии, поля снимка. Запуск: node tests/closing_time.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcClosing, boundaryTs, shiftDateOf } = sb.module.exports;
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${m}: ожидалось ${b}, получено ${a}`);

// местное время UTC+5, смена с 06:00. loc('2026-10-05', 14, 37) — 5 окт 14:37 местного
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }, { id: 2, name: 'Полотенца' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 20 }] };
const Z = { '1:1_10': 0, '1:11_12': 0 };
const ld = (ts, kg = 30, machine = 2, wt = 1) => ({ id: 'l' + ts, ts, machine, wash_type_id: wt, weight_kg: kg, extras: {}, part: 'day' });
const run = o => calcClosing(refs, { tz: 5, st: 6, startKg: Z, endKg: Z, loads: [], changes: [], connects: [], moves: [], levels: [], ...o });
const row = (r, g = '1_10') => r.rows.find(x => x.group === g && x.chemical_id === 1);

console.log('1. Закрытие в любую минуту');
const F = loc('2026-10-01', 6), TO = loc('2026-10-05', 14, 37);
t('период [замер, замер): стирки после момента закрытия и ровно в него не входят', () => {
  const r = run({ fromTs: F, toTs: TO, loads: [ld(loc('2026-10-05', 14, 36)), ld(TO), ld(loc('2026-10-05', 14, 38)), ld(loc('2026-10-01', 5, 59))] });
  assert.strictEqual(r.totals.washes, 1);
});
t('стирка ровно в момент прошлого замера входит (период полуоткрытый)', () => assert.strictEqual(run({ fromTs: F, toTs: TO, loads: [ld(F)] }).totals.washes, 1));
t('в снимке есть from_ts, to_ts и длительность в сутках', () => {
  const r = run({ fromTs: F, toTs: TO });
  assert.strictEqual(r.from_ts, F); assert.strictEqual(r.to_ts, TO);
  near(r.days_exact, 4 + (8 * 60 + 37) / 1440, 'сутки', 1e-6);
});
t('смен 5: 1–4 окт целиком и 5 окт до 14:37', () => assert.strictEqual(run({ fromTs: F, toTs: TO }).days, 5));
t('дата смены: 03:00 утра 5 окт ещё смена 4 окт', () => assert.strictEqual(shiftDateOf(loc('2026-10-05', 3), 5, 6), '2026-10-04'));
t('закрытие в 03:00 утра: последняя смена — вчерашняя, неполная', () => {
  const r = run({ fromTs: F, toTs: loc('2026-10-05', 3) });
  assert.strictEqual(r.days, 4); near(r.days_exact, 3 + 21 / 24, 'сутки', 1e-9);
});
t('жителей-суток считается долями смен', () => {
  const res = { '2026-10-01': 100, '2026-10-02': 100, '2026-10-03': 100, '2026-10-04': 100, '2026-10-05': 100 };
  const r = run({ fromTs: F, toTs: TO, residents: res });
  near(r.totals.resident_days, 100 * (4 + (8 * 60 + 37) / 1440), 'жителе-суток', 1e-6);
});
t('нет проживающих за смену — предупреждение', () => assert.ok(run({ fromTs: F, toTs: TO, residents: { '2026-10-01': 100 } }).warnings.some(w => w.type === 'residents')));
t('даты from/to (старый способ) дают тот же период, что и моменты в 06:00', () => {
  const a = run({ from: '2026-10-01', to: '2026-10-05', loads: [ld(loc('2026-10-03', 10))] }), b = run({ fromTs: loc('2026-10-01', 6), toTs: loc('2026-10-05', 6), loads: [ld(loc('2026-10-03', 10))] });
  assert.strictEqual(a.totals.washes, b.totals.washes); near(a.days_exact, b.days_exact, 'сутки'); assert.strictEqual(a.days, b.days);
});
t('раскладка по видам стирки для листа Excel', () => {
  const r = run({ fromTs: F, toTs: TO, loads: [ld(loc('2026-10-02', 9), 30, 2, 1), ld(loc('2026-10-02', 10), 20, 12, 1), ld(loc('2026-10-03', 9), 10, 3, 2)] });
  const w1 = r.washes_by_type.find(x => x.id === 1), w2 = r.washes_by_type.find(x => x.id === 2);
  assert.deepStrictEqual([w1.g1.n, w1.g2.n, w1.all.n, w1.all.kg], [1, 1, 2, 50]); assert.strictEqual(w2.all.n, 1);
});

console.log('\n2. Остаток дозатора при закрытии уходит в запас (забор с closing_id в момент замера)');
const take = (kg, closing, g = '1_10') => ({ id: 'tk', chemical_id: 1, machine_group: g, ts: F, kind: 'take', amount_kg: kg, amount_l: kg, closing_id: closing });
const pour = (h, kg) => ({ id: 'p' + h, chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-02', h), kind: 'pour', amount_kg: kg, amount_l: kg });
t('забор при закрытии не входит в приход: дозатор начинается с нуля', () => {
  const r = row(run({ fromTs: F, toTs: TO, startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 3, '1:11_12': 0 }, moves: [take(10, 'c1'), pour(9, 5)] }));
  near(r.start_measured_kg, 10, 'замер'); near(r.to_reserve_in_kg, 10, 'в запас'); near(r.start_kg, 0, 'с нуля'); near(r.inflow_kg, 5, 'приход'); near(r.fact_kg, 2, 'факт');
  near(r.start_kg + r.inflow_kg - r.end_kg, r.fact_kg, 'баланс из колонок листа');
});
t('факт тот же, если забор не помечен closing_id (обычное «забрал из дозатора»)', () => {
  const a = row(run({ fromTs: F, toTs: TO, startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 3, '1:11_12': 0 }, moves: [take(10, 'c1'), pour(9, 5)] }));
  const b = row(run({ fromTs: F, toTs: TO, startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 3, '1:11_12': 0 }, moves: [take(10, null), pour(9, 5)] }));
  near(a.fact_kg, b.fact_kg, 'факт'); near(b.to_reserve_in_kg, 0, 'в запас'); near(b.flows.takes, 10, 'забрано');
});
t('забор самого этого закрытия (в момент конца периода) в период не попадает', () => {
  const r = row(run({ fromTs: F, toTs: TO, startKg: Z, endKg: { '1:1_10': 4, '1:11_12': 0 }, moves: [{ id: 'x', chemical_id: 1, machine_group: '1_10', ts: TO, kind: 'take', amount_kg: 4, closing_id: 'c2' }] }));
  near(r.flows.takes, 0, 'забрано'); near(r.fact_kg, -4, 'факт без учёта забора (замер 4 при старте 0)');
});
t('итог по двум дозаторам складывает замер и запас', () => {
  const r = run({ fromTs: F, toTs: TO, startKg: { '1:1_10': 10, '1:11_12': 6 }, endKg: Z, moves: [take(10, 'c1'), take(6, 'c1', '11_12')] });
  const a = row(r, 'all'); near(a.start_measured_kg, 16, 'замер'); near(a.to_reserve_in_kg, 16, 'в запас'); near(a.start_kg, 0, 'с нуля');
});

console.log('\n3. Закрытый отчёт хранится как снимок');
t('снимок переживает JSON: ничего не теряется и не пересчитывается при чтении', () => {
  const r = run({ fromTs: F, toTs: TO, startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 3, '1:11_12': 0 }, moves: [take(10, 'c1'), pour(9, 5)], loads: [ld(loc('2026-10-02', 9))] });
  const { arr, ...rest } = r, back = JSON.parse(JSON.stringify({ ...rest, warn_pct: 25, version: 1 }));
  near(row(back).fact_kg, row(r).fact_kg, 'факт'); assert.strictEqual(back.from_ts, F); assert.strictEqual(back.totals.washes, 1);
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
