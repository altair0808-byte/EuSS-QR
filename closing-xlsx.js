// Выгрузка закрытия в Excel: подробно, по листам, в фирменных цветах EuSS. Нужен xlsx-writer.js.
//   ClosingXlsx.build(c, ctx) → Workbook
//     c   — строка closings (kind, at_ts, period_from, boundary_date, is_etalon, late, needs_recalc, note, snapshot, reserve, closed_at)
//     ctx — { tz, st, warnPct, startMeas, endMeas: { '<id химии>:<дозатор>': кг }, chemicals, prev (предыдущее закрытие), etalon, monthRows }
//   ClosingXlsx.download(c, ctx)   — собрать и скачать файл
//   ClosingXlsx.fileName(c, tz)    — имя файла
const ClosingXlsx = (() => {
  const X = typeof XlsxWriter !== 'undefined' ? XlsxWriter : require('./xlsx-writer.js');
  const C = { teal: '2AA3B5', dark: '12606D', tint: 'E6F4F6', tint2: 'F3F9FA', line: 'C9D6DA', ink: '17323A', mut: '5B7480', white: 'FFFFFF',
    ok: 'DFF3E7', okT: '14532D', warn: 'FFF1CC', warnT: '6B4A00', bad: 'FADBD8', badT: '7A1A12', low: 'DCEBFA', lowT: '1F4E79', stock: 'FDEBD8' };
  const KIND = { start: 'Начальный замер', interval: 'Закрытие отчёта внутри месяца', month: 'Закрытие месяца' };
  const GN = { '1_10': 'Дозатор 1 (машины 1–10)', '11_12': 'Дозатор 2 (машины 11–12)', all: 'Итого по обоим дозаторам' };
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const pad = n => String(n).padStart(2, '0');
  const loc = (ts, tz) => new Date(new Date(ts).getTime() + (tz == null ? 5 : +tz) * 3600e3);
  const fmtTs = (ts, tz) => { if (!ts) return ''; const d = loc(ts, tz); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const mName = k => { if (!k) return ''; const [y, m] = k.split('-'); return MONTHS[+m - 1] + ' ' + y; };
  const hoursText = (t0, t1) => { const h = (new Date(t1) - new Date(t0)) / 3600e3, d = Math.floor(h / 24), hh = h - d * 24; return (d ? d + ' сут. ' : '') + (Math.round(hh * 10) / 10).toString().replace('.', ',') + ' ч'; };
  const n = v => (v == null || !isFinite(v) ? null : +v);

  function fileName(c, tz) {
    const d = loc(c.at_ts, tz), stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`;
    return `EuSS_закрытие_${c.kind === 'month' ? 'месяц' : c.kind === 'start' ? 'начальный-замер' : 'отчёт'}_${stamp}.xlsx`;
  }

  function build(c, ctx = {}) {
    const tz = ctx.tz == null ? 5 : +ctx.tz, warnPct = +(ctx.warnPct || (c.snapshot && c.snapshot.warn_pct) || 25);
    const s = c.snapshot || null;
    const wb = new X.Workbook({ title: 'Закрытие EuSS ' + fmtTs(c.at_ts, tz), creator: 'EuSS', footer: 'EuSS · закрытие ' + fmtTs(c.at_ts, tz) });
    // ---------- стили ----------
    const bd = { l: 'thin', r: 'thin', t: 'thin', b: 'thin' };
    const S = {
      banner: wb.style({ font: { b: 1, sz: 18, color: C.white }, fill: C.teal, align: { h: 'left', v: 'center', indent: 1 } }),
      sub: wb.style({ font: { sz: 11, color: C.white }, fill: C.dark, align: { h: 'left', v: 'center', indent: 1 } }),
      h2: wb.style({ font: { b: 1, sz: 13, color: C.dark }, align: { h: 'left', v: 'center' }, border: { b: { s: 'medium', color: C.teal } } }),
      th: wb.style({ font: { b: 1, sz: 10, color: C.white }, fill: C.dark, align: { h: 'center', v: 'center', wrap: 1 }, border: bd }),
      thL: wb.style({ font: { b: 1, sz: 10, color: C.white }, fill: C.dark, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      grp: wb.style({ font: { b: 1, sz: 10, color: C.dark }, fill: C.tint, align: { h: 'center', v: 'center' }, border: bd }),
      td: wb.style({ font: { sz: 10, color: C.ink }, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      tdB: wb.style({ font: { b: 1, sz: 10, color: C.ink }, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      tdZ: wb.style({ font: { sz: 10, color: C.ink }, fill: C.tint2, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      n2: wb.style({ font: { sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0.00' }),
      n2B: wb.style({ font: { b: 1, sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0.00' }),
      n2Z: wb.style({ font: { sz: 10, color: C.ink }, fill: C.tint2, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0.00' }),
      n3: wb.style({ font: { sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '0.000' }),
      n3Z: wb.style({ font: { sz: 10, color: C.ink }, fill: C.tint2, align: { h: 'right', v: 'center' }, border: bd, numFmt: '0.000' }),
      n0: wb.style({ font: { sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0' }),
      sg: wb.style({ font: { sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+#,##0.00;-#,##0.00;0.00' }),
      sgB: wb.style({ font: { b: 1, sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+#,##0.00;-#,##0.00;0.00' }),
      pc: wb.style({ font: { sz: 10, color: C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+0.00"%";-0.00"%";0.00"%"' }),
      key: wb.style({ font: { b: 1, sz: 10, color: C.mut }, fill: C.tint2, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      val: wb.style({ font: { sz: 11, color: C.ink }, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      kpiL: wb.style({ font: { b: 1, sz: 9, color: C.mut }, fill: C.tint, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin', t: 'thin' } }),
      kpiV: wb.style({ font: { b: 1, sz: 18, color: C.dark }, fill: C.tint, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin', b: 'thin' }, numFmt: '#,##0.##' }),
      kpiV3: wb.style({ font: { b: 1, sz: 18, color: C.dark }, fill: C.tint, align: { h: 'center', v: 'center' }, border: { l: 'thin', r: 'thin', b: 'thin' }, numFmt: '0.000' }),
      note: wb.style({ font: { i: 1, sz: 9, color: C.mut }, align: { h: 'left', v: 'top', wrap: 1 } }),
      txt: wb.style({ font: { sz: 11, color: C.ink }, align: { h: 'left', v: 'top', wrap: 1 } }),
      txtB: wb.style({ font: { b: 1, sz: 11, color: C.dark }, align: { h: 'left', v: 'top', wrap: 1 } }),
      wOk: wb.style({ font: { b: 1, sz: 11, color: C.okT }, fill: C.ok, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      stk: wb.style({ font: { sz: 10, color: C.ink }, fill: C.stock, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0.00' }),
    };
    const devStyle = (pct, bold) => {   // цвет отклонения «факт к теории»
      const f = pct == null ? null : pct > warnPct ? [C.bad, C.badT] : pct < -warnPct ? [C.low, C.lowT] : Math.abs(pct) > warnPct / 2 ? [C.warn, C.warnT] : [C.ok, C.okT];
      return f ? wb.style({ font: { b: bold ? 1 : 0, sz: 10, color: f[1] }, fill: f[0], align: { h: 'right', v: 'center' }, border: bd, numFmt: '+0.00"%";-0.00"%";0.00"%"' }) : S.td;
    };
    const banner = (ws, cols, title, subtitle) => {
      ws.set(1, 1, title, S.banner).merge(1, 1, 1, cols).fill(1, 1, 1, cols, S.banner).height(1, 34);
      ws.set(2, 1, subtitle, S.sub).merge(2, 1, 2, cols).fill(2, 1, 2, cols, S.sub).height(2, 20);
    };
    const hdr = (ws, r, labels, h = 42) => { labels.forEach((t, i) => ws.set(r, i + 1, t, i === 0 ? S.thL : S.th)); ws.height(r, h); };
    const period = s ? `${fmtTs(s.from_ts || c.period_from, tz)} → ${fmtTs(s.to_ts || c.at_ts, tz)}` : fmtTs(c.at_ts, tz);
    const title = 'EuSS · ' + KIND[c.kind];
    const sub = s ? `Период: ${period}   ·   ${hoursText(s.from_ts || c.period_from, s.to_ts || c.at_ts)}` : `Замер: ${fmtTs(c.at_ts, tz)}`;
    const rows = s ? s.rows || [] : [];
    const allRows = rows.filter(r => r.group === 'all'), rowsOf = id => rows.filter(r => +r.chemical_id === +id);
    const chemList = allRows.map(r => ({ id: r.chemical_id, name: r.name, kind: r.kind, unit: r.unit_small }));
    const measOf = (m, id, g) => { const v = m && m[id + ':' + g]; return v == null ? null : +v; };

    // ======================= 1. Итоги =======================
    {
      const NC = 15, ws = wb.addSheet('Итоги', { tab: C.teal, grid: false, widths: [26, 11, 12, 12, 12, 12, 12, 12, 11, 11, 10, 12, 12, 13, 11], freeze: { row: 0, col: 1 }, zoom: 90 });
      banner(ws, NC, title, sub);
      let r = 4;
      // три пары «название — значение» в строке: колонки 1 | 2–4, 6–7 | 8–10, 11–12 | 13–15
      const kv = (k, v, col, kspan, vspan) => { ws.height(r, 32); ws.set(r, col, k, S.key); if (kspan > 1) ws.merge(r, col, r, col + kspan - 1).fill(r, col, r, col + kspan - 1, S.key); const vc = col + kspan; ws.set(r, vc, v, S.val).merge(r, vc, r, vc + vspan - 1).fill(r, vc, r, vc + vspan - 1, S.val); };
      const row3 = (a, b, d) => { kv(a[0], a[1], 1, 1, 3); kv(b[0], b[1], 6, 2, 3); kv(d[0], d[1], 11, 2, 4); r++; };
      row3(['Вид закрытия', KIND[c.kind]], ['Замер (конец периода)', fmtTs(c.at_ts, tz)], ['Месяц', mName(c.month_key)]);
      row3(['Начало периода', c.period_from ? fmtTs(c.period_from, tz) : '— (точка отсчёта)'], ['Длительность', s ? hoursText(s.from_ts || c.period_from, s.to_ts || c.at_ts) : '—'], ['Смен затронуто', s ? `${s.days} (в пересчёте на сутки: ${String(Math.round((s.days_exact == null ? s.days : s.days_exact) * 100) / 100).replace('.', ',')})` : '—']);
      const flags = [c.is_etalon ? 'эталон' : '', c.late ? 'позднее закрытие' : '', c.needs_recalc ? 'нужен пересчёт' : ''].filter(Boolean).join(', ') || 'обычное';
      row3(['Статус', flags], ['Закрыто в системе', c.closed_at ? fmtTs(c.closed_at, tz) : '—'], ['Комментарий', c.note || '—']); r++;
      if (!s) {
        ws.set(r, 1, 'Это начальный замер: расчёта периода нет. Остатки по дозаторам — на листе «Замеры». Они ушли в запас и дальше считаются с нуля.', S.txt).merge(r, 1, r, NC); ws.height(r, 36);
      } else {
        const T = s.totals || {}, mainAll = allRows.filter(x => x.kind === 'main'), fs = mainAll.reduce((a, x) => a + (x.fact_kg || 0), 0), ts = mainAll.reduce((a, x) => a + (x.theory_kg || 0), 0);
        const kpi = [['СТИРОК', n(T.washes), S.kpiV], ['БЕЛЬЯ, КГ', n(T.laundry_kg), S.kpiV], ['ЖИТЕЛЕ-СУТОК', n(T.resident_days), S.kpiV], ['ФАКТ / ТЕОРИЯ (ОСНОВНАЯ ХИМИЯ)', ts > 0 ? fs / ts : null, S.kpiV3]];
        const spans = [[1, 2], [3, 5], [6, 8], [9, 12]];
        kpi.forEach(([l, v, st], i) => { const [a, b] = spans[i]; ws.set(r, a, l, S.kpiL).merge(r, a, r, b).fill(r, a, r, b, S.kpiL); ws.set(r + 1, a, v == null ? '—' : v, st).merge(r + 1, a, r + 1, b).fill(r + 1, a, r + 1, b, st); });
        ws.height(r, 18).height(r + 1, 32); r += 3;
        ws.set(r, 1, 'Расход химии за период (оба дозатора)', S.h2).merge(r, 1, r, NC).fill(r, 1, r, NC, S.h2).height(r, 24); r++;
        hdr(ws, r, ['Химикат', 'Тип', 'На начало, кг', 'Приход, кг', 'На конец, кг', 'Факт, кг', 'Теория, кг', 'Отклонение, кг', 'Отклонение, %', 'Факт, л', 'Факт, шт', 'Расход на кг белья', 'Расход на стирку', 'Расход на жителя в сутки', 'Факт / теория'], 46); r++;
        const first = r;
        allRows.forEach((x, i) => {
          const z = i % 2 ? 'Z' : '';
          ws.set(r, 1, x.name, S.tdB); ws.set(r, 2, x.kind === 'main' ? 'основная' : 'доп.', S['td' + z] || S.td);
          ws.set(r, 3, n(x.start_kg), S['n2' + z] || S.n2).set(r, 4, n(x.inflow_kg), S['n2' + z] || S.n2).set(r, 5, n(x.end_kg), S['n2' + z] || S.n2);
          ws.set(r, 6, n(x.fact_kg), S.n2B).set(r, 7, n(x.theory_kg), S['n2' + z] || S.n2).set(r, 8, n(x.dev_kg), S.sg).set(r, 9, n(x.dev_pct), devStyle(x.dev_pct, true));
          ws.set(r, 10, n(x.fact_l), S['n2' + z] || S.n2).set(r, 11, n(x.fact_pc), S['n2' + z] || S.n2);
          const u = x.unit_small || '';
          ws.set(r, 12, x.per_kg_laundry == null ? null : n(x.per_kg_laundry), S.n3).set(r, 13, n(x.per_wash), S.n2).set(r, 14, n(x.per_resident_day), S.n2).set(r, 15, n(x.ratio), S.n3);
          ws.height(r, 24); r++;
        });
        const mainRows = allRows.filter(x => x.kind === 'main');
        if (mainRows.length > 1) {
          const sum = k => mainRows.every(x => x[k] != null) ? mainRows.reduce((a, x) => a + x[k], 0) : null;
          const f = sum('fact_kg'), t = sum('theory_kg');
          ws.set(r, 1, 'Основная химия, всего', S.key).set(r, 2, '', S.key).fill(r, 2, r, 5, S.key);
          ws.set(r, 3, sum('start_kg'), S.n2B).set(r, 4, sum('inflow_kg'), S.n2B).set(r, 5, sum('end_kg'), S.n2B).set(r, 6, f, S.n2B).set(r, 7, t, S.n2B).set(r, 8, f != null && t != null ? f - t : null, S.sgB);
          ws.set(r, 9, f != null && t > 0 ? (f - t) / t * 100 : null, devStyle(f != null && t > 0 ? (f - t) / t * 100 : null, true)).fill(r, 10, r, 15, S.key); ws.set(r, 15, f != null && t > 0 ? f / t : null, S.n3); ws.height(r, 24); r++;
        }
        r++;
        ws.set(r, 1, 'Цвета отклонения:', S.txtB); ws.set(r, 3, 'в норме', S.wOk).set(r, 4, `выше теории (> ${warnPct / 2}%)`, wb.style({ font: { b: 1, sz: 9, color: C.warnT }, fill: C.warn, align: { h: 'center', v: 'center', wrap: 1 }, border: bd })).set(r, 5, `больше порога (> ${warnPct}%)`, wb.style({ font: { b: 1, sz: 9, color: C.badT }, fill: C.bad, align: { h: 'center', v: 'center', wrap: 1 }, border: bd })).set(r, 6, `меньше теории (< −${warnPct}%)`, wb.style({ font: { b: 1, sz: 9, color: C.lowT }, fill: C.low, align: { h: 'center', v: 'center', wrap: 1 }, border: bd })); ws.height(r, 30); r += 2;
        ws.set(r, 1, 'Расход на кг белья, на стирку и на жителя — в мл для жидкой химии и в граммах для порошка (единица указана на листе «По дозаторам»). Факт = остаток на начало + приход − остаток на конец. Остаток дозаторов при закрытии уходит в запас, поэтому на начало следующего периода дозатор считается с нуля (см. лист «Замеры»).', S.note).merge(r, 1, r, NC); ws.height(r, 40); r++;
        const wn = (s.warnings || []).length, pn = (s.problems || []).length;
        ws.set(r, 1, wn ? `Предупреждений при закрытии: ${wn}. Подробно на листе «Предупреждения».` : 'Предупреждений при закрытии не было.', wn ? wb.style({ font: { b: 1, sz: 11, color: C.warnT }, fill: C.warn, align: { h: 'left', v: 'center', indent: 1 }, border: bd }) : S.wOk).merge(r, 1, r, 8).fill(r, 1, r, 8, wn ? wb.style({ font: { b: 1, sz: 11, color: C.warnT }, fill: C.warn, align: { h: 'left', v: 'center', indent: 1 }, border: bd }) : S.wOk);
      }
    }

    if (s) {
      // ======================= 2. По дозаторам =======================
      {
        const NC = 14, ws = wb.addSheet('По дозаторам', { tab: C.dark, grid: false, widths: [26, 12, 12, 12, 12, 12, 12, 12, 11, 11, 12, 12, 12, 10], freeze: { row: 4, col: 1 }, zoom: 90 });
        banner(ws, NC, title + ' · по дозаторам', sub);
        hdr(ws, 4, ['Химикат / дозатор', 'Замер на начало, кг', 'Ушло в запас при прошлом закрытии, кг', 'На начало (с нуля), кг', 'Приход, кг', 'На конец (замер), кг', 'Факт, кг', 'Теория, кг', 'Отклонение, кг', 'Отклонение, %', 'Факт, л', 'Факт, шт', 'Единица малого расхода', 'Факт / теория'], 56);
        let r = 5;
        chemList.forEach(ch => {
          ws.set(r, 1, ch.name + (ch.kind === 'main' ? '' : ' (доп. средство)'), S.grp).merge(r, 1, r, NC).fill(r, 1, r, NC, S.grp); ws.height(r, 20); r++;
          ['1_10', '11_12', 'all'].forEach(g => {
            const x = rowsOf(ch.id).find(y => y.group === g); if (!x) return;
            const tot = g === 'all', t = tot ? S.tdB : S.td, nn = tot ? S.n2B : S.n2;
            ws.set(r, 1, GN[g], t).set(r, 2, n(x.start_measured_kg), nn).set(r, 3, n(x.to_reserve_in_kg), nn).set(r, 4, n(x.start_kg), nn).set(r, 5, n(x.inflow_kg), nn).set(r, 6, n(x.end_kg), nn).set(r, 7, n(x.fact_kg), S.n2B).set(r, 8, n(x.theory_kg), nn).set(r, 9, n(x.dev_kg), tot ? S.sgB : S.sg).set(r, 10, n(x.dev_pct), devStyle(x.dev_pct, tot)).set(r, 11, n(x.fact_l), nn).set(r, 12, n(x.fact_pc), nn).set(r, 13, x.unit_small || '', t).set(r, 14, n(x.ratio), S.n3);
            ws.height(r, 22); r++;
          });
          // показатели на единицу
          const a = rowsOf(ch.id).find(y => y.group === 'all');
          if (a) { ws.set(r, 1, `Показатели (${a.unit_small}): на кг белья ${a.per_kg_laundry == null ? '—' : (Math.round(a.per_kg_laundry * 1000) / 1000).toString().replace('.', ',')}  ·  на стирку ${a.per_wash == null ? '—' : (Math.round(a.per_wash * 100) / 100).toString().replace('.', ',')}  ·  на жителя в сутки ${a.per_resident_day == null ? '—' : (Math.round(a.per_resident_day * 100) / 100).toString().replace('.', ',')}  ·  справочно, расход «по замене» бутылей: ${a.old_fact_kg == null ? '—' : (Math.round(a.old_fact_kg * 100) / 100).toString().replace('.', ',')} кг`, S.note).merge(r, 1, r, NC); ws.height(r, 28); r++; }
          r++;
        });
        ws.o.filter = null;
      }
      // ======================= 3. Баланс прихода =======================
      {
        const NC = 13, ws = wb.addSheet('Баланс прихода', { tab: C.dark, grid: false, widths: [26, 12, 12, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13], freeze: { row: 4, col: 1 }, zoom: 90 });
        banner(ws, NC, title + ' · из чего сложился приход, кг', 'Факт = на начало + приход − на конец. Приход = новые бутыли − остатки замен в запас + подключённые остатки − бутыль, вместо которой подключили остаток + залито из запаса + добавлено − забрано ± поправка по уровню.');
        ws.height(2, 34);
        hdr(ws, 4, ['Химикат / дозатор', 'На начало, кг', 'Новые бутыли', 'Остатки замен ушли в запас (−)', 'Подключено остатков', 'Вместо бутыли при подключении', 'Залито из запаса', 'Добавлено суперадмином', 'Забрано из дозатора (−)', 'Поправка по уровню', 'Приход, нетто', 'На конец, кг', 'Факт, кг'], 58);
        let r = 5;
        chemList.forEach(ch => {
          ws.set(r, 1, ch.name, S.grp).merge(r, 1, r, NC).fill(r, 1, r, NC, S.grp); ws.height(r, 20); r++;
          ['1_10', '11_12', 'all'].forEach(g => {
            const x = rowsOf(ch.id).find(y => y.group === g); if (!x) return; const f = x.flows || {}, tot = g === 'all', t = tot ? S.tdB : S.td, nn = tot ? S.n2B : S.n2;
            ws.set(r, 1, GN[g], t).set(r, 2, n(x.start_kg), nn).set(r, 3, n(f.bottles), nn).set(r, 4, f.leftovers ? -f.leftovers : 0, nn).set(r, 5, n(f.connects), nn).set(r, 6, n(f.replacedByConnect), nn).set(r, 7, n(f.pours), nn).set(r, 8, n(f.adds), nn).set(r, 9, f.takes ? -f.takes : 0, nn).set(r, 10, n(f.levelAdj), nn).set(r, 11, n(x.inflow_kg), S.n2B).set(r, 12, n(x.end_kg), nn).set(r, 13, n(x.fact_kg), S.n2B);
            ws.height(r, 22); r++;
          });
          const a = rowsOf(ch.id).find(y => y.group === 'all');
          if (a && a.flows) { ws.set(r, 1, `Замен бутылей: ${a.flows.nBottles}${a.flows.noLeft ? `, без указанного остатка: ${a.flows.noLeft}` : ''}${a.flows.clipped ? `, остаток больше ёмкости: ${a.flows.clipped}` : ''}`, S.note).merge(r, 1, r, NC); r++; }
          r++;
        });
      }
      // ======================= 4. Запас =======================
      // Лист показываем, когда в снимке есть расчёт запаса (снимки, закрытые до этапа 2, его не содержат).
      if ((s.reserve || []).length) {
        const NC = 13, ws = wb.addSheet('Запас', { tab: 'E08A2E', grid: false, widths: [26, 13, 14, 13, 13, 13, 13, 13, 13, 13, 13, 14, 14], freeze: { row: 4, col: 1 }, zoom: 90 });
        banner(ws, NC, title + ' · запас химии, кг', 'Поступление попадает в общий запас. Из запаса химию заливают в дозаторы, списывают (минус). Остаток дозаторов при закрытии уходит в запас отдельной строкой.');
        ws.height(2, 30);
        hdr(ws, 4, ['Химикат', 'Запас на момент начала (до закрытия)', '+ остаток дозаторов при прошлом закрытии', '= Запас на начало', '+ остатки замен бутылей', '− подключено в дозаторы', '+ забрано из дозаторов', '+ поступило в запас', '− залито в дозаторы', '− списано (из запаса)', '= Запас на конец периода', '+ остаток дозаторов при этом закрытии', '= Запас после закрытия'], 70);
        let r = 5; const rs = s.reserve || [];
        rs.forEach((z, i) => {
          const zb = i % 2 ? 'Z' : '', nn = S['n2' + zb];
          ws.set(r, 1, z.name, S.tdB).set(r, 2, n(z.start_before_kg), nn).set(r, 3, n(z.close_in_kg), nn).set(r, 4, n(z.start_kg), S.n2B).set(r, 5, n(z.leftovers_kg), nn).set(r, 6, z.connected_kg ? -z.connected_kg : 0, nn).set(r, 7, n(z.takes_kg), nn).set(r, 8, n(z.receipts_kg) || 0, nn).set(r, 9, z.pours_kg ? -z.pours_kg : 0, nn).set(r, 10, -((z.writeoff_moves_kg || 0) + (z.writeoff_leftovers_kg || 0)), nn).set(r, 11, n(z.end_kg), S.n2B).set(r, 12, n(z.close_out_kg), S.stk).set(r, 13, n(z.after_kg), S.n2B);
          ws.height(r, 24); r++;
        });
        if (!rs.length) { ws.set(r, 1, 'Нет данных по запасу', S.txt); r++; }
        // итоговая строка по всем химикатам: кг складываются только у химикатов с плотностью (иначе суммировать нечего), поэтому все значения здесь в кг
        if (rs.length > 1) {
          ws.set(r, 1, 'Итого, кг', S.thL);
          for (let col = 2; col <= NC; col++) { const key = ['start_before_kg', 'close_in_kg', 'start_kg', 'leftovers_kg', 'connected_kg', 'takes_kg', 'receipts_kg', 'pours_kg', 'writeoff', 'end_kg', 'close_out_kg', 'after_kg'][col - 2], sign = [1, 1, 1, 1, -1, 1, 1, -1, -1, 1, 1, 1][col - 2];
            const v = rs.reduce((a, z) => a + (key === 'writeoff' ? (z.writeoff_moves_kg || 0) + (z.writeoff_leftovers_kg || 0) : (+z[key] || 0)), 0); ws.set(r, col, sign * v, S.n2B); }
          ws.height(r, 24); r++;
        }
        r++;
        // общий запас и дозаторы после закрытия: сколько где лежит
        ws.set(r, 1, 'Где находится химия после закрытия, кг', S.h2).merge(r, 1, r, 6); ws.height(r, 26); r++;
        ['Химикат', 'Дозатор 1 (1–10): остаток при замере', 'Дозатор 2 (11–12): остаток при замере', 'Общий запас до закрытия', 'Всего после закрытия'].forEach((t, i) => ws.set(r, i + 1, t, i === 0 ? S.thL : S.th)); ws.height(r, 46); r++;
        rs.forEach((z, i) => { const zb = i % 2 ? 'Z' : '', nn = S['n2' + zb];
          ws.set(r, 1, z.name, S.tdB).set(r, 2, z.disp_1_10_kg == null ? null : n(z.disp_1_10_kg), nn).set(r, 3, z.disp_11_12_kg == null ? null : n(z.disp_11_12_kg), nn).set(r, 4, n(z.end_kg), S.stk).set(r, 5, n(z.after_kg), S.n2B); ws.height(r, 22); r++; });
        r++;
        ws.set(r, 1, 'Как читать: «запас на начало» = запас до замера + то, что ушло в запас из дозаторов при прошлом закрытии. «Запас на конец» = начало + остатки замен + забрано + поступило − подключено − залито − списано. «Запас после закрытия» = запас на конец + остаток дозаторов, который взвесили при этом закрытии. Принять поступление и залить в дозатор можно на вкладке «Химия» (кнопки «Поступление» и «Залить»). Списание из запаса делает суперадмин, с паролем.', S.note).merge(r, 1, r, NC); ws.height(r, 56);
      }
      // ======================= 5. Замеры =======================
      {
        const NC = 7, ws = wb.addSheet('Замеры', { tab: C.dark, grid: false, widths: [26, 22, 15, 15, 15, 15, 18], freeze: { row: 4, col: 1 } });
        banner(ws, NC, title + ' · замеры остатков в дозаторах, кг', `Начало: ${c.period_from ? fmtTs(c.period_from, tz) : '—'}   ·   Конец: ${fmtTs(c.at_ts, tz)}`);
        hdr(ws, 4, ['Химикат', 'Дозатор', 'Замер на начало', 'Ушло в запас при прошлом закрытии', 'Дозатор на начало (с нуля)', 'Замер на конец', 'Уйдёт в запас сейчас'], 46);
        let r = 5; let i = 0;
        chemList.forEach(ch => ['1_10', '11_12'].forEach(g => {
          const x = rowsOf(ch.id).find(y => y.group === g); if (!x) return; const zb = i++ % 2 ? 'Z' : '';
          ws.set(r, 1, ch.name, S['td' + zb]).set(r, 2, GN[g], S['td' + zb]).set(r, 3, n(x.start_measured_kg), S['n2' + zb]).set(r, 4, n(x.to_reserve_in_kg), S['n2' + zb]).set(r, 5, n(x.start_kg), S['n2' + zb]).set(r, 6, n(x.end_kg), S.n2B).set(r, 7, n(x.to_reserve_out_kg), S.stk); ws.height(r, 22); r++;
        }));
      }
      // ======================= 6. Стирки =======================
      {
        const NC = 7, ws = wb.addSheet('Стирки', { tab: C.dark, grid: false, widths: [32, 13, 13, 13, 13, 13, 13], freeze: { row: 4, col: 1 } });
        banner(ws, NC, title + ' · стирки за период', sub);
        hdr(ws, 4, ['Вид стирки', 'Дозатор 1: стирок', 'Дозатор 1: белья, кг', 'Дозатор 2: стирок', 'Дозатор 2: белья, кг', 'Всего стирок', 'Всего белья, кг'], 46);
        let r = 5, i = 0; const W = s.washes_by_type || [];
        W.forEach(w => { const zb = i++ % 2 ? 'Z' : ''; ws.set(r, 1, w.name, S['td' + zb]).set(r, 2, w.g1.n, S.n0).set(r, 3, w.g1.kg, S['n2' + zb]).set(r, 4, w.g2.n, S.n0).set(r, 5, w.g2.kg, S['n2' + zb]).set(r, 6, w.all.n, S.n0).set(r, 7, w.all.kg, S.n2B); ws.height(r, 22); r++; });
        const T = s.totals || {}, bg = T.byGroup || {};
        ws.set(r, 1, 'Итого', S.key).set(r, 2, n(bg['1_10'] && bg['1_10'].washes), S.n2B).set(r, 3, n(bg['1_10'] && bg['1_10'].laundry_kg), S.n2B).set(r, 4, n(bg['11_12'] && bg['11_12'].washes), S.n2B).set(r, 5, n(bg['11_12'] && bg['11_12'].laundry_kg), S.n2B).set(r, 6, n(T.washes), S.n2B).set(r, 7, n(T.laundry_kg), S.n2B); ws.height(r, 24);
        if (!W.length) ws.set(r + 2, 1, 'Подробной раскладки по видам стирки в этом закрытии нет (закрытие сделано до обновления). Итоги по дозаторам выше.', S.note).merge(r + 2, 1, r + 2, NC);
      }
      // ======================= 7. Предупреждения =======================
      {
        const NC = 4, ws = wb.addSheet('Предупреждения', { tab: 'D9534F', grid: false, widths: [8, 26, 22, 90], freeze: { row: 4, col: 0 } });
        banner(ws, NC, title + ' · предупреждения при закрытии', 'Показаны то, что система отметила при закрытии. Ничего не отмечено — закрытие чистое.');
        hdr(ws, 4, ['№', 'Тип', 'Химикат', 'Что отмечено'], 28);
        const TN = { over: 'Расход больше теории', negative: 'Отрицательный расход', noLeft: 'Не указан остаток замены', clipped: 'Остаток больше ёмкости', residents: 'Проживающие', start_assumed: 'Нет начального замера', reserve: 'Запас не сходится', density: 'Нет плотности/объёма бутыли' };
        const nm = {}; chemList.forEach(x => nm[x.id] = x.name);
        let r = 5; const W = s.warnings || [];
        W.forEach((w, i) => { const st = w.type === 'over' || w.type === 'negative' ? wb.style({ font: { sz: 10, color: C.badT }, fill: C.bad, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }) : wb.style({ font: { sz: 10, color: C.warnT }, fill: C.warn, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }); ws.set(r, 1, i + 1, S.n0).set(r, 2, TN[w.type] || w.type, st).set(r, 3, nm[w.chemical_id] || '', S.td).set(r, 4, w.text, S.td); ws.height(r, 30); r++; });
        if (!W.length) { ws.set(r, 1, 'Предупреждений нет', S.wOk).merge(r, 1, r, NC).fill(r, 1, r, NC, S.wOk); ws.height(r, 26); }
      }
      // ======================= 8. Сравнение (эталон / предыдущее) =======================
      if ((ctx.etalon && ctx.etalon.snapshot) || (ctx.prev && ctx.prev.snapshot)) {
        const NC = 9, ws = wb.addSheet('Сравнение', { tab: C.dark, grid: false, widths: [26, 16, 16, 12, 16, 12, 16, 12, 12], freeze: { row: 5, col: 1 } });
        banner(ws, NC, title + ' · сравнение расхода на кг белья', 'Единица — мл для жидкой химии и г для порошка. Рост расхода выделен красным, снижение — зелёным.');
        const E = ctx.etalon && ctx.etalon.id !== c.id ? ctx.etalon : null, P = ctx.prev && ctx.prev.snapshot ? ctx.prev : null;
        ws.set(4, 1, '', S.th).set(4, 2, 'Сейчас', S.th).set(4, 3, E ? 'Эталон ' + fmtTs(E.at_ts, tz).slice(0, 10) : 'Эталон', S.th).set(4, 4, 'к эталону', S.th).set(4, 5, P ? 'Предыдущее ' + fmtTs(P.at_ts, tz).slice(0, 10) : 'Предыдущее', S.th).set(4, 6, 'к предыдущему', S.th).set(4, 7, 'Факт/теория сейчас', S.th).set(4, 8, 'Факт/теория эталон', S.th).set(4, 9, 'Единица', S.th); ws.height(4, 36);
        ws.set(5, 1, 'Химикат', S.thL); for (let k = 2; k <= NC; k++) ws.set(5, k, '', S.th);
        const cmp = (a, b) => { const p = a != null && b != null && Math.abs(b) > 1e-12 ? (a - b) / Math.abs(b) * 100 : null; return p == null ? S.td : wb.style({ font: { b: 1, sz: 10, color: p > 10 ? C.badT : p < -10 ? C.okT : C.ink }, fill: p > 10 ? C.bad : p < -10 ? C.ok : C.white, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+0.00"%";-0.00"%";0.00"%"' }); };
        const pct = (a, b) => a != null && b != null && Math.abs(b) > 1e-12 ? (a - b) / Math.abs(b) * 100 : null;
        const find = (cl, id) => cl && cl.snapshot ? (cl.snapshot.rows || []).find(y => +y.chemical_id === +id && y.group === 'all') : null;
        let r = 6;
        allRows.forEach(x => { const e = find(E, x.chemical_id), p = find(P, x.chemical_id);
          ws.set(r, 1, x.name, S.tdB).set(r, 2, n(x.per_kg_laundry), S.n3).set(r, 3, n(e && e.per_kg_laundry), S.n3).set(r, 4, pct(x.per_kg_laundry, e && e.per_kg_laundry), cmp(x.per_kg_laundry, e && e.per_kg_laundry)).set(r, 5, n(p && p.per_kg_laundry), S.n3).set(r, 6, pct(x.per_kg_laundry, p && p.per_kg_laundry), cmp(x.per_kg_laundry, p && p.per_kg_laundry)).set(r, 7, n(x.ratio), S.n3).set(r, 8, n(e && e.ratio), S.n3).set(r, 9, x.unit_small || '', S.td); ws.height(r, 22); r++; });
      }
    }

    // ======================= Пояснения =======================
    {
      const ws = wb.addSheet('Как считается', { tab: C.mut, grid: false, widths: [110], landscape: false });
      banner(ws, 1, 'EuSS · как считается закрытие', 'Коротко о методе, чтобы цифры в отчёте можно было проверить');
      const L = [
        ['Закрытие в любое время', 'Закрыть отчёт можно в любую минуту. Замер на конец одного периода — это начало следующего: периоды идут одной цепочкой, без разрывов и пересечений. Статистика не обнуляется, она продолжается; месячный итог — сумма отрезков месяца.'],
        ['Закрытие месяца', 'Месяц закрывается в любое время в последний день месяца или 1 числа, но до первой стирки 1 числа нового месяца и после последней стирки старого. Позднее закрытие (если 1 число пропущено) может сделать только суперадмин.'],
        ['Факт расхода', 'Факт = остаток в дозаторе на начало + приход − остаток в дозаторе на конец. Остатки взвешиваются в кг. Литры и штуки получаются из кг через плотность и размер бутыли из настроек.'],
        ['Приход', 'Новая бутыль при замене (номинал из настроек) − остаток старой бутыли, ушедший в запас + подключённые остатки − бутыль, вместо которой подключили остаток + залито из запаса + добавлено суперадмином − забрано из дозатора ± поправка «в дозаторе реально было X».'],
        ['Запас', 'При закрытии остаток каждого дозатора записывается в запас отдельной записью, а дозатор после закрытия считается с нуля. Из запаса можно залить в нужный дозатор (это приход дозатора и расход запаса). Списание из запаса делает суперадмин с паролем: оно уменьшает запас и показано в отчёте отдельной колонкой.'],
        ['Теория', 'Теория = вода на стирку × норма химии на литр по рецепту вида стирки + дополнительные средства, отмеченные при загрузке. Считается по всем стиркам внутри периода (по минутам).'],
        ['Отклонение', `Отклонение = факт − теория. Красным выделено отклонение больше порога ${warnPct}% (порог меняется в настройках), жёлтым — больше половины порога, синим — меньше теории сверх порога.`],
        ['Жители', 'Показатели «на жителя в сутки» считаются по числу проживающих за смены периода. Неполная первая и последняя смена учитываются долей суток.'],
        ['Справочно «по замене»', 'Старый способ расчёта (по заменам бутылей) оставлен справочно на листе «По дозаторам». Основной расчёт — по замерам.'],
      ];
      let r = 4;
      L.forEach(([h, t]) => { ws.set(r, 1, h, S.txtB); r++; ws.set(r, 1, t, S.txt); ws.height(r, Math.max(34, Math.ceil(t.length / 105) * 17)); r += 2; });
    }
    return wb;
  }
  const download = (c, ctx) => build(c, ctx).download(fileName(c, ctx && ctx.tz));
  return { build, download, fileName, fmtTs };
})();
if (typeof module !== 'undefined') module.exports = ClosingXlsx;
