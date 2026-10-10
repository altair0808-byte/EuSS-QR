// Этап 3 «Сравнение химии»: «Скачать Excel» для краткого и подробного вида. Нужны xlsx-writer.js и compare-detail.js.
//   CompareXlsx.build(res, inp, ctx, { view: 'brief' | 'full', isAdmin, generatedAt }) → Workbook
//     brief — листы «Кратко», «Предупреждения», «Как считается»
//     full  — «Кратко», «По дозаторам», «Баланс прихода», «Замеры», «Стирки», «Предупреждения», «Как считается»
//   CompareXlsx.download(res, inp, ctx, opts) — собрать и скачать;  CompareXlsx.fileName(res, view, tz)
// Все значения — числа (не формулы). Формат чисел: 2 знака для кг и литров; разделитель (запятая) Excel берёт из языка Windows.
// Цвета отклонений и статусов — как на экране compare.html.
const CompareXlsx = (() => {
  const X = typeof XlsxWriter !== 'undefined' ? XlsxWriter : require('./xlsx-writer.js');
  const D = typeof CompareDetail !== 'undefined' ? CompareDetail : require('./compare-detail.js');
  const C = { teal: '2AA3B5', dark: '12606D', tint: 'E6F4F6', tint2: 'F3F9FA', ink: '17323A', mut: '5B7480', white: 'FFFFFF' };
  // цвета статусов и отклонений — те же, что в compare.html (.st.* и td.bad/low/ck)
  const ST = { ok: ['E7F6EF', '14532D', 'в норме'], over: ['FDECEA', '7A1A12', 'перерасход'], under: ['EAF3FC', '0B3F8A', 'недорасход'], check: ['FFF6E0', '6B4A00', 'проверить данные'], nodata: ['EEF2F3', '4F6F79', 'нет данных'] };
  const DEVTXT = { over: 'B42318', under: '175CD3', check: '8A5A00' };
  const LV = { green: ['E7F6EF', '14532D', 'Зелёный: можно верить'], yellow: ['FFF6E0', '6B4A00', 'Жёлтый: проверьте'], red: ['FDECEA', '7A1A12', 'Красный: не верьте'] };
  const KIND = { start: 'Начальный замер', interval: 'Закрытие отчёта', month: 'Закрытие месяца' };
  const GN = D.GN;
  const pad = n => String(n).padStart(2, '0');
  const fmtTs = (ts, tz) => { if (!ts) return ''; const d = new Date(new Date(ts).getTime() + (tz == null ? 5 : +tz) * 3600e3); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const stamp = (ts, tz) => { const d = new Date(new Date(ts).getTime() + (tz == null ? 5 : +tz) * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`; };
  const n = v => (v == null || !isFinite(v) ? null : +v);

  function fileName(res, view, tz) {
    return `EuSS_сравнение-химии_${view === 'full' ? 'подробно' : 'кратко'}_${stamp(res.request.from_ts, tz)}_${stamp(res.request.to_ts, tz)}.xlsx`;
  }

  function build(res, inp, ctx, opts) {
    const o = opts || {}, full = o.view === 'full', admin = o.isAdmin !== false, tz = ctx.tz == null ? 5 : +ctx.tz, st = ctx.st == null ? 6 : +ctx.st;
    const gen = o.generatedAt || new Date().toISOString(), tol = res.request.tol_pct;
    const wb = new X.Workbook({ title: 'EuSS Сравнение химии', creator: 'EuSS', footer: 'EuSS · сравнение химии · ' + fmtTs(res.request.from_ts, tz) + ' → ' + fmtTs(res.request.to_ts, tz) });
    const bd = { l: 'thin', r: 'thin', t: 'thin', b: 'thin' };
    const base = { sz: 10, color: C.ink };
    const S = {
      banner: wb.style({ font: { b: 1, sz: 18, color: C.white }, fill: C.teal, align: { h: 'left', v: 'center', indent: 1 } }),
      sub: wb.style({ font: { sz: 11, color: C.white }, fill: C.dark, align: { h: 'left', v: 'center', indent: 1 } }),
      th: wb.style({ font: { b: 1, sz: 10, color: C.white }, fill: C.dark, align: { h: 'center', v: 'center', wrap: 1 }, border: bd }),
      thL: wb.style({ font: { b: 1, sz: 10, color: C.white }, fill: C.dark, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      grp: wb.style({ font: { b: 1, sz: 10, color: C.dark }, fill: C.tint, align: { h: 'left', v: 'center', indent: 1 }, border: bd }),
      td: wb.style({ font: base, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      tdB: wb.style({ font: { ...base, b: 1 }, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      tot: wb.style({ font: { ...base, b: 1 }, fill: C.tint, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd }),
      txt: wb.style({ font: { sz: 11, color: C.ink }, align: { h: 'left', v: 'top', wrap: 1 } }),
      txtB: wb.style({ font: { b: 1, sz: 12, color: C.dark }, align: { h: 'left', v: 'center' }, border: { b: { s: 'medium', color: C.teal } } }),
      note: wb.style({ font: { i: 1, sz: 9, color: C.mut }, align: { h: 'left', v: 'top', wrap: 1 } })
    };
    const num2 = (b, fill) => wb.style({ font: { ...base, b: b ? 1 : 0 }, fill: fill || undefined, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0.00' });
    const N = { n2: num2(0), n2B: num2(1), n2T: num2(1, C.tint), n3: wb.style({ font: base, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0.000' }), n0: wb.style({ font: base, align: { h: 'right', v: 'center' }, border: bd, numFmt: '#,##0' }),
      sg: wb.style({ font: base, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+#,##0.00;-#,##0.00;0.00' }) };
    const pcStyle = (col, bold) => wb.style({ font: { ...base, b: bold ? 1 : 0, color: col || C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+#,##0.00"%";-#,##0.00"%";0.00"%"' });
    const sgStyle = (col, bold) => wb.style({ font: { ...base, b: bold ? 1 : 0, color: col || C.ink }, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+#,##0.00;-#,##0.00;0.00' });
    const chip = (fill, col) => wb.style({ font: { ...base, b: 1, color: col }, fill, align: { h: 'center', v: 'center', wrap: 1 }, border: bd });
    const wrapBad = wb.style({ font: { ...base, color: DEVTXT.over }, align: { h: 'left', v: 'center', wrap: 1, indent: 1 }, border: bd });
    // красный = рост расхода, зелёный = снижение (как на экране)
    const refStyle = cls => wb.style({ font: { ...base, b: 1, color: cls === 'up' ? 'B42318' : cls === 'down' ? '14532D' : C.ink }, fill: cls === 'up' ? 'FDECEA' : cls === 'down' ? 'E7F6EF' : undefined, align: { h: 'right', v: 'center' }, border: bd, numFmt: '+#,##0.0"%";-#,##0.0"%";0.0"%"' });

    const period = `${fmtTs(res.request.from_ts, tz)} → ${fmtTs(res.request.to_ts, tz)}`;
    const cov = res.coverage || {};
    const factTxt = cov.has_fact ? `факт по замерам: ${fmtTs(cov.fact_from_ts, tz)} → ${fmtTs(cov.fact_to_ts, tz)}` : 'факта по замерам нет, показана теория';
    const head = (ws, cols, title) => {
      ws.set(1, 1, title, S.banner).merge(1, 1, 1, cols).fill(1, 1, 1, cols, S.banner).height(1, 34);
      ws.set(2, 1, `Период: ${period}   ·   ${factTxt}`, S.sub).merge(2, 1, 2, cols).fill(2, 1, 2, cols, S.sub).height(2, 20);
      ws.set(3, 1, `Сформировано: ${fmtTs(gen, tz)} (местное время)   ·   Вид: ${full ? 'подробный' : 'краткий'}   ·   Допуск «в норме»: ±${tol}%`, S.sub).merge(3, 1, 3, cols).fill(3, 1, 3, cols, S.sub).height(3, 20);
    };
    const hdr = (ws, r, labels, h) => { labels.forEach((t, i) => ws.set(r, i + 1, t, i === 0 ? S.thL : S.th)); ws.height(r, h || 44); };
    const rows = res.rows || [], chemIds = []; rows.forEach(r => { if (!chemIds.includes(r.chemical_id)) chemIds.push(r.chemical_id); });
    const rowOf = (id, g) => rows.find(r => +r.chemical_id === +id && r.group === g);
    const tr = admin ? D.trust(res, { isAdmin: true, tz }) : null;
    const lvOf = (id, g) => { if (!tr) return null; if (g !== 'all') { const it = tr.items.find(i => +i.chemical_id === +id && i.group === g); return it ? it.level : null; }
      const its = tr.items.filter(i => +i.chemical_id === +id); return its.length ? its.reduce((m, i) => (i.level === 'red' || (i.level === 'yellow' && m === 'green')) ? (m === 'red' ? m : i.level) : m, 'green') : null; };
    const stChip = s => { const x = ST[s] || ST.nodata; return [x[2], chip(x[0], x[1])]; };

    // ======================= 1. Кратко =======================
    {
      const NC = admin ? 11 : 10, ws = wb.addSheet('Кратко', { tab: C.teal, grid: false, widths: [26, 24, 12, 12, 12, 11, 16, ...(admin ? [22] : []), 12, 12, 12], freeze: { row: 5, col: 1 }, zoom: 90 });
      head(ws, NC, 'EuSS · Сравнение химии: теория и факт');
      hdr(ws, 5, ['Химикат', 'Дозатор', 'Теория, л', 'Факт, л', 'Разница, л', 'Отклонение, %', 'Статус', ...(admin ? ['Можно ли верить цифрам'] : []), 'Теория, кг', 'Факт, кг', 'Разница, кг']);
      let r = 6;
      const put = (name, gname, x, bold, lv) => {
        const col = DEVTXT[x.status];
        ws.set(r, 1, name, bold ? S.tot : S.tdB).set(r, 2, gname, bold ? S.tot : S.td);
        ws.set(r, 3, n(x.theory_l), bold ? N.n2T : N.n2).set(r, 4, n(x.fact_l), bold ? N.n2T : N.n2B).set(r, 5, n(x.diff_l), sgStyle(col, bold)).set(r, 6, n(x.dev_pct), pcStyle(col, bold));
        const [t, cs] = stChip(x.status); ws.set(r, 7, t, cs);
        let c = 8;
        if (admin) { const l = lv ? LV[lv] : null; ws.set(r, c++, l ? l[2] : '', l ? chip(l[0], l[1]) : S.td); }
        ws.set(r, c, n(x.theory_kg), bold ? N.n2T : N.n2).set(r, c + 1, n(x.fact_kg), bold ? N.n2T : N.n2B).set(r, c + 2, n(x.diff_kg), sgStyle(col, bold)); ws.height(r, 22); r++;
      };
      chemIds.forEach(id => ['1_10', '11_12', 'all'].forEach(g => { const x = rowOf(id, g); if (x) put(x.name + (x.kind === 'main' ? '' : ' (доп.)'), GN[g], x, g === 'all', lvOf(id, g)); }));
      ['main', 'extra'].forEach(kind => ['1_10', '11_12', 'all'].forEach(g => { const t = res.totals_by_kind && res.totals_by_kind[kind] && res.totals_by_kind[kind][g]; if (t) put(kind === 'main' ? 'ИТОГО основная химия' : 'ИТОГО доп. средства', GN[g], { theory_l: t.theory_l, fact_l: t.fact_l, diff_l: t.diff_l, dev_pct: t.dev_pct, status: t.status }, true, null); }));
      r++; ws.set(r, 1, `Стирок за период факта: ${res.totals && res.totals.washes != null ? res.totals.washes : '—'}; белья, кг: ${res.totals && res.totals.laundry_kg != null ? Math.round(res.totals.laundry_kg * 100) / 100 : '—'}. Разница = факт − теория. Единицы — в заголовках колонок.`, S.note).merge(r, 1, r, NC); ws.height(r, 28);
      if (res.theory_only && res.theory_only.length) { r++; ws.set(r, 1, 'Без замеров, только теория: ' + res.theory_only.map(x => `${x.name} ${Math.round((x.theory_l == null ? x.theory_kg : x.theory_l) * 100) / 100} ${x.theory_l == null ? 'кг' : 'л'}`).join('; '), S.note).merge(r, 1, r, NC); ws.height(r, 28); }
    }

    if (full) {
      // ======================= 2. По дозаторам =======================
      {
        const NC = 15, ws = wb.addSheet('По дозаторам', { tab: C.dark, grid: false, widths: [26, 24, 10, 11, 13, 13, 14, 12, 13, 12, 13, 12, 11, 11, 11], freeze: { row: 5, col: 2 }, zoom: 90 });
        head(ws, NC, 'EuSS · Расход по дозаторам, на кг белья, на стирку, на жителя');
        hdr(ws, 5, ['Химикат', 'Дозатор', 'Стирок, шт', 'Белья, кг', 'На кг белья, мл или г', 'На стирку, мл или г', 'На жителя в сутки, мл или г', 'Единица (мл / г)', 'Эталон: на кг белья', 'Изменение к эталону, %', 'Прошлое закрытие: на кг белья', 'Изменение к прошлому, %', 'Факт, кг', 'Факт, л', 'Факт, шт'], 58);
        let r = 6;
        chemIds.forEach(id => ['1_10', '11_12', 'all'].forEach(g => {
          const x = rowOf(id, g); if (!x) return; const R = D.refsFor(x, ctx), b = g === 'all';
          ws.set(r, 1, x.name, b ? S.tot : S.tdB).set(r, 2, GN[g], b ? S.tot : S.td).set(r, 3, n(x.washes), N.n0).set(r, 4, n(x.laundry_kg), N.n2).set(r, 5, n(x.per_kg_laundry), N.n3).set(r, 6, n(x.per_wash), N.n2).set(r, 7, n(x.per_resident_day), N.n3).set(r, 8, x.unit_small || '', S.td);
          ws.set(r, 9, R.etalon.kg ? n(R.etalon.kg.ref) : null, N.n3).set(r, 10, R.etalon.kg && R.etalon.kg.pct != null ? n(R.etalon.kg.pct) : null, R.etalon.kg ? refStyle(R.etalon.kg.cls) : S.td);
          ws.set(r, 11, R.prev.kg ? n(R.prev.kg.ref) : null, N.n3).set(r, 12, R.prev.kg && R.prev.kg.pct != null ? n(R.prev.kg.pct) : null, R.prev.kg ? refStyle(R.prev.kg.cls) : S.td);
          ws.set(r, 13, n(x.fact_kg), N.n2).set(r, 14, n(x.fact_l), N.n2).set(r, 15, n(x.fact_pc), N.n2); ws.height(r, 22); r++;
        }));
        r++; ws.set(r, 1, 'Красным — расход вырос по сравнению с эталоном или прошлым закрытием, зелёным — снизился (изменение меньше 0,5% не окрашивается). На жителя в сутки считается только по обоим дозаторам и только если введены проживающие.', S.note).merge(r, 1, r, NC); ws.height(r, 30);
      }
      // ======================= 3. Баланс прихода =======================
      {
        const NC = 16, ws = wb.addSheet('Баланс прихода', { tab: C.dark, grid: false, widths: [24, 24, 20, 12, 13, 11, 12, 12, 13, 11, 12, 11, 12, 11, 12, 11], freeze: { row: 5, col: 2 }, zoom: 90 });
        head(ws, NC, 'EuSS · Баланс факта: от замера на начало до замера на конец');
        hdr(ws, 5, ['Химикат', 'Дозатор', 'Отрезок между замерами', 'На начало (замер), кг', 'Ушло в запас при прошлом закрытии, кг', 'Новые бутыли, кг', 'Остатки замен, кг', 'Подключённые остатки, кг', 'Бутыль вместо подключённого остатка, кг', 'Залито из запаса, кг', 'Добавлено суперадмином, кг', 'Забрано из дозатора, кг', 'Поправка по уровню, кг', 'Приход нетто, кг', 'На конец (замер), кг', 'Факт, кг'], 70);
        let r = 6;
        const line = (name, g, label, b, fact, bold) => {
          const fs = bold ? N.n2T : N.n2, L = D.balanceLines(b).reduce((m, l) => { m[l.key] = l.kg; return m; }, {});
          ws.set(r, 1, name, bold ? S.tot : S.tdB).set(r, 2, GN[g], bold ? S.tot : S.td).set(r, 3, label, bold ? S.tot : S.td);
          ['start_measured', 'to_reserve', 'bottles', 'leftovers', 'connects', 'replacedByConnect', 'pours', 'adds', 'takes', 'levelAdj', 'inflow', 'end'].forEach((k, i) => ws.set(r, 4 + i, n(L[k]), fs));
          ws.set(r, 16, n(fact), bold ? N.n2T : N.n2B); ws.height(r, 22); r++;
        };
        chemIds.forEach(id => ['1_10', '11_12', 'all'].forEach(g => {
          const x = rowOf(id, g); if (!x || !x.balance) return;
          const segs = (res.segments || []).map(s => ({ s, r: (s.rows_g || []).find(y => +y.chemical_id === +id && y.group === g) })).filter(y => y.r && y.r.balance);
          if (segs.length > 1) segs.forEach(y => line(x.name, g, `${fmtTs(y.s.from_ts, tz)} → ${fmtTs(y.s.to_ts, tz)}`, y.r.balance, y.r.fact_kg, false));
          line(x.name, g, segs.length > 1 ? 'Итого по периоду' : `${fmtTs(res.coverage.fact_from_ts, tz)} → ${fmtTs(res.coverage.fact_to_ts, tz)}`, x.balance, x.fact_kg, segs.length > 1 || g === 'all');
        }));
        r++; ws.set(r, 1, 'Факт = на начало − ушло в запас + приход нетто − на конец. Приход нетто = новые бутыли − остатки замен + подключённые остатки − бутыль вместо остатка + залито из запаса + добавлено суперадмином − забрано из дозатора ± поправка по уровню. Все значения — килограммы.', S.note).merge(r, 1, r, NC); ws.height(r, 32);
      }
      // ======================= 4. Замеры =======================
      {
        const NC = 7, ws = wb.addSheet('Замеры', { tab: C.dark, grid: false, widths: [18, 24, 22, 20, 26, 24, 14], freeze: { row: 5, col: 0 }, zoom: 90 });
        head(ws, NC, 'EuSS · Замеры остатка в дозаторах (закрытия внутри периода)');
        hdr(ws, 5, ['Время замера', 'Вид', 'Кто внёс', 'Внесено в систему', 'Химикат', 'Дозатор', 'Остаток, кг'], 34);
        let r = 6; const A = Date.parse(res.request.from_ts), B = Date.parse(res.request.to_ts), nm = id => id ? ((ctx.names && ctx.names[id]) || 'сотрудник') : 'система';
        (inp.closings || []).slice().sort((a, b) => Date.parse(a.at_ts) - Date.parse(b.at_ts)).filter(c => { const t = Date.parse(c.at_ts); return t >= A && t <= B; }).forEach(c => {
          const m = (ctx.meta && ctx.meta[c.id]) || {};
          chemIds.forEach(id => ['1_10', '11_12'].forEach(g => { const v = c.measures ? c.measures[id + ':' + g] : null; if (v == null) return; const x = rowOf(id, g);
            ws.set(r, 1, fmtTs(c.at_ts, tz), S.tdB).set(r, 2, KIND[c.kind] || c.kind, S.td).set(r, 3, nm(m.closed_by), S.td).set(r, 4, m.closed_at ? fmtTs(m.closed_at, tz) : '', S.td).set(r, 5, x ? x.name : 'химикат ' + id, S.td).set(r, 6, GN[g], S.td).set(r, 7, n(+v), N.n2); r++; }));
        });
        if (r === 6) { ws.set(r, 1, 'В выбранном периоде замеров нет.', S.txt).merge(r, 1, r, NC); }
      }
      // ======================= 5. Стирки =======================
      {
        const NC = 8, ws = wb.addSheet('Стирки', { tab: C.dark, grid: false, widths: [26, 24, 24, 12, 12, 13, 10, 14], freeze: { row: 5, col: 1 }, zoom: 90 });
        head(ws, NC, 'EuSS · Стирки и теория по рецептам (за период факта)');
        hdr(ws, 5, ['Химикат', 'Дозатор', 'Вид стирки', 'Стирок, шт', 'Белья, кг', 'Норма, мл/л (для средства — на 1 шт)', 'Вода, л', 'Теория, л (для порошка — кг)'], 58);
        let r = 6;
        chemIds.forEach(id => ['1_10', '11_12', 'all'].forEach(g => {
          const x = rowOf(id, g); if (!x) return; const t = D.theoryLines(res, inp, ctx, id, g); if (!t) return; const b = g === 'all';
          t.lines.forEach(l => { ws.set(r, 1, x.name, S.tdB).set(r, 2, GN[g], S.td).set(r, 3, l.name, S.td);
            if (l.extra) ws.set(r, 4, n(l.qty), N.n0).set(r, 5, null, N.n2).set(r, 6, n(l.per_unit), N.n2).set(r, 7, null, N.n2).set(r, 8, n(l.total), N.n2);
            else ws.set(r, 4, n(l.n), N.n0).set(r, 5, n(l.laundry_kg), N.n2).set(r, 6, n(l.norm_ml_per_l), N.n2).set(r, 7, n(l.water_l), N.n2).set(r, 8, n(l.total_l), N.n2); ws.height(r, 20); r++; });
          if (t.lines.length) { ws.set(r, 1, x.name, S.tot).set(r, 2, GN[g], S.tot).set(r, 3, 'Итог теории', S.tot).set(r, 4, t.kind === 'main' ? n(t.lines.reduce((s, l) => s + l.n, 0)) : null, N.n0).set(r, 5, t.kind === 'main' ? n(t.lines.reduce((s, l) => s + l.laundry_kg, 0)) : null, N.n2T).set(r, 6, null, N.n2T).set(r, 7, null, N.n2T).set(r, 8, n(t.kind === 'main' ? t.total_l : t.lines.reduce((s, l) => s + l.total, 0)), N.n2T); ws.height(r, 22); r++; }
        }));
        r++; ws.set(r, 1, 'Теория = стирок × вода (л) × норма (мл/л) ÷ 1000. Стирка относится к тому периоду, в который попало её время: стирки после момента закрытия уходят в следующий период.', S.note).merge(r, 1, r, NC); ws.height(r, 30);
      }
    }

    // ======================= Предупреждения =======================
    if (admin) {
      const NC = 5, ws = wb.addSheet('Предупреждения', { tab: 'E0A100', grid: false, widths: [26, 24, 22, 60, 80], freeze: { row: 5, col: 0 }, zoom: 90 });
      head(ws, NC, 'EuSS · Предупреждения: можно ли верить цифрам');
      hdr(ws, 5, ['Химикат', 'Дозатор', 'Светофор', 'Что случилось', 'Что исправить'], 34);
      let r = 6;
      tr.items.forEach(it => {
        const l = LV[it.level];
        if (!it.reasons.length) { ws.set(r, 1, it.name, S.tdB).set(r, 2, GN[it.group], S.td).set(r, 3, l[2], chip(l[0], l[1])).set(r, 4, 'Замеры есть, остатки внесены, расход не меньше нуля', S.td).set(r, 5, 'Ничего исправлять не нужно', S.td); ws.height(r, 22); r++; return; }
        it.reasons.forEach(rs => { const k = LV[rs.level]; ws.set(r, 1, it.name, S.tdB).set(r, 2, GN[it.group], S.td).set(r, 3, k[2], chip(k[0], k[1])).set(r, 4, rs.text, S.td).set(r, 5, rs.fix, S.td); ws.height(r, Math.max(30, Math.ceil(rs.fix.length / 85) * 15 + 6)); r++; });
      });
      const pr = (res.problems || []), wr = (res.warnings || []);
      if (pr.length || wr.length) {
        r++; ws.set(r, 1, 'Сообщения расчёта', S.txtB).merge(r, 1, r, NC).fill(r, 1, r, NC, S.txtB); ws.height(r, 24); r++;
        pr.forEach(p => { ws.set(r, 1, 'Мешает расчёту', chip(LV.red[0], LV.red[1])).set(r, 2, '', S.td).set(r, 3, '', S.td).set(r, 4, p.text, S.td).merge(r, 4, r, 5).fill(r, 4, r, 5, S.td); ws.height(r, 24); r++; });
        wr.forEach(p => { ws.set(r, 1, 'Предупреждение', chip(LV.yellow[0], LV.yellow[1])).set(r, 2, p.group ? GN[p.group] : '', S.td).set(r, 3, '', S.td).set(r, 4, p.text, S.td).merge(r, 4, r, 5).fill(r, 4, r, 5, S.td); ws.height(r, 24); r++; });
      }
    }

    // ======================= Как считается =======================
    {
      const NC = 2, ws = wb.addSheet('Как считается', { tab: C.mut, grid: false, widths: [34, 110], zoom: 100 });
      head(ws, NC, 'EuSS · Как считается');
      const L = [
        ['Факт расхода', 'Факт = остаток в дозаторе на начало (замер) − ушло в запас при прошлом закрытии + приход нетто − остаток на конец (замер). Считается в килограммах отдельно для каждого химиката и дозатора, литры и штуки получаются через плотность и «1 шт = кг» из настроек.'],
        ['Приход нетто', 'Новые бутыли − остатки старых бутылей при замене + подключённые остатки − бутыль, вместо которой подключили остаток + залито из запаса + добавлено суперадмином − забрано из дозатора ± поправка по уровню.'],
        ['Теория', 'Стирок × вода (л) × норма рецепта (мл/л) ÷ 1000. Для доп. средств: количество × норма на 1 шт ÷ 1000. Теория считается за тот же отрезок, что и факт.'],
        ['Отклонение', 'Отклонение, % = (факт − теория) ÷ теория × 100. «В норме» — в пределах ±' + tol + '%; больше — перерасход, меньше — недорасход. Отрицательный факт — «проверить данные».'],
        ['Дозаторы', 'Дозатор 1 — машины 1–10, дозатор 2 — машины 11–12. Считаются отдельно, строка «Оба дозатора» — их сумма.'],
        ['Рабочий день', `Смена идёт с ${pad(st)}:00 до ${pad(st)}:00 следующих суток, время местное (сдвиг от UTC: ${tz >= 0 ? '+' : ''}${tz} ч). Закрытие посреди смены считается долей суток; стирки после момента закрытия относятся к следующему периоду.`],
        ['Период факта', 'Факт считается только между закрытиями (замерами), целиком попавшими в выбранный период. Если период шире, на листе «Кратко» показано, за какие часы посчитан факт; теория берётся за те же часы.'],
        ['Расход на кг белья, на стирку, на жителя', 'Факт в мл (жидкая химия) или в граммах (порошок) ÷ кг белья / число стирок / жителе-суток. Жителе-сутки = число проживающих за смену × доля смены.'],
        ['Сравнение с эталоном и прошлым закрытием', 'Берётся расход на кг белья из снимка закрытия-эталона и закрытия, стоящего перед началом факта. Рост — красным, снижение — зелёным (меньше 0,5% не окрашивается).'],
        ['Светофор', 'Красный: расход отрицательный; нет замеров; не задана плотность или «1 шт = кг»; после закрытия остаток не залит обратно, а дозатор расходовал химию. Жёлтый: у замены бутыли не указан остаток (принят 0); остаток больше ёмкости; отклонение больше порога; не введены проживающие; период включает неполную смену. Зелёный: замеры есть, остатки внесены, расход не меньше нуля.'],
        ['Цвета', 'Перерасход — красный, недорасход — синий, проверить данные — жёлтый, в норме — зелёный: так же, как на экране.'],
        ['Числа в файле', 'Все значения — числа, а не формулы. Килограммы и литры показаны с двумя знаками после запятой (знак разделителя зависит от языка Excel); внутри ячейки хранится точное значение.'],
        ['Откуда число', 'Каждое число можно раскрыть до исходных записей на экране «Сравнение химии — подробно»: нажмите на число — откроется список записей с временем и тем, кто внёс.']
      ];
      let r = 5; hdr(ws, 4, ['Что', 'Как считается'], 24);
      L.forEach(([k, v]) => { ws.set(r, 1, k, S.tdB).set(r, 2, v, S.td); ws.height(r, Math.max(30, Math.ceil(v.length / 105) * 15 + 8)); r++; });
    }
    return wb;
  }

  const download = (res, inp, ctx, opts) => { const wb = build(res, inp, ctx, opts); wb.download(fileName(res, (opts || {}).view === 'full' ? 'full' : 'brief', ctx.tz)); return wb; };
  return { build, download, fileName };
})();
if (typeof module !== 'undefined') module.exports = CompareXlsx;
