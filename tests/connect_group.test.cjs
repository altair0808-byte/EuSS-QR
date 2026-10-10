// Этап 23: «Перелить в дозатор» и исправление уже записанного подключения. Запуск: node tests/connect_group.test.cjs
// Сценарии из задачи (нумерация та же):
//   1. остаток 2,98 кг из дозатора 1 перелит в дозатор 2: +2,98 в дозатор 2, −2,98 (остаток замены) в дозатор 1, итог по двум не меняется;
//   2. окно: дозатор по умолчанию не выбран, подтвердить без выбора нельзя;
//   3. после исправления дозатора у записи (1 → 2) отчёт показывает +2,98 в дозаторе 2 и убирает из дозатора 1;
//   4. исправление внутри закрытого периода помечает закрытие needs_recalc и пишет журнал; без пароля и не суперадмином нельзя (SQL, статическая проверка);
//   5. отрицательный факт дозатора 2 из-за неверно записанного дозатора исчезает после исправления;
//   6. «Подробно», краткий и полный Excel и Excel закрытия показывают те же итоги.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, bad = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } };
const near = (a, b, m, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) < eps, `${m}: ожидалось ${b}, получено ${a}`);
const text = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const sbx = { module: { exports: {} }, console, TextEncoder, Uint8Array, Date, Math, Promise, setImmediate, JSON }; vm.createContext(sbx);
['num.js', 'report-calc.js', 'compare-calc.js', 'compare-view.js', 'xlsx-writer.js', 'compare-detail.js', 'compare-xlsx.js', 'closing-xlsx.js'].forEach(f => vm.runInContext(rd(f), sbx, { filename: f }));
const ev = s => vm.runInContext(s, sbx);
const D = ev('CompareDetail'), X = ev('CompareXlsx'), CX = ev('ClosingXlsx'), calcCompare = ev('calcCompare'), calcClosing = ev('calcClosing');

// ---------- данные сценария: бутыль 20 л = 20,64 кг; в дозаторе 1 заменили две бутыли с остатками 1,5 + 1,48 = 2,98 кг, остаток вылили в дозатор 2 ----------
const loc = (d, h, m = 0) => new Date(Date.parse(d + 'T00:00:00Z') + (h - 5) * 3600e3 + m * 60e3).toISOString();
const refs = { water: 55, washTypes: [{ id: 1, name: 'Простыни' }], recipes: [{ wash_type_id: 1, chemical_id: 1, ml_per_l: 3 }],
  chemicals: [{ id: 1, name: 'EMULSIFIER', kind: 'main', bottle_l: 20, bottle_kg: 20.64 }] };
