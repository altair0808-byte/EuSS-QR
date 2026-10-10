// Этап 1 «Сравнение химии»: ОДИН расчёт теории и факта за любой период. Без интерфейса.
// Подключать ПОСЛЕ report-calc.js (использует calcClosing, calcReport, closingChems, boundaryTs, shiftDateOf оттуда).
//
// Правила:
//  • Факт = остаток в дозаторе на начало + приход − остаток на конец (кг), только между двумя ЗАМЕРАМИ (закрытиями).
//    Факт «по заменам канистр» в основном расчёте не используется, он лишь справочно (legacy_fact_kg, «неточно, без замеров»).
//  • Берутся только те отрезки между соседними закрытиями, которые целиком лежат внутри запрошенного периода.
//    Теория для сравнения считается за ТОТ ЖЕ отрезок, что и факт (иначе сравнивать яблоки с апельсинами).
//    Теория за весь запрошенный период отдаётся отдельно (theory_requested_*), как справка.
//  • По дням факт не считается: факт существует только между замерами.
//  • Неполные смены (закрытие не в 06:00) учитываются долей суток внутри calcClosing.
//
// calcCompare(refs, inp) → { request, coverage, totals, rows, totals_by_kind, theory_only, segments, problems, warnings }
//   refs  — те же справочники, что у calcClosing: { water, washTypes, chemicals, recipes }
//   inp   — {
//     fromTs, toTs     — период [от, до), ISO. Или from/to — даты 'YYYY-MM-DD' (границы смен);
//     tz, st           — settings: tz_offset, shift_start (по умолчанию 5 и 6);
//     closings         — цепочка закрытий: [{ id, at_ts, kind, measures: { '<id химии>:<дозатор>': кг } }] (любой порядок);
//                        из строк БД собирается через chainFromRows(closings, closing_measures);
//     loads, changes, connects, moves, levels — события (с запасом назад по времени, как для calcClosing);
//     residents        — { 'YYYY-MM-DD': число } или null;
//     tolPct           — допуск «в норме», % (по умолчанию warnPct, иначе 25);
//     warnPct          — порог «больше теории» для предупреждений calcClosing (settings.close_warn_pct)
//   }
// Статусы строки: ok | over | under | nodata | check  (check — отрицательный расход: «проверьте замеры, заливки, замены»).

// Собрать цепочку закрытий из строк БД: closings(id, at_ts, kind) + closing_measures(closing_id, chemical_id, machine_group, amount_kg)
function chainFromRows(closingRows, measureRows) {
  const by = {};
  (measureRows || []).forEach(m => { (by[m.closing_id] || (by[m.closing_id] = {}))[m.chemical_id + ':' + m.machine_group] = +m.amount_kg; });
  return (closingRows || []).map(c => ({ id: c.id, at_ts: c.at_ts, kind: c.kind, measures: by[c.id] || {} }))
    .sort((a, b) => new Date(a.at_ts) - new Date(b.at_ts));
}

// Баланс одной строки calcClosing в виде, пригодном для суммирования и показа (все числа в кг)
function balOf(x) {
  const f = x.flows || {};
  return { start_measured_kg: x.start_measured_kg == null ? (x.start_kg || 0) + (x.to_reserve_in_kg || 0) : x.start_measured_kg, to_reserve_kg: x.to_reserve_in_kg || 0,
    start_kg: x.start_kg || 0, bottles: f.bottles || 0, leftovers: f.leftovers || 0, connects: f.connects || 0, replacedByConnect: f.replacedByConnect || 0,
    pours: f.pours || 0, adds: f.adds || 0, takes: f.takes || 0, levelAdj: f.levelAdj || 0, inflow_kg: x.inflow_kg || 0, end_kg: x.end_kg == null ? null : x.end_kg,
    noLeft: f.noLeft || 0, clipped: f.clipped || 0 };
}

