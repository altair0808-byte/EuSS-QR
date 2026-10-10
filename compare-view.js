// Этап 2 «Сравнение химии»: краткий вид. Чистые функции показа: без базы и без DOM, поэтому их можно проверять тестами.
// Данные приходят из calcCompare (compare-calc.js). Страница: compare.html.
const CompareView = (() => {
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n, m = 2) => n == null || !isFinite(+n) ? '–' : (typeof Num !== 'undefined' ? Num.fmt(n, m) : String(Math.round(+n * 10 ** m) / 10 ** m));
  const sg = n => n != null && +n > 0 ? '+' : '';
  const pad2 = n => String(n).padStart(2, '0');

  const STATUS = { ok: ['в норме', 'ok'], over: ['перерасход', 'over'], under: ['недорасход', 'under'], nodata: ['нет данных', 'nd'], check: ['проверить данные', 'ck'] };
  const GROUP_LABEL = { all: 'Оба дозатора', '1_10': 'Дозатор 1 (машины 1–10)', '11_12': 'Дозатор 2 (машины 11–12)' };

  // ---------- время (всё в местном времени прачечной: tz — сдвиг от UTC, st — час начала смены) ----------
  const fmtTs = (ts, tz) => {
    if (!ts) return '–';
    const d = new Date(new Date(ts).getTime() + (tz == null ? 5 : +tz) * 3600e3);
    return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };
  // значение для <input type="datetime-local"> и обратно: поле показывает местное время прачечной, а не часовой пояс браузера
  const toLocalInput = (ts, tz) => {
    const d = new Date(new Date(ts).getTime() + (tz == null ? 5 : +tz) * 3600e3);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };
  const fromLocalInput = (s, tz) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - (tz == null ? 5 : +tz) * 3600e3).toISOString() : null;
  };
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const monthLabel = k => { const [y, m] = k.split('-'); return MONTHS[+m - 1] + ' ' + y; };
  const monthKeyOf = (ts, tz, st) => new Date(new Date(ts).getTime() + ((tz == null ? 5 : +tz) - (st == null ? 6 : +st)) * 3600e3).toISOString().slice(0, 7);
  // месяц: с 1 числа 06:00 до 1 числа следующего месяца 06:00; текущий месяц обрезается «сейчас»
  const monthRange = (key, tz, st, nowTs) => {
    const [y, m] = key.split('-').map(Number), sh = (st == null ? 6 : +st) - (tz == null ? 5 : +tz);
    const a = Date.UTC(y, m - 1, 1, sh), b = Date.UTC(y, m, 1, sh);
    const now = nowTs == null ? b : Math.floor(+nowTs / 60000) * 60000, to = Math.min(b, now);
    return { fromTs: new Date(a).toISOString(), toTs: new Date(to).toISOString(), partial: to < b };
  };
  const monthOptions = (nowTs, tz, st, n = 12) => {
    let [y, m] = monthKeyOf(nowTs, tz, st).split('-').map(Number); const out = [];
    for (let i = 0; i < n; i++) { const k = `${y}-${pad2(m)}`; out.push({ key: k, label: monthLabel(k) }); m--; if (m < 1) { m = 12; y--; } }
    return out;
  };
  // последнее закрытие: от предыдущего замера до последнего (список закрытий — от новых к старым)
  const lastClosingRange = list => list && list.length >= 2 ? { fromTs: list[1].at_ts, toTs: list[0].at_ts } : null;

  // ---------- показ ----------
  const statusChip = s => { const [t, c] = STATUS[s] || STATUS.nodata; return `<span class="st ${c}">${t}</span>`; };
  const pctTxt = p => p == null ? '–' : `${sg(p)}${num(p, 1)}%`;
  const devCls = s => s === 'over' ? 'bad' : s === 'under' ? 'low' : s === 'check' ? 'ck' : '';

  function periodHTML(res, tz) {
    return `<p class="hint">Период: <b>${fmtTs(res.request.from_ts, tz)} → ${fmtTs(res.request.to_ts, tz)}</b></p>`;
  }

  // за какие часы реально посчитан факт
  function coverageHTML(res, tz) {
    const c = res.coverage;
    if (!c || !c.has_fact) return `<div class="msg wr">${esc((c && c.note) || 'Факт посчитать нельзя.')}<br><small>Показана только теория за выбранный период.</small></div>`;
    const span = `${fmtTs(c.fact_from_ts, tz)} → ${fmtTs(c.fact_to_ts, tz)}`;
    if (c.full) return `<p class="hint">Факт по замерам остатков: ${span}${c.segments > 1 ? ` · закрытий в периоде: ${c.segments}` : ''}</p>`;
    return `<div class="msg wr">Факт посчитан за период закрытий: <b>${span}</b> (${num(c.coverage_pct, 0)}% выбранного периода). Теория для сравнения взята за тот же отрезок.</div>`;
  }

  // четыре карточки сверху
  function cardsHTML(res, g) {
    const c = res.coverage, t = res.totals || {};
    const fact = c && c.has_fact;
    let washes = null, kg = null;
    if (fact) { const s = g === 'all' ? t : (t.by_group || {})[g]; if (s) { washes = s.washes; kg = s.laundry_kg; } }
    else if (g === 'all') { washes = c.washes_requested; kg = c.laundry_kg_requested; }
    const main = (res.totals_by_kind && res.totals_by_kind.main || {})[g];
    const nWarn = (res.warnings || []).filter(w => g === 'all' || !w.group || w.group === g).length + (res.problems || []).length;
    const dev = main ? main.dev_pct : null;
    return `<div class="tot">
<div><span>Стирок</span><b>${washes == null ? '–' : num(washes, 0)}</b></div>
<div><span>Белья, кг</span><b>${kg == null ? '–' : num(kg, 1)}</b></div>
<div class="${main ? devCls(main.status) : ''}"><span>Отклонение, % (основная химия)</span><b>${pctTxt(dev)}</b></div>
<div class="${nWarn ? 'wn' : ''}"><span>Предупреждений</span><b>${nWarn}</b></div>
</div>`;
  }

  // таблица: химикат · теория · факт · разница · отклонение · статус
  // opts.detail (этап 3, только админу): у каждой строки химии кнопка «Подробно» и скрытая строка для карточки (заполняет страница)
  function tableHTML(res, g, opts) {
    const rows = (res.rows || []).filter(r => r.group === g);
    if (!rows.length) return '<p class="hint">Нет химикатов для сравнения.</p>';
    const det = !!(opts && opts.detail);
    const line = r => `<tr><td>${esc(r.name)}</td><td>${num(r.theory_l)}</td><td>${num(r.fact_l)}</td><td class="${devCls(r.status)}">${sg(r.diff_l)}${num(r.diff_l)}</td><td class="${devCls(r.status)}">${pctTxt(r.dev_pct)}</td><td>${statusChip(r.status)}</td>${det ? `<td><button type="button" class="mr" data-chem="${esc(r.chemical_id)}" aria-expanded="false">Подробно</button></td>` : ''}</tr>` +
      (det ? `<tr class="dr" hidden><td colspan="7" data-chem="${esc(r.chemical_id)}"></td></tr>` : '');
    const tot = (kind, label) => {
      const t = res.totals_by_kind && res.totals_by_kind[kind] && res.totals_by_kind[kind][g];
      if (!t) return '';
      const star = t.incomplete ? '<sup title="Посчитаны не все химикаты: по части нет данных">*</sup>' : '';
      return `<tr class="tt"><td>${label}${star}</td><td>${num(t.theory_l)}</td><td>${num(t.fact_l)}</td><td class="${devCls(t.status)}">${sg(t.diff_l)}${num(t.diff_l)}</td><td class="${devCls(t.status)}">${pctTxt(t.dev_pct)}</td><td>${statusChip(t.status)}</td>${det ? '<td></td>' : ''}</tr>`;
    };
    const main = rows.filter(r => r.kind === 'main'), extra = rows.filter(r => r.kind !== 'main');
    const body = main.map(line).join('') + (main.length ? tot('main', 'ИТОГО основная химия') : '') + extra.map(line).join('') + (extra.length ? tot('extra', 'ИТОГО доп. средства') : '');
    return `<div class="tw"><table><thead><tr><th>Химикат</th><th>Теория, л</th><th>Факт, л</th><th>Разница, л</th><th>Откл., %</th><th>Статус</th>${det ? '<th></th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // под таблицей: справка про теорию за весь период и доп. средства без замеров
  function notesHTML(res, g) {
    const out = [];
    const c = res.coverage;
    if (c && c.has_fact && !c.full) {
      const th = (res.rows || []).filter(r => r.group === g && r.kind === 'main' && r.theory_requested_l != null).reduce((s, r) => s + r.theory_requested_l, 0);
      out.push(`Теория за весь выбранный период (справка): ${num(th)} л`);
    }
    if ((res.theory_only || []).length) out.push('Без замеров, только теория: ' + res.theory_only.map(x => `${esc(x.name)} ${num(x.theory_l)} л`).join(', '));
    out.push(`Допуск «в норме»: ±${num(res.request.tol_pct, 0)}%. Факт считается по замерам остатков в дозаторах между закрытиями.`);
    return `<p class="hint">${out.join('<br>')}</p>`;
  }

  function warningsHTML(res, g) {
    const probs = res.problems || [], ws = (res.warnings || []).filter(w => g === 'all' || !w.group || w.group === g);
    if (!probs.length && !ws.length) return '';
    const li = a => a.map(x => `<li>${esc(x.text)}</li>`).join('');
    return (probs.length ? `<div class="msg er"><b>Мешает расчёту</b><ul>${li(probs)}</ul></div>` : '') +
      (ws.length ? `<details class="msg wr"><summary>Предупреждения (${ws.length})</summary><ul>${li(ws)}</ul></details>` : '');
  }

  // весь экран одним куском
  // opts.before — блок перед таблицей (светофор «Можно ли верить цифрам», только админу); opts.detail — кнопки «Подробно»
  function screenHTML(res, g, tz, opts) {
    const o = opts || {};
    return periodHTML(res, tz) + coverageHTML(res, tz) + (o.before || '') + cardsHTML(res, g) + tableHTML(res, g, o) + notesHTML(res, g) + warningsHTML(res, g);
  }

  return { esc, num, fmtTs, toLocalInput, fromLocalInput, monthLabel, monthKeyOf, monthRange, monthOptions, lastClosingRange,
           statusChip, periodHTML, coverageHTML, cardsHTML, tableHTML, notesHTML, warningsHTML, screenHTML, STATUS, GROUP_LABEL };
})();
if (typeof module !== 'undefined') module.exports = CompareView;