const C0 = loc('2026-10-01', 6), C1 = loc('2026-10-09', 18);
const changes = [{ id: 'ch1', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-05', 7), leftover_kg: 1.5 }, { id: 'ch2', chemical_id: 1, machine_group: '1_10', ts: loc('2026-10-06', 9), leftover_kg: 1.48 }];
const conn = g => [{ id: 'cn1', chemical_id: 1, machine_group: g, ts: loc('2026-10-06', 9, 5), amount_kg: 2.98 }];
const resAll = {}; for (let d = 1; d <= 12; d++) resAll['2026-10-' + String(d).padStart(2, '0')] = 100;
// замеры: дозатор 1 с 0 до 17,62 кг; дозатор 2 с 5 кг до 6,98 (=5 + 2,98 перелитых − 1 кг реального расхода)
const START = { '1:1_10': 0, '1:11_12': 5 }, END = { '1:1_10': 17.62, '1:11_12': 6.98 };
const take = (g, kg, ts, cid, id) => ({ id, chemical_id: 1, machine_group: g, kind: 'take', amount_kg: kg, ts, closing_id: cid, created_by: 'u1' });
const moves = [take('1_10', 17.62, C1, 'c1', 'm1'), take('11_12', 6.98, C1, 'c1', 'm2')];
const closeInp = g => ({ fromTs: C0, toTs: C1, tz: 5, st: 6, startKg: START, endKg: END, loads: [], changes, connects: conn(g), levels: [], moves, residents: resAll });
const rowOf = (res, g) => res.rows.find(r => r.chemical_id === 1 && r.group === g);

const wrong = calcClosing(refs, closeInp('1_10'));    // запись подключения ушла в дозатор-источник (как было до исправления)
const right = calcClosing(refs, closeInp('11_12'));   // запись исправлена: налили в дозатор 2

(async () => {
  console.log('Сценарий 1: остаток 2,98 кг из дозатора 1 перелит в дозатор 2');
  await t('дозатор 2: подключённый остаток +2,98 (это и есть приход)', () => { near(rowOf(right, '11_12').flows.connects, 2.98, 'подключено'); near(rowOf(right, '11_12').inflow_kg, 2.98, 'приход 2'); });
  await t('дозатор 1: остатки замен −2,98, подключённого нет', () => { const f = rowOf(right, '1_10').flows; near(f.leftovers, 2.98, 'остатки замен'); near(f.connects, 0, 'подключено'); });
  await t('итог по двум дозаторам не меняется: две бутыли = 41,28 кг', () => near(rowOf(right, '1_10').inflow_kg + rowOf(right, '11_12').inflow_kg, 41.28 - 2.98 + 2.98, 'сумма'));
  await t('итог по двум не зависит от того, куда записано подключение (приход «оба» = 41,28 в обоих вариантах)', () => { near(rowOf(wrong, 'all').inflow_kg, 41.28, 'до исправления'); near(rowOf(right, 'all').inflow_kg, 41.28, 'после исправления'); });

  console.log('\nСценарий 2: окно «Перелить в дозатор» (leftover.js)');
  const calls = [], toasts = [];
  const mkEl = () => { const e = { style: {}, dataset: {}, value: '', textContent: '', disabled: false, innerHTML: '', _cls: new Set(), _attr: {},
    classList: { toggle(c, on) { on ? e._cls.add(c) : e._cls.delete(c); }, add: c => e._cls.add(c), contains: c => e._cls.has(c) }, setAttribute(k, v) { e._attr[k] = v; }, focus() {}, remove() {} }; return e; };
  const q = {};          // кэш элементов окна по селектору
  const btns = [mkEl(), mkEl()]; btns[0].dataset.v = '1_10'; btns[1].dataset.v = '11_12';
  const doc = { head: { appendChild() {} }, body: { appendChild(o) { doc.last = o; } }, getElementById: () => null, addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    createElement() { const o = mkEl(); o.querySelector = s => q[s] || (q[s] = mkEl()); o.querySelectorAll = s => s === '#lodz button' ? btns : []; return o; } };
  const rpc = async (fn, args) => { calls.push({ fn, args }); return { error: null, data: 'id' }; };
  const ctx = { sb: { rpc }, document: doc, toast: m => toasts.push(m), Num: ev('Num'), Date, Math, String, Promise, Object, Array, JSON, isFinite, parseFloat, Number };
  vm.createContext(ctx);
  vm.runInContext(rd('leftover.js') + ';this.LO=Leftover;', ctx, { filename: 'leftover.js' });
  const LO = ctx.LO;
  const chems = refs.chemicals;
  // остатки в запасе: 1,5 + 1,48 кг из дозатора 1 (leftover_pool)
  const pool = [{ id: 'a', chemical_id: 1, machine_group: '1_10', leftover_kg: 1.5, created_by: 'u1' }, { id: 'b', chemical_id: 1, machine_group: '1_10', leftover_kg: 1.48, created_by: 'u1' }];
  const sum = LO.summary(pool, chems)[0];
  await t('модель окна: дозатор не выбран, подтвердить нельзя', () => { const m = LO.pourModel(sum, null); assert.strictEqual(m.chosen, null); assert.strictEqual(m.canConfirm, false); assert.strictEqual(m.btnTxt, 'Выберите дозатор'); });
  await t('даже если последний остаток из дозатора 2, по умолчанию он не выбирается', () => {
    const s2 = LO.summary([{ id: 'x', chemical_id: 1, machine_group: '11_12', leftover_kg: 3 }, ...pool], chems)[0]; assert.strictEqual(LO.pourModel(s2, null).chosen, null); });
  await t('неизвестное значение дозатора не принимается', () => { assert.strictEqual(LO.pourModel(sum, 'x').canConfirm, false); assert.strictEqual(LO.pourModel(sum, '').canConfirm, false); });
  await t('откуда и сколько: «из дозатора 1: 2,98 кг (…), будет добавлено в дозатор 2»', () => {
    const m = LO.pourModel(sum, '11_12'); assert.strictEqual(m.fromTxt.length, 1); assert.ok(/^из дозатора 1: 2,98 кг \(2,8\d+ л\), будет добавлено в дозатор 2$/.test(m.fromTxt[0]), m.fromTxt[0]); });
  await t('итог крупно: «В дозатор 2 будет добавлено 2,98 кг (… л)»', () => { const m = LO.pourModel(sum, '11_12'); assert.ok(/^В дозатор 2 будет добавлено 2,98 кг \(2,8\d+ л\)$/.test(m.resultTxt), m.resultTxt); assert.strictEqual(m.btnTxt, 'Перелить в дозатор 2'); assert.strictEqual(m.canConfirm, true); });
  await t('остатки из обоих дозаторов считаются одним запасом: 3 + 2 кг → 5 кг в выбранный дозатор', () => {
    const s2 = LO.summary([{ id: 'x', chemical_id: 1, machine_group: '1_10', leftover_kg: 3 }, { id: 'y', chemical_id: 1, machine_group: '11_12', leftover_kg: 2 }], chems)[0];
    const m = LO.pourModel(s2, '1_10'); assert.strictEqual(m.from.length, 2); assert.ok(m.resultTxt.startsWith('В дозатор 1 будет добавлено 5 кг'), m.resultTxt);
    assert.ok(m.fromTxt[0].startsWith('из дозатора 1: 3 кг') && m.fromTxt[1].startsWith('из дозатора 2: 2 кг')); });
  await t('без плотности показывается только известная единица', () => {
    const c2 = [{ id: 1, name: 'X', kind: 'main', bottle_l: 20, bottle_kg: 0 }]; const s2 = LO.summary([{ id: 'x', chemical_id: 1, machine_group: '1_10', leftover_l: 4 }], c2)[0];
    assert.strictEqual(LO.pourModel(s2, '11_12').resultTxt, 'В дозатор 2 будет добавлено 4 л'); });
  await t('окно: после открытия кнопка неактивна, ни один дозатор не выбран, текст вопроса и заголовок «Перелить в дозатор»', () => {
    calls.length = 0; LO.panel(sum, { today: '2026-10-09' }, () => {});
    const html = doc.last.innerHTML; assert.ok(html.includes('В какой дозатор вы выливаете остаток?'), 'нет вопроса');
    assert.ok(html.includes('aria-label="Перелить в дозатор"') && html.includes('<p class="k">Перелить в дозатор</p>'), 'нет заголовка');
    assert.ok(/id="logo"[^>]*disabled/.test(html), 'кнопка подтверждения должна быть неактивна'); assert.ok(!/class="[^"]*sel/.test(html) && !/aria-pressed="true"/.test(html), 'дозатор не должен быть выбран');
    assert.ok(text(html).includes('из дозатора 1: 2,98 кг'), 'не показано, откуда остаток'); });
  await t('нажатие «Перелить» без выбора ничего не пишет в базу', async () => {
    calls.length = 0; toasts.length = 0; LO.panel(sum, { today: '2026-10-09' }, () => {});
    await q['#logo'].onclick(); assert.strictEqual(calls.length, 0, 'не должно быть вызова connect_leftovers'); assert.strictEqual(JSON.stringify(toasts), JSON.stringify(['Выберите дозатор'])); });
  await t('выбрали дозатор 2: кнопка активна, итог крупно, и подтверждение пишет именно в 11_12', async () => {
    calls.length = 0; toasts.length = 0; let done = 0; LO.panel(sum, { today: '2026-10-09' }, () => done++);
    q['#lodz'].onclick({ target: { closest: () => btns[1] } });
    assert.strictEqual(q['#logo'].disabled, false); assert.strictEqual(q['#logo'].textContent, 'Перелить в дозатор 2');
    assert.ok(/^В дозатор 2 будет добавлено 2,98 кг/.test(q['#lores'].textContent), q['#lores'].textContent); assert.ok(q['#lores']._cls.has('on'));
    assert.ok(q['#losrc'].innerHTML.includes('будет добавлено в дозатор 2'));
    await q['#logo'].onclick(); assert.strictEqual(JSON.stringify(calls), JSON.stringify([{ fn: 'connect_leftovers', args: { p_chemical: 1, p_group: '11_12' } }])); assert.strictEqual(done, 1); assert.ok(/перелит в дозатор 2/.test(toasts[0])); });
  await t('в исходном коде нет дозатора «по умолчанию» (старая строка g = last.machine_group удалена)', () => { const src = rd('leftover.js'); assert.ok(!/last\.machine_group/.test(src)); assert.ok(!/let g = [^n;]*machine_group/.test(src)); assert.ok(/let g = null;/.test(src)); });
  await t('кнопка на карточке и тексты переименованы в «Перелить в дозатор», «Подключили остаток» нигде не осталось', () => {
    assert.ok(rd('leftover.js').includes('data-lo="${s.c.id}">Перелить в дозатор</button>'));
    ['leftover.js', 'index.html', 'form.html'].forEach(f => assert.ok(!/Подключили остаток|Подтвердить подключение/.test(rd(f)), f)); });
  await t('SQL connect_leftovers по-прежнему объединяет весь запас химии одной записью в выбранный дозатор (stage11, не менялся)', () => {
    const s11 = rd('stage11.sql'); assert.ok(/create or replace function connect_leftovers\(p_chemical bigint, p_group text\)/.test(s11)); assert.ok(/if p_group not in \('1_10','11_12'\) then raise exception 'Выберите дозатор'/.test(s11)); });

  console.log('\nСценарий 3: исправление дозатора у записи 1 → 2');
  await t('до исправления: подключение записано в дозатор 1, отчёт даёт его там (+2,98) и у дозатора 2 плюса нет', () => { near(rowOf(wrong, '1_10').flows.connects, 2.98, 'д1 подключено'); near(rowOf(wrong, '11_12').flows.connects, 0, 'д2 подключено'); });
  await t('после исправления: +2,98 в дозаторе 2, из дозатора 1 убрано', () => { near(rowOf(right, '11_12').flows.connects, 2.98, 'д2 подключено'); near(rowOf(right, '1_10').flows.connects, 0, 'д1 подключено'); });
  await t('приход дозатора 1 уменьшился ровно на 2,98, дозатора 2 вырос на 2,98', () => { near(rowOf(wrong, '1_10').inflow_kg - rowOf(right, '1_10').inflow_kg, 2.98, 'д1'); near(rowOf(right, '11_12').inflow_kg - rowOf(wrong, '11_12').inflow_kg, 2.98, 'д2'); });
  await t('сравнение за период («Подробно») даёт то же: дозатор 2 +2,98', () => {
    const inp = g => ({ tz: 5, st: 6, loads: [], changes, connects: conn(g), levels: [], residents: resAll, fromTs: C0, toTs: C1, closings: [{ id: 'c0', at_ts: C0, kind: 'start', measures: START }, { id: 'c1', at_ts: C1, kind: 'interval', measures: END }], moves });
    const a = calcCompare(refs, inp('1_10')), b = calcCompare(refs, inp('11_12'));
    near(a.rows.find(r => r.chemical_id === 1 && r.group === '11_12').balance.connects, 0, 'до'); near(b.rows.find(r => r.chemical_id === 1 && r.group === '11_12').balance.connects, 2.98, 'после'); });

  console.log('\nСценарий 4: SQL connect_set_group (stage23.sql), статическая проверка');
  const s23 = rd('stage23.sql'), body = s23.slice(s23.indexOf('create or replace function connect_set_group'));
  await t('функция connect_set_group(uuid, text, text), можно запускать повторно (create or replace)', () => assert.ok(/create or replace function connect_set_group\(p_id uuid, p_group text, p_pw text\) returns jsonb/.test(s23)));
  await t('только суперадмин: is_super() проверяется первой и бросает исключение', () => { const i = body.indexOf('is_super()'), j = body.indexOf('check_my_password'); assert.ok(i > 0 && i < j); assert.ok(/if not is_super\(\) then raise exception/.test(body)); });
  await t('пароль: check_my_password вызывается ДО update; при неверном пароле возвращается ошибка без правки', () => {
    const i = body.indexOf('check_my_password'), j = body.indexOf('update chem_connects'); assert.ok(i > 0 && j > i, 'пароль должен проверяться раньше правки');
    assert.ok(/if v_msg is not null then return jsonb_build_object\('ok', false, 'error', v_msg\)/.test(body)); });
  await t('меняется только machine_group у одной записи; количество, время и структура таблицы не трогаются', () => {
    const u = body.match(/update chem_connects set ([^;]*);/)[1]; assert.strictEqual(u.replace(/\s+where.*$/, '').trim(), 'machine_group = p_group'); assert.ok(/where id = p_id/.test(body));
    assert.ok(!/alter table|drop table|insert into chem_connects|delete from chem_connects/i.test(s23)); });
  await t('дозатор проверяется (только 1_10 / 11_12), запись должна существовать и менять дозатор', () => { assert.ok(/p_group not in \('1_10','11_12'\)/.test(body)); assert.ok(/Подключение не найдено/.test(body)); assert.ok(/уже записана в этот дозатор/.test(body)); });
  await t('защита закрытых периодов не обходится: триггер не отключается, app.pw_ok вручную не ставится, прямых правок closings нет', () => {
    assert.ok(!/disable trigger|drop trigger|session_replication_role|set_config|app\.pw_ok/i.test(s23.replace(/--.*$/gm, '')), 'нельзя трогать защиту');
    assert.ok(!/update\s+closings|insert\s+into\s+closings|delete\s+from\s+closings/i.test(body), 'закрытия правит только t_closed_guard'); });
  await t('в stage15 защита на chem_connects стоит и для суперадмина с паролем помечает needs_recalc и пишет closed_edit', () => {
    const s15 = rd('stage15.sql'); assert.ok(/create trigger t_closed_guard before insert or update or delete on chem_connects/.test(s15));
    assert.ok(/is_super\(\) and coalesce\(current_setting\('app\.pw_ok', true\), ''\) = 'on'/.test(s15)); assert.ok(/update closings set needs_recalc = true/.test(s15)); assert.ok(/'closed_edit'/.test(s15));
    assert.ok(/set_config\('app\.pw_ok', 'on', true\)/.test(s15), 'check_my_password должна ставить пометку'); });
  await t('без пароля защита бы не пропустила: пометка app.pw_ok ставится только внутри check_my_password (не в connect_set_group)', () => { assert.ok(!/pw_ok/.test(body.replace(/--.*$/gm, ''))); });
  await t('журнал: closing_log со старым и новым дозатором; audit_log пишет триггер t_conn_audit на update (stage9)', () => {
    assert.ok(/insert into closing_log/.test(body) && /'connect_set_group'/.test(body) && /'old_group', k\.machine_group/.test(body) && /'new_group', p_group/.test(body));
    assert.ok(/create trigger t_conn_audit after insert or update or delete on chem_connects/.test(rd('stage9.sql'))); });
  await t('права: revoke from public, grant execute только authenticated', () => { assert.ok(/revoke all on function connect_set_group\(uuid, text, text\) from public/.test(s23)); assert.ok(/grant execute on function connect_set_group\(uuid, text, text\) to authenticated/.test(s23)); });
  await t('замок как у «Перелить в дозатор»: параллельные подключение и правка не пересекаются', () => assert.ok(/pg_advisory_xact_lock\(hashtext\('connect_leftovers:' \|\| k\.chemical_id::text\)\)/.test(body)));
  await t('после правки закрытие помечается needs_recalc, а пересчёт идёт кнопкой «Пересчитать» через closing_recalc (stage18) с паролем', () => {
    const s18 = rd('stage18.sql'); assert.ok(/not v_row\.needs_recalc then/.test(s18)); assert.ok(/check_my_password/.test(s18)); assert.ok(/closing_recalc/.test(rd('closings-report.html'))); });

  console.log('\nЭкран исправления (суперадмин, leftover.js + index.html)');
  const cRow = { id: 'cn1', ts: loc('2026-10-06', 9, 5), shift_date: '2026-10-06', chemical_id: 1, machine_group: '1_10', amount_kg: 2.98, amount_l: null, n: 2, created_by: 'u1' };
  await t('список: дата, химия, сколько, в какой дозатор записано, кнопка «Изменить дозатор»', () => {
    const h = LO.fixHtml([cRow], chems, { u1: 'Админ' }, { today: '2026-10-09', tz: 5 }), tx = text(h);
    assert.ok(tx.includes('EMULSIFIER') && tx.includes('2,98 кг') && tx.includes('записано в дозатор 1') && tx.includes('06.10') && /09:05/.test(tx), tx); assert.ok(h.includes('data-lx="cn1"') && h.includes('>Изменить дозатор<')); });
  await t('модель исправления: 1 → 2 даёт «+2,98 в дозатор 2, из дозатора 1 уберётся»; тот же дозатор выбрать нельзя', () => {
    const m = LO.fixModel(chems[0], cRow, '11_12'); assert.strictEqual(m.canConfirm, true); assert.ok(/^Запись перейдёт из дозатора 1 в дозатор 2: в дозатор 2 будет \+2,98 кг/.test(m.resultTxt) && /из дозатора 1 это количество уберётся$/.test(m.resultTxt), m.resultTxt);
    assert.strictEqual(LO.fixModel(chems[0], cRow, '1_10').canConfirm, false); assert.strictEqual(LO.fixModel(chems[0], cRow, null).canConfirm, false); });
  await t('окно исправления: без выбора кнопка неактивна; с выбором спрашивает пароль и вызывает connect_set_group с нужными аргументами', async () => {
    calls.length = 0; const pwCalls = []; let res;
    ctx.rpcAsk = async (fn, args) => { calls.push({ fn, args }); return { ok: true, closed_period: true }; };
    ctx.withPw = async (title, txt, run) => { pwCalls.push({ title, txt }); res = await run('secret'); return res.ok; };
    vm.runInContext('rpcAsk = this.rpcAsk; withPw = this.withPw;', ctx);
    for (const k of Object.keys(q)) delete q[k];
    LO.fixPanel(cRow, chems[0], { today: '2026-10-09', tz: 5 }, () => {});
    assert.ok(/id="fxgo"[^>]*disabled/.test(doc.last.innerHTML)); assert.ok(/data-v="1_10" aria-pressed="false" disabled/.test(doc.last.innerHTML), 'текущий дозатор должен быть недоступен');
    await q['#fxgo'].onclick(); assert.strictEqual(calls.length, 0, 'без выбора вызова быть не должно');
    const b2 = mkEl(); b2.dataset.v = '11_12'; q['#fxdz'].onclick({ target: { closest: () => b2 } });
    await q['#fxgo'].onclick();
    assert.strictEqual(JSON.stringify(calls), JSON.stringify([{ fn: 'connect_set_group', args: { p_id: 'cn1', p_group: '11_12', p_pw: 'secret' } }])); assert.strictEqual(pwCalls.length, 1);
    assert.ok(toasts.some(x => /нужен пересчёт/.test(x)), 'при правке в закрытом периоде должна быть подсказка про пересчёт'); });
  await t('index.html: экран только для суперадмина (S.isSuper), данные из report_connects, после правки список обновляется', () => {
    const h = rd('index.html'); assert.ok(/S\.isSuper\?Leftover\.fetchConnects/.test(h)); assert.ok(/S\.isSuper\?`<div id="lofx">/.test(h)); assert.ok(/Leftover\.fixBind\(fx,S\.conns/.test(h)); assert.ok(/report_connects/.test(rd('leftover.js'))); });
  await t('журнал (journal.html) показывает смену дозатора у подключения «было → стало»', () => assert.ok(/entity==='connect'\)\{\s*add\('Дозатор',grp\(o\.machine_group\),grp\(n\.machine_group\)\)/.test(rd('journal.html'))));
  await t('кэш приложения обновится на телефонах (sw.js версия поднята)', () => assert.ok(/VER = 'euss-v16'/.test(rd('sw.js'))));

  console.log('\nСценарий 5: отрицательный факт дозатора 2');
  await t('до исправления у дозатора 2 факт отрицательный (−1,98 кг) и есть предупреждение «negative»', () => { near(rowOf(wrong, '11_12').fact_kg, -1.98, 'факт д2 до'); assert.ok(wrong.warnings.some(w => w.type === 'negative' && w.group === '11_12')); });
  await t('после исправления факт дозатора 2 = 1,00 кг (реальный расход), предупреждения нет', () => { near(rowOf(right, '11_12').fact_kg, 1.0, 'факт д2 после'); assert.ok(!right.warnings.some(w => w.type === 'negative'), 'остались отрицательные'); });
  await t('у дозатора 1 лишний плюс ушёл: факт 20,68 вместо 23,66; общий расход «оба» не изменился (21,68)', () => {
    near(rowOf(wrong, '1_10').fact_kg, 23.66, 'д1 до'); near(rowOf(right, '1_10').fact_kg, 20.68, 'д1 после'); near(rowOf(wrong, 'all').fact_kg, 21.68, 'оба до'); near(rowOf(right, 'all').fact_kg, 21.68, 'оба после'); });

  console.log('\nСценарий 6: «Подробно», краткий и полный Excel, Excel закрытия — одни и те же итоги');
  const mkInp = g => ({ tz: 5, st: 6, loads: [], changes, connects: conn(g), levels: [], residents: resAll, fromTs: C0, toTs: C1, closings: [{ id: 'c0', at_ts: C0, kind: 'start', measures: START }, { id: 'c1', at_ts: C1, kind: 'interval', measures: END }], moves });
  const inp = mkInp('11_12'), res = calcCompare(refs, inp);
  const cRowC = (r, g) => r.rows.find(x => x.chemical_id === 1 && x.group === g);
  const ctx2 = { refs, names: { u1: 'Админ' }, meta: { c0: { closed_by: 'u1', closed_at: C0, kind: 'start' }, c1: { closed_by: 'u1', closed_at: C1 } }, tz: 5, st: 6, etalon: null, prev: null };
  const lines = r => D.balanceLines(r.balance);
  const gk = (L, k) => L.find(l => l.key === k).kg;
  await t('«Подробно»: дозатор 2: подключено 2,98, приход нетто 2,98, факт 1,00; дозатор 1: остатки замен 2,98, подключено 0', () => {
    const L2 = lines(cRowC(res, '11_12')), L1 = lines(cRowC(res, '1_10'));
    near(gk(L2, 'connects'), 2.98, 'д2 подключено'); near(gk(L2, 'inflow'), 2.98, 'д2 приход'); near(gk(L2, 'fact'), 1.0, 'д2 факт');
    near(gk(L1, 'leftovers'), 2.98, 'д1 остатки замен'); near(gk(L1, 'connects'), 0, 'д1 подключено'); near(gk(L1, 'fact'), 20.68, 'д1 факт'); });
  await t('«Подробно»: итоги «оба» = сумма дозаторов (приход 41,28; факт 21,68)', () => { const Lall = lines(cRowC(res, 'all')); near(gk(Lall, 'inflow'), 41.28, 'приход'); near(gk(Lall, 'fact'), 21.68, 'факт'); });
  const unzip = buf => { const f = {}; let o = 0; while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) { const csz = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28); f[buf.slice(o + 30, o + 30 + nl).toString('utf8')] = buf.slice(o + 30 + nl + el, o + 30 + nl + el + csz); o += 30 + nl + el + csz; } return f; };
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const readXlsx = bytes => { const f = unzip(Buffer.from(bytes)), wbx = f['xl/workbook.xml'].toString(); const nm = [...wbx.matchAll(/<sheet name="([^"]*)"/g)].map(m => unesc(m[1]));
    return nm.map((n, i) => { const x = f['xl/worksheets/sheet' + (i + 1) + '.xml'].toString(), cells = {};
      for (const m of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) { const b = m[3] || '', nv = /<v>([^<]*)<\/v>/.exec(b), ts = /<t[^>]*>([\s\S]*?)<\/t>/.exec(b); cells[m[1]] = nv ? +nv[1] : ts ? unesc(ts[1]) : null; }
      return { name: n, cells }; }); };
  const nums = sh => Object.values(sh.cells).filter(v => typeof v === 'number'), has = (sh, v) => nums(sh).some(x => Math.abs(x - v) < 1e-6);
  const genAt = '2026-10-10T07:30:00.000Z';
  const full = readXlsx(X.build(res, inp, ctx2, { view: 'full', isAdmin: true, generatedAt: genAt }).toBytes()), brief = readXlsx(X.build(res, inp, ctx2, { view: 'brief', isAdmin: true, generatedAt: genAt }).toBytes());
  await t('краткий и полный Excel: лист «Кратко» с одинаковыми числами', () => assert.strictEqual(nums(brief[0]).join(';'), nums(full[0]).join(';')));
  await t('полный Excel, «Баланс прихода»: 2,98 (подключено в дозатор 2), 41,28, 20,68, 1 (факт дозатора 2)', () => { const s = full.find(x => x.name === 'Баланс прихода'); assert.ok(s, 'нет листа «Баланс прихода»'); [2.98, 41.28, 20.68, 1, 21.68].forEach(v => assert.ok(has(s, v), 'нет ' + v)); });
  await t('в Excel нет отрицательного факта дозатора 2 (−1,98)', () => full.forEach(s => assert.ok(!has(s, -1.98), 'лист ' + s.name + ' содержит −1,98')));
  const snap = calcClosing(refs, closeInp('11_12'));
  const c = { id: 'c1', kind: 'interval', at_ts: C1, period_from: C0, boundary_date: '2026-10-09', month_key: '2026-10', opens_month: '2026-10', late: false, is_etalon: true, needs_recalc: false, note: '', closed_at: C1, snapshot: { ...snap, warn_pct: 25, version: 2 } };
  const cctx = { tz: 5, st: 6, warnPct: 25, startMeas: START, endMeas: END, chemicals: refs.chemicals, prev: null, etalon: c };
  await t('снимок закрытия после пересчёта: дозатор 2 приход 2,98, факт 1,00; «вместо бутыли» = 0', () => { const r2 = snap.rows.find(x => x.group === '11_12'); near(r2.inflow_kg, 2.98, 'приход'); near(r2.fact_kg, 1.0, 'факт'); near(r2.flows.replacedByConnect, 0, 'вместо бутыли'); });
  await t('Excel закрытия показывает те же 2,98 / 1 / 20,68 / 41,28 и нет −1,98', () => { const books = readXlsx(CX.build(c, cctx).toBytes()); [2.98, 1, 20.68, 41.28].forEach(v => assert.ok(books.some(s => has(s, v)), 'нет ' + v)); assert.ok(!books.some(s => has(s, -1.98)), 'есть −1,98'); });
  await t('закрытый период сам не пересчитывается: старый снимок (неверный дозатор) остаётся в Excel до closing_recalc', () => {
    const oldSnap = calcClosing(refs, closeInp('1_10')), old = { ...c, snapshot: { ...oldSnap, warn_pct: 25, version: 2 }, needs_recalc: true };
    const books = readXlsx(CX.build(old, { ...cctx, etalon: old }).toBytes()); assert.ok(books.some(s => has(s, -1.98)), 'старый отрицательный факт должен остаться в снимке'); });

  console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0);
})();