function calcCompare(refs, inp) {
  const tz = inp.tz == null ? 5 : +inp.tz, st = inp.st == null ? 6 : +inp.st;
  const t0 = inp.fromTs ? new Date(inp.fromTs).toISOString() : boundaryTs(inp.from, tz, st);
  const t1 = inp.toTs ? new Date(inp.toTs).toISOString() : boundaryTs(inp.to, tz, st);
  const A = new Date(t0).getTime(), B = new Date(t1).getTime();
  const tolPct = inp.tolPct != null ? +inp.tolPct : inp.warnPct != null ? +inp.warnPct : 25;
  const EPS = 1e-9;
  const chems = closingChems(refs.chemicals);
  const out = { request: { from_ts: t0, to_ts: t1, days_exact: (B - A) / 864e5, tol_pct: tolPct }, problems: [], warnings: [], segments: [] };
  if (!(B > A)) { out.problems.push({ type: 'period', text: 'Конец периода должен быть позже начала' }); out.rows = []; out.theory_only = []; out.totals_by_kind = {}; out.coverage = { has_fact: false }; out.totals = {}; return out; }

  // ---- 1. отрезки между соседними закрытиями, целиком внутри периода ----
  const chain = (inp.closings || []).slice().sort((a, b) => new Date(a.at_ts) - new Date(b.at_ts));
  const segs = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const s = new Date(chain[i].at_ts).getTime(), e = new Date(chain[i + 1].at_ts).getTime();
    if (s >= A && e <= B && e > s) segs.push({ a: chain[i], b: chain[i + 1] });
  }
  const inRange = (x, lo, hi) => { const t = new Date(x.ts).getTime(); return t >= lo && t < hi; };
  const allLoads = inp.loads || [];
  const reqLoads = allLoads.filter(l => inRange(l, A, B));

  // ---- 2. теория за весь запрошенный период (справка) и для химии без замеров ----
  const emptyCtx = { changes: [], connects: [], moves: [], levels: [] };
  const repReq = calcReport(reqLoads, [], refs, [], emptyCtx, [], []);
  const reqTheory = (c, g) => { const r = (g === 'all' ? repReq.groups.all : repReq.groups[g]).chem.find(x => +x.id === +c.id); return r ? r.theory : { l: null, kg: null }; };
  const closeIds = new Set(chems.map(c => +c.id));
  out.theory_only = (refs.chemicals || []).filter(c => !closeIds.has(+c.id)).map(c => {
    const t = reqTheory(c, 'all');
    return { chemical_id: c.id, name: c.name, kind: c.kind, theory_l: t.l, theory_kg: t.kg, note: 'Расход по замерам не ведётся: показана только теория' };
  }).filter(x => x.theory_l != null || x.theory_kg != null);

  // ---- 3. покрытие ----
  const factFrom = segs.length ? new Date(segs[0].a.at_ts).getTime() : null;
  const factTo = segs.length ? new Date(segs[segs.length - 1].b.at_ts).getTime() : null;
  const winLoads = segs.length ? allLoads.filter(l => inRange(l, factFrom, factTo)) : [];
  const sumKg = a => a.reduce((s, l) => s + (+l.weight_kg || 0), 0);
  const cov = {
    has_fact: segs.length > 0, segments: segs.length,
    fact_from_ts: segs.length ? new Date(factFrom).toISOString() : null, fact_to_ts: segs.length ? new Date(factTo).toISOString() : null,
    fact_days: segs.length ? (factTo - factFrom) / 864e5 : 0,
    coverage_pct: segs.length ? (factTo - factFrom) / (B - A) * 100 : 0,
    full: segs.length > 0 && Math.abs(factFrom - A) < 1000 && Math.abs(factTo - B) < 1000,
    uncovered_before_h: segs.length ? Math.max(0, (factFrom - A) / 3600e3) : null, uncovered_after_h: segs.length ? Math.max(0, (B - factTo) / 3600e3) : null,
    washes_requested: reqLoads.length, laundry_kg_requested: sumKg(reqLoads),
    washes_in_fact: winLoads.length, laundry_kg_in_fact: sumKg(winLoads),
    note: null
  };
  if (!segs.length) {
    const inside = chain.filter(c => { const t = new Date(c.at_ts).getTime(); return t >= A && t <= B; }).length;
    cov.note = chain.length < 2 ? 'Закрытий меньше двух: факт посчитать нельзя. Нужен замер на начало и замер на конец.'
      : inside < 2 ? 'Внутри выбранного периода меньше двух закрытий: факт посчитать нельзя. Выберите период от одного закрытия до другого.'
      : 'Нет отрезка между соседними закрытиями внутри периода.';
  } else if (!cov.full) {
    cov.note = `Факт за период закрытий: от ${cov.fact_from_ts} до ${cov.fact_to_ts} (${cov.coverage_pct.toFixed(0)}% выбранного периода). Теория для сравнения взята за тот же отрезок.`;
  }
  out.coverage = cov;

  // ---- 4. расчёт по каждому отрезку (calcClosing) и суммирование ----
  const GROUPS = ['1_10', '11_12', 'all'];
  const agg = {};        // 'id:group' -> накопитель
  const slot = (c, g) => agg[c.id + ':' + g] || (agg[c.id + ':' + g] = {
    chemical_id: c.id, name: c.name, kind: c.kind, group: g, density: null, bottle_kg: null,
    fact_kg: 0, factNull: false, theory_kg: 0, theoryNull: false, legacy_kg: 0, legacyNull: false, laundry_kg: 0, washes: 0,
    bal: { start_measured_kg: 0, to_reserve_kg: 0, noLeft: 0, clipped: 0, start_kg: 0, bottles: 0, leftovers: 0, connects: 0, replacedByConnect: 0, pours: 0, adds: 0, takes: 0, levelAdj: 0, inflow_kg: 0, end_kg: 0, endNull: false }, nSeg: 0 });
  let residentDays = null, residentMissing = 0, residentSeen = false;
  const seen = new Set();
  segs.forEach(sg => {
    const r = calcClosing(refs, {
      fromTs: sg.a.at_ts, toTs: sg.b.at_ts, tz, st, warnPct: inp.warnPct,
      startKg: sg.a.measures || {}, endKg: sg.b.measures || {},
      loads: allLoads, changes: inp.changes || [], connects: inp.connects || [], moves: inp.moves || [], levels: inp.levels || [], residents: inp.residents || null
    });
    const segOut = { from_ts: r.from_ts, to_ts: r.to_ts, days_exact: r.days_exact, closing_from: sg.a.id || null, closing_to: sg.b.id || null,
                     washes: r.totals.washes, laundry_kg: r.totals.laundry_kg, warnings: r.warnings, problems: r.problems, rows: r.rows.filter(x => x.group === 'all').map(x => ({ chemical_id: x.chemical_id, name: x.name, fact_kg: x.fact_kg, theory_kg: x.theory_kg, dev_pct: x.dev_pct })),
                     // этап 3: строки отрезка по каждому дозатору (баланс, факт, теория) — для «Подробно» и графика по закрытиям
                     rows_g: r.rows.map(x => ({ chemical_id: x.chemical_id, name: x.name, group: x.group, fact_kg: x.fact_kg, theory_kg: x.theory_kg, dev_pct: x.dev_pct, balance: balOf(x) })) };
    out.segments.push(segOut);
    r.problems.forEach(p => { const k = p.type + '|' + p.chemical_id + '|' + p.text; if (!seen.has(k)) { seen.add(k); out.problems.push(p); } });
    r.warnings.forEach(w => out.warnings.push({ ...w, segment_from_ts: r.from_ts, segment_to_ts: r.to_ts }));
    if (r.totals.resident_days != null) { residentSeen = true; residentDays = (residentDays || 0) + r.totals.resident_days; }
    residentMissing += r.totals.resident_missing_days || 0;
    r.rows.forEach(x => {
      const c = chems.find(y => +y.id === +x.chemical_id); if (!c) return;
      const s = slot(c, x.group);
      s.nSeg++; s.density = x.density; s.bottle_kg = x.bottle_kg;
      if (x.fact_kg == null) s.factNull = true; else s.fact_kg += x.fact_kg;
      if (x.theory_kg == null) s.theoryNull = true; else s.theory_kg += x.theory_kg;
      if (x.old_fact_kg == null) s.legacyNull = true; else s.legacy_kg += x.old_fact_kg;
      s.laundry_kg += x.laundry_kg || 0; s.washes += x.washes || 0;
      s.bal.start_kg += x.start_kg || 0;
      const bo = balOf(x); s.bal.start_measured_kg += bo.start_measured_kg; s.bal.to_reserve_kg += bo.to_reserve_kg; s.bal.noLeft += bo.noLeft; s.bal.clipped += bo.clipped;
      const f = x.flows || {};
      ['bottles', 'leftovers', 'connects', 'replacedByConnect', 'pours', 'adds', 'takes', 'levelAdj'].forEach(k => { s.bal[k] += f[k] || 0; });
      s.bal.inflow_kg += x.inflow_kg || 0;
      if (x.end_kg == null) s.bal.endNull = true; else s.bal.end_kg += x.end_kg;
    });
  });
  const hasRes = residentSeen && residentDays > 0;
  out.residents_info = { entered: hasRes, missing_days: residentMissing, resident_days: hasRes ? residentDays : null };
  // неполная смена: граница отрезка (замер) не на начале смены (по умолчанию 06:00 местного времени)
  const edges = []; const edgeSeen = new Set();
  segs.forEach(sg => [sg.a, sg.b].forEach(c => {
    const t = new Date(c.at_ts).getTime(), loc = new Date(t + tz * 3600e3), k = c.at_ts + '';
    const aligned = loc.getUTCHours() === st && loc.getUTCMinutes() === 0 && loc.getUTCSeconds() === 0;
    if (!aligned && !edgeSeen.has(k)) { edgeSeen.add(k); edges.push({ ts: new Date(t).toISOString(), closing_id: c.id || null }); }
  }));
  out.coverage.partial_shift = edges.length > 0; out.coverage.partial_edges = edges;
  out.totals = {
    washes: winLoads.length, laundry_kg: cov.laundry_kg_in_fact,
    by_group: {
      '1_10': { washes: winLoads.filter(l => +l.machine <= 10).length, laundry_kg: sumKg(winLoads.filter(l => +l.machine <= 10)) },
      '11_12': { washes: winLoads.filter(l => +l.machine > 10).length, laundry_kg: sumKg(winLoads.filter(l => +l.machine > 10)) }
    },
    resident_days: hasRes ? residentDays : null, resident_missing_days: residentMissing
  };

  // ---- 5. строки ----
  const statusOf = (fact, theory, pct) => {
    if (fact == null || theory == null) return 'nodata';
    if (fact < -1e-6) return 'check';
    if (!(theory > EPS)) return fact > 1e-6 ? 'over' : 'ok';
    return pct > tolPct ? 'over' : pct < -tolPct ? 'under' : 'ok';
  };
  out.rows = [];
  chems.forEach(c => {
    const d = (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
    GROUPS.forEach(g => {
      const s = agg[c.id + ':' + g];
      const tr = reqTheory(c, g);
      const noFact = !s || s.factNull || !s.nSeg;
      const fact = noFact ? null : s.fact_kg;
      const theory = !s || s.theoryNull || !s.nSeg ? null : s.theory_kg;
      const diff = fact != null && theory != null ? fact - theory : null;
      const pct = diff != null && theory > EPS ? diff / theory * 100 : null;
      const factL = fact != null && d ? fact / d : null;
      const small = fact == null ? null : d ? factL * 1000 : fact * 1000;     // мл для жидкой химии, г для порошка
      const lmk = s ? s.laundry_kg : 0, wsh = s ? s.washes : 0;
      out.rows.push({
        chemical_id: c.id, name: c.name, kind: c.kind, group: g,
        fact_kg: fact, fact_l: factL, fact_pc: fact != null && +c.bottle_kg > 0 ? fact / +c.bottle_kg : null,
        theory_kg: theory, theory_l: theory != null && d ? theory / d : null,
        diff_kg: diff, diff_l: diff != null && d ? diff / d : null, dev_pct: pct, ratio: fact != null && theory > EPS ? fact / theory : null,
        status: statusOf(fact, theory, pct),
        theory_requested_kg: tr.kg, theory_requested_l: tr.l,
        legacy_fact_kg: s && !s.legacyNull && s.nSeg ? s.legacy_kg : null, legacy_note: 'Справочно, по заменам канистр: неточно, без замеров',
        unit_small: d ? 'мл' : 'г',
        per_kg_laundry: small != null && lmk > 0 ? small / lmk : null,
        per_wash: small != null && wsh > 0 ? small / wsh : null,
        per_resident_day: small != null && g === 'all' && hasRes ? small / residentDays : null,
        laundry_kg: lmk, washes: wsh, density: d, bottle_kg: +c.bottle_kg > 0 ? +c.bottle_kg : null,
        balance: s && s.nSeg ? { start_measured_kg: s.bal.start_measured_kg, to_reserve_kg: s.bal.to_reserve_kg, noLeft: s.bal.noLeft, clipped: s.bal.clipped, start_kg: s.bal.start_kg, bottles: s.bal.bottles, leftovers: s.bal.leftovers, connects: s.bal.connects, replacedByConnect: s.bal.replacedByConnect,
          pours: s.bal.pours, adds: s.bal.adds, takes: s.bal.takes, levelAdj: s.bal.levelAdj, inflow_kg: s.bal.inflow_kg, end_kg: s.bal.endNull ? null : s.bal.end_kg } : null
      });
    });
  });

  // ---- 6. итоги в литрах по виду химии (основная / доп. средства) и дозаторам ----
  out.totals_by_kind = {};
  ['main', 'extra'].forEach(kind => {
    out.totals_by_kind[kind] = {};
    GROUPS.forEach(g => {
      const rs = out.rows.filter(r => r.kind === kind && r.group === g);
      if (!rs.length) return;
      const ok = rs.filter(r => r.fact_l != null && r.theory_l != null);
      const fact = ok.reduce((s, r) => s + r.fact_l, 0), theory = ok.reduce((s, r) => s + r.theory_l, 0);
      const dev = ok.length ? fact - theory : null, pct = dev != null && theory > EPS ? dev / theory * 100 : null;
      out.totals_by_kind[kind][g] = { fact_l: ok.length ? fact : null, theory_l: ok.length ? theory : null, diff_l: dev, dev_pct: pct,
        status: ok.length ? statusOf(fact, theory, pct) : 'nodata', chemicals: rs.length, chemicals_counted: ok.length, incomplete: ok.length < rs.length };
    });
  });
  return out;
}

if (typeof module !== 'undefined') module.exports = Object.assign(module.exports || {}, { calcCompare, chainFromRows });
