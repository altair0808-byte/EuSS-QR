// Этап 1: смоук-тест экрана «Отчёт по закрытиям» без браузера: список, карточка, кнопки, Excel. Запуск: node tests/closings_report_ui.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const html = rd('closings-report.html'), inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
const el = () => ({ innerHTML: '', hidden: false, onclick: null, classList: { toggle() {} }, textContent: '' });
const ctx = vm.createContext({ console, TextEncoder, Uint8Array, Date, Math, URLSearchParams, location: { search: '' }, scrollTo() {},
  document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el() }, $: () => el(), toast() {}, need: async () => null, sb: {} });
['num.js', 'report-calc.js', 'xlsx-writer.js', 'closing-xlsx.js'].forEach(f => vm.runInContext(rd(f), ctx, { filename: f }));
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'W' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }], chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 20 }] };
const F = loc('2026-10-01', 9, 15), TO = loc('2026-10-12', 14, 37);
vm.runInContext(inline.replace(/\(async \(\) => \{[\s\S]*$/, '').replace(/\(async\(\)=>\{[\s\S]*$/, ''), ctx);   // всё, кроме запускающей функции в конце
vm.runInContext(`
  refs = ${JSON.stringify(refs)};
  const snap = calcClosing(refs, { fromTs: '${F}', toTs: '${TO}', tz: 5, st: 6, startKg: { '1:1_10': 10, '1:11_12': 5 }, endKg: { '1:1_10': 4, '1:11_12': 2 }, loads: [{ id: 'a', ts: '${loc('2026-10-03', 9)}', machine: 2, wash_type_id: 1, weight_kg: 30, extras: {}, part: 'day' }], changes: [], connects: [], moves: [], levels: [] });
  delete snap.arr;
  L = [{ id: 'c1', kind: 'interval', boundary_date: '2026-10-12', at_ts: '${TO}', period_from: '${F}', month_key: '2026-10', is_etalon: true, needs_recalc: false, late: false, closed_at: '${TO}', snapshot: { ...snap, warn_pct: 25, version: 2 } },
       { id: 'c0', kind: 'start', boundary_date: '2026-10-01', at_ts: '${F}', month_key: '2026-10', is_etalon: false, closed_at: '${F}', snapshot: null, m: [{ chemical_id: 1, machine_group: '1_10', amount_kg: 10 }] }];
`, ctx);
const run = c => vm.runInContext(c, ctx);
console.log('Отчёт по закрытиям');
t('список: время закрытия и период с точностью до минут', () => { const h = run('list()'); assert.ok(h.includes('12.10.2026 14:37') && h.includes('01.10.2026 09:15 → 12.10.2026 14:37'), h.slice(0, 400)); });
t('карточка: данные зафиксированы, есть кнопка «Скачать Excel»', async () => { const h = run('card(L[0])'); assert.ok(h.includes('зафиксированы') && h.includes('data-a="xlsx"'), 'нет кнопки/пометки'); });
t('карточка начального замера тоже скачивается в Excel', () => assert.ok(run('card(L[1])').includes('data-a="xlsx"')));
t('«Пересчитать» не показывается у зафиксированного закрытия, даже суперадмину', () => { run('isSuper = true'); assert.ok(!run('card(L[0])').includes('data-a="recalc"')); });
t('«Пересчитать» появляется только если запись периода правили (needs_recalc)', () => { run('L[0].needs_recalc = true'); assert.ok(run('card(L[0])').includes('data-a="recalc"')); run('L[0].needs_recalc = false'); });
t('обычному админу кнопки эталона/отмены/пересчёта не видны, Excel виден', () => { run('isSuper = false'); const h = run('card(L[0])'); assert.ok(h.includes('data-a="xlsx"') && !/data-a="(etalon|delete|recalc)"/.test(h)); });
t('динамика по месяцам строится', () => assert.ok(run('months()').includes('октябрь 2026')));
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
