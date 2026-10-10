// Этап 2 «Сравнение химии»: краткий вид. Запуск: node tests/compare_ui.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, bad = 0; const t = (n, f) => { try { f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const ta = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };

const ctx = () => { const sb = { module: { exports: {} }, console, TextEncoder, Uint8Array, Promise, setImmediate, JSON, Math }; vm.createContext(sb); ['num.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js', 'xlsx-writer.js', 'compare-detail.js', 'compare-xlsx.js', 'compare-data.js'].forEach(f => vm.runInContext(rd(f), sb, { filename: f })); return sb; };
const sb = ctx(), ev = s => vm.runInContext(s, sb);
const V = ev('CompareView'), calcCompare = ev('calcCompare');

// ---- сценарий как в compare.test.cjs: 20 стирок, замеры 10+6 → 4+3 ----
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const chemicals = [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 22 }];
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }], chemicals };
const C0 = loc('2026-10-08', 18), C1 = loc('2026-10-09', 18);
const loads = []; for (let i = 0; i < 20; i++) loads.push({ ts: loc('2026-10-09', 7 + (i % 9), 10 + i), machine: (i % 12) + 1, weight_kg: 25, wash_type_id: 1 });
const take = (g, kg, ts, cid) => ({ chemical_id: 1, machine_group: g, kind: 'take', amount_kg: kg, amount_l: kg / 1.1, ts, closing_id: cid });
const pour = (g, kg, ts) => ({ chemical_id: 1, machine_group: g, kind: 'pour', amount_kg: kg, amount_l: kg / 1.1, ts });
const moves = [take('1_10', 10, C0, 'c0'), take('11_12', 6, C0, 'c0'), pour('1_10', 10, loc('2026-10-08', 18, 5)), pour('11_12', 6, loc('2026-10-08', 18, 5)), take('1_10', 4, C1, 'c1'), take('11_12', 3, C1, 'c1')];
const closings = [{ id: 'c0', at_ts: C0, kind: 'start', measures: { '1:1_10': 10, '1:11_12': 6 } }, { id: 'c1', at_ts: C1, kind: 'interval', measures: { '1:1_10': 4, '1:11_12': 3 } }];
const base = { tz: 5, st: 6, loads, changes: [], connects: [], levels: [], residents: null };
const rOk = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings, moves });

console.log('1. Период и время');
t('месяц: октябрь = с 1 окт. 06:00 до 1 нояб. 06:00 (местное, UTC+5)', () => { const r = V.monthRange('2026-10', 5, 6, Date.parse('2026-12-01T00:00:00Z')); assert.strictEqual(r.fromTs, '2026-10-01T01:00:00.000Z'); assert.strictEqual(r.toTs, '2026-10-31T01:00:00.000Z'.replace('10-31', '11-01')); assert.strictEqual(r.partial, false); });
t('текущий месяц обрезается «сейчас»', () => { const now = Date.parse('2026-10-10T08:30:45Z'); const r = V.monthRange('2026-10', 5, 6, now); assert.strictEqual(r.toTs, '2026-10-10T08:30:00.000Z'); assert.strictEqual(r.partial, true); });
t('декабрь переходит в январь следующего года', () => { const r = V.monthRange('2026-12', 5, 6, Date.parse('2027-03-01T00:00:00Z')); assert.strictEqual(r.toTs, '2027-01-01T01:00:00.000Z'); });
t('список месяцев: 12 штук, первый — текущий по смене (до 06:00 1 числа ещё прошлый месяц)', () => {
  const o = V.monthOptions(Date.parse('2026-11-01T00:30:00Z'), 5, 6); assert.strictEqual(o.length, 12); assert.strictEqual(o[0].key, '2026-10'); assert.strictEqual(o[1].key, '2026-09'); assert.strictEqual(o[0].label, 'октябрь 2026');
  assert.strictEqual(V.monthOptions(Date.parse('2026-02-15T10:00:00Z'), 5, 6)[2].key, '2025-12');
});
t('поле «дата и время» показывает местное время, а не пояс браузера и возвращает то же', () => { const iso = '2026-10-09T13:00:00.000Z'; const s = V.toLocalInput(iso, 5); assert.strictEqual(s, '2026-10-09T18:00'); assert.strictEqual(V.fromLocalInput(s, 5), iso); assert.strictEqual(V.fromLocalInput('', 5), null); });
t('«последнее закрытие» = от предыдущего замера до последнего; одно закрытие — нет периода', () => {
  assert.deepStrictEqual({ ...V.lastClosingRange([{ at_ts: 'B' }, { at_ts: 'A' }, { at_ts: '0' }]) }, { fromTs: 'A', toTs: 'B' }); assert.strictEqual(V.lastClosingRange([{ at_ts: 'A' }]), null);
});
t('время в шапке: местное dd.mm.yyyy hh:mm', () => assert.strictEqual(V.fmtTs(C1, 5), '09.10.2026 18:00'));

