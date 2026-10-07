// Сколько химии реально ушло при каждой замене бутыли (в основной единице химии: литры или кг).
// Правило: обычная замена = полная бутыль минус остаток. Если перед заменой подключали накопленный остаток,
// то ёмкость, которая сейчас закончилась, была не полной бутылью, а именно этим остатком (его объём и есть «ёмкость»).
// Замены и подключения идут по времени; подключение относится к ближайшей следующей замене той же химии и того же дозатора.
// Для периода нужны замены и подключения с запасом назад (60 дней), чтобы подключение из прошлого периода не потерялось.
function chemUsed(refs, changes, connects, moves, levels) {
  const used = {}, noLeft = {};
  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const conv = (c, v, from, to) => { if (from === to) return v; const d = dens(c); if (!d) return null; return from === 'l' ? v * d : v / d; };
  const T = x => new Date(x.ts).getTime() || 0;
  refs.chemicals.forEach(c => {
    if (c.kind === 'extra') return;
    const prim = +c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null); if (!prim) return;
    const size = prim === 'l' ? +c.bottle_l : +c.bottle_kg;
    const amt = x => prim === 'l'
      ? (x.amount_l != null ? +x.amount_l : x.amount_kg != null ? conv(c, +x.amount_kg, 'kg', 'l') : null)
      : (x.amount_kg != null ? +x.amount_kg : x.amount_l != null ? conv(c, +x.amount_l, 'l', 'kg') : null);
    const leftOf = x => prim === 'l'
      ? (x.leftover_l != null ? +x.leftover_l : x.leftover_kg != null ? conv(c, +x.leftover_kg, 'kg', 'l') : null)
      : (x.leftover_kg != null ? +x.leftover_kg : x.leftover_l != null ? conv(c, +x.leftover_l, 'l', 'kg') : null);
    ['1_10', '11_12'].forEach(g => {
      const ev = [];
      (changes || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).forEach(x => ev.push({ k: 0, t: T(x), x }));
      (connects || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).forEach(x => ev.push({ k: 1, t: T(x), x }));
      (moves || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).forEach(x => ev.push({ k: -1, t: T(x), x }));
      (levels || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === g).forEach(x => ev.push({ k: 2, t: T(x), x }));
      ev.sort((a, b) => a.t - b.t || a.k - b.k);            // при равном времени сначала перемещение, потом замена, потом подключение, потом «реальный уровень»
      let pending = 0, adj = 0, lvl = null;                  // adj: забрали (−) и залили (+) в дозатор с момента прошлой замены; lvl: реальный уровень, указанный вручную
      ev.forEach(e => {
        if (e.k === -1) { const a = amt(e.x); if (a > 0) adj += e.x.kind === 'take' ? -a : a; return; }   // 'pour' и 'add' (добавил суперадмин) поднимают уровень, 'take' снижает
        if (e.k === 1) { const a = amt(e.x); if (a > 0) pending += a; return; }
        if (e.k === 2) { const a = amt(e.x); if (a != null && isFinite(a) && a >= 0) { lvl = a; pending = 0; adj = 0; } return; }   // «в дозаторе было X»: заменяет и бутыль, и подключённый остаток
        let left = leftOf(e.x);
        if (left == null || !isFinite(left)) { noLeft[e.x.id] = true; left = 0; }
        const cap = Math.max(0, (pending > 0 ? pending : lvl != null ? lvl : size) + adj);   // забранное не расход, залитое — не «лишний» расход
        used[e.x.id] = cap - Math.max(0, Math.min(cap, left));
        pending = 0; adj = 0; lvl = null;
      });
    });
  });
  return { used, noLeft };
}
function addDaysISO(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

// Теория и факт расхода химии с раздельными дозаторами.
// Группа 1_10 = машины 1-10, группа 11_12 = машины 11-12.
// connects: подключения остатка (report_connects). Они уменьшают факт: подключённый остаток уже был посчитан
// как «не израсходованный» при замене, а следующая замена посчитает всю бутыль целиком.
// ctx (необязательно): { changes, connects } с запасом назад по времени, чтобы подключения из прошлого периода учитывались.
function calcReport(loads, changes, refs, connects, ctx, moves, levels) {
  connects = connects || []; moves = moves || [];
  const U = chemUsed(refs, ctx ? ctx.changes : changes, ctx ? ctx.connects : connects, ctx && ctx.moves ? ctx.moves : moves, ctx && ctx.levels ? ctx.levels : levels).used;
  const { water, washTypes, chemicals, recipes } = refs;
  const GROUPS = ['1_10','11_12'];
  const groupOfMachine = m => (+m <= 10 ? '1_10' : '11_12');
  const rec = {};
  recipes.forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);

  const makeGroup = () => ({ total:0, kg:0, byWash:{}, chem:{} });
  const groups = { '1_10': makeGroup(), '11_12': makeGroup(), all: makeGroup() };
  const byPart = { day:0, night:0 };
  let kg = 0;

  function addLoad(group, l) {
    const w = group.byWash[l.wash_type_id] || (group.byWash[l.wash_type_id] = { n:0, kg:0 });
    w.n++; w.kg += +l.weight_kg || 0;
    group.total++; group.kg += +l.weight_kg || 0;
  }
  function addTheory(group, l) {
    chemicals.forEach(c => {
      if (c.kind === 'main') group.chem[c.id] = (group.chem[c.id] || 0) + water * (rec[l.wash_type_id + ':' + c.id] || 0) / 1000;
    });
    Object.entries(l.extras || {}).forEach(([id,q]) => {
      const c = chemicals.find(x => String(x.id) === String(id) && x.kind === 'extra');
      if (!c) return;
      const unit = c.per_unit_unit === 'g' ? 1000 : 1000; // theory is stored as l-equivalent / kg-equivalent below
      group.chem[c.id] = (group.chem[c.id] || 0) + (+q || 0) * (+c.per_unit || 0) / unit;
    });
  }

  loads.forEach(l => {
    const g = groupOfMachine(l.machine);
    addLoad(groups[g], l);
    addTheory(groups[g], l);
    addLoad(groups.all, l);
    addTheory(groups.all, l);
    if (l.part in byPart) byPart[l.part]++;
    kg += +l.weight_kg || 0;
  });

  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const conv = (c,v,from,to) => {
    if (from === to) return v;
    const d = dens(c); if (!d) return null;
    return from === 'l' ? v*d : v/d;
  };
  // значение сразу в литрах, кг и штуках (штука = одна бутыль из настроек); штуки только для основной химии
  const both = (c,v,u) => {
    const l = conv(c,v,u,'l'), kg = conv(c,v,u,'kg');
    const pc = c.kind === 'extra' ? null : (l != null && +c.bottle_l > 0 ? l / +c.bottle_l : kg != null && +c.bottle_kg > 0 ? kg / +c.bottle_kg : null);
    return { l, kg, pc };
  };

  function chemRows(groupKey) {
    return chemicals.map(c => {
      const prim = c.kind === 'extra' ? null : (+c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null)); // замены бутылей отмечаются только для основной химии
      const size = prim === 'l' ? +c.bottle_l : prim === 'kg' ? +c.bottle_kg : null;
      const tu = c.kind === 'extra' && c.per_unit_unit === 'g' ? 'kg' : 'l';
      const theory = both(c, groups[groupKey].chem[c.id] || 0, tu);
      const mine = changes.filter(x => x.chemical_id === c.id && (groupKey === 'all' || (x.machine_group || '1_10') === groupKey));
      let took=null, put=null, added=null, actual=null, noLeft=0, diff=null, pct=null, stock=null, connected=null, adj=0;
      const leftOf = x => prim==='l'
        ? (x.leftover_l != null ? +x.leftover_l : x.leftover_kg != null ? conv(c,+x.leftover_kg,'kg','l') : null)
        : (x.leftover_kg != null ? +x.leftover_kg : x.leftover_l != null ? conv(c,+x.leftover_l,'l','kg') : null);
      if (prim) {
        let sum=0, st=0;
        mine.forEach(x=>{
          let left = leftOf(x);
          if(left==null){noLeft++;left=0;}
          sum += U[x.id] != null ? U[x.id] : size - Math.max(0,Math.min(size,left));
          if(!x.connect_id && !x.written_off_at && left>0) st += Math.min(size,left);   // остаток лежит в запасе: не подключён и не списан
        });
        let conn=0;
        connects.filter(x => +x.chemical_id === +c.id && (groupKey === 'all' || (x.machine_group || '1_10') === groupKey)).forEach(x=>{
          const a = prim==='l'
            ? (x.amount_l != null ? +x.amount_l : x.amount_kg != null ? conv(c,+x.amount_kg,'kg','l') : null)
            : (x.amount_kg != null ? +x.amount_kg : x.amount_l != null ? conv(c,+x.amount_l,'l','kg') : null);
          if(a==null||!(a>0))return;
          conn += a;
        });
        let tk=0,pr=0,ad=0;
        moves.filter(x => +x.chemical_id === +c.id && (groupKey === 'all' || (x.machine_group || '1_10') === groupKey)).forEach(x=>{
          const a = prim==='l' ? (x.amount_l != null ? +x.amount_l : x.amount_kg != null ? conv(c,+x.amount_kg,'kg','l') : null) : (x.amount_kg != null ? +x.amount_kg : x.amount_l != null ? conv(c,+x.amount_l,'l','kg') : null);
          if(a>0){ if(x.kind==='take') tk+=a; else if(x.kind==='add') ad+=a; else pr+=a; }   // add: суперадмин добавил любое количество, запас не трогает
        });
        st = Math.max(0, st + tk - pr);                         // забрали из дозатора — прибавилось в запас, залили — убавилось
        actual=both(c,sum,prim); took=both(c,tk,prim); put=both(c,pr,prim); added=both(c,ad,prim);
        stock=both(c,st,prim); connected=both(c,conn,prim);
        const theoryPrim=prim==='l'?theory.l:theory.kg;
        if(theoryPrim!=null){diff=sum-theoryPrim;pct=theoryPrim>0?diff/theoryPrim*100:null;}
      }
      return {id:c.id,name:c.name,kind:c.kind,prim,size,theory,actual,took,put,added,changes:mine.length,noLeft,diff,pct,stock,connected,adj};
    });
  }

  groups['1_10'].chemRows = chemRows; // internal marker
  return {
    total: loads.length, kg, byPart,
    groups: {
      '1_10': { total:groups['1_10'].total, kg:groups['1_10'].kg, byWash:groups['1_10'].byWash, chem:chemRows('1_10') },
      '11_12': { total:groups['11_12'].total, kg:groups['11_12'].kg, byWash:groups['11_12'].byWash, chem:chemRows('11_12') },
      all: { total:groups.all.total, kg:groups.all.kg, byWash:groups.all.byWash, chem:chemRows('all') }
    },
    byWash: groups.all.byWash
  };
}

