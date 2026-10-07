// Симуляция 20 смен прачечной: загрузки, замены бутылей, остатки, «подключили остаток».
// Известна «истина» (физический расход) -> сравниваем с calcReport из report-calc.js.
// Запуск: node tests/sim20.cjs
const fs = require('fs'), vm = require('vm'), path = require('path');
const sb = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../report-calc.js'), 'utf8'), sb);
const { calcReport, chemUsed } = sb.module.exports;

// ---------- детерминированный ГСЧ ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mkNorm = R => () => { let u = 0, v = 0; while (!u) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------- справочники (из supabase.sql) ----------
const WASH = ['Постель белая', 'Махра белая', 'Униформа белая', 'Униформа тёмная', 'Синтетика', 'Деликатная', 'Спецодежда'];
const WEIGHTS = [25, 20, 15, 10, 5, 5, 20];
const REC = [[3, 8, 6, 4, 1], [3, 8, 6, 5, 1], [3, 8, 5, 3, 1], [2, 6, 0, 3, 1], [3, 5, 0, 3, 1], [2, 4, 0, 3, 1], [3, 10, 0, 3, 1]];
const CHEM = ['EMULSIFIER', 'ALKALINE', 'BLEACH', 'SOFTENER', 'NEUTRALIZER'];
const BOTTLE_L = 20, BOTTLE_KG = 22, WATER = 55;
const refs = {
  water: WATER,
  washTypes: WASH.map((n, i) => ({ id: i + 1, name: n })),
  chemicals: [
    ...CHEM.map((n, i) => ({ id: i + 1, name: n, kind: 'main', bottle_l: BOTTLE_L, bottle_kg: BOTTLE_KG })),
    { id: 6, name: 'Ваниш', kind: 'extra', per_unit: 5, per_unit_unit: 'ml' },
    { id: 7, name: 'Ленор', kind: 'extra', per_unit: 50, per_unit_unit: 'ml' },
    { id: 8, name: 'Порошок', kind: 'extra', per_unit: 175, per_unit_unit: 'g' }],
  recipes: WASH.flatMap((_, w) => CHEM.map((_, c) => ({ wash_type_id: w + 1, chemical_id: c + 1, ml_per_l: REC[w][c] })))
};

// ---------- сценарии «человеческого фактора» ----------
const SCEN = {
  'Точно':    { lefSd: 0.1, miss: 0.00, pConnect: 0.6, doseSd: 0.08 },
  'Обычно':   { lefSd: 0.4, miss: 0.04, pConnect: 0.6, doseSd: 0.08 },
  'Небрежно': { lefSd: 1.0, miss: 0.12, pConnect: 0.6, doseSd: 0.08 },
};
// реальный расход относительно теории (то, что система должна «обнаружить»)
const BIAS = [1.10, 0.97, 1.15, 1.05, 1.08];
const T0 = Date.UTC(2026, 8, 15, 1, 0, 0);            // 06:00 Атырау = 01:00 UTC
const iso = ms => new Date(ms).toISOString();

