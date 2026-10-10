// Этап 1 «Сравнение химии»: единый расчёт теории и факта за период. Запуск: node tests/compare.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } }; vm.createContext(sb);
['report-calc.js', 'compare-calc.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sb, { filename: f }));
const { calcCompare, chainFromRows } = sb.module.exports;
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) < eps, `${m}: ожидалось ${b}, получено ${a}`);

// местное время UTC+5, смена с 06:00
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }],
  recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 },
              { id: 2, name: 'Vanish', kind: 'extra', per_unit: 10, per_unit_unit: 'ml' }] };
// 1 стирка = 55 л × 3 мл/л = 0,165 л = 0,1815 кг (плотность 1,1)
const W = 0.1815;
const load = (ts, machine, kg = 25) => ({ ts, machine, weight_kg: kg, wash_type_id: 1 });
const take = (g, kg, ts, cid) => ({ chemical_id: 1, machine_group: g, kind: 'take', amount_kg: kg, amount_l: kg / 1.1, ts, closing_id: cid });
const pour = (g, kg, ts) => ({ chemical_id: 1, machine_group: g, kind: 'pour', amount_kg: kg, amount_l: kg / 1.1, ts });
const cl = (id, ts, a, b, kind = 'interval') => ({ id, at_ts: ts, kind, measures: { '1:1_10': a, '1:11_12': b } });
const row = (r, g = 'all', id = 1) => r.rows.find(x => x.chemical_id === id && x.group === g);

const C0 = loc('2026-10-08', 18), C1 = loc('2026-10-09', 18), C2 = loc('2026-10-10', 18);
const ld = []; for (let i = 0; i < 20; i++) ld.push(load(loc('2026-10-09', 7 + (i % 9), 10 + i), (i % 12) + 1));   // 20 стирок внутри первого периода
const base = { tz: 5, st: 6, loads: ld, changes: [], connects: [], levels: [], residents: null };

console.log('1. Нормальный период: замеры, залили обратно');
const mv1 = [take('1_10', 10, C0, 'c0'), take('11_12', 6, C0, 'c0'), pour('1_10', 10, loc('2026-10-08', 18, 5)), pour('11_12', 6, loc('2026-10-08', 18, 5)),
             take('1_10', 4, C1, 'c1'), take('11_12', 3, C1, 'c1')];
const r1 = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
t('факт = 16 − 7 = 9 кг (замеры 10+6 → 4+3)', () => near(row(r1).fact_kg, 9, 'факт'));
t('теория = 20 стирок × 0,1815 = 3,63 кг', () => near(row(r1).theory_kg, 20 * W, 'теория'));
t('отклонение = (9 − 3,63) / 3,63 = +147,9 %, статус «перерасход»', () => { near(row(r1).dev_pct, (9 - 20 * W) / (20 * W) * 100, '%'); assert.strictEqual(row(r1).status, 'over'); });
t('дозатор 1 и дозатор 2 в сумме дают «all»', () => near(row(r1, '1_10').fact_kg + row(r1, '11_12').fact_kg, row(r1).fact_kg, 'сумма'));
t('дозатор 1: 10 − 4 = 6 кг, дозатор 2: 6 − 3 = 3 кг', () => { near(row(r1, '1_10').fact_kg, 6, 'д1'); near(row(r1, '11_12').fact_kg, 3, 'д2'); });
t('литры и штуки через плотность 1,1 и бутыль 22 кг', () => { near(row(r1).fact_l, 9 / 1.1, 'л'); near(row(r1).fact_pc, 9 / 22, 'шт'); });
t('на стирку: 9 кг ÷ 1,1 = 8,18 л = 8182 мл ÷ 20 стирок', () => near(row(r1).per_wash, 9 / 1.1 * 1000 / 20, 'на стирку'));
t('на кг белья: 20 стирок × 25 кг = 500 кг', () => near(row(r1).per_kg_laundry, 9 / 1.1 * 1000 / 500, 'на кг'));
t('баланс складывается: начало + приход − конец = факт', () => { const b = row(r1).balance; near(b.start_kg + b.inflow_kg - b.end_kg, row(r1).fact_kg, 'баланс'); });
t('покрытие полное, заметки нет', () => { assert.strictEqual(r1.coverage.full, true); assert.strictEqual(r1.coverage.note, null); assert.strictEqual(r1.coverage.segments, 1); });
t('справочный факт «по заменам» помечен как неточный', () => assert.ok(/неточно/.test(row(r1).legacy_note)));
t('итог по основной химии в литрах совпадает со строкой', () => near(r1.totals_by_kind.main.all.fact_l, row(r1).fact_l, 'итого'));