// ===================== Закрытие по замерам (этап 15) =====================
// Факт расхода химии БАЛАНСОМ между двумя замерами остатка В ДОЗАТОРЕ (кг), отдельно по химикату и дозатору:
//   расход факт = остаток на начало + приход − остаток на конец
// «Приход» (нетто) строится из событий, которые сайт уже ведёт, и считается тем же проходом по событиям, что и chemUsed:
//   + новая бутыль при замене (номинал «1 шт = кг» из настроек)
//   − остаток старой бутыли, который при замене ушёл из дозатора в запас (его вводит бригадир)
//   + подключённый остаток; при этом подключение ЗАМЕНЯЕТ бутыль (как в chemUsed: ёмкость = подключённый остаток),
//     поэтому не поставленная бутыль вычитается (строка «вместо бутыли»)
//   + залили из запаса (pour), + добавил суперадмин (add)
//   − забрали из дозатора (take)
//   ± поправка «в дозаторе реально было X» (levels): ёмкость заменяется на X, разница идёт в поправку
// Период полуоткрытый: [t0, t1). Событие ровно в момент замера относится к СЛЕДУЮЩЕМУ периоду, поэтому замеры
// стыкуются без разрывов и без пересечений. Всё считается в кг; литры и штуки получаются через плотность.
const CLOSE_GROUPS = ['1_10', '11_12'];