console.log('2. Таблица и карточки');
const html = V.screenHTML(rOk, 'all', 5);
t('таблица: колонки химикат · теория · факт · разница · отклонение · статус', () => ['Химикат', 'Теория, л', 'Факт, л', 'Разница, л', 'Откл., %', 'Статус'].forEach(h => assert.ok(html.includes('<th>' + h + '</th>'), h)));
t('строка EMULSIFIER: теория 3,3 л, факт 8,18 л, +4,88 л, +147,9 %, «перерасход»', () => { const row = html.match(/<tr><td>EMULSIFIER<\/td>.*?<\/tr>/)[0]; ['<td>3,3</td>', '<td>8,18</td>', '+4,88', '+147,9%', 'перерасход'].forEach(x => assert.ok(row.includes(x), x + ' в ' + row)); });
t('есть строка ИТОГО основная химия', () => assert.ok(/ИТОГО основная химия/.test(html)));
t('доп. средств нет — строки ИТОГО доп. средства тоже нет', () => assert.ok(!/ИТОГО доп/.test(html)));
t('карточки: стирок 20, белья 500 кг, отклонение +147,9 %, предупреждений = числу предупреждений расчёта', () => { const c = V.cardsHTML(rOk, 'all'); assert.ok(/Стирок<\/span><b>20</.test(c)); assert.ok(/Белья, кг<\/span><b>500</.test(c)); assert.ok(c.includes('+147,9%')); const nw = rOk.warnings.length + rOk.problems.length; assert.ok(nw > 0, 'ожидали предупреждение «выше теории»'); assert.ok(new RegExp('Предупреждений</span><b>' + nw + '<').test(c)); });
t('дозатор 1 отдельно: факт 6 кг = 5,45 л; дозатор 2: 3 кг = 2,73 л', () => { assert.ok(V.tableHTML(rOk, '1_10').includes('<td>5,45</td>')); assert.ok(V.tableHTML(rOk, '11_12').includes('<td>2,73</td>')); });
t('карточки по дозатору считают только его стирки', () => { const c1 = V.cardsHTML(rOk, '1_10'), c2 = V.cardsHTML(rOk, '11_12'); const n = c => +c.match(/Стирок<\/span><b>(\d+)</)[1]; assert.strictEqual(n(c1) + n(c2), 20); });
t('покрытие полное: коротко «Факт по замерам остатков: …», без жёлтой плашки', () => { assert.ok(/Факт по замерам остатков: 08\.10\.2026 18:00 → 09\.10\.2026 18:00/.test(html)); assert.ok(!/class="msg wr">Факт посчитан/.test(html)); });
t('допуск и принцип факта подписаны под таблицей', () => assert.ok(/Допуск «в норме»: ±25%/.test(html)));
t('имя химиката экранируется', () => { const r = JSON.parse(JSON.stringify(rOk)); r.rows.forEach(x => x.name = '<b>X</b>'); assert.ok(!V.tableHTML(r, 'all').includes('<b>X</b>')); });

