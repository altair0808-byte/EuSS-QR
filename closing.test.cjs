// Этап 15: закрытие по замерам. Запуск: node tests/closing.test.cjs
// Баланс: расход факт = остаток на начало + приход (нетто) − остаток на конец. Проверяем на цифрах и случайным моделированием.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcClosing, dispenserFlows, boundaryTs, chemUsed } = sb.module.exports;
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ожидалось ${b}, получено ${a}`);

// Период: смены 1–6 окт 2026 (замер 1 окт 06:00 → замер 7 окт 06:00, местное UTC+5). Химикат: бутыль 20 л = 20 кг (плотность 1).
const FROM = '2026-10-01', TO = '2026-10-07';
const T = h => new Date(Date.parse(boundaryTs(FROM, 5, 6)) + h * 3600e3).toISOString();   // h часов после первого замера
const refs = { water: 55, washTypes: [{ id: 1, name: 'W' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 20 }] };
let n = 0; const id = p => p + (++n);
const chg = (h, left, g = '1_10') => ({ id: id('c'), chemical_id: 1, machine_group: g, ts: T(h), leftover_kg: left, leftover_l: left });
const con = (h, kg, g = '1_10') => ({ id: id('k'), chemical_id: 1, machine_group: g, ts: T(h), amount_kg: kg, amount_l: kg });
const mov = (h, kind, kg, g = '1_10') => ({ id: id('m'), chemical_id: 1, machine_group: g, ts: T(h), kind, amount_kg: kg, amount_l: kg });
const lev = (h, kg, g = '1_10') => ({ id: id('l'), chemical_id: 1, machine_group: g, ts: T(h), amount_kg: kg, amount_l: kg });
const run = (o, r = refs) => calcClosing(r, { from: FROM, to: TO, tz: 5, st: 6, startKg: { '1:1_10': 0, '1:11_12': 0 }, endKg: { '1:1_10': 0, '1:11_12': 0 }, loads: [], changes: [], connects: [], moves: [], levels: [], ...o });
const row = (res, g = '1_10') => res.rows.find(r => r.group === g && r.chemical_id === 1);

console.log('1. Пример из задания: было 60, пришло 40, осталось 55 → расход 45');
t('две новые бутыли по 20 кг (остатки 0): приход 40', () => near(row(run({ changes: [chg(10, 0), chg(50, 0)] })).inflow_kg, 40, 'приход'));
t('60 + 40 − 55 = 45', () => { const r = row(run({ startKg: { '1:1_10': 60, '1:11_12': 0 }, endKg: { '1:1_10': 55, '1:11_12': 0 }, changes: [chg(10, 0), chg(50, 0)] })); near(r.fact_kg, 45, 'факт'); });
t('замеры за период без событий: 60 → 52, расход 8', () => near(row(run({ startKg: { '1:1_10': 60, '1:11_12': 0 }, endKg: { '1:1_10': 52, '1:11_12': 0 } })).fact_kg, 8, 'факт'));

console.log('\n2. Каждое событие прихода в отдельности');
const inflow = o => row(run(o)).inflow_kg;
t('замена: новая бутыль 20 минус остаток старой 5 = +15 (остаток ушёл в запас)', () => near(inflow({ changes: [chg(5, 5)] }), 15, 'замена'));
t('замена без остатка (не указан): +20 и предупреждение', () => { const r = run({ changes: [{ id: 'x', chemical_id: 1, machine_group: '1_10', ts: T(5) }] }); near(row(r).inflow_kg, 20, 'приход'); assert.ok(r.warnings.some(w => w.type === 'noLeft')); });
t('замена: остаток больше ёмкости обрезается до ёмкости (как в chemUsed) и есть предупреждение', () => { const r = run({ changes: [chg(5, 25)] }); near(row(r).inflow_kg, 0, 'приход'); assert.ok(r.warnings.some(w => w.type === 'clipped')); });
t('залили из запаса (pour) 7 кг: +7', () => near(inflow({ moves: [mov(5, 'pour', 7)] }), 7, 'pour'));
t('суперадмин добавил (add) 10 кг: +10 (chem_add)', () => near(inflow({ moves: [mov(5, 'add', 10)] }), 10, 'add'));
t('забрали (take) 5 кг: −5', () => near(inflow({ moves: [mov(5, 'take', 5)] }), -5, 'take'));
t('замена + подключение: бутыль не ставили, вместо неё остаток 5 → ≈ −остаток старой + 5', () => {
  // замена (остаток 5 → в запас): +20 −5; подключили этот остаток: +5 −20 («вместо бутыли») → 0
  near(inflow({ changes: [chg(5, 5)], connects: [con(5.1, 5)] }), 0, 'замена+подключение'); });
t('второе подключение только добавляется (бутыль уже заменена первым)', () => near(inflow({ changes: [chg(5, 5)], connects: [con(5.1, 5), con(5.2, 3)] }), 3, 'два подключения'));
t('«в дозаторе реально было 12 кг» сразу после замены: вместо 20 влили 12', () => near(inflow({ changes: [chg(5, 0)], levels: [lev(5.1, 12)] }), 12, 'уровень'));
t('другой дозатор события не видит', () => { const r = run({ changes: [chg(5, 0, '11_12')] }); near(row(r, '1_10').inflow_kg, 0, '1_10'); near(row(r, '11_12').inflow_kg, 20, '11_12'); });
t('события до замера и после замера в приход не входят', () => near(inflow({ changes: [chg(-5, 0), chg(24 * 6 + 1, 0)], moves: [mov(-1, 'add', 9)] }), 0, 'вне периода'));
t('событие ровно в момент замера относится к следующему периоду, ровно в начало — к этому', () => {
  near(inflow({ changes: [{ ...chg(0, 0), ts: boundaryTs(TO, 5, 6) }] }), 0, 'на конце');
  near(inflow({ changes: [{ ...chg(0, 0), ts: boundaryTs(FROM, 5, 6) }] }), 20, 'на начале'); });
t('состояние на начало периода берётся из истории: подключение до периода, замена в периоде', () => {
  // до периода подключили 6 кг (ёмкость = 6, бутыль была заменена), в периоде замена: приход 20 − остаток 1
  near(inflow({ changes: [chg(-10, 0), chg(5, 1)], connects: [con(-9, 6)] }), 20 - 1, 'приход'); });

console.log('\n3. Сходимость: баланс = то, что реально ушло (случайное моделирование)');
// физика: в дозаторе L кг; расход между событиями; замена — старое содержимое уходит в запас (его вводят как остаток), ставится бутыль 20;
// подключение/уровень — сразу после замены. Замеры случайные. Баланс обязан дать ровно суммарный расход.
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function simulate(seed) {
  const R = rng(seed); let L = 5 + R() * 15, h = 0.5, used = 0, startKg = L; const changes = [], connects = [], moves = [], levels = [];
  const burn = () => { const c = Math.min(L, R() * 6); L -= c; used += c; };
  for (;;) {
    const nh = h + 0.3 + R() * 6; if (nh > 24 * 6 - 0.5) break;   // события только внутри периода
    burn(); h = nh;
    const k = R();
    if (k < 0.4) { changes.push(chg(h, L)); L = 20;                                    // замена
      const j = R(); h += 0.01;
      if (j < 0.25) { const a = 2 + R() * 10; connects.push(con(h, a)); L = a; }       // вместо бутыли подключили остаток
      else if (j < 0.4) { const a = R() * 20; levels.push(lev(h, a)); L = a; } }       // реально влили меньше
    else if (k < 0.6) { const a = R() * 8; moves.push(mov(h, 'pour', a)); L += a; }
    else if (k < 0.8) { const a = R() * L; moves.push(mov(h, 'add', a)); L += a; }
    else { const a = R() * L; moves.push(mov(h, 'take', a)); L -= a; }
  }
  burn();
  return { startKg, endKg: L, used, changes, connects, moves, levels };
}
t('300 случайных периодов: факт по балансу совпал с реальным расходом до 1e-9 кг', () => {
  for (let s = 1; s <= 300; s++) {
    const m = simulate(s); const r = row(run({ startKg: { '1:1_10': m.startKg, '1:11_12': 0 }, endKg: { '1:1_10': m.endKg, '1:11_12': 0 }, changes: m.changes, connects: m.connects, moves: m.moves, levels: m.levels }));
    assert.ok(Math.abs(r.fact_kg - m.used) < 1e-9, `seed ${s}: ждали ${m.used}, получили ${r.fact_kg}`); } });
function simulate2(seed) {   // то же, но с промежуточным замером ровно в середине (4 окт 06:00 = 72 ч)
  const R = rng(seed); let L = 5 + R() * 15, h = 0.5, used = 0, used1 = null, mid = null; const startKg = L, changes = [], connects = [], moves = [], levels = [];
  const burn = () => { const c = Math.min(L, R() * 6); L -= c; used += c; };
  const measure = () => { burn(); mid = L; used1 = used; };
  for (;;) {
    const nh = h + 0.3 + R() * 6; if (nh > 24 * 6 - 0.5) break;
    if (mid == null && nh >= 72) { measure(); }          // замер в момент стыка; события потом идут уже во втором периоде
    burn(); h = nh;
    const k = R();
    if (k < 0.4) { changes.push(chg(h, L)); L = 20; const j = R(); h += 0.01;
      if (j < 0.25) { const a = 2 + R() * 10; connects.push(con(h, a)); L = a; } else if (j < 0.4) { const a = R() * 20; levels.push(lev(h, a)); L = a; } }
    else if (k < 0.6) { const a = R() * 8; moves.push(mov(h, 'pour', a)); L += a; }
    else if (k < 0.8) { const a = R() * L; moves.push(mov(h, 'add', a)); L += a; }
    else { const a = R() * L; moves.push(mov(h, 'take', a)); L -= a; }
  }
  if (mid == null) measure();
  burn();
  return { startKg, mid, endKg: L, used1, used2: used - used1, changes, connects, moves, levels };
}
t('промежуточный замер: два периода по отдельности = реальному расходу каждого, сумма = общему (300 случаев)', () => {
  for (let s = 1; s <= 300; s++) {
    const m = simulate2(s), ev = { changes: m.changes, connects: m.connects, moves: m.moves, levels: m.levels, loads: [] };
    // события строго внутри своих периодов (границу 72 ч моделирование не пересекает): отбираем по времени, как делает расчёт
    const a = row(calcClosing(refs, { from: FROM, to: '2026-10-04', tz: 5, st: 6, startKg: { '1:1_10': m.startKg, '1:11_12': 0 }, endKg: { '1:1_10': m.mid, '1:11_12': 0 }, ...ev }));
    const b = row(calcClosing(refs, { from: '2026-10-04', to: TO, tz: 5, st: 6, startKg: { '1:1_10': m.mid, '1:11_12': 0 }, endKg: { '1:1_10': m.endKg, '1:11_12': 0 }, ...ev }));
    assert.ok(Math.abs(a.fact_kg - m.used1) < 1e-9, `seed ${s}, период 1: ждали ${m.used1}, получили ${a.fact_kg}`);
    assert.ok(Math.abs(b.fact_kg - m.used2) < 1e-9, `seed ${s}, период 2: ждали ${m.used2}, получили ${b.fact_kg}`);
    assert.ok(Math.abs(a.fact_kg + b.fact_kg - (m.used1 + m.used2)) < 1e-9); } });
t('два подряд идущих периода стыкуются: сумма двух = один общий период', () => {
  const m = simulate(7), mid = 'tmp'; // замер посередине берём из моделирования не получится — проверяем на отрезках без событий
  const A = run({ startKg: { '1:1_10': 50, '1:11_12': 0 }, endKg: { '1:1_10': 44, '1:11_12': 0 }, to: '2026-10-04' });
  const Bp = calcClosing(refs, { from: '2026-10-04', to: '2026-10-07', tz: 5, st: 6, startKg: { '1:1_10': 44, '1:11_12': 0 }, endKg: { '1:1_10': 30, '1:11_12': 0 }, loads: [], changes: [], connects: [], moves: [], levels: [] });
  near(row(A).fact_kg + row(Bp).fact_kg, 50 - 30, 'сумма'); });
t('событие в стык двух периодов считается ровно один раз', () => {
  const ev = { changes: [{ ...chg(0, 0), ts: boundaryTs('2026-10-04', 5, 6) }] };
  const a = row(calcClosing(refs, { from: FROM, to: '2026-10-04', tz: 5, st: 6, startKg: {}, endKg: { '1:1_10': 0, '1:11_12': 0 }, loads: [], connects: [], moves: [], levels: [], ...ev })).inflow_kg;
  const b = row(calcClosing(refs, { from: '2026-10-04', to: TO, tz: 5, st: 6, startKg: {}, endKg: { '1:1_10': 0, '1:11_12': 0 }, loads: [], connects: [], moves: [], levels: [], ...ev })).inflow_kg;
  near(a + b, 20, 'один раз'); near(a, 0, 'первый период'); });

console.log('\n4. Связь со старым фактом «по замене» и теорией');
t('замеры прямо после замен: баланс = старый факт (бутыль 20, остаток 2 → расход 18)', () => {
  // начало: свежая бутыль 20 (замер сразу после прошлой замены); замена с остатком 2; конец: опять свежая бутыль 20
  const c = chg(30, 2), A = run({ startKg: { '1:1_10': 20, '1:11_12': 0 }, endKg: { '1:1_10': 20, '1:11_12': 0 }, changes: [chg(-30, 0), c] });
  near(row(A).fact_kg, 18, 'баланс'); near(chemUsed(refs, [chg(-30, 0), c], []).used[c.id], 18, 'chemUsed');
  near(row(A).old_fact_kg, 18, 'старый факт в строке'); });
t('теория: 2 загрузки по 55 л × 3 мл/л = 0,33 кг; отклонение и % считаются', () => {
  const loads = [{ id: 'a', ts: T(3), machine: 2, wash_type_id: 1, weight_kg: 25, extras: {}, part: 'day' }, { id: 'b', ts: T(4), machine: 3, wash_type_id: 1, weight_kg: 35, extras: {}, part: 'day' }];
  const r = row(run({ startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 9.5, '1:11_12': 0 }, loads }));
  near(r.theory_kg, 0.33, 'теория'); near(r.fact_kg, 0.5, 'факт'); near(r.dev_kg, 0.17, 'отклонение'); near(r.dev_pct, 0.17 / 0.33 * 100, '%');
  near(r.per_kg_laundry, 500 / 60, 'мл на кг белья'); near(r.per_wash, 250, 'мл на стирку'); });
t('загрузка вне периода в теорию не входит', () => near(row(run({ loads: [{ id: 'z', ts: T(-3), machine: 2, wash_type_id: 1, weight_kg: 25, extras: {}, part: 'day' }] })).theory_kg, 0, 'теория'));
t('на жителя: расход / сумма проживающих по сменам; нет данных → null; неполные данные → предупреждение', () => {
  const res = { '2026-10-01': 10, '2026-10-02': 10, '2026-10-03': 10, '2026-10-04': 10, '2026-10-05': 10, '2026-10-06': 10 };
  const o = { startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 9, '1:11_12': 0 } };
  near(row(run({ ...o, residents: res }), 'all').per_resident_day, 1000 / 60, 'мл/жителя'); assert.strictEqual(row(run(o), 'all').per_resident_day, null);
  const part = run({ ...o, residents: { '2026-10-01': 10 } }); assert.ok(part.warnings.some(w => w.type === 'residents')); });
t('итог «оба дозатора» = сумма дозаторов', () => { const r = run({ startKg: { '1:1_10': 30, '1:11_12': 20 }, endKg: { '1:1_10': 25, '1:11_12': 18 } }); near(row(r, 'all').fact_kg, 7, 'all'); near(row(r, 'all').start_kg, 50, 'start'); });

console.log('\n5. Граничные случаи');
t('нет замера на конец: закрыть нельзя, сказано какого именно', () => { const r = run({ endKg: { '1:1_10': 5 } }); assert.strictEqual(r.canClose, false); const p = r.problems.find(x => x.type === 'missing'); assert.strictEqual(p.group, '11_12'); assert.ok(p.text.includes('EMULSIFIER') && p.text.includes('дозатор 2')); });
t('нет плотности: закрыть нельзя, просим задать в настройках', () => {
  const r2 = { ...refs, chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20 }] }; const r = run({}, r2);
  assert.strictEqual(r.canClose, false); assert.ok(r.problems.some(p => p.type === 'density' && /настройк/.test(p.text))); });
t('расход отрицательный: предупреждение (не блокировка)', () => { const r = run({ startKg: { '1:1_10': 10, '1:11_12': 0 }, endKg: { '1:1_10': 12, '1:11_12': 0 } }); assert.ok(r.canClose); assert.ok(r.warnings.some(w => w.type === 'negative' && w.value < 0)); });
t('расход выше теории больше порога: предупреждение; в пределах порога — нет', () => {
  const loads = [{ id: 'a', ts: T(3), machine: 2, wash_type_id: 1, weight_kg: 25, extras: {}, part: 'day' }];   // теория 0,165
  const o = { startKg: { '1:1_10': 10, '1:11_12': 0 }, loads };
  assert.ok(run({ ...o, endKg: { '1:1_10': 9.5, '1:11_12': 0 } }).warnings.some(w => w.type === 'over'));
  assert.ok(!run({ ...o, endKg: { '1:1_10': 9.8, '1:11_12': 0 } }).warnings.some(w => w.type === 'over'));       // 0,2 против 0,165 = +21 % < 25 %
  assert.ok(!run({ ...o, endKg: { '1:1_10': 9.5, '1:11_12': 0 }, warnPct: 500 }).warnings.some(w => w.type === 'over')); });
t('новый химикат без начального замера: принят 0 с предупреждением, не блокировка', () => { const r = run({ startKg: {} }); assert.ok(r.canClose); assert.ok(r.warnings.some(w => w.type === 'start_assumed')); });
t('доп. средство закрывается, только если отмечено «ведётся на дозаторе» (in_closing)', () => {
  const ex = { id: 8, name: 'Порошок', kind: 'extra', per_unit: 175, per_unit_unit: 'g' };
  const base = { ...refs, chemicals: [...refs.chemicals, ex] };
  assert.ok(!run({}, base).rows.some(r => r.chemical_id === 8));
  const on = { ...refs, chemicals: [...refs.chemicals, { ...ex, in_closing: true }] };
  const r = run({ loads: [{ id: 'a', ts: T(3), machine: 2, wash_type_id: 1, weight_kg: 25, extras: { 8: 2 }, part: 'day' }] }, on);
  near(r.rows.find(x => x.chemical_id === 8 && x.group === '1_10').theory_kg, 0.35, 'порошок 2 × 175 г');
  assert.ok(r.problems.some(p => p.type === 'missing' && p.chemical_id === 8)); });
t('единицы: кг, литры (через плотность 1,1) и штуки (бутыль 22 кг)', () => {
  const r2 = { ...refs, chemicals: [{ id: 1, name: 'E', kind: 'main', bottle_l: 20, bottle_kg: 22 }] };
  const r = row(run({ startKg: { '1:1_10': 44, '1:11_12': 0 }, endKg: { '1:1_10': 33, '1:11_12': 0 } }, r2));
  near(r.fact_kg, 11, 'кг'); near(r.fact_l, 10, 'л'); near(r.fact_pc, 0.5, 'шт'); });
t('замена с остатком в литрах пересчитывается в кг по плотности', () => {
  const r2 = { ...refs, chemicals: [{ id: 1, name: 'E', kind: 'main', bottle_l: 20, bottle_kg: 22 }] };
  near(row(run({ changes: [{ id: 'q', chemical_id: 1, machine_group: '1_10', ts: T(5), leftover_l: 5 }] }, r2)).inflow_kg, 22 - 5.5, 'приход'); });

console.log('\n6. Старые расчёты не тронуты');
t('calcReport по-прежнему отдаёт те же поля', () => { const r = sb.module.exports.calcReport([], [chg(5, 2)], refs, [], null); assert.ok(r.groups.all.chem[0].actual && r.groups.all.chem[0].theory); });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