function simulate(seed, sc, days = 20, opts = {}) {
  const R = rng(seed), N = mkNorm(R);
  const loads = [], changes = [], connects = [];
  const truth = {};                                   // [chem][group] -> физика
  const key = (c, g) => c + '|' + g;
  const tanks = {};
  const GROUPS = ['1_10', '11_12'];
  const mkTrig = cap => 0.3 + R() * (Math.min(4, 0.4 * cap) - 0.3);
  CHEM.forEach((_, c) => GROUPS.forEach(g => {
    tanks[key(c + 1, g)] = { level: BOTTLE_L, cap: BOTTLE_L, trig: mkTrig(BOTTLE_L), consumed: 0, bottles: 1, stockTrue: [], stockRec: [], lastChangeConsumed: 0, daily: Array(days).fill(0) };
  }));
  let id = 0, extraDaily = [];

  for (let d = 0; d < days; d++) {
    const n1 = Math.max(10, Math.round(48 + d * 0.4 + 6 * N())), n2 = Math.max(0, Math.round(10 + 3 * N()));
    const lst = [];
    for (let i = 0; i < n1; i++) lst.push({ machine: 1 + Math.floor(R() * 10) });
    for (let i = 0; i < n2; i++) lst.push({ machine: 11 + Math.floor(R() * 2) });
    lst.forEach(l => { l.off = R() * 24 * 3600e3; });
    lst.sort((a, b) => a.off - b.off);
    lst.forEach(l => {
      let r = R() * WEIGHTS.reduce((a, b) => a + b), w = 0; while (r > WEIGHTS[w]) { r -= WEIGHTS[w]; w++; }
      const ts = T0 + d * 864e5 + l.off;
      const extras = {}; if (R() < 0.05) extras[8] = 1 + Math.floor(R() * 2); if (R() < 0.03) extras[6] = 1;
      loads.push({ id: 'l' + (++id), machine: l.machine, wash_type_id: w + 1, weight_kg: Math.round((25 + 1.5 * N()) * 2) / 2, part: l.off < 12 * 3600e3 ? 'day' : 'night', extras, ts: iso(ts), day: d });
      const g = l.machine <= 10 ? '1_10' : '11_12';
      CHEM.forEach((_, c) => {
        const th = WATER * REC[w][c] / 1000; if (!th) return;
        const T = tanks[key(c + 1, g)];
        let dose = th * BIAS[c] * (1 + sc.doseSd * N()); dose = Math.max(0, Math.min(dose, T.level));
        T.level -= dose; T.consumed += dose; T.daily[d] += dose;
        if (T.level <= T.trig) {                                  // бригадир меняет бутыль/ёмкость
          const rTrue = T.level, tNow = ts + 60e3 * (5 + Math.floor(R() * 30));
          let rec = Math.round(Math.max(0, rTrue + sc.lefSd * N()) * 10) / 10;
          const missed = R() < sc.miss;
          const ch = { id: 'c' + (++id), chemical_id: c + 1, machine_group: g, ts: iso(tNow), day: d, leftover_l: missed ? undefined : rec, _rTrue: rTrue, _usedTrue: T.cap - rTrue };
          if (missed) delete ch.leftover_l;
          changes.push(ch);
          T.stockTrue.push(rTrue); if (!missed && rec > 0) T.stockRec.push(ch);
          const recSum = T.stockRec.reduce((a, x) => a + x.leftover_l, 0);
          if (recSum >= 4 && R() < sc.pConnect) {                // «Подключили остаток»
            const k = { id: 'k' + (++id), chemical_id: c + 1, machine_group: g, ts: iso(tNow + 60e3), day: d, amount_l: Math.round(recSum * 10) / 10 };
            connects.push(k); T.stockRec.forEach(x => x.connect_id = k.id); T.stockRec = [];
            const tr = T.stockTrue.reduce((a, b) => a + b, 0); T.stockTrue = [];
            T.cap = tr; T.level = tr;
          } else { T.cap = BOTTLE_L; T.level = BOTTLE_L; T.bottles++; }
          T.trig = mkTrig(T.cap);
        }
      });
    });
  }
  return { loads, changes, connects, tanks, days };
}

// ---------- метрики ----------
function evaluate(S, calcFn = calcReport) {
  const out = { chem: {}, perGroup: {} };
  const rep = calcFn(S.loads, S.changes, refs, S.connects);
  let calcTot = 0, trueTot = 0, theoTot = 0, stockCalc = 0, stockTrue = 0, tailTot = 0;
  CHEM.forEach((name, i) => {
    const c = i + 1; let calcA = 0, trueA = 0, theo = 0, stC = 0, stT = 0, tail = 0, nCh = 0, nCo = 0;
    ['1_10', '11_12'].forEach(g => {
      const row = rep.groups[g].chem.find(x => x.id === c);
      const T = S.tanks[c + '|' + g];
      const lastCh = S.changes.filter(x => x.chemical_id === c && x.machine_group === g);
      const trueUsed = lastCh.reduce((a, x) => a + x._usedTrue, 0);      // физически ушло из закрытых ёмкостей
      calcA += row.actual.l; trueA += trueUsed; theo += row.theory.l; stC += row.stock.l;
      stT += T.stockTrue.reduce((a, b) => a + b, 0); tail += T.cap - T.level; nCh += lastCh.length;
      nCo += S.connects.filter(x => x.chemical_id === c && x.machine_group === g).length;
      out.perGroup[name + ' ' + g] = { calc: row.actual.l, truth: trueUsed, theory: row.theory.l };
    });
    out.chem[name] = { calc: calcA, truth: trueA, theory: theo, errAbs: calcA - trueA, errPct: (calcA - trueA) / trueA * 100, stockCalc: stC, stockTrue: stT, tail, nCh, nCo, biasTrue: BIAS[i], biasCalc: calcA / theo };
    calcTot += calcA; trueTot += trueA; theoTot += theo; stockCalc += stC; stockTrue += stT; tailTot += tail;
  });
  // физический баланс: всё, что залили = ушло + в ёмкостях + в запасе
  let bal = 0, nBottles = 0, consumed = 0, inTank = 0, inStock = 0;
  Object.values(S.tanks).forEach(T => { nBottles += T.bottles; consumed += T.consumed; inTank += T.level; inStock += T.stockTrue.reduce((a, b) => a + b, 0); });
  bal = nBottles * BOTTLE_L - (consumed + inTank + inStock);
  out.total = { calc: calcTot, truth: trueTot, theory: theoTot, errAbs: calcTot - trueTot, errPct: (calcTot - trueTot) / trueTot * 100, stockCalc, stockTrue, tail: tailTot, balance: bal, nBottles, consumed, inTank, inStock };
  out.rep = rep;
  return out;
}
module.exports = { simulate, evaluate, SCEN, CHEM, refs, calcReport, chemUsed, BIAS, T0, iso };

if (require.main === module) {
  const ev = evaluate(simulate(42, SCEN['Обычно']));
  console.log(JSON.stringify(ev.total, null, 1));
}
