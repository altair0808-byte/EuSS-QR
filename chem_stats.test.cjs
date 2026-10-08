// Тесты chem-stats.js: «залито», «израсходовано (теория)», события «кто, где, во сколько». Запуск: node tests/chem_stats.test.cjs
const assert = require('assert'); const path = require('path'); const fs = require('fs'); const vm = require('vm');
// скрипты сайта обычные (не модули), поэтому грузим их в общий контекст, как в браузере
const ctxVm = vm.createContext({});
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctxVm);
load('num.js'); load('report-calc.js');
const RC = vm.runInContext('({ calcReport, boundaryTs })', ctxVm);
const CS = vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chem-stats.js'), 'utf8') + '\n;ChemStats', ctxVm);
global.Num = vm.runInContext('Num', ctxVm);
let ok = 0, bad = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ✓ ' + n); } catch (e) { bad++; console.log('  ✗ ' + n + '\n    ' + e.message); } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, (m || '') + ' ждали ' + b + ', получили ' + a);

const refs = { water: 55,
  washTypes: [{ id: 1, name: 'Простыни' }, { id: 2, name: 'Полотенца' }],
  chemicals: [{ id: 1, name: 'Щёлочь', kind: 'main', bottle_l: 20, bottle_kg: 22 },
              { id: 2, name: 'Без плотности', kind: 'main', bottle_l: 10, bottle_kg: 0 },
              { id: 3, name: 'Ваниш', kind: 'extra', per_unit: 50, per_unit_unit: 'ml', in_closing: false },
              { id: 4, name: 'Отбеливатель', kind: 'extra', per_unit: 100, per_unit_unit: 'ml', bottle_kg: 5, bottle_l: 5, in_closing: true }],
  recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 2 }, { wash_type_id: 2, chemical_id: 1, ml_per_l: 4 }] };
const tz = 5, st = 6, from = '2026-10-07', to = '2026-10-07';
const at = h => new Date(Date.parse(RC.boundaryTs(from, tz, st)) + h * 3600e3).toISOString();   // h часов после начала смены
const loads = [
  { id: 'a', ts: at(2), shift_date: from, machine: 3, wash_type_id: 1, weight_kg: 25, extras: { 3: 2 }, created_by: 'u1' },
  { id: 'b', ts: at(5), shift_date: from, machine: 11, wash_type_id: 2, weight_kg: 20, extras: {}, created_by: 'u2' },
  { id: 'c', ts: at(30), shift_date: '2026-10-08', machine: 3, wash_type_id: 1, weight_kg: 25, extras: {}, created_by: 'u1' }];   // другая смена
const ev = { changes: [{ id: 'k1', ts: at(3), shift_date: from, machine_group: '1_10', chemical_id: 1, leftover_kg: 2, leftover_l: null, created_by: 'u3' },
                       { id: 'k2', ts: at(3), shift_date: from, machine_group: '1_10', chemical_id: 2, leftover_kg: null, leftover_l: 1, created_by: 'u3' }],   // у химиката 2 нет кг бутыли: без настройки залитое не посчитать
  connects: [], moves: [{ id: 'm1', ts: at(4), shift_date: from, chemical_id: 1, machine_group: '1_10', kind: 'add', amount_kg: 5, amount_l: null, created_by: 'u3' },
                        { id: 'm2', ts: at(6), shift_date: from, chemical_id: 1, machine_group: '1_10', kind: 'take', amount_kg: 1, amount_l: null, created_by: 'u3' }], levels: [] };
const day = loads.filter(l => l.shift_date === from);
const rep = RC.calcReport(day, [], refs, [], null, [], []);
const M = CS.calc(refs, rep, ev, from, to, tz, st), R = id => M.rows.find(r => r.id === id);

console.log('1. Расчёт «залито» и «израсходовано»');
t('теория: 2 загрузки в разных дозаторах', () => { near(R(1).g['1_10'].theory.l, 55 * 2 / 1000); near(R(1).g['11_12'].theory.l, 55 * 4 / 1000); near(R(1).g.all.theory.l, 0.33); });
t('залито дозатор 1: бутыль 22 кг + добавил 5 − забрал 1 = 26 кг', () => { near(R(1).g['1_10'].poured.kg, 26); near(R(1).g['1_10'].poured.l, 26 / 1.1); });
t('залито дозатор 2: пусто = 0', () => near(R(1).g['11_12'].poured.kg, 0));
t('залито итого = сумма дозаторов', () => near(R(1).g.all.poured.kg, 26));
t('штуки через бутыль 22 кг', () => near(R(1).g['1_10'].poured.pc, 26 / 22));
t('нет плотности и кг бутыли: залито не считаем, нужна подсказка', () => { assert.strictEqual(R(2).g['1_10'].poured, null); assert.strictEqual(R(2).g['1_10'].need, true); });
t('доп. средство без «ведётся на дозаторе»: залито не считается, теория есть', () => { assert.strictEqual(R(3).tracked, false); assert.strictEqual(R(3).g.all.poured, null); near(R(3).g.all.theory.l, 2 * 50 / 1000); });
t('доп. средство «ведётся на дозаторе» попадает в залито', () => assert.strictEqual(R(4).tracked, true));
t('замена в другую смену не попадает в период', () => { const m2 = CS.calc(refs, rep, ev, '2026-10-09', '2026-10-09', tz, st); near(m2.rows[0].g.all.poured.kg, 0); });

