// Подключённый остаток: пример из задания проходит через сравнение, «Подробно», краткий/полный Excel и Excel закрытия.
// Закрытые периоды не меняются при чтении; пересчёт прежних закрытий идёт только через closing_recalc с резервной копией (stage22.sql).
// Запуск: node tests/leftover_ui.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) < eps, `${m}: ожидалось ${b}, получено ${a}`);

const sb = { module: { exports: {} }, console, TextEncoder, Uint8Array, Date, Math, Promise, setImmediate, JSON }; vm.createContext(sb);
['num.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js', 'xlsx-writer.js', 'compare-detail.js', 'compare-xlsx.js', 'closing-xlsx.js'].forEach(f => vm.runInContext(rd(f), sb, { filename: f }));
const ev = s => vm.runInContext(s, sb);
const D = ev('CompareDetail'), X = ev('CompareXlsx'), CX = ev('ClosingXlsx'), calcCompare = ev('calcCompare'), calcClosing = ev('calcClosing');

const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 20.64 }] };
const C0 = loc('2026-10-08', 18), C1 = loc('2026-10-09', 18);
const loads = []; for (let i = 0; i < 20; i++) loads.push({ id: 'l' + i, ts: loc('2026-10-09', 7 + (i % 9), 10 + i), machine: (i % 10) + 1, weight_kg: 25, wash_type_id: 1 });
const changes = [{ id: 'ch1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-09', 7), leftover_kg: 1.5 }, { id: 'ch2', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-09', 9), leftover_kg: 1.48 }];
const connects = [{ id: 'cn1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-09', 9, 5), amount_kg: 2.98 }];
const take = (g, kg, ts, cid, id) => ({ id, chemical_id: 1, machine_group: g, kind: 'take', amount_kg: kg, ts, closing_id: cid, created_by: 'u1' });
const moves = [take('1_10', 17.62, C1, 'c1', 'm1')];
const cl = (id, ts, a, b, kind = 'interval') => ({ id, at_ts: ts, kind, measures: { '1:1_10': a, '1:11_12': b } });
const resAll = {}; for (let d = 6; d <= 12; d++) resAll['2026-10-' + String(d).padStart(2, '0')] = 100;
const inp = { tz: 5, st: 6, loads, changes, connects, levels: [], residents: resAll, fromTs: C0, toTs: C1, closings: [cl('c0', C0, 0, 0, 'start'), cl('c1', C1, 17.62, 0)], moves };
const res = calcCompare(refs, inp);
const row = (r, g = 'all') => r.rows.find(x => x.chemical_id === 1 && x.group === g);
const ctx = { refs, names: { u1: 'Админ' }, meta: { c0: { closed_by: 'u1', closed_at: C0, kind: 'start' }, c1: { closed_by: 'u1', closed_at: C1 } }, tz: 5, st: 6, etalon: null, prev: null };
const genAt = '2026-10-10T07:30:00.000Z';

console.log('Сценарий 6: экран «Сравнение», «Подробно» и краткий вид');
t('сравнение: приход нетто 41,28 кг, факт 23,66 кг', () => { const b = row(res).balance; near(b.inflow_kg, 41.28, 'приход нетто'); near(row(res).fact_kg, 23.66, 'факт'); });
t('«Подробно»: подключено 2,98 · вместо бутыли 0 · приход нетто 41,28 · факт 23,66', () => {
  const L = D.balanceLines(row(res).balance), g = k => L.find(l => l.key === k).kg;
  near(g('connects'), 2.98, 'подключено'); near(g('replacedByConnect'), 0, 'вместо бутыли'); near(g('bottles'), 41.28, 'бутыли'); near(g('leftovers'), 2.98, 'остатки замен'); near(g('inflow'), 41.28, 'приход'); near(g('fact'), 23.66, 'факт'); });
