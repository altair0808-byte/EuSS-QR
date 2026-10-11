// Учёт остатка бутыли при замене и его подключения. Запуск: node tests/leftover_connect.test.cjs
// Правило: подключённый остаток только ДОБАВЛЯЕТСЯ к дозатору, новую бутыль не заменяет и не вычитает.
//   приход нетто = новые бутыли − остатки замен + подключённые остатки + залито из запаса + добавлено суперадмином − забрано ± поправка по уровню
// Правило единое для ВСЕХ записей (и старых, и новых): признака «вместо бутыли» больше нет.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcClosing, chemUsed, boundaryTs } = sb.module.exports;
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ожидалось ${b}, получено ${a}`);

// Химикат: бутыль 20 л = 20,64 кг (плотность 1,032) — как в примере из задания (2 бутыли = 41,28 кг)
const BOT_L = 20, BOT_KG = 20.64;
const FROM = '2026-10-01', TO = '2026-10-07';
const T = h => new Date(Date.parse(boundaryTs(FROM, 5, 6)) + h * 3600e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'W' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: BOT_L, bottle_kg: BOT_KG }] };
let n = 0; const id = p => p + (++n);
const chg = (h, left, g = '1_10') => ({ id: id('c'), chemical_id: 1, machine_group: g, ts: T(h), leftover_kg: left });
const con = (h, kg, g = '1_10', extra = {}) => ({ id: id('k'), chemical_id: 1, machine_group: g, ts: T(h), amount_kg: kg, ...extra });
const mov = (h, kind, kg, g = '1_10') => ({ id: id('m'), chemical_id: 1, machine_group: g, ts: T(h), kind, amount_kg: kg });
const lev = (h, kg, g = '1_10') => ({ id: id('l'), chemical_id: 1, machine_group: g, ts: T(h), amount_kg: kg });
const Z = { '1:1_10': 0, '1:11_12': 0 };
const run = o => calcClosing(refs, { from: FROM, to: TO, tz: 5, st: 6, startKg: Z, endKg: Z, loads: [], changes: [], connects: [], moves: [], levels: [], ...o });
const row = (res, g = '1_10') => res.rows.find(r => r.group === g && r.chemical_id === 1);

console.log('1. Пример из задания: 2 бутыли (41,28 кг), остатки 2,98 кг слили и подключили');
// два остатка (1,5 + 1,48 = 2,98) убрали при замене, слили вместе и подключили одной записью 2,98
const ex = () => run({ endKg: { '1:1_10': 17.62, '1:11_12': 0 }, changes: [chg(10, 1.5), chg(50, 1.48)], connects: [con(51, 2.98)] });
t('приход нетто = 41,28 − 2,98 + 2,98 = 41,28 кг (раньше получалось 20,64)', () => near(row(ex()).inflow_kg, 41.28, 'приход нетто'));
t('замер на начало 0, на конец 17,62 → факт 23,66 кг', () => near(row(ex()).fact_kg, 23.66, 'факт'));
t('строка «вместо бутыли» в балансе равна 0', () => near(row(ex()).flows.replacedByConnect, 0, 'вместо бутыли'));
t('разложение: бутыли 41,28 · остатки замен −2,98 · подключено +2,98', () => {
  const b = row(ex()).flows; near(b.bottles, 41.28, 'бутыли'); near(b.leftovers, 2.98, 'остатки замен'); near(b.connects, 2.98, 'подключено'); });

console.log('\n2. Замена без подключения остатка — как раньше');
t('замена с остатком 5, без подключения: +20,64 − 5', () => near(row(run({ changes: [chg(5, 5)] })).inflow_kg, BOT_KG - 5, 'приход'));
t('замена без остатка: +бутыль и предупреждение', () => { const r = run({ changes: [{ id: 'x', chemical_id: 1, machine_group: '1_10', ts: T(5) }] }); near(row(r).inflow_kg, BOT_KG, 'приход'); assert.ok(r.warnings.some(w => w.type === 'noLeft')); });
t('остаток больше ёмкости бутыли обрезается и даёт предупреждение (как раньше)', () => { const r = run({ changes: [chg(5, 25)] }); near(row(r).inflow_kg, 0, 'приход'); assert.ok(r.warnings.some(w => w.type === 'clipped')); });
const D = BOT_KG / BOT_L;   // плотность: chemUsed считает в литрах (основная единица химиката — л)
t('chemUsed без подключений: расход замены = 20 л − остаток (в литрах)', () => { const m = chg(5, 5); near(chemUsed(refs, [m], [], [], []).used[m.id], BOT_L - 5 / D, 'расход'); });

console.log('\n3. Остаток подключён в другой дозатор');
// из дозатора 1 убрали бутыль с остатком 3 кг, поставили новую; 3 кг перелили в дозатор 2 (машины 11–12)
const x = () => run({ changes: [chg(10, 3, '1_10')], connects: [con(10.1, 3, '11_12')] });
t('дозатор-источник: новая бутыль +20,64, остаток замены −3 → приход 17,64', () => near(row(x(), '1_10').inflow_kg, BOT_KG - 3, '1_10'));
t('дозатор-получатель: подключённый остаток +3 (бутыль не меняется)', () => near(row(x(), '11_12').inflow_kg, 3, '11_12'));
t('итог по двум дозаторам: как при замене бутыли, остаток не потерян: 20,64', () => near(row(x(), '1_10').inflow_kg + row(x(), '11_12').inflow_kg, BOT_KG, 'сумма'));
t('зеркально: остаток из 11–12 в дозатор 1–10', () => { const r = run({ changes: [chg(10, 2, '11_12')], connects: [con(10.1, 2, '1_10')] }); near(row(r, '11_12').inflow_kg, BOT_KG - 2, '11_12'); near(row(r, '1_10').inflow_kg, 2, '1_10'); });
t('ёмкость получателя при его следующей замене = бутыль + подключённый остаток (расход считается от суммы)', () => {
  const c2 = chg(20, 0, '11_12'); near(chemUsed(refs, [c2], [con(10.1, 3, '11_12')], [], []).used[c2.id], BOT_L + 3 / D, 'расход, л');
  const c3 = chg(20, 0, '1_10'); near(chemUsed(refs, [c3], [con(10.1, 3, '11_12')], [], []).used[c3.id], BOT_L, 'другой дозатор не затронут'); });

console.log('\n4. Старая запись «вместо бутыли» теперь считается по новому правилу');
t('старая запись подключения (без каких-либо признаков) = «в дополнение к бутыли»', () => near(row(run({ changes: [chg(5, 5)], connects: [con(5.1, 5)] })).inflow_kg, BOT_KG, 'приход'));
t('любые прежние служебные поля в записи подключения на расчёт не влияют', () => near(row(run({ changes: [chg(5, 5)], connects: [con(5.1, 5, '1_10', { instead_of_bottle: true, mode: 'instead' })] })).inflow_kg, BOT_KG, 'приход'));
t('несколько подключений подряд только добавляются', () => near(row(run({ changes: [chg(5, 5)], connects: [con(5.1, 5), con(5.2, 3)] })).inflow_kg, BOT_KG - 5 + 5 + 3, 'приход'));
t('подключение без замены (бутыль стояла с начала): просто +остаток', () => near(row(run({ connects: [con(5, 4)] })).inflow_kg, 4, 'приход'));

console.log('\n5. Поправка по уровню и остальные потоки учитывают подключённый остаток');
t('«в дозаторе реально было X» после подключения: поправка = X − (бутыль + подключённый)', () => {
  const r = row(run({ changes: [chg(5, 0)], connects: [con(5.1, 4)], levels: [lev(5.2, 15)] })); near(r.inflow_kg, BOT_KG + 4 + (15 - (BOT_KG + 4)), 'приход'); near(r.inflow_kg, 15, 'итого = X'); });
t('залили из запаса / забрали после подключения', () => near(row(run({ changes: [chg(5, 0)], connects: [con(5.1, 4)], moves: [mov(6, 'pour', 7), mov(7, 'take', 2)] })).inflow_kg, BOT_KG + 4 + 7 - 2, 'приход'));

console.log('\n6. Случайные периоды: баланс = реальному расходу при новой модели (300 случаев)');
const rng = s => () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
function simulate(seed) {
  const R = rng(seed); let L = 5 + R() * 15, h = 0.5, used = 0; const startKg = L, changes = [], connects = [], moves = [], levels = [];
  const burn = () => { const c = Math.min(L, R() * 6); L -= c; used += c; };
  for (;;) {
    const nh = h + 0.3 + R() * 6; if (nh > 24 * 6 - 0.5) break;
    burn(); h = nh;
    const k = R();
    if (k < 0.4) { changes.push(chg(h, L)); L = BOT_KG; const j = R(); h += 0.01;      // старая бутыль убрана, остаток L ушёл, новая бутыль
      if (j < 0.25) { const a = 2 + R() * 10; connects.push(con(h, a)); L += a; }      // остаток ДОБАВИЛИ к новой бутыли
      else if (j < 0.4) { const a = R() * BOT_KG; levels.push(lev(h, a)); L = a; } }
    else if (k < 0.6) { const a = R() * 8; moves.push(mov(h, 'pour', a)); L += a; }
    else if (k < 0.8) { const a = R() * L; moves.push(mov(h, 'add', a)); L += a; }
    else { const a = R() * L; moves.push(mov(h, 'take', a)); L -= a; }
  }
  burn();
  return { startKg, endKg: L, used, changes, connects, moves, levels };
}
t('факт по балансу совпал с реальным расходом до 1e-9 кг', () => {
  for (let s = 1; s <= 300; s++) {
    const m = simulate(s); const r = row(run({ startKg: { '1:1_10': m.startKg, '1:11_12': 0 }, endKg: { '1:1_10': m.endKg, '1:11_12': 0 }, changes: m.changes, connects: m.connects, moves: m.moves, levels: m.levels }));
    assert.ok(Math.abs(r.fact_kg - m.used) < 1e-9, `seed ${s}: ждали ${m.used}, получили ${r.fact_kg}`); } });
t('и два периода с промежуточным замером в сумме дают общий (границу 72 ч событие не пересекает)', () => {
  for (let s = 1; s <= 100; s++) {
    const m = simulate(s), whole = row(run({ startKg: { '1:1_10': m.startKg, '1:11_12': 0 }, endKg: { '1:1_10': m.endKg, '1:11_12': 0 }, changes: m.changes, connects: m.connects, moves: m.moves, levels: m.levels }));
    assert.ok(Math.abs(whole.fact_kg - m.used) < 1e-9); } });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