console.log('2. После закрытия остаток не залит обратно');
const r2 = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: [take('1_10', 10, C0, 'c0'), take('11_12', 6, C0, 'c0')] });
t('расход отрицательный: −7 кг, статус «check»', () => { near(row(r2).fact_kg, -7, 'факт'); assert.strictEqual(row(r2).status, 'check'); });
t('есть предупреждение «negative» по обоим дозаторам', () => assert.strictEqual(r2.warnings.filter(w => w.type === 'negative').length, 2));

console.log('3. Период шире закрытий: факт только между замерами');
const outside = [load(loc('2026-10-07', 10), 1), load(loc('2026-10-07', 11), 2), load(loc('2026-10-10', 20), 3)];   // вне отрезка закрытий
const r3 = calcCompare(refs, { ...base, loads: ld.concat(outside), fromTs: loc('2026-10-07', 6), toTs: loc('2026-10-11', 6), closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
t('факт тот же, что за сам отрезок (9 кг)', () => near(row(r3).fact_kg, 9, 'факт'));
t('теория для сравнения только за отрезок закрытий', () => near(row(r3).theory_kg, 20 * W, 'теория'));
t('теория за весь запрошенный период отдельно: 23 стирки', () => near(row(r3).theory_requested_kg, 23 * W, 'теория период'));
t('сказано, за какой период реально посчитан факт', () => { assert.strictEqual(r3.coverage.full, false); assert.ok(/Факт за период закрытий/.test(r3.coverage.note)); assert.strictEqual(r3.coverage.fact_from_ts, new Date(C0).toISOString()); assert.strictEqual(r3.coverage.fact_to_ts, new Date(C1).toISOString()); });
t('стирок и белья вне отрезка не учтено в итогах факта', () => { assert.strictEqual(r3.totals.washes, 20); assert.strictEqual(r3.coverage.washes_requested, 23); });

console.log('4. Меньше двух закрытий внутри периода');
const r4 = calcCompare(refs, { ...base, fromTs: loc('2026-10-08', 20), toTs: loc('2026-10-10', 6), closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
t('факта нет, статус «nodata», теория за период есть', () => { assert.strictEqual(r4.coverage.has_fact, false); assert.strictEqual(row(r4).status, 'nodata'); assert.strictEqual(row(r4).fact_kg, null); assert.ok(row(r4).theory_requested_kg > 0); });
t('причина объяснена словами', () => assert.ok(/меньше двух закрытий|нельзя/.test(r4.coverage.note)));
t('вообще без закрытий — тоже без падения', () => { const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [], moves: [] }); assert.strictEqual(r.coverage.has_fact, false); assert.strictEqual(row(r).status, 'nodata'); });

console.log('5. Два отрезка подряд');
const ld2 = ld.concat([load(loc('2026-10-10', 8), 1), load(loc('2026-10-10', 9), 11)]);       // 2 стирки во втором отрезке
const mv5 = mv1.concat([pour('1_10', 4, loc('2026-10-09', 18, 5)), pour('11_12', 3, loc('2026-10-09', 18, 5)), take('1_10', 1, C2, 'c2'), take('11_12', 1, C2, 'c2')]);
const r5 = calcCompare(refs, { ...base, loads: ld2, fromTs: C0, toTs: C2, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3), cl('c2', C2, 1, 1)], moves: mv5 });
t('два отрезка, покрытие полное', () => { assert.strictEqual(r5.segments.length, 2); assert.strictEqual(r5.coverage.full, true); });
t('факт = (16 − 7) + (7 − 2) = 14 кг', () => near(row(r5).fact_kg, 14, 'факт'));
t('теория = 22 стирки', () => near(row(r5).theory_kg, 22 * W, 'теория'));
t('баланс по всей цепочке сходится', () => { const b = row(r5).balance; near(b.start_kg + b.inflow_kg - b.end_kg, row(r5).fact_kg, 'баланс'); });
t('замеры можно передать в любом порядке', () => { const r = calcCompare(refs, { ...base, loads: ld2, fromTs: C0, toTs: C2, closings: [cl('c2', C2, 1, 1), cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv5 }); near(row(r).fact_kg, 14, 'факт'); });

console.log('6. Граница закрытия посреди смены (18:00)');
t('стирка в 17:59 в периоде, в 18:00 и позже уже в следующем', () => {
  const l = [load(loc('2026-10-09', 17, 59), 1), load(loc('2026-10-09', 18, 0), 1), load(loc('2026-10-09', 18, 30), 1)];
  const r = calcCompare(refs, { ...base, loads: l, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
  assert.strictEqual(r.totals.washes, 1); near(row(r).theory_kg, W, 'теория');
});

console.log('7. Нет замера на конец');
t('нет замера → факт пустой, «nodata», проблема «missing»', () => {
  const c1 = { id: 'c1', at_ts: C1, kind: 'interval', measures: { '1:1_10': 4 } };
  const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), c1], moves: mv1 });
  assert.strictEqual(row(r).fact_kg, null); assert.strictEqual(row(r).status, 'nodata');
  assert.ok(r.problems.some(p => p.type === 'missing'));
  near(row(r, '1_10').fact_kg, 6, 'дозатор 1 при этом посчитан');
});

