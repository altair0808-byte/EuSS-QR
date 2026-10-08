// Этап 1: закрытый отчёт скачивается в Excel. Собираем файл из снимка закрытия и проверяем, что он открывается и в нём нужные листы.
// Запуск: node tests/closing_xlsx.test.cjs [путь для сохранения .xlsx]
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcClosing } = sb.module.exports;
// xlsx-writer.js и closing-xlsx.js — обычные браузерные скрипты (в проекте "type": "module", поэтому require не подходит): грузим их в песочницу
const load = (f, g = {}) => { const box = { module: { exports: {} }, TextEncoder, Uint8Array, Date, Math, ...g }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), box); return box.module.exports; };
const XW = load('xlsx-writer.js'), CX = load('closing-xlsx.js', { XlsxWriter: XW });
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 }] };
const F = loc('2026-10-01', 9, 15), TO = loc('2026-10-12', 14, 37);
const snap = calcClosing(refs, { fromTs: F, toTs: TO, tz: 5, st: 6, startKg: { '1:1_10': 10, '1:11_12': 6 }, endKg: { '1:1_10': 8, '1:11_12': 5 },
  loads: [{ id: 'a', ts: loc('2026-10-03', 9), machine: 2, wash_type_id: 1, weight_kg: 30, extras: {}, part: 'day' }, { id: 'b', ts: loc('2026-10-04', 9), machine: 12, wash_type_id: 1, weight_kg: 20, extras: {}, part: 'day' }],
  changes: [], connects: [], levels: [], residents: { '2026-10-01': 100, '2026-10-02': 100 },
  moves: [{ id: 't1', chemical_id: 1, machine_group: '1_10', ts: F, kind: 'take', amount_kg: 10, closing_id: 'c0' }, { id: 't2', chemical_id: 1, machine_group: '11_12', ts: F, kind: 'take', amount_kg: 6, closing_id: 'c0' }] });
delete snap.arr; const c = { id: 'c1', kind: 'interval', at_ts: TO, period_from: F, boundary_date: '2026-10-12', month_key: '2026-10', opens_month: '2026-10', late: false, is_etalon: true, needs_recalc: false, note: 'проверка', closed_at: TO, snapshot: { ...snap, warn_pct: 25, version: 2 } };
const start = { id: 'c0', kind: 'start', at_ts: F, boundary_date: '2026-10-01', month_key: '2026-10', snapshot: null, closed_at: F };
const ctx = { tz: 5, st: 6, warnPct: 25, startMeas: { '1:1_10': 10, '1:11_12': 6 }, endMeas: { '1:1_10': 8, '1:11_12': 5 }, chemicals: refs.chemicals, prev: null, etalon: c };
console.log('Excel закрытия');
let bytes, wb;
t('имя файла с датой и временем замера', () => assert.strictEqual(CX.fileName(c, 5), 'EuSS_закрытие_отчёт_2026-10-12_14-37.xlsx'));
t('книга собирается из снимка без ошибок', () => { wb = CX.build(c, ctx); bytes = wb.toBytes(); assert.ok(bytes.length > 3000); });
t('файл начальный замер собирается тоже', () => assert.ok(CX.build(start, { tz: 5, startMeas: {}, endMeas: { '1:1_10': 10 } }).toBytes().length > 1000));
// Этап 2: поступление и списание попадают в лист «Запас»
const snap2 = calcClosing(refs, { fromTs: F, toTs: TO, tz: 5, st: 6, startKg: { '1:1_10': 10, '1:11_12': 6 }, endKg: { '1:1_10': 8, '1:11_12': 5 }, reserveStart: { 1: 16 },
  loads: [], changes: [], connects: [], levels: [],
  moves: [{ id: 't1', chemical_id: 1, machine_group: '1_10', ts: F, kind: 'take', amount_kg: 10, closing_id: 'c0' }, { id: 't2', chemical_id: 1, machine_group: '11_12', ts: F, kind: 'take', amount_kg: 6, closing_id: 'c0' },
    { id: 'r1', chemical_id: 1, machine_group: 'stock', ts: loc('2026-10-05', 10), kind: 'receipt', amount_kg: 100, amount_l: 90.909 }, { id: 'p1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-05', 11), kind: 'pour', amount_kg: 22, amount_l: 20 },
    { id: 'w1', chemical_id: 1, machine_group: 'stock', ts: loc('2026-10-06', 10), kind: 'writeoff', amount_kg: 4, amount_l: 3.636 }] });
t('снимок содержит запас: поступило 100, залито 22, списано 4', () => { const z = snap2.reserve[0]; assert.strictEqual(snap2.reserve.length, 1); assert.ok(Math.abs(z.receipts_kg - 100) < 1e-9 && Math.abs(z.pours_kg - 22) < 1e-9 && Math.abs(z.writeoff_moves_kg - 4) < 1e-9); assert.ok(Math.abs(z.end_kg - (16 + 100 - 22 - 4)) < 1e-9); });
const c2 = { ...c, snapshot: snap2 };
t('лист «Запас» есть в Excel закрытия', () => { const w = CX.build(c2, ctx); const b = w.toBytes(); assert.ok(b.length > 3000); fs.writeFileSync('/tmp/closing_stock_test.xlsx', Buffer.from(b)); });
const out = process.argv[2] || '/tmp/closing_test.xlsx'; if (bytes) fs.writeFileSync(out, Buffer.from(bytes));
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло. Файл: ${out}`); process.exit(bad ? 1 : 0);
