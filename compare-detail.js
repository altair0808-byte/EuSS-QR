// Этап 3 «Сравнение химии»: подробный вид, светофор «Можно ли верить цифрам», источники чисел, график и хронология.
// Чистые функции: без базы и без DOM (кроме attach в конце), поэтому проверяются тестами. Подключать ПОСЛЕ compare-calc.js и compare-view.js.
//
//   CompareDetail.trust(res, { isAdmin })               → светофор по каждому химикату и дозатору
//   CompareDetail.trustHTML(res, group, { isAdmin })    → блок «Можно ли верить цифрам» (только админу)
//   CompareDetail.cardHTML(res, inp, ctx, chemId, group) → карточка «Подробно» (6 разделов)
//   CompareDetail.sources(inp, res, ctx, chemId, group, key, seg) → исходные записи любого числа
//
// res — результат calcCompare; inp — те же данные, что были переданы в calcCompare (события, стирки, закрытия);
// ctx — { refs, names: {id → имя}, tz, st, meta: {id закрытия → {closed_by, closed_at, kind}}, etalon, prev, monthRes }
//   etalon / prev — { id, at_ts, snapshot } (снимок закрытия из таблицы closings; prev — закрытие, которое стоит в начале факта).
const CompareDetail = (() => {
  const V = () => (typeof CompareView !== 'undefined' ? CompareView : require('./compare-view.js'));
  const esc = t => V().esc(t), num = (n, m) => V().num(n, m), fmtTs = (t, tz) => V().fmtTs(t, tz);
  const EPS = 1e-6;
  const GN = { '1_10': 'Дозатор 1 (машины 1–10)', '11_12': 'Дозатор 2 (машины 11–12)', all: 'Оба дозатора' };
  const GS = { '1_10': 'дозатор 1', '11_12': 'дозатор 2', all: 'оба дозатора' };
  const T = x => Date.parse(x.ts);
  const sgn = n => n != null && +n > 0 ? '+' : '';
  const inG = (x, g) => g === 'all' || (x.machine_group || '1_10') === g;
  const groupsOf = g => g === 'all' ? ['1_10', '11_12'] : [g];
  const chemOf = (ctx, id) => ((ctx && ctx.refs && ctx.refs.chemicals) || []).find(c => +c.id === +id) || null;
  const densOf = c => c && +c.bottle_l > 0 && +c.bottle_kg > 0 ? +c.bottle_kg / +c.bottle_l : null;
  const whoOf = (ctx, id) => id ? ((ctx && ctx.names && ctx.names[id]) || 'сотрудник') : 'система';
  const rowOf = (res, chemId, g) => (res.rows || []).find(r => +r.chemical_id === +chemId && r.group === g) || null;

  // ============================ 1. СВЕТОФОР ============================
  // Код причины → уровень, короткий текст и «Что исправить» простыми словами.
  const FIX = {
    negative: ['red', 'Расход получился меньше нуля',
      'Так не бывает: значит, в учёте что-то пропущено. Чаще всего после закрытия остаток химии не залили обратно в дозатор, не внесли замену бутыли или ошиблись при взвешивании. Что сделать: 1) проверьте вес на замере в начале и в конце; 2) посмотрите, была ли запись «Залить в дозатор» после закрытия; 3) проверьте, что внесены все замены бутылей. Ошибку в записи исправляет админ (с паролем), потом откройте отчёт снова.'],
    no_measures: ['red', 'Нет замеров остатка',
      'Расход по замерам считается между двумя взвешиваниями остатка в дозаторе: на начало и на конец. Что сделать: на экране «Закрытие» внесите вес остатка по каждому химикату и дозатору. Если нужного замера в прошлом уже нет, выберите период от одного закрытия до другого.'],
    no_density: ['red', 'Не задана плотность или «1 шт = кг»',
      'Чтобы перевести килограммы в литры и штуки, нужно знать, сколько литров и сколько килограммов в одной бутыли. Что сделать: откройте «Настройки» → химикат и впишите «1 шт = литров» и «1 шт = кг» по этикетке бутыли. Потом откройте отчёт снова.'],
    not_returned: ['red', 'После закрытия остаток не залит обратно, а дозатор расходовал химию',
      'При закрытии остаток из дозатора уходит в общий запас, и дозатор начинает с нуля. Если его не залить обратно, химия в дозаторе кончилась «на бумаге», хотя стирки шли. Что сделать: на вкладке «Химия» → «Общий запас» нажмите «Залить» и выберите нужный дозатор и количество. Если залили, а предупреждение осталось, проверьте дозатор и время заливки: она должна быть после закрытия.'],
    partly_returned: ['yellow', 'После закрытия залит не весь остаток',
      'При закрытии часть остатка осталась в запасе. Это нормально, если вы так и хотели (например, перелили в другой дозатор). Если нет: на вкладке «Химия» → «Общий запас» нажмите «Залить» и добавьте недостающее количество.'],
    no_leftover: ['yellow', 'У замены бутыли не указан остаток (принят 0)',
      'При замене бутыли нужно записать, сколько химии осталось в старой. Не указали — система считает, что осталось 0, и расход получается завышенным. Что сделать: в журнале найдите замену и добавьте остаток (админ исправляет запись с паролем).'],
    clipped: ['yellow', 'Остаток при замене больше ёмкости бутыли',
      'Записанный остаток больше, чем может быть в бутыли, поэтому учтена только ёмкость. Скорее всего, ошиблись цифрой или единицей (литры вместо килограммов). Что сделать: найдите замену в журнале и поправьте остаток.'],
    deviation: ['yellow', 'Отклонение больше порога',
      'Факт заметно отличается от теории по рецептам. Бывает из-за ошибок взвешивания, не внесённых замен и заливок, неверной нормы в рецепте или реального перерасхода. Что сделать: сначала проверьте замеры и записи в «Хронологии» этого химиката, потом норму в рецепте. Если всё верно, причину нужно искать в самой стирке.'],
    residents: ['yellow', 'Не введены проживающие',
      'Без числа проживающих нельзя посчитать расход «на жителя в сутки»; остальные цифры верны. Что сделать: внесите число проживающих за каждую смену (экран «Проживающие»).'],
    partial_shift: ['yellow', 'Период включает неполную смену',
      'Закрытие сделано посреди смены (не в 06:00), поэтому смена учтена долей суток. Это нормально; но показатели «на жителя в сутки» и сравнение с эталоном чуть менее точны. Ничего исправлять не нужно, если закрытие было намеренным.']
  };
  const RANK = { green: 0, yellow: 1, red: 2 };
  const WORD = { green: 'можно верить', yellow: 'проверьте', red: 'не верьте' };
  const DOT = { green: 'g', yellow: 'y', red: 'r' };
  const reason = (code, extra) => ({ code, level: FIX[code][0], text: FIX[code][1] + (extra ? ': ' + extra : ''), fix: FIX[code][2] });

  // Светофор по каждому химикату и дозатору. Админу — полный; остальным (бригадир, сотрудник) ничего не показывается.
  function trust(res, opts) {
    const o = opts || {};
    const out = { visible: o.isAdmin !== false, items: [], chems: [], summary: { green: 0, yellow: 0, red: 0 }, worst: 'green' };
    if (!out.visible) return out;
    const cov = res.coverage || {}, ri = res.residents_info || {}, probs = res.problems || [], tol = res.request ? res.request.tol_pct : 25;
    const ids = []; (res.rows || []).forEach(r => { if (!ids.includes(r.chemical_id)) ids.push(r.chemical_id); });
    ids.forEach(id => {
      const perG = [];
      ['1_10', '11_12'].forEach(g => {
        const r = rowOf(res, id, g); if (!r) return;
        const rs = [], b = r.balance;
        const dens = probs.some(p => p.type === 'density' && +p.chemical_id === +id);
        if (r.fact_kg != null && r.fact_kg < -EPS) rs.push(reason('negative', num(r.fact_kg) + ' кг'));
        if (r.fact_kg == null && !dens) rs.push(reason('no_measures', cov.has_fact ? null : (cov.note || null)));
        if (dens || !(r.density > 0) || !(r.bottle_kg > 0)) rs.push(reason('no_density'));
        if (b && b.to_reserve_kg > EPS) {
          const back = (b.pours || 0) + (b.adds || 0) + (b.connects || 0), used = (r.washes || 0) > 0 || (r.theory_kg || 0) > EPS || (r.fact_kg || 0) > EPS;
          if (used && back < b.to_reserve_kg * 0.5) rs.push(reason('not_returned', `ушло в запас ${num(b.to_reserve_kg)} кг, залито обратно ${num(back)} кг`));
          else if (used && back < b.to_reserve_kg * 0.98) rs.push(reason('partly_returned', `ушло в запас ${num(b.to_reserve_kg)} кг, залито ${num(back)} кг`));
        }
        if (b && b.noLeft > 0) rs.push(reason('no_leftover', `замен без остатка: ${num(b.noLeft, 0)}`));
        if (b && b.clipped > 0) rs.push(reason('clipped', `замен: ${num(b.clipped, 0)}`));
        if (r.status === 'over' || r.status === 'under') rs.push(reason('deviation', `${sgn(r.dev_pct)}${num(r.dev_pct, 1)}% при допуске ±${num(tol, 0)}%`));
        if (cov.has_fact && (!ri.entered || ri.missing_days > 0)) rs.push(reason('residents', ri.missing_days > 0 ? `не хватает смен: ${num(ri.missing_days, 0)}` : null));
        if (cov.has_fact && cov.partial_shift) rs.push(reason('partial_shift', (cov.partial_edges || []).map(e => fmtTs(e.ts, o.tz)).join(', ')));
        const level = rs.reduce((m, x) => RANK[x.level] > RANK[m] ? x.level : m, 'green');
        const item = { chemical_id: id, name: r.name, kind: r.kind, group: g, level, reasons: rs };
        out.items.push(item); out.summary[level]++; perG.push(item);
        if (RANK[level] > RANK[out.worst]) out.worst = level;
      });
      if (perG.length) out.chems.push({ chemical_id: id, name: perG[0].name, level: perG.reduce((m, x) => RANK[x.level] > RANK[m] ? x.level : m, 'green'), items: perG });
    });
    return out;
  }

  function trustHTML(res, g, opts) {
    const tr = trust(res, opts);
    if (!tr.visible || !tr.chems.length) return '';
    const sel = tr.chems.map(c => ({ ...c, items: c.items.filter(i => g === 'all' || i.group === g) })).filter(c => c.items.length);
    if (!sel.length) return '';
    const worst = sel.reduce((m, c) => c.items.reduce((mm, i) => RANK[i.level] > RANK[mm] ? i.level : mm, m), 'green');
    const item = i => `<li class="tl"><span class="dot ${DOT[i.level]}" aria-hidden="true"></span><b>${esc(GS[i.group])}</b> — ${WORD[i.level]}${i.reasons.length ? '' : '<small class="ok">замеры есть, остатки внесены, расход не меньше нуля</small>'}${i.reasons.length ? '<ul>' + i.reasons.map(r => `<li class="rs ${r.level}">${esc(r.text)} <button type="button" class="fx" aria-expanded="false">Что исправить</button><div class="fixbox" hidden>${esc(r.fix)}</div></li>`).join('') + '</ul>' : ''}</li>`;
    return `<section class="trust ${DOT[worst]}" aria-label="Можно ли верить цифрам"><h2>Можно ли верить цифрам <span class="chipT ${DOT[worst]}">${WORD[worst]}</span></h2>
<div class="tgrid">${sel.map(c => { const lv = c.items.reduce((m, i) => RANK[i.level] > RANK[m] ? i.level : m, 'green'); return `<div class="tc"><div class="th"><span class="dot ${DOT[lv]}" aria-hidden="true"></span><b>${esc(c.name)}</b></div><ul>${c.items.map(item).join('')}</ul></div>`; }).join('')}</div>
<p class="hint">Зелёный: замеры есть, остатки внесены, расход не меньше нуля. Жёлтый: цифры можно смотреть, но есть что проверить. Красный: цифрам верить нельзя, пока не исправлено.</p></section>`;
  }

  // ============================ 2. БАЛАНС ФАКТА ============================
  // Строки баланса: ключ, подпись, значение (кг, со знаком влияния на факт).
  const BAL = [
    ['start_measured', 'На начало (замер)', '+', b => b.start_measured_kg],
    ['to_reserve', 'Ушло в запас при прошлом закрытии', '−', b => b.to_reserve_kg],
    ['bottles', 'Новые бутыли', '+', b => b.bottles],
    ['leftovers', 'Остатки замен (ушли из дозатора)', '−', b => b.leftovers],
    ['connects', 'Подключённые остатки', '+', b => b.connects],
    ['replacedByConnect', 'Бутыль, вместо которой подключили остаток', '−', b => b.replacedByConnect],
    ['pours', 'Залито из запаса', '+', b => b.pours],
    ['adds', 'Добавлено суперадмином', '+', b => b.adds],
    ['takes', 'Забрано из дозатора', '−', b => b.takes],
    ['levelAdj', 'Поправка по уровню', '±', b => b.levelAdj],
    ['inflow', 'Приход нетто', '=', b => b.inflow_kg],
    ['end', 'На конец (замер)', '−', b => b.end_kg],
    ['fact', 'Факт расхода', '=', b => b.end_kg == null ? null : b.start_measured_kg - b.to_reserve_kg + b.inflow_kg - b.end_kg]
  ];
  const balanceLines = b => b ? BAL.map(([key, label, sign, f]) => ({ key, label, sign, kg: f(b) })) : [];

  function balanceHTML(res, row, ctx) {
    if (!row || !row.balance) return '<p class="hint">Баланса нет: за выбранный период нет двух замеров.</p>';
    const d = row.density, id = row.chemical_id, g = row.group;
    const segs = (res.segments || []).map((s, i) => ({ s, i, r: (s.rows_g || []).find(x => +x.chemical_id === +id && x.group === g) })).filter(x => x.r && x.r.balance);
    const multi = segs.length > 1;
    const tot = balanceLines(row.balance), per = segs.map(x => balanceLines(x.r.balance));
    const btn = (v, key, seg) => v == null ? '–' : `<button type="button" class="nb" data-src="${esc([id, g, key, seg == null ? '' : seg].join('|'))}">${num(v)}</button>`;
    const head = `<tr><th>Показатель</th>${multi ? segs.map(x => `<th>Отрезок ${x.i + 1}<br><small>${esc(fmtTs(x.s.from_ts, ctx && ctx.tz).slice(0, 5))} → ${esc(fmtTs(x.s.to_ts, ctx && ctx.tz).slice(0, 5))}</small></th>`).join('') : ''}<th>${multi ? 'Итого, кг' : 'кг'}</th><th>л</th></tr>`;
    const body = tot.map((l, k) => {
      const skip = (l.key === 'replacedByConnect' || l.key === 'levelAdj') && Math.abs(l.kg || 0) < EPS && per.every(p => Math.abs(p[k].kg || 0) < EPS);
      if (skip) return '';
      const strong = l.sign === '=';
      return `<tr class="${strong ? 'tt' : ''}"><td>${l.sign} ${esc(l.label)}</td>${multi ? per.map((p, j) => `<td>${btn(p[k].kg, l.key, segs[j].i)}</td>`).join('') : ''}<td>${btn(l.kg, l.key, null)}</td><td>${l.kg == null || !d ? '–' : num(l.kg / d)}</td></tr><tr class="sb" hidden><td colspan="${3 + (multi ? segs.length : 0)}"></td></tr>`;
    }).join('');
    return `<div class="tw"><table class="bal"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="hint">Факт = на начало − ушло в запас + приход нетто − на конец. Нажмите на число, чтобы увидеть записи, из которых оно получилось.</p>`;
  }

  // ============================ 3. ТЕОРИЯ ============================
  const windowOf = res => res.coverage && res.coverage.has_fact ? [Date.parse(res.coverage.fact_from_ts), Date.parse(res.coverage.fact_to_ts)] : [Date.parse(res.request.from_ts), Date.parse(res.request.to_ts)];

  // Теория по видам стирок: сколько стирок, норма мл/л, вода, итог. Те же формулы, что в report-calc.js (calcReport → addTheory).
  function theoryLines(res, inp, ctx, chemId, group) {
    const c = chemOf(ctx, chemId); if (!c) return null;
    const [A, B] = windowOf(res), refs = ctx.refs, water = +refs.water || 0, d = densOf(c);
    const mach = l => +l.machine <= 10 ? '1_10' : '11_12';
    const loads = (inp.loads || []).filter(l => { const t = T(l); return t >= A && t < B && (group === 'all' || mach(l) === group); });
    const out = { chemical_id: c.id, group, kind: c.kind, water, loads: loads.length, lines: [], total_l: 0, total_kg: null, unit: 'л' };
    if (c.kind === 'main') {
      const rec = {}; (refs.recipes || []).forEach(r => { rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0; });
      const by = {}; loads.forEach(l => { (by[l.wash_type_id] = by[l.wash_type_id] || { n: 0, kg: 0 }); by[l.wash_type_id].n++; by[l.wash_type_id].kg += +l.weight_kg || 0; });
      (refs.washTypes || []).forEach(w => { const x = by[w.id]; if (!x) return; const norm = rec[w.id + ':' + c.id] || 0; out.lines.push({ wash_type_id: w.id, name: w.name, n: x.n, laundry_kg: x.kg, norm_ml_per_l: norm, water_l: water, total_l: x.n * water * norm / 1000 }); });
      Object.keys(by).forEach(id => { if (!(refs.washTypes || []).some(w => String(w.id) === String(id))) { const x = by[id], norm = rec[id + ':' + c.id] || 0; out.lines.push({ wash_type_id: +id, name: 'вид ' + id, n: x.n, laundry_kg: x.kg, norm_ml_per_l: norm, water_l: water, total_l: x.n * water * norm / 1000 }); } });
      out.total_l = out.lines.reduce((s, x) => s + x.total_l, 0); out.total_kg = d ? out.total_l * d : null;
    } else {
      const g = c.per_unit_unit === 'g'; out.unit = g ? 'кг' : 'л'; let q = 0;
      loads.forEach(l => { q += +((l.extras || {})[c.id]) || 0; });
      if (q) out.lines.push({ extra: true, name: c.name, qty: q, per_unit: +c.per_unit || 0, per_unit_unit: g ? 'г' : 'мл', total: q * (+c.per_unit || 0) / 1000 });
      out.total_l = out.lines.reduce((s, x) => s + x.total, 0);
      out.total_kg = g ? out.total_l : (d ? out.total_l * d : null);
      if (g) out.total_l = d ? out.total_l / d : null;
    }
    const row = rowOf(res, chemId, group);
    out.matches = !row || row.theory_l == null || out.total_l == null || Math.abs(row.theory_l - out.total_l) < 1e-6;
    return out;
  }

  function theoryHTML(res, inp, ctx, row) {
    const t = theoryLines(res, inp, ctx, row.chemical_id, row.group); if (!t) return '';
    if (!t.lines.length) return `<p class="hint">В периоде факта нет стирок с этим средством.</p>`;
    const id = row.chemical_id, g = row.group;
    const b = (v, key, k) => `<button type="button" class="nb" data-src="${esc([id, g, key, k == null ? '' : k].join('|'))}">${num(v)}</button>`;
    const body = t.kind === 'main'
      ? t.lines.map(x => `<tr><td>${esc(x.name)}</td><td>${b(x.n, 'theory', x.wash_type_id)}</td><td>${num(x.norm_ml_per_l)}</td><td>${num(x.water_l)}</td><td>${num(x.total_l)}</td></tr><tr class="sb" hidden><td colspan="5"></td></tr>`).join('')
      : t.lines.map(x => `<tr><td>${esc(x.name)}</td><td>${b(x.qty, 'theory', '')}</td><td>${num(x.per_unit)} ${x.per_unit_unit}</td><td>–</td><td>${num(x.total)}</td></tr><tr class="sb" hidden><td colspan="5"></td></tr>`).join('');
    const head = t.kind === 'main' ? '<th>Вид стирки</th><th>Стирок, шт</th><th>Норма, мл/л</th><th>Вода, л</th><th>Итого, л</th>' : '<th>Средство</th><th>Использовано, шт</th><th>Норма на 1 шт</th><th>Вода</th><th>Итого, ' + t.unit + '</th>';
    return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body}<tr class="tt"><td>Итог теории</td><td></td><td></td><td></td><td>${num(t.kind === 'main' ? t.total_l : t.lines.reduce((s, x) => s + x.total, 0))} ${t.unit}</td></tr></tbody></table></div>
<p class="hint">Теория: ${t.kind === 'main' ? 'стирок × вода (л) × норма (мл/л) ÷ 1000' : 'использовано × норма на 1 шт ÷ 1000'}${t.total_kg != null ? ` = ${num(t.total_kg)} кг` : ''}.${t.matches ? '' : ' <b>Внимание: итог не совпадает с таблицей сверху.</b>'}</p>`;
  }

  // ============================ 4. РАСХОД НА КГ / СТИРКУ / ЖИТЕЛЯ ============================
  function usageHTML(res, row) {
    const u = row.unit_small || 'мл', id = row.chemical_id, g = row.group;
    const rd = res.totals && res.totals.resident_days;
    const cell = (v, key, dg) => `<td>${v == null ? '–' : `<button type="button" class="nb" data-src="${esc([id, g, key, ''].join('|'))}">${num(v, dg)}</button>`}</td>`;
    return `<div class="tw"><table><thead><tr><th>Показатель</th><th>Значение</th><th>Единица</th></tr></thead><tbody>
<tr><td>Расход на 1 кг белья</td>${cell(row.per_kg_laundry, 'per_kg', 3)}<td>${u}/кг белья</td></tr><tr class="sb" hidden><td colspan="3"></td></tr>
<tr><td>Расход на 1 стирку</td>${cell(row.per_wash, 'per_wash', 2)}<td>${u}/стирку</td></tr><tr class="sb" hidden><td colspan="3"></td></tr>
<tr><td>Расход на жителя в сутки</td>${cell(row.per_resident_day, 'per_resident', 3)}<td>${u}/житель·сутки${g !== 'all' ? ' (считается только по обоим дозаторам)' : ''}</td></tr><tr class="sb" hidden><td colspan="3"></td></tr>
</tbody></table></div><p class="hint">Всего: стирок ${num(row.washes, 0)}, белья ${num(row.laundry_kg, 1)} кг${rd ? `, жителе-суток ${num(rd, 1)}` : ', проживающие не введены'}. ${u === 'мл' ? 'Жидкая химия — в миллилитрах.' : 'Порошок — в граммах.'}</p>`;
  }

  // ============================ 5. ЭТАЛОН И ПРЕДЫДУЩЕЕ ЗАКРЫТИЕ ============================
  const snapRow = (snap, id, g) => snap && snap.rows ? snap.rows.find(r => +r.chemical_id === +id && r.group === g) || null : null;
  // сравнение одного показателя: рост — плохо (красным), снижение — хорошо (зелёным)
  function refCompare(cur, ref) {
    if (cur == null || ref == null || !isFinite(+cur) || !isFinite(+ref)) return null;
    if (Math.abs(ref) < 1e-12) return { ref, cur, delta: cur - ref, pct: null, cls: Math.abs(cur - ref) < 1e-12 ? 'eq' : 'up' };
    const pct = (cur - ref) / Math.abs(ref) * 100;
    return { ref, cur, delta: cur - ref, pct, cls: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'eq' };
  }
  function refsFor(row, ctx) {
    const mk = (cl) => {
      if (!cl) return { missing: 'нет' };
      const r = snapRow(cl.snapshot, row.chemical_id, row.group);
      if (!r) return { cl, missing: cl.snapshot ? 'нет данных по этому химикату' : 'у этого закрытия нет расчёта' };
      if (r.unit_small && row.unit_small && r.unit_small !== row.unit_small) return { cl, missing: 'другая единица измерения' };
      return { cl, kg: refCompare(row.per_kg_laundry, r.per_kg_laundry), wash: refCompare(row.per_wash, r.per_wash) };
    };
    return { etalon: mk(ctx && ctx.etalon), prev: mk(ctx && ctx.prev) };
  }
  function refHTML(res, row, ctx) {
    const R = refsFor(row, ctx), u = row.unit_small || 'мл', tz = ctx && ctx.tz;
    const cell = (c, key, dg) => !c ? '<td>–</td><td>–</td>' : `<td><button type="button" class="nb" data-src="${esc([row.chemical_id, row.group, key, ''].join('|'))}">${num(c.ref, dg)}</button></td><td class="d ${c.cls}">${c.pct == null ? (c.cls === 'eq' ? '0%' : 'новое') : (c.pct > 0 ? '▲ +' : c.pct < 0 ? '▼ ' : '') + num(c.pct, 1) + '%'}</td>`;
    const line = (title, x, key) => {
      if (x.missing) return `<tr><td>${title}</td><td colspan="5" class="hint">${x.cl ? esc(fmtTs(x.cl.at_ts, tz)) + ': ' : ''}${x.missing === 'нет' ? 'не задано' : esc(x.missing)}</td></tr>`;
      return `<tr><td>${title}<br><small>${esc(fmtTs(x.cl.at_ts, tz))}</small></td>${cell(x.kg, key, 3)}${cell(x.wash, key, 2)}<td></td></tr><tr class="sb" hidden><td colspan="6"></td></tr>`;
    };
    return `<div class="tw"><table><thead><tr><th>Сравниваем с</th><th>На кг белья, ${u}</th><th>Изменение</th><th>На стирку, ${u}</th><th>Изменение</th><th></th></tr></thead><tbody>
<tr class="tt"><td>Сейчас</td><td>${num(row.per_kg_laundry, 3)}</td><td></td><td>${num(row.per_wash, 2)}</td><td></td><td></td></tr>
${line('Эталон', R.etalon, 'etalon')}${line('Предыдущее закрытие', R.prev, 'prev')}</tbody></table></div><p class="hint">Красным — расход вырос, зелёным — снизился (изменение меньше 0,5% не отмечается). Эталон — первое закрытие или то, которое выбрал суперадмин.</p>`;
  }

  // ============================ 6. ГРАФИК ПО ЗАКРЫТИЯМ ============================
  // Накопительно: на каждом закрытии — сумма теории и факта с начала периода. По дням не считается (факт есть только на замерах).
  function cumulative(res, chemId, group, d) {
    const k = d ? 1 / d : 1, unit = d ? 'л' : 'кг';
    const pts = []; let f = 0, t = 0, fOk = true, tOk = true;
    const segs = res.segments || [];
    if (!segs.length) return { unit, points: [] };
    pts.push({ ts: segs[0].from_ts, fact: 0, theory: 0 });
    segs.forEach(s => {
      const r = (s.rows_g || []).find(x => +x.chemical_id === +chemId && x.group === group);
      if (!r) return;
      if (r.fact_kg == null) fOk = false; else f += r.fact_kg * k;
      if (r.theory_kg == null) tOk = false; else t += r.theory_kg * k;
      pts.push({ ts: s.to_ts, fact: fOk ? f : null, theory: tOk ? t : null });
    });
    return { unit, points: pts };
  }
  function chartSVG(cum, tz, title) {
    const P = cum.points; if (P.length < 2) return '<p class="hint">Для графика нужно хотя бы одно закрытие в периоде.</p>';
    const W = 560, H = 230, L = 52, Rr = 14, Tp = 16, Bt = 44, iw = W - L - Rr, ih = H - Tp - Bt;
    const vals = P.flatMap(p => [p.fact, p.theory]).filter(v => v != null && isFinite(v)); const max = Math.max(1e-9, ...vals) * 1.1;
    const X = i => L + (P.length === 1 ? 0 : i / (P.length - 1) * iw), Y = v => Tp + ih - v / max * ih;
    const line = key => { const pts = P.map((p, i) => p[key] == null ? null : [X(i), Y(p[key])]).filter(Boolean); return pts.length ? pts : null; };
    const poly = (pts, cls) => pts ? `<polyline class="${cls}" fill="none" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>` + pts.map(p => `<circle class="${cls}" r="3.5" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}"/>`).join('') : '';
    const ticks = [0, .25, .5, .75, 1].map(q => `<line x1="${L}" x2="${W - Rr}" y1="${Y(max * q).toFixed(1)}" y2="${Y(max * q).toFixed(1)}" class="gl"/><text x="${L - 6}" y="${(Y(max * q) + 4).toFixed(1)}" text-anchor="end" class="ax">${esc(num(max * q, 2))}</text>`).join('');
    const step = Math.max(1, Math.ceil(P.length / 6));
    const xs = P.map((p, i) => i % step === 0 || i === P.length - 1 ? `<text x="${X(i).toFixed(1)}" y="${H - 22}" text-anchor="middle" class="ax">${esc(fmtTs(p.ts, tz).slice(0, 5))}</text><text x="${X(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" class="ax">${esc(fmtTs(p.ts, tz).slice(11))}</text>` : '').join('');
    const lastF = P[P.length - 1].fact, lastT = P[P.length - 1].theory;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || 'Накопительный расход')}"><title>${esc(title || 'Накопительный расход: теория и факт по закрытиям')}</title>${ticks}${poly(line('theory'), 'th')}${poly(line('fact'), 'fc')}${xs}<text x="${L}" y="11" class="ax">${esc(cum.unit)}, накопительно</text></svg>