console.log('3. Особые случаи');
t('остаток не залит обратно: «проверить данные» и список предупреждений', () => {
  const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings, moves: [take('1_10', 10, C0, 'c0'), take('11_12', 6, C0, 'c0')] }); const h = V.screenHTML(r, 'all', 5);
  assert.ok(h.includes('проверить данные')); assert.ok(/Предупреждения \(2\)/.test(h)); assert.ok(/Расход отрицательный/.test(h));
  assert.ok(/Предупреждения \(1\)/.test(V.screenHTML(r, '1_10', 5)));          // по дозатору — только его предупреждения
});
t('период шире закрытий: жёлтая плашка с часами факта и справка про теорию', () => {
  const r = calcCompare(refs, { ...base, loads: loads.concat([{ ts: loc('2026-10-07', 10), machine: 1, weight_kg: 25, wash_type_id: 1 }]), fromTs: loc('2026-10-07', 6), toTs: loc('2026-10-11', 6), closings, moves }); const h = V.screenHTML(r, 'all', 5);
  assert.ok(/Факт посчитан за период закрытий: <b>08\.10\.2026 18:00 → 09\.10\.2026 18:00<\/b>/.test(h)); assert.ok(/Теория за весь выбранный период \(справка\): 3,47 л/.test(h));
});
t('закрытий нет: понятная причина, только теория, статус «нет данных»', () => {
  const r = calcCompare(refs, { ...base, fromTs: C0, toTs: C1, closings: [], moves: [] }); const h = V.screenHTML(r, 'all', 5);
  assert.ok(/Показана только теория/.test(h)); assert.ok(h.includes('нет данных')); assert.ok(/Стирок<\/span><b>20</.test(V.cardsHTML(r, 'all')));
  assert.ok(/Стирок<\/span><b>–</.test(V.cardsHTML(r, '1_10')));
});
t('нет плотности: проблема красным «Мешает расчёту»', () => {
  const r = calcCompare({ ...refs, chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main' }] }, { ...base, fromTs: C0, toTs: C1, closings, moves }); assert.ok(/Мешает расчёту/.test(V.screenHTML(r, 'all', 5)));
});
t('доп. средство с замером получает свой ИТОГО; без замера — строка «только теория»', () => {
  const ch2 = chemicals.concat([{ id: 2, name: 'Vanish', kind: 'extra', in_closing: true, bottle_l: 5, bottle_kg: 5, per_unit: 10, per_unit_unit: 'ml' }, { id: 3, name: 'Lenor', kind: 'extra', per_unit: 10, per_unit_unit: 'ml' }]);
  const cl2 = closings.map(c => ({ ...c, measures: { ...c.measures, '2:1_10': 1, '2:11_12': 1 } }));
  const r = calcCompare({ ...refs, chemicals: ch2 }, { ...base, loads: loads.map((l, i) => i === 0 ? { ...l, extras: { 3: 2 } } : l), fromTs: C0, toTs: C1, closings: cl2, moves }); const h = V.screenHTML(r, 'all', 5);
  assert.ok(/ИТОГО доп\. средства/.test(h)); assert.ok(/Без замеров, только теория: Lenor/.test(h));
});

console.log('4. Страница compare.html');
const page = rd('compare.html');
t('все нужные скрипты подключены в правильном порядке', () => { const o = ['num.js', 'app.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js'].map(s => page.indexOf('src="' + s + '"')); o.forEach((x, i) => assert.ok(x > 0, 'нет ' + i)); assert.deepStrictEqual(o, o.slice().sort((a, b) => a - b)); });
t('есть выбор периода (3 режима), выбор дозатора (3) и поле вывода', () => { ['data-m="last"', 'data-m="month"', 'data-m="custom"', 'data-g="all"', 'data-g="1_10"', 'data-g="11_12"', 'id="out"', 'id="pick"'].forEach(x => assert.ok(page.includes(x), x)); });
t('доступ только админам и суперадмину', () => assert.ok(/доступно админам и суперадмину/.test(page) && /is_admin/.test(page)));
t('скрипт страницы без синтаксических ошибок', () => { const inl = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]; new vm.Script(inl); });
t('ссылки на страницу: из «Закрытий», из «Отчёта по сменам» (только тем, кто может править), service worker', () => {
  assert.ok(rd('closings-report.html').includes('href="compare.html"')); const rp = rd('report.html'); assert.ok(rp.includes('href="compare.html"') && rp.includes("_tocmp.hidden=!canEdit"));
  const sw = rd('sw.js'); ['compare.html', 'compare-calc.js', 'compare-view.js'].forEach(f => assert.ok(sw.includes("'" + f + "'"), f)); assert.ok(!/euss-v13/.test(sw));
});

console.log('5. Страница целиком: запуск скрипта с подставной базой');
(async () => {
  const mk = () => { const els = {}; const el = id => els[id] || (els[id] = { id, innerHTML: '', hidden: false, onclick: null, onchange: null, dataset: {}, classList: { toggle() {} }, value: '' });
    return { getElementById: el, querySelectorAll: () => [], els }; };
  const run = async (data, { rpcFail } = {}) => {
    const c = ctx(), doc = mk(); const calls = [];
    const builder = table => { const b = { select: () => b, order: () => b, eq: () => b, in: () => b, maybeSingle: () => Promise.resolve({ data: data.profiles }), then: (res, rej) => Promise.resolve({ data: data[table] || [], error: null }).then(res, rej) }; return b; };
    c.document = doc; c.Date = Date; c.sb = { auth: {}, from: builder, rpc: (fn, a) => { calls.push(fn); if (rpcFail === fn) return Promise.resolve({ data: null, error: { message: 'boom ' + fn } }); return Promise.resolve({ data: fn === 'is_admin' ? data.admin : (data.rpc[fn] || []), error: null }); } };
    c.need = async () => ({ user: { id: 'u1' } });
    const inl = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
    vm.runInContext(inl, c, { filename: 'compare.html' });
    for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
    return { out: doc.els.out.innerHTML, doc, calls, c };
  };
  const data = {
    profiles: { role: 'admin' }, admin: true,
    settings: [{ key: 'tz_offset', value: 5 }, { key: 'shift_start', value: 6 }, { key: 'water_l', value: 55 }, { key: 'close_warn_pct', value: 25 }],
    chemicals, wash_types: refs.washTypes, recipes: refs.recipes,
    closings: [{ id: 'c1', at_ts: C1, kind: 'interval' }, { id: 'c0', at_ts: C0, kind: 'start' }],
    closing_measures: [{ closing_id: 'c0', chemical_id: 1, machine_group: '1_10', amount_kg: 10 }, { closing_id: 'c0', chemical_id: 1, machine_group: '11_12', amount_kg: 6 },
                       { closing_id: 'c1', chemical_id: 1, machine_group: '1_10', amount_kg: 4 }, { closing_id: 'c1', chemical_id: 1, machine_group: '11_12', amount_kg: 3 }],
    rpc: { report_loads: loads, report_moves: moves, get_residents: [] }
  };
  await ta('админ открывает страницу: считается «последнее закрытие», те же цифры, что в расчёте', async () => {
    const r = await run(data); assert.ok(/Факт по замерам остатков: 08\.10\.2026 18:00 → 09\.10\.2026 18:00/.test(r.out), r.out.slice(0, 300));
    assert.ok(r.out.includes('<td>8,18</td>') && r.out.includes('+147,9%') && r.out.includes('перерасход'));
    ['report_loads', 'report_changes', 'report_connects', 'report_moves', 'report_levels', 'get_residents'].forEach(fn => assert.ok(r.calls.includes(fn), 'нет вызова ' + fn));
  });
  await ta('не админ: отчёт не показывается и данные не запрашиваются', async () => {
    const r = await run({ ...data, admin: false, profiles: { role: 'worker' } }); assert.ok(/доступно админам и суперадмину/.test(r.out)); assert.ok(!r.calls.includes('report_loads'));
  });
  await ta('закрытие одно: понятное сообщение вместо пустого экрана', async () => {
    const r = await run({ ...data, closings: [data.closings[0]] }); assert.ok(/хотя бы два закрытия/.test(r.out));
  });
  await ta('ошибка базы показывается текстом, страница не падает', async () => {
    const r = await run(data, { rpcFail: 'report_loads' }); assert.ok(/Не удалось посчитать: boom report_loads/.test(r.out));
  });
  await ta('нет таблицы closings: подсказка выполнить stage15.sql', async () => {
    const r = await run({ ...data, closings: null }); assert.ok(r.out.length > 0);
  });

  console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);
  process.exit(bad ? 1 : 0);
})();
