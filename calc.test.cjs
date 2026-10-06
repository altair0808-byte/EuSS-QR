// Этап 1: проверка расчётов (report-calc.js). Запуск: node tests/calc.test.cjs
const assert = require('assert');
// report-calc.js — браузерный скрипт (package.json: type=module), поэтому грузим его через vm
const fs = require('fs'), vm = require('vm'), path = require('path');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sandbox);
const { calcReport, chemUsed } = sandbox.module.exports;

const refs = {
  water: 55,
  washTypes: [{ id: 1, name: 'Постель белая' }, { id: 2, name: 'Униформа' }],
  chemicals: [
    { id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 },   // плотность 1.1 кг/л
    { id: 6, name: 'Ваниш', kind: 'extra', per_unit: 5, per_unit_unit: 'ml' },
    { id: 8, name: 'Порошок', kind: 'extra', per_unit: 175, per_unit_unit: 'g' },
  ],
  recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }, { wash_type_id: 2, chemical_id: 1, ml_per_l: 5 }],
};
const load = (o = {}) => ({ id: 'l' + Math.random(), machine: 3, wash_type_id: 1, weight_kg: 25, part: 'day', extras: {}, ...o });
const chg = (o = {}) => ({ id: 'c' + Math.random(), chemical_id: 1, machine_group: '1_10', ts: '2026-10-06T01:00:00Z', ...o });
const con = (o = {}) => ({ id: 'k' + Math.random(), chemical_id: 1, machine_group: '1_10', ts: '2026-10-06T02:00:00Z', ...o });
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ожидалось ${b}, получено ${a}`);
const row = (r, g = 'all', id = 1) => r.groups[g].chem.find(c => c.id === id);

let ok = 0, fail = 0;
const t = (name, fn) => { try { fn(); ok++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } };

console.log('Теория (по рецептам)');
t('1 загрузка: 55 л × 3 мл/л = 0.165 л', () => near(row(calcReport([load()], [], refs), 'all').theory.l, 0.165, 'theory'));
t('разные виды стирки суммируются', () => near(row(calcReport([load(), load({ wash_type_id: 2 })], [], refs)).theory.l, 0.165 + 0.275, 'theory'));
t('доп. химия: Порошок 2 шт × 175 г = 0.35 кг', () => near(row(calcReport([load({ extras: { 8: 2 } })], [], refs), 'all', 8).theory.kg, 0.35, 'powder'));
t('доп. химия: Ваниш 3 шт × 5 мл = 0.015 л', () => near(row(calcReport([load({ extras: { 6: 3 } })], [], refs), 'all', 6).theory.l, 0.015, 'vanish'));

console.log('Вес, количество, смены, дозаторы');
t('машины 10 и 11 попадают в разные дозаторы', () => {
  const r = calcReport([load({ machine: 10 }), load({ machine: 11, weight_kg: 30 })], [], refs);
  assert.strictEqual(r.groups['1_10'].total, 1); assert.strictEqual(r.groups['11_12'].total, 1);
  assert.strictEqual(r.groups.all.total, 2); near(r.groups['11_12'].kg, 30, 'kg 11_12'); near(r.kg, 55, 'kg total');
});
t('день/ночь считаются отдельно', () => {
  const r = calcReport([load(), load(), load({ part: 'night' })], [], refs);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.byPart)), { day: 2, night: 1 });
});
t('вес и счётчик по видам стирки', () => {
  const r = calcReport([load(), load({ weight_kg: 10 }), load({ wash_type_id: 2 })], [], refs);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.byWash)), { 1: { n: 2, kg: 35 }, 2: { n: 1, kg: 25 } });
});
t('пересчёт после удаления загрузки', () => {
  const a = load(), b = load();
  const full = calcReport([a, b], [], refs), cut = calcReport([a], [], refs);
  assert.strictEqual(full.total - cut.total, 1); near(row(full).theory.l - row(cut).theory.l, 0.165, 'delta');
});
t('вес приходит строкой из БД (numeric)', () => near(calcReport([load({ weight_kg: '25.5' })], [], refs).kg, 25.5, 'kg'));

console.log('Факт расхода (замена бутылей)');
t('бутыль 20 л, остаток 5 л → ушло 15 л', () => {
  const r = calcReport([], [chg({ leftover_l: 5 })], refs); near(row(r).actual.l, 15, 'used'); near(row(r).actual.kg, 16.5, 'kg');
});
t('остаток в кг: 11 кг = 10 л → ушло 10 л', () => near(row(calcReport([], [chg({ leftover_kg: 11 })], refs)).actual.l, 10, 'used'));
t('пустая бутыль (остаток 0) → ушло 20 л, штук 1', () => {
  const r = row(calcReport([], [chg({ leftover_l: 0, leftover_kg: 0 })], refs)); near(r.actual.l, 20, 'used'); near(r.actual.pc, 1, 'pcs');
});
t('остаток больше бутыли ограничивается размером', () => near(row(calcReport([], [chg({ leftover_l: 99 })], refs)).actual.l, 0, 'used'));
t('нет данных об остатке → noLeft=1', () => assert.strictEqual(row(calcReport([], [chg()], refs)).noLeft, 1));
t('отклонение от теории: diff и % ', () => {
  const r = row(calcReport([load()], [chg({ leftover_l: 5 })], refs)); near(r.diff, 15 - 0.165, 'diff'); near(r.pct, (15 - 0.165) / 0.165 * 100, 'pct');
});
t('замены разных дозаторов не смешиваются', () => {
  const r = calcReport([], [chg({ leftover_l: 5 }), chg({ machine_group: '11_12', leftover_l: 10 })], refs);
  near(row(r, '1_10').actual.l, 15, '1_10'); near(row(r, '11_12').actual.l, 10, '11_12'); near(row(r, 'all').actual.l, 25, 'all');
});

console.log('Подключение остатка');
t('после подключения 5 л следующая замена = 5 − 2 = 3 л (а не 18)', () => {
  const A = chg({ id: 'A', ts: '2026-10-06T01:00:00Z', leftover_l: 5, connect_id: 'K' }), B = chg({ id: 'B', ts: '2026-10-06T03:00:00Z', leftover_l: 2 });
  const K = con({ id: 'K', ts: '2026-10-06T02:00:00Z', amount_l: 5 });
  const u = chemUsed(refs, [A, B], [K]).used; near(u.A, 15, 'A'); near(u.B, 3, 'B');
  near(row(calcReport([], [A, B], refs, [K])).actual.l, 18, 'sum');
});
t('подключение в 11–12 не влияет на дозатор 1–10', () => {
  const B = chg({ id: 'B', ts: '2026-10-06T03:00:00Z', leftover_l: 2 });
  near(chemUsed(refs, [B], [con({ machine_group: '11_12', amount_l: 5 })]).used.B, 18, 'B');
});
t('остаток в запасе: без connect_id учитывается, с connect_id — нет', () => {
  near(row(calcReport([], [chg({ leftover_l: 5 })], refs)).stock.l, 5, 'stock free');
  near(row(calcReport([], [chg({ leftover_l: 5, connect_id: 'K' })], refs, [con({ id: 'K', amount_l: 5 })])).stock.l, 0, 'stock connected');
});
t('согласованность запаса и расхода, когда остаток > подключённого (граничный случай)', () => {
  // подключили 5 л, а в замене указан остаток 8 л: расход ограничен ёмкостью 5, запас — min(бутыль, 8)
  const B = chg({ id: 'B', ts: '2026-10-06T03:00:00Z', leftover_l: 8 });
  const r = row(calcReport([], [B], refs, [con({ amount_l: 5 })]));
  near(r.actual.l, 0, 'used'); assert.ok(r.stock.l <= 5 + 1e-9, 'в запас записано ' + r.stock.l + ' л при ёмкости 5 л');
});

console.log(`\nИтого: ${ok} прошло, ${fail} не прошло`);
process.exit(fail ? 1 : 0);
