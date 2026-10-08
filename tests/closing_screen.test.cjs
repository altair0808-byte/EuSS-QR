// Этап 1: экран «Закрытие» без браузера: время замера, проверка правил времени сервером, что уходит в closing_create. Запуск: node tests/closing_screen.test.cjs
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, bad = 0; const q = []; const t = (n, f) => q.push([n, f]);
const inline = [...rd('closing.html').matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1].replace(/\(async\(\)=>\{[\s\S]*$/, '');
const els = {}; const E = s => els[s] || (els[s] = { innerHTML: '', value: '', checked: false, hidden: false, textContent: '' });
const calls = []; let checkAnswers = {};
const ctx = vm.createContext({ console, Date, Math, Promise, location: { href: '' }, toast() {}, need: async () => null, $: E,
  document: { querySelectorAll: () => [] }, esc: undefined,
  sb: { rpc: async (fn, a) => { calls.push([fn, a]); if (fn === 'closing_check_time') return { data: checkAnswers[a.p_kind + (a.p_late ? ':late' : '')] || { ok: false, error: 'нельзя' } }; return { data: null }; } },
  withPw: async (title, txt, run) => { const r = await run('pw'); calls.push(['withPw', title, txt, r]); return true; },
  rpcAsk: async (fn, a) => { calls.push([fn, a]); return { ok: true }; } });
['num.js', 'report-calc.js'].forEach(f => vm.runInContext(rd(f), ctx));
vm.runInContext(inline, ctx);
const run = c => vm.runInContext(c, ctx);
console.log('Экран «Закрытие»');
t('время вводится как местное и уходит на сервер в UTC (UTC+5: 14:30 → 09:30Z)', () => { run('tz=5'); assert.strictEqual(run("toIso('2026-10-07T14:30')"), '2026-10-07T09:30:00.000Z'); });
t('любая минута: 03:05 утра тоже допустимо', () => assert.strictEqual(run("toIso('2026-10-01T03:05')"), '2026-09-30T22:05:00.000Z'));
t('до первого замера доступен только «Начальный замер»', async () => {
  run("last=null;kind=null"); E('#bd').value = '2026-10-07T14:30'; checkAnswers = { start: { ok: true } };
  await run('draw()'); assert.ok(E('#kd').innerHTML.includes('Начальный замер') && !E('#kd').innerHTML.includes('Закрыть месяц'));
  assert.strictEqual(run('kind'), 'start');
});
t('месяц нельзя посреди месяца: кнопка выключена и показана причина сервера, выбран «отчёт»', async () => {
  run("last={id:'p',at_ts:'2026-10-01T04:15:00.000Z',kind:'start'};kind=null;isSuper=false"); E('#bd').value = '2026-10-12T14:37';
  checkAnswers = { month: { ok: false, error: 'Месяц закрывается в последний день месяца или 1 числа' }, interval: { ok: true, month_key: '2026-10', opens_month: '2026-10' } };
  await run('draw()'); const h = E('#kd').innerHTML;
  assert.ok(/data-k="month"[^>]*disabled/.test(h) && h.includes('последний день месяца'), h); assert.strictEqual(run('kind'), 'interval');
  assert.ok(E('#per').innerHTML.includes('01.10.2026 09:15') && E('#per').innerHTML.includes('12.10.2026 14:37'));
});
t('1 числа до первой стирки: доступен «Закрыть месяц», отчёт внутри месяца — нет', async () => {
  E('#bd').value = '2026-11-01T05:30'; checkAnswers = { month: { ok: true, opens_month: '2026-11' }, interval: { ok: false, error: 'Месяц закончился' } }; run('kind=null');
  await run('draw()'); assert.strictEqual(run('kind'), 'month'); assert.ok(E('#per').innerHTML.includes('2026-11'));
});
t('после первой стирки нового месяца обычный админ закрыть месяц не может', async () => {
  E('#bd').value = '2026-11-01T09:00'; checkAnswers = { month: { ok: false, error: 'Уже была стирка нового месяца' }, interval: { ok: false, error: 'Месяц закончился' } }; run('kind=null');
  await run('draw()'); assert.strictEqual(run('kind'), null); assert.ok(E('#per').innerHTML.includes('нельзя'));
});
t('суперадмин: «позднее закрытие» включается галочкой и помечается late', async () => {
  run('isSuper=true;kind=null'); E('#late').checked = true; checkAnswers = { month: { ok: false, error: 'x' }, 'month:late': { ok: true, opens_month: '2026-11' }, interval: { ok: false, error: 'y' } };
  await run('draw()'); assert.strictEqual(run('kind'), 'month'); assert.strictEqual(run('chk.month.late'), true); E('#late').checked = false;
});
t('закрытие отправляет момент замера (p_at), снимок с from_ts/to_ts и не отправляет дату', async () => {
  calls.length = 0; run("kind='interval'; at='2026-10-12T09:37:00.000Z'; last={id:'p',at_ts:'2026-10-01T04:15:00.000Z',kind:'start'}; chk={interval:{ok:true}}; res={start:false,warnings:[],problems:[],arr:[{chemical_id:1,machine_group:'1_10',amount_kg:5}],from_ts:'2026-10-01T04:15:00.000Z',to_ts:'2026-10-12T09:37:00.000Z',rows:[],totals:{}}");
  E('#note').value = 'проверка'; await run('submit()');
  const c = calls.find(x => x[0] === 'closing_create'); assert.ok(c, 'closing_create не вызван'); const a = c[1];
  assert.strictEqual(a.p_at, '2026-10-12T09:37:00.000Z'); assert.ok(!('p_boundary' in a)); assert.strictEqual(a.p_snapshot.to_ts, '2026-10-12T09:37:00.000Z'); assert.strictEqual(a.p_late, false); assert.strictEqual(a.p_note, 'проверка');
  const w = calls.find(x => x[0] === 'withPw'); assert.ok(w[2].includes('не пересчитываются'), 'в подтверждении нет напоминания про фиксацию');
});
(async () => { for (const [n, f] of q) { try { await f(); ok++; console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n     ', e.message); } } console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`); process.exit(bad ? 1 : 0); })();
