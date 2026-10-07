const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcReport, chemUsed } = sb.module.exports;
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };

// --- 1. Смены: точная копия логики триггера set_shift() (supabase.sql), tz_offset=5, shift_start=6
const TZ = 5, ST = 6;
function shift(utcIso) {
  const loc = new Date(new Date(utcIso).getTime() + TZ * 3600e3);                 // (ts at time zone 'UTC') + tz
  const sd = new Date(loc.getTime() - ST * 3600e3).toISOString().slice(0, 10);   // (loc - st)::date
  const h = loc.getUTCHours();
  return { sd, part: h >= ST && h < ST + 12 ? 'day' : 'night' };
}
const L = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 9, d, h, m) - TZ * 3600e3).toISOString(); };   // местное время Атырау -> UTC
console.log('1. Смена и день (местное время, UTC+5)');
[['05:59', 5, 'night'], ['06:00', 6, 'day'], ['12:00', 6, 'day'], ['17:59', 6, 'day'], ['18:00', 6, 'night'], ['23:59', 6, 'night']].forEach(([h, d, p]) =>
  t(`6 окт ${h} → смена ${d} окт, ${p === 'day' ? '1 смена (день)' : '2 смена (ночь)'}`, () => { const r = shift(L(6, h)); assert.strictEqual(r.part, p); assert.strictEqual(r.sd, '2026-10-0' + d); }));
t('7 окт 00:00 → ещё смена 6 окт, ночь', () => { const r = shift(L(7, '00:00')); assert.deepStrictEqual(r, { sd: '2026-10-06', part: 'night' }); });
t('7 окт 05:59 → смена 6 окт, ночь (последняя минута суток)', () => { const r = shift(L(7, '05:59')); assert.deepStrictEqual(r, { sd: '2026-10-06', part: 'night' }); });
t('7 окт 06:00 → новая смена 7 окт, день', () => { const r = shift(L(7, '06:00')); assert.deepStrictEqual(r, { sd: '2026-10-07', part: 'day' }); });
t('сутки 06:00–06:00 = ровно 24 часа, 12 ч день + 12 ч ночь', () => {
  let day = 0, night = 0, other = 0; for (let m = 0; m < 1440 * 3; m++) { const ts = new Date(Date.UTC(2026, 9, 5, 1, 0) + m * 60e3).toISOString(); const r = shift(ts); if (r.sd !== '2026-10-05') continue; r.part === 'day' ? day++ : night++; }
  assert.strictEqual(day, 720); assert.strictEqual(night, 720); });
t('граница в UTC: 01:00 UTC = 06:00 Атырау = начало смены', () => assert.deepStrictEqual(shift('2026-10-07T01:00:00Z'), { sd: '2026-10-07', part: 'day' }));