// момент замера: дата смены + shift_start (местное время) → UTC ISO. Для tz=5, st=6: 2026-10-07 → 2026-10-07T01:00:00.000Z
function boundaryTs(dateISO, tz, st) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, (st == null ? 6 : +st) - (tz == null ? 5 : +tz))).toISOString();
}
// какие химикаты закрываются по замеру: вся основная + доп. средства, отмеченные «ведётся на дозаторе» (chemicals.in_closing)
const closingChems = chemicals => (chemicals || []).filter(c => c.kind === 'main' || c.in_closing === true);

// Потоки одного химиката в одном дозаторе за период [t0, t1), в кг.
// ev = { changes, connects, moves, levels } с запасом назад по времени (как для chemUsed), чтобы знать состояние на t0.
function dispenserFlows(c, group, t0, t1, ev) {
  const T = x => new Date(x.ts).getTime() || 0;
  const A = new Date(t0).getTime(), B = new Date(t1).getTime();
  const dn = (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const size = +c.bottle_kg > 0 ? +c.bottle_kg : null;
  const f = { bottles: 0, leftovers: 0, connects: 0, replacedByConnect: 0, pours: 0, adds: 0, takes: 0, levelAdj: 0,
              nBottles: 0, noLeft: 0, clipped: 0, needDensity: false, needSize: false };
  // значение в кг: kg, если есть; иначе литры через плотность. null — значения нет, undefined — есть только литры, а плотности нет
  const kgOf = (x, key) => {
    const kg = x[key + '_kg'], l = x[key + '_l'];
    if (kg != null && isFinite(+kg)) return +kg;
    if (l != null && isFinite(+l)) return dn ? +l * dn : undefined;
    return null;
  };
  const mine = a => (a || []).filter(x => +x.chemical_id === +c.id && (x.machine_group || '1_10') === group);
  const ev2 = [];
  mine(ev.changes).forEach(x => ev2.push({ k: 0, t: T(x), x }));
  mine(ev.connects).forEach(x => ev2.push({ k: 1, t: T(x), x }));
  mine(ev.moves).forEach(x => ev2.push({ k: -1, t: T(x), x }));
  mine(ev.levels).forEach(x => ev2.push({ k: 2, t: T(x), x }));
  ev2.sort((a, b) => a.t - b.t || a.k - b.k);                // тот же порядок, что в chemUsed
  let pending = 0, adj = 0, lvl = null;
  const base = () => pending > 0 ? pending : lvl != null ? lvl : size;
  for (const e of ev2) {
    if (e.t >= B) break;
    const inP = e.t >= A;
    if (e.k === -1) {                                          // перемещение: take / pour / add
      const a = kgOf(e.x, 'amount');
      if (a === undefined && inP) f.needDensity = true;
      if (!(a > 0)) continue;
      const kind = e.x.kind === 'take' ? 'take' : e.x.kind === 'add' ? 'add' : 'pour';
      adj += kind === 'take' ? -a : a;
      if (inP) f[kind === 'take' ? 'takes' : kind === 'add' ? 'adds' : 'pours'] += a;
    } else if (e.k === 1) {                                    // подключение остатка
      const a = kgOf(e.x, 'amount');
      if (a === undefined && inP) f.needDensity = true;
      if (!(a > 0)) continue;
      if (inP && base() == null) f.needSize = true;
      const old = pending > 0 ? 0 : (base() || 0);             // первое подключение заменяет бутыль (или уровень); следующие только добавляются
      pending += a;
      if (inP) { f.connects += a; f.replacedByConnect -= old; }
    } else if (e.k === 2) {                                    // «в дозаторе реально было X»
      const a = kgOf(e.x, 'amount');
      if (a === undefined && inP) f.needDensity = true;
      if (a == null || !isFinite(a) || a < 0) continue;
      if (inP && base() == null) f.needSize = true;
      if (inP) f.levelAdj += a - ((base() || 0) + adj);
      pending = 0; adj = 0; lvl = a;
    } else {                                                   // замена бутыли
      let left = kgOf(e.x, 'leftover');
      if (left === undefined && inP) f.needDensity = true;
      const noLeft = left == null || !isFinite(left);
      if (noLeft) left = 0;
      if (size == null) { if (inP) f.needSize = true; }
      const cap = Math.max(0, (base() || 0) + adj);
      const eff = Math.max(0, Math.min(cap, left));
      if (inP) {
        f.bottles += size || 0; f.leftovers += eff; f.nBottles++;
        if (noLeft) f.noLeft++;
        if (!noLeft && left > cap + 1e-9) f.clipped++;
      }
      pending = 0; adj = 0; lvl = null;
    }
  }
  f.inflow = f.bottles + f.connects + f.replacedByConnect + f.pours + f.adds + f.levelAdj - f.leftovers - f.takes;   // «приход, нетто»
  return f;
}

// Расчёт закрытия за период.
// inp: {
//   from, to      — даты замеров (смена, с которой начинается замер), 'YYYY-MM-DD'; период = смены from … to−1
//   tz, st        — settings: tz_offset, shift_start
//   startKg, endKg — замеры { '<id химии>:<дозатор>': кг }; startKg берётся из предыдущего закрытия
//   loads         — загрузки (любые; берутся только с ts внутри периода)
//   changes, connects, moves, levels — события с запасом назад (60 дней), как в отчёте
//   residents     — { 'YYYY-MM-DD': число } или null, если нет доступа / не введено
//   warnPct       — порог «больше теории», % (settings.close_warn_pct), по умолчанию 25
// }
// Возвращает { rows, totals, problems, warnings, canClose }. problems мешают закрытию, warnings требуют подтверждения.
function calcClosing(refs, inp) {
  const tz = inp.tz == null ? 5 : +inp.tz, st = inp.st == null ? 6 : +inp.st;
  const t0 = boundaryTs(inp.from, tz, st), t1 = boundaryTs(inp.to, tz, st);
  const A = new Date(t0).getTime(), B = new Date(t1).getTime();
  const inPeriod = x => { const t = new Date(x.ts).getTime(); return t >= A && t < B; };
  const warnPct = inp.warnPct == null ? 25 : +inp.warnPct;
  const problems = [], warnings = [];
  const chems = closingChems(refs.chemicals);
  const loads = (inp.loads || []).filter(inPeriod);
  const ev = { changes: inp.changes || [], connects: inp.connects || [], moves: inp.moves || [], levels: inp.levels || [] };
  // теория и старый факт «по замене» — прежним расчётом сайта, на тех же данных
  const rep = calcReport(loads, ev.changes.filter(inPeriod), refs, ev.connects.filter(inPeriod),
    { changes: ev.changes, connects: ev.connects, moves: ev.moves, levels: ev.levels }, ev.moves.filter(inPeriod), ev.levels);
  // дни периода и проживающие
  const days = []; for (let d = inp.from; d < inp.to; d = addDaysISO(d, 1)) days.push(d);
  let residentDays = null, residentMissing = 0;
  if (inp.residents) {
    residentDays = 0; days.forEach(d => { const n = inp.residents[d]; if (n == null) residentMissing++; else residentDays += +n || 0; });
    if (!(residentDays > 0)) residentDays = null;
    else if (residentMissing) warnings.push({ type: 'residents', text: `Не введены проживающие за ${residentMissing} из ${days.length} смен: показатели «на жителя» занижены/неполные` });
  }
  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const rows = [];
  chems.forEach(c => {
    const d = dens(c), name = c.name;
    const tRow = {};
    CLOSE_GROUPS.forEach(g => { tRow[g] = rep.groups[g].chem.find(x => +x.id === +c.id); });
    const mk = (g, label) => {
      const key = c.id + ':' + g;
      const f = dispenserFlows(c, g, t0, t1, ev);
      const th = tRow[g].theory, old = tRow[g].actual;
      let start = inp.startKg ? inp.startKg[key] : undefined, end = inp.endKg ? inp.endKg[key] : undefined;
      const base = { chemical_id: c.id, name, kind: c.kind, group: g };
      if (end == null || !isFinite(+end)) problems.push({ type: 'missing', chemical_id: c.id, group: g, text: `Нет замера на конец: ${name}, ${label}` });
      if (start == null || !isFinite(+start)) { warnings.push({ type: 'start_assumed', chemical_id: c.id, group: g, text: `Нет начального замера: ${name}, ${label}. Принят 0 кг (новый химикат?)` }); start = 0; }
      if (c.kind === 'main' && !d) problems.push({ type: 'density', chemical_id: c.id, group: g, text: `${name}: задайте в настройках «1 шт = литров» и «1 шт = кг» (плотность)` });
      if (c.kind === 'main' && !(+c.bottle_kg > 0) && !problems.some(p => p.type === 'density' && p.chemical_id === c.id)) problems.push({ type: 'density', chemical_id: c.id, group: g, text: `${name}: задайте в настройках «1 шт = кг»` });
      if (f.needDensity) problems.push({ type: 'density', chemical_id: c.id, group: g, text: `${name}: есть записи только в литрах, а плотность не задана (настройки)` });
      if (f.needSize) problems.push({ type: 'density', chemical_id: c.id, group: g, text: `${name}: не задано «1 шт = кг» (настройки)` });
      if (th.kg == null) problems.push({ type: 'density', chemical_id: c.id, group: g, text: `${name}: теорию нельзя перевести в кг, задайте плотность (настройки)` });
      const have = end != null && isFinite(+end);
      const fact = have ? +start + f.inflow - +end : null;
      const theory = th.kg;
      const dev = fact != null && theory != null ? fact - theory : null;
      const pct = dev != null && theory > 0 ? dev / theory * 100 : null;
      return { ...base, start_kg: +start, end_kg: have ? +end : null, flows: f, inflow_kg: f.inflow, fact_kg: fact, theory_kg: theory,
               dev_kg: dev, dev_pct: pct, ratio: fact != null && theory > 0 ? fact / theory : null,
               old_fact_kg: old ? old.kg : null, density: d, bottle_kg: +c.bottle_kg > 0 ? +c.bottle_kg : null };
    };
    const g1 = mk('1_10', 'дозатор 1 (машины 1–10)'), g2 = mk('11_12', 'дозатор 2 (машины 11–12)');
    const sum = (a, b) => a == null || b == null ? null : a + b;
    const fl = {}; Object.keys(g1.flows).forEach(k => { fl[k] = typeof g1.flows[k] === 'boolean' ? g1.flows[k] || g2.flows[k] : g1.flows[k] + g2.flows[k]; });
    const all = { chemical_id: c.id, name, kind: c.kind, group: 'all', start_kg: g1.start_kg + g2.start_kg, end_kg: sum(g1.end_kg, g2.end_kg), flows: fl, inflow_kg: fl.inflow,
      fact_kg: sum(g1.fact_kg, g2.fact_kg), theory_kg: sum(g1.theory_kg, g2.theory_kg), old_fact_kg: sum(g1.old_fact_kg, g2.old_fact_kg), density: d, bottle_kg: g1.bottle_kg };
    all.dev_kg = all.fact_kg != null && all.theory_kg != null ? all.fact_kg - all.theory_kg : null;
    all.dev_pct = all.dev_kg != null && all.theory_kg > 0 ? all.dev_kg / all.theory_kg * 100 : null;
    all.ratio = all.fact_kg != null && all.theory_kg > 0 ? all.fact_kg / all.theory_kg : null;
    [g1, g2, all].forEach(r => {
      const gk = r.group === 'all' ? rep.groups.all : rep.groups[r.group];
      const lmk = gk.kg, wsh = gk.total;                        // кг белья и число стирок этого дозатора (или обоих)
      const lit = r.fact_kg != null && d ? r.fact_kg / d : null;
      r.fact_l = lit;
      r.fact_pc = r.fact_kg != null && r.bottle_kg ? r.fact_kg / r.bottle_kg : null;
      r.theory_l = r.theory_kg != null && d ? r.theory_kg / d : null;
      // «мл» для жидкой химии (есть плотность), «г» для остальной (порошок)
      const small = r.fact_kg == null ? null : d ? r.fact_l * 1000 : r.fact_kg * 1000;
      r.unit_small = d ? 'мл' : 'г';
      r.per_kg_laundry = small != null && lmk > 0 ? small / lmk : null;
      r.per_wash = small != null && wsh > 0 ? small / wsh : null;
      r.per_resident_day = small != null && r.group === 'all' && residentDays ? small / residentDays : null;   // на жителя в сутки: сумма проживающих по сменам
      r.laundry_kg = lmk; r.washes = wsh;
      if (r.group !== 'all' && r.fact_kg != null) {
        const nm = `${r.name}, ${r.group === '1_10' ? 'дозатор 1' : 'дозатор 2'}`;
        if (r.fact_kg < -1e-9) warnings.push({ type: 'negative', chemical_id: r.chemical_id, group: r.group, value: r.fact_kg, text: `Расход отрицательный: ${nm}. Проверьте замеры, заливки и замены` });
        else if (r.dev_pct != null && r.dev_pct > warnPct) warnings.push({ type: 'over', chemical_id: r.chemical_id, group: r.group, value: r.dev_pct, limit: warnPct, text: `Расход больше теории сверх порога: ${nm}` });
        if (r.flows.noLeft) warnings.push({ type: 'noLeft', chemical_id: r.chemical_id, group: r.group, text: `${nm}: у ${r.flows.noLeft} замен не указан остаток (принят 0)` });
        if (r.flows.clipped) warnings.push({ type: 'clipped', chemical_id: r.chemical_id, group: r.group, text: `${nm}: у ${r.flows.clipped} замен остаток больше ёмкости (учтена только ёмкость)` });
      }
      rows.push(r);
    });
  });
  // убрать дубли проблем (одна и та же проблема для двух дозаторов)
  const seen = new Set(), uniq = problems.filter(p => { const k = p.type + '|' + p.chemical_id + '|' + (p.type === 'missing' ? p.group : p.text); if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    from: inp.from, to: inp.to, t0, t1, days: days.length,
    totals: { washes: rep.total, laundry_kg: rep.kg, byGroup: { '1_10': { washes: rep.groups['1_10'].total, laundry_kg: rep.groups['1_10'].kg }, '11_12': { washes: rep.groups['11_12'].total, laundry_kg: rep.groups['11_12'].kg } },
              resident_days: residentDays, resident_missing_days: residentMissing },
    rows, problems: uniq, warnings, canClose: uniq.length === 0
  };
}
if (typeof module !== 'undefined') module.exports = { calcReport, chemUsed, addDaysISO, calcClosing, dispenserFlows, boundaryTs, closingChems };