<p class="legend"><span class="lg th"></span>теория${lastT != null ? ' ' + esc(num(lastT)) + ' ' + cum.unit : ''} <span class="lg fc"></span>факт${lastF != null ? ' ' + esc(num(lastF)) + ' ' + cum.unit : ' (не по всем закрытиям)'}</p>`;
  }

  // график + подпись, за что он: за месяц (если загружены данные месяца) или за выбранный период
  function chartBlock(res, ctx, row) {
    const tz = ctx && ctx.tz, V0 = V(), mon = ctx && ctx.monthRes ? cumulative(ctx.monthRes, row.chemical_id, row.group, row.density) : null;
    const useMonth = mon && mon.points.length > 1, cum = useMonth ? mon : cumulative(res, row.chemical_id, row.group, row.density);
    const cap = useMonth ? 'Месяц: ' + V0.monthLabel(V0.monthKeyOf(Date.parse(ctx.monthRes.request.to_ts) - 1, tz, ctx.st)) : 'Выбранный период (закрытий в нём: ' + Math.max(0, cum.points.length - 1) + ')';
    return `<p class="hint">${esc(cap)}. Точки — моменты закрытий, значения накопительные.</p>` + chartSVG(cum, tz, row.name + ': накопительный расход, ' + cap);
  }

  // ============================ 7. ИСТОЧНИКИ ЧИСЕЛ ============================
  const segsOf = res => (res.segments || []).map(s => ({ a: Date.parse(s.from_ts), b: Date.parse(s.to_ts), from: s.closing_from, to: s.closing_to }));
  const kgTxt = (x, key, d) => { const kg = x[key + '_kg'], l = x[key + '_l']; return kg != null && isFinite(+kg) ? +kg : (l != null && isFinite(+l) && d ? +l * d : null); };

  // Исходные записи для числа. key: start_measured | to_reserve | bottles | leftovers | connects | replacedByConnect | pours | adds | takes | levelAdj | inflow | end | fact | theory | per_kg | per_wash | per_resident | etalon | prev
  function sources(inp, res, ctx, chemId, group, key, seg) {
    const c = chemOf(ctx, chemId), d = densOf(c); const all = segsOf(res);
    const washId = key === 'theory' && seg != null && seg !== '' ? String(seg) : null;     // для теории четвёртая часть ключа — вид стирки, для остальных — номер отрезка
    const segs = !washId && seg != null && seg !== '' && all[+seg] ? [all[+seg]] : all; const out = [], seen = new Set();
    const push = r => { const k = r.entity + '|' + r.id + '|' + (r.sub || ''); if (seen.has(k)) return; seen.add(k); out.push(r); };
    const mine = a => (a || []).filter(x => +x.chemical_id === +chemId && inG(x, group));
    const inSeg = t => segs.some(s => t >= s.a && t < s.b);
    const meta = id => (ctx && ctx.meta && ctx.meta[id]) || {};
    const measure = (cid, role) => {
      const cl = (inp.closings || []).find(x => x.id === cid); if (!cl) return;
      groupsOf(group).forEach(g => { const v = cl.measures ? cl.measures[chemId + ':' + g] : null; push({ entity: 'closing', id: cid, sub: g, ts: cl.at_ts, who: whoOf(ctx, meta(cid).closed_by), when_in: meta(cid).closed_at || null, kg: v == null ? null : +v, text: `Замер остатка ${role}: ${GS[g]}` }); });
    };
    const moveRec = (m, text) => push({ entity: 'move', id: m.id, ts: m.ts, who: whoOf(ctx, m.created_by), kg: kgTxt(m, 'amount', d), text: `${text}: ${GS[m.machine_group || '1_10']}` });
    const isCloseTake = (m, s) => m.kind === 'take' && m.closing_id && T(m) === s.a;
    const parts = {
      start_measured: () => segs.forEach(s => measure(s.from, 'на начало')),
      end: () => segs.forEach(s => measure(s.to, 'на конец')),
      to_reserve: () => segs.forEach(s => mine(inp.moves).filter(m => isCloseTake(m, s)).forEach(m => moveRec(m, 'Остаток забран при закрытии (ушёл в запас)'))),
      bottles: () => mine(inp.changes).filter(x => inSeg(T(x))).forEach(x => push({ entity: 'change', id: x.id, ts: x.ts, who: whoOf(ctx, x.created_by), kg: c && +c.bottle_kg > 0 ? +c.bottle_kg : null, text: `Замена бутыли (новая бутыль по номиналу): ${GS[x.machine_group || '1_10']}` })),
      leftovers: () => mine(inp.changes).filter(x => inSeg(T(x))).forEach(x => push({ entity: 'change', id: x.id, sub: 'left', ts: x.ts, who: whoOf(ctx, x.created_by), kg: kgTxt(x, 'leftover', d), text: `Остаток старой бутыли при замене${kgTxt(x, 'leftover', d) == null ? ' не указан (принят 0)' : ''}: ${GS[x.machine_group || '1_10']}` })),
      connects: () => mine(inp.connects).filter(x => inSeg(T(x))).forEach(x => push({ entity: 'connect', id: x.id, ts: x.ts, who: whoOf(ctx, x.created_by), kg: kgTxt(x, 'amount', d), text: `Подключён остаток: ${GS[x.machine_group || '1_10']}` })),
      pours: () => segs.forEach(s => mine(inp.moves).filter(m => !['take', 'add', 'receipt', 'writeoff'].includes(m.kind) && T(m) >= s.a && T(m) < s.b).forEach(m => moveRec(m, 'Залито из запаса'))),
      adds: () => mine(inp.moves).filter(m => m.kind === 'add' && inSeg(T(m))).forEach(m => moveRec(m, 'Добавлено суперадмином')),
      takes: () => segs.forEach(s => mine(inp.moves).filter(m => m.kind === 'take' && !isCloseTake(m, s) && T(m) >= s.a && T(m) < s.b).forEach(m => moveRec(m, 'Забрано из дозатора'))),
      levelAdj: () => mine(inp.levels).filter(x => inSeg(T(x))).forEach(x => push({ entity: 'level', id: x.id, ts: x.ts, who: whoOf(ctx, x.created_by), kg: kgTxt(x, 'amount', d), text: `Поправка: «в дозаторе реально было» — ${GS[x.machine_group || '1_10']}` })),
      theory: () => (inp.loads || []).filter(l => { const t = T(l); const m = +l.machine <= 10 ? '1_10' : '11_12'; return inSeg(t) && (group === 'all' || m === group) && (!washId || String(l.wash_type_id) === washId); }).forEach(l => push({ entity: 'load', id: l.id || (l.ts + '|' + l.machine), ts: l.ts, who: whoOf(ctx, l.created_by), kg: +l.weight_kg || 0, text: `Стирка: машина ${l.machine}, ${((ctx.refs.washTypes || []).find(w => +w.id === +l.wash_type_id) || {}).name || 'вид ' + l.wash_type_id}, белья кг` })),
      etalon: () => ctx && ctx.etalon && push({ entity: 'closing', id: ctx.etalon.id, ts: ctx.etalon.at_ts, who: whoOf(ctx, meta(ctx.etalon.id).closed_by), kg: null, text: 'Закрытие-эталон (снимок расчёта)' }),
      prev: () => ctx && ctx.prev && push({ entity: 'closing', id: ctx.prev.id, ts: ctx.prev.at_ts, who: whoOf(ctx, meta(ctx.prev.id).closed_by), kg: null, text: 'Предыдущее закрытие (снимок расчёта)' })
    };
    const run = k => parts[k] && parts[k]();
    if (key === 'inflow') ['bottles', 'leftovers', 'connects', 'pours', 'adds', 'takes', 'levelAdj'].forEach(run);
    else if (key === 'fact') ['start_measured', 'to_reserve', 'bottles', 'leftovers', 'connects', 'pours', 'adds', 'takes', 'levelAdj', 'end'].forEach(run);
    else if (key === 'per_kg' || key === 'per_wash' || key === 'per_resident') { ['start_measured', 'end', 'to_reserve', 'bottles', 'leftovers', 'connects', 'pours', 'adds', 'takes', 'levelAdj'].forEach(run); run('theory'); }
    else if (key === 'replacedByConnect') run('connects');
    else run(key);
    return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }

  function sourcesHTML(list, tz) {
    if (!list || !list.length) return '<div class="srcbox"><p class="hint">Исходных записей нет: число равно нулю или получилось из настроек.</p></div>';
    const big = list.length > 200, shown = big ? list.slice(0, 200) : list;
    return `<div class="srcbox"><table><thead><tr><th>Когда</th><th>Что записано</th><th>Кто внёс</th><th>кг</th><th></th></tr></thead><tbody>${shown.map(r =>
      `<tr><td>${esc(fmtTs(r.ts, tz))}</td><td>${esc(r.text)}</td><td>${esc(r.who)}${r.when_in ? `<br><small>внесено ${esc(fmtTs(r.when_in, tz))}</small>` : ''}</td><td>${r.kg == null ? '–' : num(r.kg)}</td><td>${r.entity === 'closing' ? `<a href="closings-report.html?id=${encodeURIComponent(r.id)}">Закрытие</a>` : `<a href="journal.html?ts=${encodeURIComponent(r.ts)}">Журнал</a>`}</td></tr>`).join('')}</tbody></table>${big ? `<p class="hint">Показаны первые 200 записей из ${list.length}.</p>` : ''}</div>`;
  }

  // ============================ 8. ХРОНОЛОГИЯ ============================
  function timeline(inp, res, ctx, chemId, group) {
    const [A, B] = windowOf(res), c = chemOf(ctx, chemId), d = densOf(c), ev = [];
    const mine = a => (a || []).filter(x => +x.chemical_id === +chemId && inG(x, group));
    const meta = id => (ctx && ctx.meta && ctx.meta[id]) || {};
    const amt = (x, k) => { const v = kgTxt(x, k, d); return v == null ? '' : ` ${num(v)} кг`; };
    mine(inp.changes).forEach(x => { const t = T(x); if (t >= A && t < B) ev.push({ ts: x.ts, type: 'change', label: 'Замена бутыли', text: `${GS[x.machine_group || '1_10']}, остаток старой:${kgTxt(x, 'leftover', d) == null ? ' не указан' : amt(x, 'leftover')}`, who: whoOf(ctx, x.created_by) }); });
    mine(inp.connects).forEach(x => { const t = T(x); if (t >= A && t < B) ev.push({ ts: x.ts, type: 'connect', label: 'Подключён остаток', text: `${GS[x.machine_group || '1_10']},${amt(x, 'amount')}`, who: whoOf(ctx, x.created_by) }); });
    mine(inp.moves).forEach(x => { const t = T(x); if (t < A || t >= B || ['receipt', 'writeoff'].includes(x.kind)) return;
      const closeTake = x.kind === 'take' && x.closing_id;
      ev.push({ ts: x.ts, type: x.kind === 'take' ? 'take' : x.kind === 'add' ? 'add' : 'pour', label: closeTake ? 'Остаток ушёл в запас (закрытие)' : x.kind === 'take' ? 'Забрано из дозатора' : x.kind === 'add' ? 'Добавлено суперадмином' : 'Заливка из запаса', text: `${GS[x.machine_group || '1_10']},${amt(x, 'amount')}`, who: whoOf(ctx, x.created_by) }); });
    mine(inp.levels).forEach(x => { const t = T(x); if (t >= A && t < B) ev.push({ ts: x.ts, type: 'level', label: 'Поправка по уровню', text: `${GS[x.machine_group || '1_10']}, в дозаторе было${amt(x, 'amount')}`, who: whoOf(ctx, x.created_by) }); });
    (inp.closings || []).forEach(cl => { const t = Date.parse(cl.at_ts); if (t < A || t > B) return;
      groupsOf(group).forEach(g => { const v = cl.measures ? cl.measures[chemId + ':' + g] : null; if (v == null) return; ev.push({ ts: cl.at_ts, type: 'measure', label: 'Замер остатка', text: `${GS[g]}, ${num(v)} кг`, who: whoOf(ctx, meta(cl.id).closed_by), when_in: meta(cl.id).closed_at || null }); }); });
    const order = { measure: 0, take: 1, pour: 2 };
    return ev.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (order[a.type] ?? 5) - (order[b.type] ?? 5));
  }
  function timelineHTML(list, tz) {
    if (!list.length) return '<p class="hint">В этом периоде записей по этому химикату нет.</p>';
    return `<ol class="tlv">${list.map(e => `<li class="${esc(e.type)}"><time>${esc(fmtTs(e.ts, tz))}</time> <b>${esc(e.label)}</b> — ${esc(e.text)} <small>внёс: ${esc(e.who)}${e.when_in ? ', в системе ' + esc(fmtTs(e.when_in, tz)) : ''}</small></li>`).join('')}</ol>`;
  }

  // ============================ 9. КАРТОЧКА «ПОДРОБНО» ============================
  function oneCard(res, inp, ctx, row, opts) {
    const o = opts || {}, tz = ctx && ctx.tz, tr = o.isAdmin === false ? null : trust(res, { isAdmin: true, tz });
    const item = tr && tr.items.find(i => +i.chemical_id === +row.chemical_id && i.group === row.group);
    const sec = (n, t, h) => `<h4><span class="sn">${n}</span> ${t}</h4>${h}`;
    return `<div class="dcard" data-chem="${esc(row.chemical_id)}" data-g="${esc(row.group)}"><h3>${esc(row.name)} <small>${esc(GN[row.group])}</small>${item ? ` <span class="dot ${DOT[item.level]}" title="${WORD[item.level]}"></span>` : ''}</h3>
