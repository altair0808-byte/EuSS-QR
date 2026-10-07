const { simulate, evaluate, SCEN, CHEM, refs, calcReport, BIAS } = require('./sim20.cjs');
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const RUNS = 400;
// наивный расчёт: подключения игнорируются (как будто «кнопки» нет)
const naive = (L, C, R) => calcReport(L, C.map(x => { const y = { ...x }; delete y.connect_id; return y; }), R, []);

for (const [name, sc] of Object.entries(SCEN)) {
  const E = [], En = [], tailP = [], stk = [], bal = [], bias = CHEM.map(() => []), biasClosed = CHEM.map(() => []), nB = [], nCo = [], tail = [], daily = [], weekly = [];
  for (let s = 1; s <= RUNS; s++) {
    const S = simulate(s * 7919, sc), ev = evaluate(S), evn = evaluate(S, naive);
    E.push(ev.total.errPct); En.push(evn.total.errPct);
    tailP.push(ev.total.tail / ev.total.consumed * 100); tail.push(ev.total.tail);
    stk.push(ev.total.stockCalc - ev.total.stockTrue); bal.push(Math.abs(ev.total.balance));
    nB.push(ev.total.nBottles); nCo.push(S.connects.length);
    CHEM.forEach((n, i) => { biasClosed[i].push(ev.chem[n].calc / ev.chem[n].theory * 0 + 0); });
    // дневная/недельная точность: факт по сменам (по дню замены) против физического расхода за этот день
    const perDay = Array(20).fill(0), perDayT = Array(20).fill(0);
    S.changes.forEach(c => { perDayT[c.day] += c._usedTrue; });
    const U = require('./sim20.cjs').chemUsed(refs, S.changes, S.connects).used;
    S.changes.forEach(c => { perDay[c.day] += U[c.id] ?? 0; });
    // «истинный расход за день» = физический расход по тикам
    const trueDay = Array(20).fill(0); Object.values(S.tanks).forEach(T => T.daily.forEach((v, d) => trueDay[d] += v));
    daily.push(mean(perDay.map((v, d) => Math.abs(v - trueDay[d]) / trueDay[d] * 100)));
    const wk = [[0, 7], [7, 14]]; const w = wk.map(([a, b]) => { const x = perDay.slice(a, b).reduce((p, c) => p + c, 0), y = trueDay.slice(a, b).reduce((p, c) => p + c, 0); return Math.abs(x - y) / y * 100; });
    weekly.push(mean(w));
  }
  const f = (x, d = 2) => x.toFixed(d);
  console.log(`\n=== ${name} (${RUNS} прогонов×20 смен) ===`);
  console.log(`итоговая ошибка факта (закрытые ёмкости), %:  среднее ${f(mean(E))}  медиана ${f(q(E, .5))}  p5 ${f(q(E, .05))}  p95 ${f(q(E, .95))}`);
  console.log(`  то же, если игнорировать «Подключили остаток»: среднее ${f(mean(En))}  p95 ${f(q(En, .95))}`);
  console.log(`в незакрытых ёмкостях на конец периода: ${f(mean(tail), 1)} л = ${f(mean(tailP), 1)}% расхода`);
  console.log(`ошибка остатка в запасе (расчёт − истина), л: среднее ${f(mean(stk))}  p5 ${f(q(stk, .05))}  p95 ${f(q(stk, .95))}`);
  console.log(`замен бутылей: ${f(mean(nB), 0)}, подключений остатка: ${f(mean(nCo), 0)}`);
  console.log(`средняя |ошибка| по дням ${f(mean(daily), 1)}%  по неделям ${f(mean(weekly), 1)}%`);
  console.log(`баланс (залито − ушло − в ёмкостях − в запасе): макс ${Math.max(...bal).toExponential(1)} л`);
}