console.log('\n2. Итоги');
t('итоги: теория по основной химии и отмеченным доп.', () => { const T = CS.totals(M, 'all'); assert.strictEqual(T.all, 3); assert.ok(T.theory.nL >= 1); near(T.poured.kg, 26); });

console.log('\n3. Кто, где, во сколько');
const nm = { u1: 'Иванов', u2: 'Петров', u3: 'Бригадир' };
const ctx = { ev, loads, from, to, nm };
t('расход: только загрузки периода, с именем и машиной', () => { const e = CS.events(refs, ctx, refs.chemicals[0], 'all'); assert.strictEqual(e.use.length, 2); assert.strictEqual(e.use[0].who, 'Петров'); assert.strictEqual(e.use[1].machine, 3); });
t('расход: фильтр по дозатору', () => { const e = CS.events(refs, ctx, refs.chemicals[0], '11_12'); assert.strictEqual(e.use.length, 1); assert.strictEqual(e.use[0].machine, 11); });
t('залито: замена, добавил и забрал со знаками', () => { const e = CS.events(refs, ctx, refs.chemicals[0], 'all'); assert.strictEqual(JSON.stringify(e.fill.map(x => x.k).sort()), JSON.stringify(['add', 'chg', 'take'])); assert.strictEqual(e.fill.find(x => x.k === 'take').sign, -1); assert.strictEqual(e.fill.find(x => x.k === 'chg').who, 'Бригадир'); });
t('сводка по сотрудникам и машинам', () => { const e = CS.events(refs, ctx, refs.chemicals[0], 'all'); assert.strictEqual(e.byWho.length, 2); near(e.byWho.reduce((s, x) => s + x.v, 0), 0.33); assert.strictEqual(e.byMachine.length, 2); });
t('сумма строк расхода = теория по химикату', () => { const e = CS.events(refs, ctx, refs.chemicals[0], 'all'); near(e.use.reduce((s, r) => s + r.amt.l, 0), R(1).g.all.theory.l); });
t('доп. средство: расход есть, залитого нет', () => { const e = CS.events(refs, ctx, refs.chemicals[2], 'all'); assert.strictEqual(e.use.length, 1); assert.strictEqual(e.fill.length, 0); });
t('неизвестный сотрудник не ломает список', () => { const e = CS.events(refs, { ...ctx, nm: {} }, refs.chemicals[0], 'all'); assert.strictEqual(e.use[0].who, ''); });

console.log('\n4. Вывод');
t('render: названия, «Залито», «Израсходовано», подсказки', () => { const h = CS.render(M, 'all'); assert.ok(h.includes('Щёлочь') && h.includes('Всего залито') && h.includes('Израсходовано (теория)') && h.includes('задайте литры и кг') && h.includes('не ведётся на дозаторе')); });
t('render: числа без округления', () => { const h = CS.render(M, '1_10'); assert.ok(h.includes('0,11 л')); });
t('старый calcReport не тронут', () => { assert.ok(rep.groups.all.chem.length === 4); });

console.log('\n5. Экран: список и окно «кто, где, во сколько» (простая подмена document)');
{
  const made = [];
  const mk = () => { const o = { innerHTML: '', dataset: {}, children: [], onclick: null, onmousedown: null, className: '', remove() { o.removed = true; }, appendChild(c) { o.children.push(c); },
    querySelector() { return { onclick: null }; }, querySelectorAll() { return []; } }; made.push(o); return o; };
  const doc = { createElement: mk, getElementById: () => null, head: { appendChild() {} }, body: { appendChild(c) { doc.last = c; } }, addEventListener() {}, removeEventListener() {} };
  ctxVm.document = doc;
  const el = { innerHTML: '', onclick: null };
  CS.mount(el, { refs, rep, ev, loads, from, to, tz, st, nm, key: 'all', picker: true });
  t('mount рисует переключатель дозатора и химикаты', () => { assert.ok(el.innerHTML.includes('data-k="1_10"') && el.innerHTML.includes('data-cs="1"')); });
  t('нажатие на дозатор 2 перерисовывает список', () => { el.onclick({ target: { closest: s => s === '[data-k]' ? { dataset: { k: '11_12' } } : null } }); assert.ok(el.innerHTML.includes('class="on"') && /data-k="11_12" class="on"/.test(el.innerHTML)); });
  t('нажатие на химикат открывает окно с именами и машинами', () => {
    el.onclick({ target: { closest: s => s === '[data-cs]' ? { dataset: { cs: '1' } } : null } });
    const h = doc.last.innerHTML; assert.ok(h.includes('Щёлочь') && h.includes('Петров') && h.includes('Машина 11') && h.includes('Смена 07.10.2026'), h.slice(0, 300)); });
}
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