// --- 2. Остаток вычитается из расхода
const refs = { water: 55, washTypes: [], recipes: [], chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 }] };
const chg = o => ({ id: 'c' + Math.random(), chemical_id: 1, machine_group: '1_10', ts: '2026-10-06T01:00:00Z', ...o });
const con = o => ({ id: 'k' + Math.random(), chemical_id: 1, machine_group: '1_10', ts: '2026-10-06T02:00:00Z', ...o });
const row = (r, g, id = 1) => r.groups[g].chem.find(c => c.id === id);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ожидалось ${b}, получено ${a}`);
console.log('\n2. Остаток вычитается из расхода');
t('бутыль 20 л, остаток 5 л → расход 15 л, в запасе 5 л', () => { const r = calcReport([], [chg({ leftover_l: 5 })], refs); near(row(r, 'all').actual.l, 15, 'used'); near(row(r, 'all').stock.l, 5, 'stock'); });

// --- 3. Остаток -> другой дозатор: добавляется именно тому
console.log('\n3. Остаток из одного дозатора подключён в другой');
// A: дозатор 1-10, остаток 5 л (в запас). K: остаток подключён в дозатор 11-12 (amount 5). B: замена в 11-12, остаток 2 л.
const A = chg({ id: 'A', machine_group: '1_10', ts: '2026-10-06T01:00:00Z', leftover_l: 5, connect_id: 'K' });
const K = con({ id: 'K', machine_group: '11_12', ts: '2026-10-06T02:00:00Z', amount_l: 5 });
const B = chg({ id: 'B', machine_group: '11_12', ts: '2026-10-06T03:00:00Z', leftover_l: 2 });
const r3 = calcReport([], [A, B], refs, [K]);
t('1-10: бутыль A = 20 − 5 = 15 л (остаток вычтен)', () => near(row(r3, '1_10').actual.l, 15, '1_10'));
t('11-12: ёмкость 5 л − остаток 2 л = 3 л (а не 18)', () => near(row(r3, '11_12').actual.l, 3, '11_12'));
t('итого 18 л, ничего не потеряно и не задвоено', () => near(row(r3, 'all').actual.l, 18, 'all'));
t('подключённое 5 л записано в дозатор 11-12, не в 1-10', () => { near(row(r3, '11_12').connected.l, 5, 'c1112'); near(row(r3, '1_10').connected.l, 0, 'c110'); });
t('запас: подключённый остаток A больше не лежит в запасе 1-10', () => near(row(r3, '1_10').stock.l, 0, 'stock'));
t('следующая замена в 1-10 остаётся полной бутылью (подключение в 11-12 её не трогает)', () => { const C = chg({ id: 'C', machine_group: '1_10', ts: '2026-10-06T04:00:00Z', leftover_l: 1 }); near(chemUsed(refs, [A, B, C], [K]).used.C, 19, 'C'); });
t('зеркально: остаток из 11-12 в дозатор 1-10', () => {
  const A2 = chg({ id: 'A2', machine_group: '11_12', leftover_l: 4, connect_id: 'K2' }), K2 = con({ id: 'K2', machine_group: '1_10', amount_l: 4 }), B2 = chg({ id: 'B2', machine_group: '1_10', ts: '2026-10-06T03:00:00Z', leftover_l: 1 });
  const r = calcReport([], [A2, B2], refs, [K2]); near(row(r, '11_12').actual.l, 16, '11_12'); near(row(r, '1_10').actual.l, 3, '1_10'); near(row(r, 'all').actual.l, 19, 'all'); });
t('остаток собран из двух дозаторов (3+2 л) и подключён в 1-10 → ёмкость 5 л', () => {
  const a = chg({ id: 'a', machine_group: '1_10', ts: '2026-10-05T01:00:00Z', leftover_l: 3, connect_id: 'K3' }), b = chg({ id: 'b', machine_group: '11_12', ts: '2026-10-06T01:00:00Z', leftover_l: 2, connect_id: 'K3' });
  const k = con({ id: 'K3', machine_group: '1_10', amount_l: 5 }), c = chg({ id: 'c', machine_group: '1_10', ts: '2026-10-06T05:00:00Z', leftover_l: 1 });
  const r = calcReport([], [a, b, c], refs, [k]); near(row(r, '1_10').actual.l, 17 + 4, '1_10 = (20−3)+(5−1)'); near(row(r, '11_12').actual.l, 18, '11_12'); near(row(r, 'all').actual.l, 39, 'all'); });

// --- 4. Граница суток: подключение вчера (смена 6 окт), замена сегодня (смена 7 окт)
console.log('\n4. Подключение и замена в разных сутках');
const Kd = con({ id: 'Kd', ts: L(7, '05:50'), amount_l: 5, shift_date: '2026-10-06' }), Bd = chg({ id: 'Bd', ts: L(7, '06:10'), leftover_l: 2, shift_date: '2026-10-07' });
t('отчёт за 7 окт с запасом назад (как в report.html): расход 3 л', () => near(row(calcReport([], [Bd], refs, [], { changes: [Bd], connects: [Kd] }), 'all').actual.l, 3, 'ctx'));
t('без запаса назад было бы ошибочно 18 л — код этого не допускает (передаёт 60 дней)', () => near(row(calcReport([], [Bd], refs, []), 'all').actual.l, 18, 'noctx'));
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
