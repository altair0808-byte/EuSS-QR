// Этап 4: блок на главном экране (только админам и суперадмину).
// Статистика текущего периода с последнего замера + напоминание «пора закрыть месяц».
// Факта в текущем периоде ещё нет (он появится только после замера), поэтому показываем стирки, бельё и теорию.
const ClosingDash = (() => {
  const E = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dmy = d => String(d).split('-').reverse().join('.');
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  // pure: что напомнить. last = { at_ts, boundary_date, kind, opens_month } | null, today = дата смены 'YYYY-MM-DD',
  // o.newMonthWash — уже была стирка нового месяца (после неё закрыть месяц в срок уже нельзя)
  // Правило: месяц закрывается в последний день месяца или 1 числа, до первой стирки 1 числа; закрыть отчёт внутри месяца можно в любое время.
  const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  function reminder(last, today, o = {}) {
    if (!last) return { level: 'info', text: 'Замеров остатков ещё нет. Внесите начальный замер, чтобы считать точный факт расхода.' };
    const open = last.opens_month || last.boundary_date.slice(0, 7);          // месяц текущего открытого периода
    const [y, m] = open.split('-').map(Number), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);   // 1 число следующего месяца
    if (today >= next) {
      if (o.newMonthWash) return { level: 'bad', text: `Месяц ${open} не закрыт до первой стирки нового месяца. Закрытие задним числом делает суперадмин.` };
      return { level: 'warn', text: 'Месяц закончился — закройте месяц: взвесьте остатки после последней стирки и до первой стирки 1 числа.' };
    }
    if (today === addDays(next, -1)) return { level: 'info', text: 'Сегодня последний день месяца. Закрыть месяц можно после последней стирки или утром 1 числа, до первой стирки.' };
    return null;
  }
  let cache = { html: '', at: 0 };
  async function mount(el, o) {
    if (!el) return;
    if (cache.html) el.innerHTML = cache.html;                     // панель перерисовывается каждые 30 с — без мигания
    if (Date.now() - cache.at < 5 * 60e3) return;                  // данные обновляем не чаще раза в 5 минут
    cache.at = Date.now();
    const { tz = 5, st = 6, refs } = o;
    try {
      const [{ data: cl, error }, { data: td }] = await Promise.all([
        sb.from('closings').select('id,kind,boundary_date,at_ts,opens_month,is_etalon,snapshot').order('at_ts', { ascending: false }).limit(1),
        sb.rpc('closing_today')]);
      if (error) { el.innerHTML = ''; return; }          // stage15.sql не выполнен — блок просто не показываем
      const last = (cl || [])[0] || null, today = td || new Date(Date.now() + (tz - st) * 3600e3).toISOString().slice(0, 10);
      let nw = false;
      if (last) {                                   // нужна ли проверка «уже была стирка нового месяца»: только когда месяц закончился
        const open = last.opens_month || last.boundary_date.slice(0, 7), [yy, mm] = open.split('-').map(Number), nx = new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
        if (today >= nx) { const q = await sb.from('loads').select('id', { count: 'exact', head: true }).gte('shift_date', nx); nw = !q.error && (q.count || 0) > 0; }
      }
      const rem = reminder(last, today, { newMonthWash: nw });
      let stats = '';
      if (last && last.at_ts && refs) {
        const d1 = shiftDateOf(last.at_ts, tz, st), back = addDaysISO(d1, -60);
        const [lo, ch, cn, lv] = await Promise.all([sb.rpc('report_loads', { d1, d2: today }), sb.rpc('report_changes', { d1: back, d2: today }), sb.rpc('report_connects', { d1: back, d2: today }), sb.rpc('report_levels', { d1: back, d2: today })]);
        const from = new Date(last.at_ts).getTime(), inP = x => new Date(x.ts).getTime() >= from;
        const loads = (lo.data || []).filter(inP), chg = ch.data || [], con = cn.data || [];
        const r = calcReport(loads, chg.filter(inP), refs, con.filter(inP), { changes: chg, connects: con, levels: lv.data || [] });
        const days = Math.round((Date.parse(today) - Date.parse(d1)) / 864e5) + 1;
        const main = r.groups.all.chem.filter(c => c.kind === 'main' && c.theory && c.theory.kg != null);
        stats = `<div class="mg" style="margin-top:.5rem">
          <article class="m"><p class="l">С замера</p><p class="v">${days} <small>смен</small></p><p class="n">с ${dmy(d1)} ${(() => { const q = new Date(new Date(last.at_ts).getTime() + tz * 3600e3); return String(q.getUTCHours()).padStart(2, '0') + ':' + String(q.getUTCMinutes()).padStart(2, '0'); })()}</p></article>
          <article class="m"><p class="l">Стирок</p><p class="v">${Num.fmt(r.total)}</p><p class="n">в текущем периоде</p></article>
          <article class="m"><p class="l">Белья</p><p class="v">${Num.fmt(r.kg)} <small>кг</small></p><p class="n">в текущем периоде</p></article>
          <article class="m"><p class="l">Теория химии</p><p class="v">${Num.fmt(main.reduce((s, c) => s + c.theory.kg, 0))} <small>кг</small></p><p class="n">${main.map(c => E(c.name) + ' ' + Num.fmt(c.theory.kg) + ' кг').join(' · ') || '–'}</p></article></div>`;
      }
      const et = last?.snapshot && last.kind !== 'start' ? (() => { const a = (last.snapshot.rows || []).filter(x => x.group === 'all' && x.kind === 'main'), f = a.reduce((s, x) => s + (x.fact_kg || 0), 0), t = a.reduce((s, x) => s + (x.theory_kg || 0), 0); return t > 0 ? `Последнее закрытие: факт/теория ${Num.fmt(f / t, 3)}` : ''; })() : '';
      const col = rem?.level === 'bad' ? '#fdecea;color:#7a1a12;border-color:#f3b8b1' : rem?.level === 'warn' ? '#fff6e0;color:#6b4a00;border-color:#f1d58a' : 'var(--tint)';
      const t = new Date(today + 'T00:00:00Z');
      el.innerHTML = `<section aria-label="Текущий период по замерам" style="margin:1rem 0">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5rem"><p class="gl" style="margin:0">Текущий период по замерам · ${t.getUTCDate()} ${MON[t.getUTCMonth()]}</p>
        <span><a class="btn s" href="closings-report.html">Закрытия</a> <a class="btn s" href="closing.html">⚖ Закрыть</a></span></div>
        ${rem ? `<div style="margin:.5rem 0;padding:.65rem .85rem;border:1px solid var(--ln);border-radius:var(--r);background:${col};font-size:.9rem;font-weight:600">${E(rem.text)}</div>` : ''}
        ${stats}${et ? `<p class="hint" style="margin:.4rem 0 0">${E(et)}</p>` : ''}</section>`;
      cache.html = el.innerHTML; const cur = document.getElementById('clp'); if (cur && cur !== el) cur.innerHTML = cache.html;
    } catch (e) { el.innerHTML = ''; }
  }
  return { mount, reminder };
})();
if (typeof module !== 'undefined') module.exports = ClosingDash;