console.log('8. Доп. средства и прочее');
t('доп. средство без замеров показано только теорией (theory_only)', () => {
  const l = [{ ...load(loc('2026-10-09', 9), 1), extras: { 2: 3 } }];
  const r = calcCompare(refs, { ...base, loads: l, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1 });
  assert.strictEqual(r.theory_only.length, 1); assert.strictEqual(r.theory_only[0].name, 'Vanish'); near(r.theory_only[0].theory_l, 0.03, 'теория доп.');
});
t('допуск «в норме» берётся из tolPct: при 200 % та же разница уже «ok»', () => { const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 4, 3)], moves: mv1, tolPct: 200 }); assert.strictEqual(row(r).status, 'ok'); });
t('недорасход: замер на конце выше ожидаемого → «under»', () => {
  const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 10, 6, 'start'), cl('c1', C1, 12.5, 3.2)], moves: mv1.map(m => m.closing_id === 'c1' ? { ...m, amount_kg: m.machine_group === '1_10' ? 12.5 : 3.2 } : m) });
  near(row(r).fact_kg, 16 - 15.7, 'факт'); assert.strictEqual(row(r).status, 'under');
});
t('chainFromRows собирает цепочку из строк БД', () => {
  const ch = chainFromRows([{ id: 'b', at_ts: C1, kind: 'interval' }, { id: 'a', at_ts: C0, kind: 'start' }],
    [{ closing_id: 'a', chemical_id: 1, machine_group: '1_10', amount_kg: '10' }, { closing_id: 'a', chemical_id: 1, machine_group: '11_12', amount_kg: '6' }, { closing_id: 'b', chemical_id: 1, machine_group: '1_10', amount_kg: '4' }, { closing_id: 'b', chemical_id: 1, machine_group: '11_12', amount_kg: '3' }]);
  assert.strictEqual(ch[0].id, 'a'); assert.strictEqual(ch[0].measures['1:1_10'], 10);
  near(row(calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: ch, moves: mv1 })).fact_kg, 9, 'факт');
});
t('неверный период (конец раньше начала) не падает', () => { const r = calcCompare(refs, { ...base, fromTs: C1, toTs: C0, closings: [] }); assert.ok(r.problems.length); });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);
process.exit(bad ? 1 : 0);