t('«Подробно»: сумма строк баланса = приход нетто', () => { const L = D.balanceLines(row(res).balance), g = k => L.find(l => l.key === k).kg;
  near(g('bottles') - g('leftovers') + g('connects') + g('replacedByConnect') + g('pours') + g('adds') - g('takes') + g('levelAdj'), g('inflow'), 'сумма'); });
t('дозатор 2 не затронут (приход 0)', () => near(row(res, '11_12').balance.inflow_kg, 0, 'дозатор 2'));

console.log('\nСценарий 6: Excel сравнения (краткий и полный)');
const unzip = buf => { const f = {}; let o = 0; while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) { const csz = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28); f[buf.slice(o + 30, o + 30 + nl).toString('utf8')] = buf.slice(o + 30 + nl + el, o + 30 + nl + el + csz); o += 30 + nl + el + csz; } return f; };
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const readXlsx = bytes => { const f = unzip(Buffer.from(bytes)), wbx = f['xl/workbook.xml'].toString(); const nm = [...wbx.matchAll(/<sheet name="([^"]*)"/g)].map(m => unesc(m[1]));
  return nm.map((n, i) => { const x = f['xl/worksheets/sheet' + (i + 1) + '.xml'].toString(), cells = {};
    for (const m of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const body = m[3] || '', nv = /<v>([^<]*)<\/v>/.exec(body), ts = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body); cells[m[1]] = nv ? +nv[1] : ts ? unesc(ts[1]) : null; }
    return { name: n, cells }; }); };
const nums = sh => Object.values(sh.cells).filter(v => typeof v === 'number');
const has = (sh, v) => nums(sh).some(x => Math.abs(x - v) < 1e-6);
const full = readXlsx(X.build(res, inp, ctx, { view: 'full', isAdmin: true, generatedAt: genAt }).toBytes());
const brief = readXlsx(X.build(res, inp, ctx, { view: 'brief', isAdmin: true, generatedAt: genAt }).toBytes());
t('полный Excel, лист «Баланс прихода»: 41,28 и 23,66, а «вместо бутыли» = 0', () => { const s = full.find(x => x.name === 'Баланс прихода'); assert.ok(s, 'нет листа'); assert.ok(has(s, 41.28), 'нет 41,28'); assert.ok(has(s, 23.66), 'нет 23,66'); assert.ok(has(s, 2.98), 'нет 2,98'); });
t('краткий и полный Excel: лист «Кратко» с одинаковыми числами', () => { const a = nums(brief[0]).join(';'), b = nums(full[0]).join(';'); assert.strictEqual(a, b); });
t('«Кратко»: факт в литрах = 23,66 кг ÷ плотность 1,032', () => assert.ok(has(full[0], 23.66 / 1.032), 'нет факта в литрах'));
t('в тексте «Как считается» нет «− бутыль, вместо которой подключили остаток»', () => { const s = full.find(x => x.name === 'Как считается'); const all = Object.values(s.cells).filter(v => typeof v === 'string').join(' '); assert.ok(!/−\s*бутыль,? вместо/.test(all)); assert.ok(/только добавля/.test(all)); });

