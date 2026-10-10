// Этап 3 «Сравнение химии»: общая загрузка данных для compare.html (кратко) и compare-detail.html (подробно).
// Один и тот же код грузит данные и считает calcCompare для обоих экранов, поэтому итоги совпадают.
// Подключать ПОСЛЕ report-calc.js, compare-calc.js, compare-view.js, compare-detail.js. Работает с клиентом Supabase (sb) без DOM.
//
//   CompareData.init(sb)                  → env: { refs, tz, st, warnPct, closings (от новых к старым), names, meta, isAdmin, role }
//   CompareData.rangeOf(env, mode, month, customFrom, customTo) → { fromTs, toTs } | null
//   CompareData.compute(sb, env, range)   → { res, inp }   (calcCompare + исходные данные, из которых он посчитан)
//   CompareData.makeCtx(sb, env, res, inp, mode) → ctx для CompareDetail/CompareXlsx (имена, закрытия, эталон, предыдущее, месяц)
const CompareData = (() => {
  const V = () => (typeof CompareView !== 'undefined' ? CompareView : require('./compare-view.js'));
  const rpc = async (sb, fn, a) => { const r = await sb.rpc(fn, a); if (r.error) throw new Error(r.error.message); return r.data || []; };
  const soft = async (sb, fn, a) => { try { const r = await sb.rpc(fn, a); return r.error ? null : (r.data || []); } catch (e) { return null; } };
  const sel = async (sb, table, cols, f) => { let q = sb.from(table).select(cols); if (f) q = f(q); const r = await q; if (r.error) throw new Error(r.error.message); return r.data || []; };

  // Справочники, настройки, закрытия, имена сотрудников и права. Права проверяет и база (is_admin / роль), экран только прячет лишнее.
  async function init(sb, ses) {
    const uid = ses && ses.user && ses.user.id;
    const [pr, adm] = await Promise.all([sb.from('profiles').select('role').eq('id', uid).maybeSingle(), sb.rpc('is_admin')]);
    const role = pr && pr.data ? pr.data.role : null, isAdmin = !!(adm && adm.data) || role === 'superadmin';
    const env = { isAdmin, role, ok: isAdmin };
    if (!isAdmin) return env;
    const [s, c, w, rc, cl] = await Promise.all([
      sb.from('settings').select('*'), sb.from('chemicals').select('*').order('sort'), sb.from('wash_types').select('id,name').order('sort'),
      sb.from('recipes').select('*'), sb.from('closings').select('id,at_ts,kind,is_etalon,closed_by,closed_at').order('at_ts', { ascending: false })]);
    if (cl.error) { env.error = /closings/.test(cl.error.message) ? 'Выполните stage15.sql в Supabase.' : cl.error.message; return env; }
    const g = k => { const x = (s.data || []).find(y => y.key === k); return x ? +x.value : null; };
    env.tz = g('tz_offset') ?? 5; env.st = g('shift_start') ?? 6; env.warnPct = g('close_warn_pct') ?? 25;
    env.refs = { water: g('water_l') ?? 55, washTypes: w.data || [], chemicals: c.data || [], recipes: rc.data || [] };
    env.closings = (cl.data || []).slice().sort((a, b) => new Date(b.at_ts) - new Date(a.at_ts));
    env.meta = {}; env.closings.forEach(x => { env.meta[x.id] = { closed_by: x.closed_by, closed_at: x.closed_at, kind: x.kind }; });
    env.names = {}; const n = await soft(sb, 'staff_names'); (n || []).forEach(x => { env.names[x.id] = x.name; });   // имена нужны только для «кто внёс»
    return env;
  }

  function rangeOf(env, mode, month, customFrom, customTo) {
    const v = V();
    if (mode === 'last') return v.lastClosingRange(env.closings);
    if (mode === 'month') { const r = v.monthRange(month, env.tz, env.st, Date.now()); return { fromTs: r.fromTs, toTs: r.toTs }; }
    return customFrom && customTo ? { fromTs: customFrom, toTs: customTo } : null;
  }

  // Загрузка событий и расчёт за период. События берутся с запасом 60 дней назад (как в отчёте по сменам и в закрытии).
  async function compute(sb, env, r) {
    const A = new Date(r.fromTs).getTime(), B = new Date(r.toTs).getTime();
    const inside = env.closings.filter(c => { const t = new Date(c.at_ts).getTime(); return t >= A && t <= B; });     // закрытия внутри периода — границы отрезков факта
    const from = shiftDateOf(r.fromTs, env.tz, env.st), to = shiftDateOf(r.toTs, env.tz, env.st), back = addDaysISO(from, -60), needFact = inside.length >= 2;
    const [loads, changes, connects, moves, levels, mrows, resRows] = await Promise.all([
      rpc(sb, 'report_loads', { d1: from, d2: to }),
      needFact ? rpc(sb, 'report_changes', { d1: back, d2: to }) : [], needFact ? rpc(sb, 'report_connects', { d1: back, d2: to }) : [],
      needFact ? soft(sb, 'report_moves', { d1: back, d2: to }) : [], needFact ? soft(sb, 'report_levels', { d1: back, d2: to }) : [],
      needFact ? sel(sb, 'closing_measures', 'closing_id,chemical_id,machine_group,amount_kg', q => q.in('closing_id', inside.map(c => c.id))) : [],
      needFact ? soft(sb, 'get_residents', { d1: from, d2: to }) : null]);
    let residents = null; if (resRows) { residents = {}; resRows.forEach(x => { residents[x.day] = x.cnt; }); }
    const inp = { fromTs: r.fromTs, toTs: r.toTs, tz: env.tz, st: env.st, closings: chainFromRows(inside, mrows), loads, changes, connects, moves: moves || [], levels: levels || [], residents, warnPct: env.warnPct, tolPct: env.warnPct };
    return { res: calcCompare(env.refs, inp), inp };
  }

  // Контекст для подробного вида и Excel: имена, кто и когда внёс замеры, эталон, предыдущее закрытие, расчёт за месяц.
  async function makeCtx(sb, env, res, inp, mode, withMonth) {
    const ctx = { refs: env.refs, names: env.names, meta: env.meta, tz: env.tz, st: env.st, etalon: null, prev: null, monthRes: null };
    const cov = res.coverage || {};
    const et = env.closings.find(c => c.is_etalon), pv = cov.has_fact ? env.closings.find(c => Math.abs(new Date(c.at_ts) - new Date(cov.fact_from_ts)) < 1000) : null;
    const ids = [et && et.id, pv && pv.id].filter((x, i, a) => x && a.indexOf(x) === i);
    if (ids.length) {
      try {
        const snaps = await sel(sb, 'closings', 'id,at_ts,snapshot', q => q.in('id', ids)); const by = {}; snaps.forEach(x => { by[x.id] = x; });
        const mk = c => c ? { id: c.id, at_ts: c.at_ts, snapshot: (by[c.id] && by[c.id].snapshot) || null } : null;
        ctx.etalon = mk(et); ctx.prev = mk(pv);
      } catch (e) { ctx.etalon = et ? { id: et.id, at_ts: et.at_ts, snapshot: null } : null; ctx.prev = pv ? { id: pv.id, at_ts: pv.at_ts, snapshot: null } : null; }
    }
    if (withMonth && cov.has_fact) {
      try {
        const v = V(), key = v.monthKeyOf(new Date(res.request.to_ts).getTime() - 1, env.tz, env.st), mr = v.monthRange(key, env.tz, env.st, Date.now());
        const same = Math.abs(new Date(mr.fromTs) - new Date(res.request.from_ts)) < 1000 && Math.abs(new Date(mr.toTs) - new Date(res.request.to_ts)) < 1000;
        ctx.monthRes = same ? res : (await compute(sb, env, { fromTs: mr.fromTs, toTs: mr.toTs })).res;
      } catch (e) { ctx.monthRes = null; }
    }
    return ctx;
  }

  return { init, rangeOf, compute, makeCtx };
})();
if (typeof module !== 'undefined') module.exports = CompareData;
