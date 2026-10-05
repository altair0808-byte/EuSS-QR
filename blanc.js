// Бланк Blanc.xlsx: раскладка загрузок по листу дня, просмотр на странице и заполнение файла.
// Чистые функции, без обращения к базе. Работает в браузере и в node (для проверки).
const Blank = (() => {
  const TYPES = ['постель белая', 'махра белая', 'униформа белая', 'униформа темная', 'синтетика', 'деликатная', 'спецодежда'];
  const SLOTS = 5;                 // строк на один вид стирки в бланке
  const SUMMARY = 'Итоги месяца и недели';
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const LET = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colOf = (machine, part) => 10 + (machine - 1) * 2 + part;          // J = 10, день/ночь парами
  const bySort = (a, b) => (a.sort || 0) - (b.sort || 0);
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const serial = d => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5);
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('ru-RU');

  function setup(refs) {
    const mains = refs.chemicals.filter(c => c.kind === 'main').sort(bySort).slice(0, 5);
    const extras = refs.chemicals.filter(c => c.kind === 'extra').sort(bySort).slice(0, 3);
    const typeOf = {}, wt = Array(7).fill(null), rec = {}, other = {};
    refs.washTypes.forEach(w => { const t = TYPES.indexOf(norm(w.name)); if (t >= 0) { typeOf[w.id] = t; wt[t] = w; } else other[w.id] = w.name; });
    refs.recipes.forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
    return { mains, extras, typeOf, wt, rec, other, water: +refs.water || 55 };
  }

  // Раскладка одного дня: loads уже отфильтрованы по shift_date
  function build(loads, refs, date) {
    const S = setup(refs);
    const grid = TYPES.map(() => Array.from({ length: 12 }, () => [[], []]));
    const ex = TYPES.map(() => [0, 0, 0]);
    const lost = [], unknown = {};
    loads.slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).forEach(l => {
      const t = S.typeOf[l.wash_type_id];
      if (t === undefined) { const n = S.other[l.wash_type_id] || ('вид ' + l.wash_type_id); unknown[n] = (unknown[n] || 0) + 1; return; }
      const cell = grid[t][l.machine - 1][l.part === 'night' ? 1 : 0];
      if (cell.length >= SLOTS) lost.push({ type: S.wt[t].name, machine: l.machine, part: l.part === 'night' ? 'ночь' : 'день' });
      else cell.push(+l.weight_kg || 0);
      Object.entries(l.extras || {}).forEach(([id, q]) => { const i = S.extras.findIndex(c => String(c.id) === String(id)); if (i >= 0) ex[t][i] += +q || 0; });
    });
    const types = TYPES.map((_, t) => {
      const w = S.wt[t], cells = grid[t].flat();
      const n = cells.reduce((a, c) => a + c.length, 0), kg = cells.flat().reduce((a, x) => a + x, 0);
      const minutes = w ? +w.minutes || 0 : 0;
      const chem = S.mains.map(c => w ? n * S.water * (S.rec[w.id + ':' + c.id] || 0) : 0);
      while (chem.length < 5) chem.push(0);
      const exTot = S.extras.map((c, i) => ex[t][i] * (+c.per_unit || 0));
      while (exTot.length < 3) exTot.push(0);
      return { t, name: w ? w.name : TYPES[t], n, kg, minutes, time: n * minutes, chem, exQty: ex[t], exTot };
    });
    const colSum = Array.from({ length: 24 }, (_, i) => r6(types.reduce((a, ty) => a + grid[ty.t][i >> 1][i & 1].reduce((x, y) => x + y, 0), 0)));
    const total = {
      n: types.reduce((a, x) => a + x.n, 0), kg: r6(types.reduce((a, x) => a + x.kg, 0)), time: types.reduce((a, x) => a + x.time, 0),
      chem: [0, 1, 2, 3, 4].map(i => r6(types.reduce((a, x) => a + x.chem[i], 0))),
      exQty: [0, 1, 2].map(i => types.reduce((a, x) => a + x.exQty[i], 0)),
      exTot: [0, 1, 2].map(i => r6(types.reduce((a, x) => a + x.exTot[i], 0))),
      colSum
    };
    return { date, grid, types, total, lost, unknown, mains: S.mains, extras: S.extras };
  }

  // ---------- просмотр на странице ----------
  function html(m) {
    const h = [];
    const chemNames = [0, 1, 2, 3, 4].map(i => m.mains[i] ? m.mains[i].name : '');
    const exNames = [0, 1, 2].map(i => m.extras[i] ? m.extras[i].name : '');
    h.push('<table class="blk"><thead><tr><th rowspan="3">Вид</th><th rowspan="3">Кол-во</th><th rowspan="3">Время, мин</th>');
    chemNames.forEach(n => h.push(`<th rowspan="3" class="vt">${esc(n)}</th>`));
    h.push('<th colspan="24">Вес, кг (номер машины)</th><th rowspan="3">Всего кг</th>');
    exNames.forEach(n => h.push(`<th colspan="2" rowspan="2">${esc(n)}</th>`));
    h.push('</tr><tr>');
    for (let i = 1; i <= 12; i++) h.push(`<th colspan="2">${i}</th>`);
    h.push('</tr><tr>');
    for (let i = 1; i <= 12; i++) h.push('<th class="dn">д</th><th class="dn">н</th>');
    exNames.forEach(() => h.push('<th class="dn">шт</th><th class="dn">всего</th>'));
    h.push('</tr></thead><tbody>');
    m.types.forEach(ty => {
      for (let k = 0; k < SLOTS; k++) {
        h.push('<tr' + (k === 0 ? ' class="first"' : '') + '>');
        if (k === 0) {
          h.push(`<th rowspan="${SLOTS}" class="nm">${esc(ty.name)}</th><td rowspan="${SLOTS}">${ty.n || ''}</td><td rowspan="${SLOTS}">${ty.time || ''}</td>`);
          ty.chem.forEach(v => h.push(`<td rowspan="${SLOTS}">${v ? fmt(v, 0) : ''}</td>`));
        }
        for (let i = 0; i < 24; i++) { const w = m.grid[ty.t][i >> 1][i & 1][k]; h.push(`<td class="w${i & 1 ? ' nt' : ''}">${w === undefined ? '' : fmt(w)}</td>`); }
        if (k === 0) {
          h.push(`<td rowspan="${SLOTS}"><b>${ty.kg ? fmt(ty.kg) : ''}</b></td>`);
          for (let i = 0; i < 3; i++) h.push(`<td rowspan="${SLOTS}">${ty.exQty[i] || ''}</td><td rowspan="${SLOTS}">${ty.exTot[i] ? fmt(ty.exTot[i], 0) : ''}</td>`);
        }
        h.push('</tr>');
      }
    });
    const T = m.total;
    h.push(`<tr class="tot"><th>ИТОГО</th><td>${T.n || ''}</td><td>${T.time || ''}</td>${T.chem.map(v => `<td>${v ? fmt(v, 0) : ''}</td>`).join('')}`
      + T.colSum.map((v, i) => `<td class="${i & 1 ? 'nt' : ''}">${v ? fmt(v) : ''}</td>`).join('')
      + `<td>${T.kg ? fmt(T.kg) : ''}</td>` + [0, 1, 2].map(i => `<td>${T.exQty[i] || ''}</td><td>${T.exTot[i] ? fmt(T.exTot[i], 0) : ''}</td>`).join('') + '</tr>');
    h.push('</tbody></table>');
    return h.join('');
  }

  function warnings(m) {
    const w = [];
    if (m.lost.length) w.push(`Не поместилось в бланк (больше ${SLOTS} стирок одного вида на машину за смену): ${m.lost.length} шт. Они не попали в таблицу и файл: ` + m.lost.map(x => `машина ${x.machine} ${x.part}, ${x.type}`).join('; ') + '.');
    const u = Object.entries(m.unknown);
    if (u.length) w.push('Вида стирки нет в шаблоне Blanc.xlsx, эти записи пропущены: ' + u.map(([n, c]) => `${n} (${c})`).join(', ') + '.');
    return w;
  }

  // ---------- строки итогов месяца ----------
  function summaryRow(m) {
    const T = m.total;
    return { date: m.date, n: T.n, kg: T.kg, chem: T.chem, exTot: T.exTot };
  }

  // ---------- xlsx: правка xml внутри файла ----------
  const F_RE = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/;
  const cellRe = ref => new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)');
  function setCell(xml, ref, val) {                       // val: число или '' ; стиль и формула сохраняются
    const m = cellRe(ref).exec(xml);
    if (!m) throw new Error('В шаблоне нет ячейки ' + ref);
    const attrs = m[1].replace(/\s+t="[^"]*"/, '');
    const f = m[2] ? (F_RE.exec(m[2]) || [''])[0] : '';
    const body = val === '' ? { t: ' t="str"', v: '<v></v>' } : { t: '', v: '<v>' + r6(val) + '</v>' };
    return xml.replace(cellRe(ref), () => `<c r="${ref}"${attrs}${body.t}>${f}${body.v}</c>`);
  }
  function setFormula(xml, ref, text) {                   // только для обычных (не общих) формул
    const m = cellRe(ref).exec(xml);
    if (!m || !m[2] || !/<f>[\s\S]*?<\/f>/.test(m[2])) return xml;
    return xml.replace(cellRe(ref), () => '<c r="' + ref + '"' + m[1] + '>' + m[2].replace(/<f>[\s\S]*?<\/f>/, '<f>' + text + '</f>') + '</c>');
  }

  // Формулы листа дня: минуты и расход на литр берутся из настроек сайта
  function syncFormulas(xml, S) {
    for (let t = 0; t < 7; t++) {
      const r = 5 + t * SLOTS, w = S.wt[t];
      if (w) {
        xml = setFormula(xml, 'D' + r, `C${r}*${+w.minutes || 0}`);
        S.mains.forEach((c, i) => { xml = setFormula(xml, LET(5 + i) + r, `C${r}*${S.water}*${S.rec[w.id + ':' + c.id] || 0}`); });
      }
      S.extras.forEach((c, i) => { xml = setFormula(xml, LET(36 + i * 2) + r, `${LET(35 + i * 2)}${r}*${+c.per_unit || 0}`); });   // AJ, AL, AN
    }
    return xml;
  }

  function fillDay(xml, m) {
    xml = setCell(xml, 'A5', serial(m.date));
    m.types.forEach(ty => {
      const r = 5 + ty.t * SLOTS;
      for (let mach = 1; mach <= 12; mach++) for (let p = 0; p < 2; p++)
        m.grid[ty.t][mach - 1][p].forEach((w, k) => { xml = setCell(xml, LET(colOf(mach, p)) + (r + k), w); });
      xml = setCell(xml, 'C' + r, ty.n);
      xml = setCell(xml, 'D' + r, ty.time);
      ty.chem.forEach((v, i) => { xml = setCell(xml, LET(5 + i) + r, v); });
      xml = setCell(xml, 'AH' + r, ty.kg);
      for (let i = 0; i < 3; i++) {
        if (ty.exQty[i]) xml = setCell(xml, LET(35 + i * 2) + r, ty.exQty[i]);      // AI, AK, AM
        xml = setCell(xml, LET(36 + i * 2) + r, ty.exTot[i]);                        // AJ, AL, AN
      }
    });
    const T = m.total;
    xml = setCell(xml, 'C40', T.n); xml = setCell(xml, 'D40', T.time);
    T.chem.forEach((v, i) => { xml = setCell(xml, LET(5 + i) + 40, v); });
    T.colSum.forEach((v, i) => { xml = setCell(xml, LET(10 + i) + 40, v); });
    xml = setCell(xml, 'AH40', T.kg);
    for (let i = 0; i < 3; i++) { xml = setCell(xml, LET(35 + i * 2) + 40, T.exQty[i]); xml = setCell(xml, LET(36 + i * 2) + 40, T.exTot[i]); }
    return xml;
  }

  function fillSummary(xml, days) {          // days: {номер: модель}
    const sum = Array(9).fill(0);
    for (let n = 1; n <= 31; n++) {
      const m = days[n], row = 9 + n, T = m && m.total;
      const vals = T ? [T.kg, ...T.chem, ...T.exTot] : Array(9).fill(0);
      xml = setCell(xml, 'C' + row, m ? serial(m.date) : '');
      vals.forEach((v, i) => { xml = setCell(xml, LET(4 + i) + row, v > 0 ? v : ''); sum[i] += v > 0 ? v : 0; });
    }
    sum.forEach((v, i) => { xml = setCell(xml, LET(4 + i) + 41, v); });
    return xml;
  }

  // zip: JSZip с шаблоном; days: {номер дня: модель}; refs как в отчёте
  async function fillWorkbook(zip, days, refs) {
    const S = setup(refs);
    const wb = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const target = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]);
      if (id && tg) target[id[1]] = tg[1].replace(/^\/?(xl\/)?/, 'xl/');
    }
    const path = {};
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const n = /name="([^"]+)"/.exec(m[0]), r = /r:id="([^"]+)"/.exec(m[0]);
      if (n && r) path[n[1].replace(/&amp;/g, '&')] = target[r[1]];
    }
    for (let n = 1; n <= 31; n++) {
      const p = path[String(n)]; if (!p) throw new Error('В шаблоне нет листа ' + n);
      let xml = syncFormulas(await zip.file(p).async('string'), S);
      if (days[n]) xml = fillDay(xml, days[n]);
      zip.file(p, xml);
    }
    const sp = path[SUMMARY]; if (!sp) throw new Error('В шаблоне нет листа «' + SUMMARY + '»');
    zip.file(sp, fillSummary(await zip.file(sp).async('string'), days));
    if (!/fullCalcOnLoad/.test(wb)) zip.file('xl/workbook.xml', wb.replace(/<calcPr\b([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>'));
    return zip;
  }

  return { TYPES, build, html, warnings, summaryRow, fillWorkbook, fmt, esc, serial };
})();
if (typeof module !== 'undefined') module.exports = Blank;