${item && item.reasons.length ? `<ul class="rsl">${item.reasons.map(r => `<li class="rs ${r.level}">${esc(r.text)} <button type="button" class="fx" aria-expanded="false">Что исправить</button><div class="fixbox" hidden>${esc(r.fix)}</div></li>`).join('')}</ul>` : ''}
${sec(1, 'Баланс факта', balanceHTML(res, row, ctx))}
${sec(2, 'Теория', theoryHTML(res, inp, ctx, row))}
${sec(3, 'Расход на кг белья, на стирку, на жителя в сутки', usageHTML(res, row))}
${sec(4, 'Сравнение с эталоном и с предыдущим закрытием', refHTML(res, row, ctx))}
${sec(5, 'Накопительный расход: теория и факт по закрытиям', `<div class="chartbox" data-chart="${esc(row.chemical_id + '|' + row.group)}">${chartBlock(res, ctx, row)}</div>`)}
${sec(6, 'Хронология событий периода', timelineHTML(timeline(inp, res, ctx, row.chemical_id, row.group), tz))}</div>`;
  }
  // для строки «оба дозатора» показываем оба дозатора и итог
  function cardHTML(res, inp, ctx, chemId, group, opts) {
    const gs = group === 'all' ? ['1_10', '11_12', 'all'] : [group];
    return gs.map(g => { const r = rowOf(res, chemId, g); return r ? oneCard(res, inp, ctx, r, opts) : ''; }).join('');
  }

  // Кнопки внутри разметки: «Что исправить» и числа-источники. root — элемент, на который повешен обработчик клика.
  function onClick(e, getState) {
    const t = e.target && e.target.closest ? e.target : null; if (!t) return false;
    const fx = t.closest('button.fx');
    if (fx) { const box = fx.nextElementSibling; if (box) { box.hidden = !box.hidden; fx.setAttribute('aria-expanded', String(!box.hidden)); } return true; }
    const nb = t.closest('button.nb');
    if (nb) {
      const tr = nb.closest('tr'), box = tr && tr.nextElementSibling; if (!box || !box.classList.contains('sb')) return true;
      if (!box.hidden) { box.hidden = true; return true; }
      const st = getState(), p = String(nb.dataset.src || '').split('|');
      box.firstElementChild.innerHTML = sourcesHTML(sources(st.inp, st.res, st.ctx, p[0], p[1], p[2], p[3]), st.ctx && st.ctx.tz); box.hidden = false; return true;
    }
    return false;
  }

  return { trust, trustHTML, FIX, WORD, balanceLines, balanceHTML, theoryLines, theoryHTML, usageHTML, refCompare, refsFor, refHTML, cumulative, chartSVG, chartBlock,
           sources, sourcesHTML, timeline, timelineHTML, cardHTML, oneCard, onClick, windowOf, GN, GS };
})();
if (typeof module !== 'undefined') module.exports = CompareDetail;