console.log('\nExcel закрытия и закрытые периоды');
const F = C0, TO = C1;
const snap = calcClosing(refs, { fromTs: F, toTs: TO, tz: 5, st: 6, startKg: { '1:1_10': 0, '1:11_12': 0 }, endKg: { '1:1_10': 17.62, '1:11_12': 0 }, loads, changes, connects, levels: [], moves, residents: resAll });
const c = { id: 'c1', kind: 'interval', at_ts: TO, period_from: F, boundary_date: '2026-10-09', month_key: '2026-10', opens_month: '2026-10', late: false, is_etalon: true, needs_recalc: false, note: '', closed_at: TO, snapshot: { ...snap, warn_pct: 25, version: 2 } };
const cctx = { tz: 5, st: 6, warnPct: 25, startMeas: { '1:1_10': 0, '1:11_12': 0 }, endMeas: { '1:1_10': 17.62, '1:11_12': 0 }, chemicals: refs.chemicals, prev: null, etalon: c };
const cbook = sheet => readXlsx(CX.build(c, cctx).toBytes()).find(x => x.name === sheet);
t('новое закрытие: снимок хранит приход нетто 41,28 и факт 23,66', () => { const r = snap.rows.find(x => x.group === '1_10'); near(r.inflow_kg, 41.28, 'приход'); near(r.fact_kg, 23.66, 'факт'); near(r.flows.replacedByConnect, 0, 'вместо бутыли'); });
t('Excel закрытия показывает те же 41,28 и 23,66', () => { const books = readXlsx(CX.build(c, cctx).toBytes()); assert.ok(books.some(s => has(s, 41.28)), 'нет 41,28'); assert.ok(books.some(s => has(s, 23.66)), 'нет 23,66'); });
t('закрытый период не пересчитывается при чтении: в Excel остаётся то, что лежит в снимке (старое значение 20,64)', () => {
  const old = JSON.parse(JSON.stringify(c));   // имитация старого закрытия: прежнее правило (подключение заменило бутыль) → приход 20,64, факт 3,02; у дозатора 1 и у строки «оба»
  old.snapshot.rows.filter(x => x.group === '1_10' || x.group === 'all').forEach(r => { r.inflow_kg = 20.64; r.fact_kg = 3.02; r.fact_l = 3.02 / 1.032; if (r.flows) { r.flows.inflow = 20.64; r.flows.replacedByConnect = -20.64; } if (r.balance) { r.balance.inflow_kg = 20.64; r.balance.replacedByConnect = -20.64; } });
  const books = readXlsx(CX.build(old, { ...cctx, etalon: old }).toBytes()); assert.ok(books.some(s => has(s, 20.64)), 'старый приход потерян'); assert.ok(books.some(s => has(s, 3.02)), 'старый факт потерян'); assert.ok(!books.some(s => has(s, 23.66)), 'снимок пересчитался при чтении (появился новый факт 23,66)'); });
t('calcClosing не меняет входные данные и переданный снимок', () => { const a = JSON.stringify(c.snapshot); calcClosing(refs, { fromTs: F, toTs: TO, tz: 5, st: 6, startKg: {}, endKg: {}, loads, changes, connects, levels: [], moves }); assert.strictEqual(JSON.stringify(c.snapshot), a); });

console.log('\nМиграция stage22.sql и пересчёт (статическая проверка)');
const s22 = rd('stage22.sql'), s18 = rd('stage18.sql'), page = rd('closings-report.html');
t('stage22 копирует снимки в резервную таблицу без перезаписи при повторном запуске', () => { assert.ok(/create table if not exists closings_backup_stage22/.test(s22)); assert.ok(/on conflict \(closing_id\) do nothing/.test(s22)); });
t('stage22 помечает закрытия needs_recalc и не трогает сами снимки', () => { assert.ok(/update closings set needs_recalc = true/.test(s22)); assert.ok(!/update closings set snapshot/.test(s22.replace(/closings_restore_stage22[\s\S]*$/, ''))); });
t('stage22 не меняет chem_connects и не вводит признак «вместо бутыли»', () => assert.ok(!/alter table chem_connects|insert into chem_connects|update chem_connects/i.test(s22)));
t('есть откат closings_restore_stage22 только для суперадмина', () => { assert.ok(/create or replace function closings_restore_stage22/.test(s22)); assert.ok(/not is_super\(\)/.test(s22)); });
t('closing_recalc остаётся единственным путём и пишет старый снимок в журнал', () => { assert.ok(/closing_log[\s\S]*old_snapshot/.test(s18)); assert.ok(/needs_recalc/.test(s18)); });
t('страница закрытий: кнопка «Пересчитать все закрытия по новому правилу», показ «было → стало» и пароль', () => { assert.ok(page.includes('recalcAll')); assert.ok(page.includes('Пересчитать все закрытия по новому правилу')); assert.ok(/было → стало/.test(page)); assert.ok(/closing_recalc/.test(page)); });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
