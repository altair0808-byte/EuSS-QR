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
    const allMain = refs.chemicals.filter(c => c.kind === 'main').sort(bySort), allExtra = refs.chemicals.filter(c => c.kind === 'extra').sort(bySort);
    const mains = allMain.slice(0, 5), extras = allExtra.slice(0, 3);
    const skipped = [...allMain.slice(5), ...allExtra.slice(3)].map(c => c.name);
    const typeOf = {}, wt = Array(7).fill(null), rec = {}, other = {};
    refs.washTypes.forEach(w => { const t = TYPES.indexOf(norm(w.name)); if (t >= 0) { typeOf[w.id] = t; wt[t] = w; } else other[w.id] = w.name; });
    refs.recipes.forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
    return { mains, extras, skipped, typeOf, wt, rec, other, water: +refs.water || 55 };
  }

  // Раскладка одного дня: loads уже отфильтрованы по shift_date
  function build(loads, refs, date) {
    const S = setup(refs);
    const grid = TYPES.map(() => Array.from({ length: 12 }, () => [[], []]));
    const agg = TYPES.map(() => ({ n: 0, kg: 0, ex: [0, 0, 0] }));          // всё, что записано, даже если не влезло в 5 строк
    const colAll = Array(24).fill(0);
    const lost = [], unknown = {};
    const machineStats = {};
    for (let machine = 1; machine <= 12; machine++) machineStats[machine] = { n: 0, kg: 0, day: 0, night: 0, dayKg: 0, nightKg: 0, chem: Array(S.mains.length).fill(0), exQty: Array(S.extras.length).fill(0), exTot: Array(S.extras.length).fill(0) };
    loads.slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).forEach(l => {
      const t = S.typeOf[l.wash_type_id], w = +l.weight_kg || 0, part = l.part === 'night' ? 1 : 0;
      const ms = machineStats[+l.machine];
      if (ms) {                                                              // машина считается всегда, даже если вид стирки неизвестен шаблону
        ms.n++; ms.kg += w; ms[part ? 'night' : 'day']++; ms[part ? 'nightKg' : 'dayKg'] += w;
        S.mains.forEach((c, i) => { ms.chem[i] += S.water * (S.rec[l.wash_type_id + ':' + c.id] || 0); });
        Object.entries(l.extras || {}).forEach(([id, q]) => {
          const i = S.extras.findIndex(c => String(c.id) === String(id));
          if (i >= 0) { ms.exQty[i] += +q || 0; ms.exTot[i] += (+q || 0) * (+S.extras[i].per_unit || 0); }
        });
      }
      if (t === undefined) { const n = S.other[l.wash_type_id] || ('вид ' + l.wash_type_id); unknown[n] = (unknown[n] || 0) + 1; return; }
      agg[t].n++; agg[t].kg += w;
      colAll[(l.machine - 1) * 2 + part] += w;
      Object.entries(l.extras || {}).forEach(([id, q]) => { const i = S.extras.findIndex(c => String(c.id) === String(id)); if (i >= 0) agg[t].ex[i] += +q || 0; });
      const cell = grid[t][l.machine - 1][part];
      if (cell.length >= SLOTS) lost.push({ type: S.wt[t].name, machine: l.machine, part: part ? 'ночь' : 'день' });
      else cell.push(w);
    });
    const types = TYPES.map((_, t) => {
      const w = S.wt[t], n = agg[t].n, kg = agg[t].kg;
      const minutes = w ? +w.minutes || 0 : 0;
      const chem = S.mains.map(c => w ? n * S.water * (S.rec[w.id + ':' + c.id] || 0) : 0);
      while (chem.length < 5) chem.push(0);
      const exTot = S.extras.map((c, i) => agg[t].ex[i] * (+c.per_unit || 0));
      while (exTot.length < 3) exTot.push(0);
      return { t, name: w ? w.name : TYPES[t], n, kg, minutes, time: n * minutes, chem, exQty: agg[t].ex, exTot };
    });
    const colSum = colAll.map(r6);
    const total = {
      unknownN: Object.values(unknown).reduce((a, x) => a + x, 0),
      n: types.reduce((a, x) => a + x.n, 0), kg: r6(types.reduce((a, x) => a + x.kg, 0)), time: types.reduce((a, x) => a + x.time, 0),
      chem: [0, 1, 2, 3, 4].map(i => r6(types.reduce((a, x) => a + x.chem[i], 0))),
      exQty: [0, 1, 2].map(i => types.reduce((a, x) => a + x.exQty[i], 0)),
      exTot: [0, 1, 2].map(i => r6(types.reduce((a, x) => a + x.exTot[i], 0))),
      colSum
    };

    // Раздельный расход по двум дозаторам + общий итог.
    const groups = {
      '1_10': { n: 0, kg: 0, chem: Array(S.mains.length).fill(0), exQty: Array(S.extras.length).fill(0), exTot: Array(S.extras.length).fill(0) },
      '11_12': { n: 0, kg: 0, chem: Array(S.mains.length).fill(0), exQty: Array(S.extras.length).fill(0), exTot: Array(S.extras.length).fill(0) }
    };
    loads.forEach(l => {
      const g = +l.machine <= 10 ? groups['1_10'] : groups['11_12'];
      g.n++; g.kg += +l.weight_kg || 0;
      S.mains.forEach((c, i) => { g.chem[i] += S.water * (S.rec[l.wash_type_id + ':' + c.id] || 0); });
      Object.entries(l.extras || {}).forEach(([id, q]) => {
        const i = S.extras.findIndex(c => String(c.id) === String(id));
        if (i >= 0) { g.exQty[i] += +q || 0; g.exTot[i] += (+q || 0) * (+S.extras[i].per_unit || 0); }
      });
    });
    Object.values(machineStats).forEach(g => { g.kg = r6(g.kg); g.chem = g.chem.map(r6); g.exTot = g.exTot.map(r6); });
    Object.values(groups).forEach(g => {
      g.kg = r6(g.kg); g.chem = g.chem.map(r6); g.exTot = g.exTot.map(r6);
    });
    groups.all = {
      n: groups['1_10'].n + groups['11_12'].n,
      kg: r6(groups['1_10'].kg + groups['11_12'].kg),
      chem: groups['1_10'].chem.map((v,i) => r6(v + groups['11_12'].chem[i])),
      exQty: groups['1_10'].exQty.map((v,i) => v + groups['11_12'].exQty[i]),
      exTot: groups['1_10'].exTot.map((v,i) => r6(v + groups['11_12'].exTot[i]))
    };
    return { date, grid, types, total, groups, machineStats, lost, unknown, skipped: S.skipped, mains: S.mains, extras: S.extras };
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
    if (m.lost.length) w.push(`Не поместилось в бланк (больше ${SLOTS} стирок одного вида на машину за смену): ${m.lost.length} шт. В таблице на экране и в итогах они учтены, но в ячейки Excel не поместились: ` + m.lost.map(x => `машина ${x.machine} ${x.part}, ${x.type}`).join('; ') + '.');
    if (m.skipped && m.skipped.length) w.push('В шаблоне Blanc.xlsx места только для 5 основных и 3 дополнительных видов химии. Не попадут в Excel: ' + m.skipped.join(', ') + '.');
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
  const colNum = ref => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const xesc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Вставляет ячейку в нужное место строки; если строки нет, создаёт её. Так шаблон может быть «пустым».
  function insertCell(xml, ref, cellXml) {
    const row = +/\d+$/.exec(ref)[0], col = colNum(ref);
    const rowRe = new RegExp('<row r="' + row + '"([^>]*?)(?:/>|>([\\s\\S]*?)</row>)');
    const m = rowRe.exec(xml);
    if (m) {
      const attrs = m[1].replace(/\/$/, ''), cells = m[2] || '';
      const parts = cells.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
      let at = parts.length;
      for (let i = 0; i < parts.length; i++) if (colNum(/r="([A-Z]+\d+)"/.exec(parts[i])[1]) > col) { at = i; break; }
      parts.splice(at, 0, cellXml);
      return xml.replace(rowRe, () => '<row r="' + row + '"' + attrs + '>' + parts.join('') + '</row>');
    }
    const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
    const next = rows.find(x => +x[1] > row);
    const rowXml = '<row r="' + row + '">' + cellXml + '</row>';
    if (next) return xml.slice(0, next.index) + rowXml + xml.slice(next.index);
    if (/<sheetData\s*\/>/.test(xml)) return xml.replace(/<sheetData\s*\/>/, '<sheetData>' + rowXml + '</sheetData>');
    return xml.replace('</sheetData>', rowXml + '</sheetData>');
  }
  // val: число, '' (очистить) или строка. Стиль и формула существующей ячейки сохраняются.
  function setCell(xml, ref, val) {
    const isStr = typeof val === 'string' && val !== '';
    const m = cellRe(ref).exec(xml);
    if (!m) {
      if (val === '') return xml;
      return insertCell(xml, ref, isStr ? `<c r="${ref}" t="inlineStr"><is><t>${xesc(val)}</t></is></c>` : `<c r="${ref}"><v>${r6(val)}</v></c>`);
    }
    const attrs = m[1].replace(/\s+t="[^"]*"/, '');
    const f = m[2] ? (F_RE.exec(m[2]) || [''])[0] : '';
    const body = val === '' ? { t: ' t="str"', v: '<v></v>' } : isStr ? { t: ' t="inlineStr"', v: '<is><t>' + xesc(val) + '</t></is>' } : { t: '', v: '<v>' + r6(val) + '</v>' };
    return xml.replace(cellRe(ref), () => `<c r="${ref}"${attrs}${body.t}>${isStr ? '' : f}${body.v}</c>`);
  }
  function setFormula(xml, ref, text) {                   // только для обычных (не общих) формул
    const m = cellRe(ref).exec(xml);
    if (!m || !m[2] || !/<f>[\s\S]*?<\/f>/.test(m[2])) return xml;
    return xml.replace(cellRe(ref), () => '<c r="' + ref + '"' + m[1] + '>' + m[2].replace(/<f>[\s\S]*?<\/f>/, '<f>' + text + '</f>') + '</c>');
  }

  // Формулы листа дня: минуты и расход на литр берутся из настроек сайта
  function syncFormulas(xml, S) {
    xml = setFormula(xml, 'C40', 'C5+C10+C15+C20+C25+C30+C35');           // в шаблоне пропущен C25 (синтетика), итог «Количество» занижался
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

  // Сбрасывает случайные числа в ячейках веса (J5:AG39), если они не формулы. Шаблон мог сохраниться с тестовыми данными.
  function clearWeights(xml) {
    return xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (all, col, row, attrs, body) => {
      const c = colNum(col), r = +row;
      if (c < 10 || c > 33 || r < 5 || r > 39 || (body && /<f\b/.test(body))) return all;
      if (!body || !/<v>[^<]+<\/v>|<is>/.test(body)) return all;
      return '<c r="' + col + row + '"' + attrs.replace(/\s+t="[^"]*"/, '') + '/>';
    });
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
    sum.forEach((v, i) => {
      xml = setCell(xml, LET(4 + i) + 41, v);
      xml = setFormula(xml, LET(4 + i) + 41, `SUM(${LET(4 + i)}10:${LET(4 + i)}40)`);   // в шаблоне было 11:40, 1-е число не попадало в итог
    });
    return xml;
  }

  // zip: JSZip с шаблоном; days: {номер дня: модель}; refs как в отчёте
  async function fillWorkbook(zip, days, refs, changes = [], connects = [], used = {}) {
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
      let xml = clearWeights(syncFormulas(await zip.file(p).async('string'), S));
      if (days[n]) xml = fillDay(xml, days[n]);
      zip.file(p, xml);
    }
    const sp = path[SUMMARY]; if (!sp) throw new Error('В шаблоне нет листа «' + SUMMARY + '»');
    zip.file(sp, fillSummary(await zip.file(sp).async('string'), days));

    // Отдельные листы расхода двух дозаторов и общий итог.
    function fillGroupSummary(xml, days, key) {
      const sums = { n: 0, kg: 0, chem: Array(5).fill(0), exTot: Array(3).fill(0) };
      for (let n = 1; n <= 31; n++) {
        const m = days[n], g = m && m.groups && m.groups[key];
        const row = 1 + n;
        xml = setCell(xml, 'A' + row, m ? serial(m.date) : '');
        if (g) {
          xml = setCell(xml, 'B' + row, g.n); xml = setCell(xml, 'C' + row, g.kg);
          for (let i = 0; i < 5; i++) { xml = setCell(xml, LET(4 + i) + row, g.chem[i] || ''); sums.chem[i] += g.chem[i] || 0; }
          for (let i = 0; i < 3; i++) { xml = setCell(xml, LET(9 + i) + row, g.exTot[i] || ''); sums.exTot[i] += g.exTot[i] || 0; }
          sums.n += g.n || 0; sums.kg += g.kg || 0;
        } else {
          xml = setCell(xml, 'B' + row, ''); xml = setCell(xml, 'C' + row, '');
          for (let i = 0; i < 5; i++) xml = setCell(xml, LET(4 + i) + row, '');
          for (let i = 0; i < 3; i++) xml = setCell(xml, LET(9 + i) + row, '');
        }
      }
      xml = setCell(xml, 'B33', sums.n); xml = setCell(xml, 'C33', r6(sums.kg));
      for (let i = 0; i < 5; i++) xml = setCell(xml, LET(4 + i) + '33', r6(sums.chem[i]));
      for (let i = 0; i < 3; i++) xml = setCell(xml, LET(9 + i) + '33', r6(sums.exTot[i]));
      return xml;
    }
    for (const [sheet, key] of [['Расход 1-10','1_10'],['Расход 11-12','11_12'],['Расход общий','all']]) {
      const gp = path[sheet]; if (!gp) throw new Error('В шаблоне нет листа «' + sheet + '»');
      zip.file(gp, fillGroupSummary(await zip.file(gp).async('string'), days, key));
    }

    function fillMachineSheet(xml, days, minMachine, maxMachine) {
      let row = 2;
      const sum = {};
      for (let n = 1; n <= 31; n++) {
        const m = days[n];
        for (let machine = minMachine; machine <= maxMachine; machine++, row++) {
          const g = m && m.machineStats ? m.machineStats[machine] : null;
          xml = setCell(xml, 'A' + row, m ? serial(m.date) : '');
          xml = setCell(xml, 'B' + row, minMachine === 1 ? '1-10' : '11-12');
          xml = setCell(xml, 'C' + row, machine);
          xml = setCell(xml, 'D' + row, g ? g.n : '');
          xml = setCell(xml, 'E' + row, g ? g.kg : '');
          for (let i = 0; i < 5; i++) xml = setCell(xml, LET(6 + i) + row, g && g.chem[i] ? g.chem[i] : '');
          for (let i = 0; i < 3; i++) xml = setCell(xml, LET(11 + i) + row, g && g.exTot[i] ? g.exTot[i] : '');
          if (g) {
            if (!sum[machine]) sum[machine] = {n:0,kg:0,chem:Array(5).fill(0),ex:Array(3).fill(0)};
            sum[machine].n += g.n; sum[machine].kg += g.kg;
            for(let i=0;i<5;i++) sum[machine].chem[i] += g.chem[i] || 0;
            for(let i=0;i<3;i++) sum[machine].ex[i] += g.exTot[i] || 0;
          }
        }
      }
      return xml;
    }
    for (const [sheet, a, b] of [['Машины 1-10',1,10],['Машины 11-12',11,12]]) {
      const gp = path[sheet]; if (!gp) throw new Error('В шаблоне нет листа «' + sheet + '»');
      zip.file(gp, fillMachineSheet(await zip.file(gp).async('string'), days, a, b));
    }

    function fillMachineSummary(xml, days) {
      const sum = {};
      for (let machine=1; machine<=12; machine++) sum[machine]={n:0,kg:0,chem:Array(5).fill(0),ex:Array(3).fill(0)};
      for (let n=1;n<=31;n++) { const m=days[n]; if(!m||!m.machineStats) continue; for(let machine=1;machine<=12;machine++){ const g=m.machineStats[machine]; if(!g) continue; const z=sum[machine]; z.n+=g.n; z.kg+=g.kg; for(let i=0;i<5;i++)z.chem[i]+=g.chem[i]||0; for(let i=0;i<3;i++)z.ex[i]+=g.exTot[i]||0; } }
      for(let machine=1;machine<=12;machine++){ const row=machine+1,z=sum[machine]; xml=setCell(xml,'A'+row,machine<=10?'1-10':'11-12'); xml=setCell(xml,'B'+row,machine); xml=setCell(xml,'C'+row,z.n); xml=setCell(xml,'D'+row,r6(z.kg)); xml=setCell(xml,'E'+row,z.n?r6(z.kg/z.n):''); for(let i=0;i<5;i++)xml=setCell(xml,LET(6+i)+row,r6(z.chem[i])); for(let i=0;i<3;i++)xml=setCell(xml,LET(11+i)+row,r6(z.ex[i])); }
      return xml;
    }
    { const gp=path['Сводка по машинам']; if(!gp) throw new Error('В шаблоне нет листа «Сводка по машинам»'); zip.file(gp, fillMachineSummary(await zip.file(gp).async('string'), days)); }

    function fillChemistryDetail(xml, days, refs, changes, connects, used) {
      const chemicals = (refs.chemicals || []).slice().sort(bySort);
      const water = +refs.water || 55;
      const rec = {}; (refs.recipes || []).forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
      const groups = ['1_10','11_12'];
      // Даты берём и из замен/подключений: если в какой-то день стирок не было, а химию меняли, этот день не должен пропасть
      const models = {};
      Object.values(days).forEach(m => { models[m.date] = m; });
      (changes || []).concat(connects || []).forEach(x => { if (x.shift_date && !models[x.shift_date]) models[x.shift_date] = build([], refs, x.shift_date); });
      const dateList = Object.keys(models).sort();
      xml = setCell(xml, 'E1', 'Теория'); xml = setCell(xml, 'F1', 'Факт'); xml = setCell(xml, 'G1', 'Разница'); xml = setCell(xml, 'K1', 'Ед.'); ['Теория, шт','Факт, шт','Теория, л','Факт, л','Теория, кг','Факт, кг'].forEach((t, i) => { xml = setCell(xml, LET(12 + i) + '1', t); });
      let row = 2;
      const density = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? (+c.bottle_kg / +c.bottle_l) : null;
      const toL = (c, v, unit) => unit === 'l' ? v : (density(c) ? v / density(c) : null);
      const toKg = (c, v, unit) => unit === 'kg' ? v : (density(c) ? v * density(c) : null);
      for (const date of dateList) {
        const m = models[date];
        for (const group of groups) {
          for (const c of chemicals) {
            const theoryMain = c.kind === 'main' ? (m.groups[group].chem[chemicals.filter(x=>x.kind==='main').findIndex(x=>x.id===c.id)] || 0) / 1000 : 0;
            const exIndex = c.kind === 'extra' ? m.extras.findIndex(x=>x.id===c.id) : -1;
            const theoryExtraRaw = exIndex >= 0 ? (m.groups[group].exTot[exIndex] || 0) : 0;
            const theoryUnit = c.kind === 'extra' && c.per_unit_unit === 'g' ? 'kg' : 'l';
            const theory = c.kind === 'main' ? theoryMain : (theoryExtraRaw / 1000);
            const prim = c.kind === 'extra' ? null : (+c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null));
            const mine = (changes || []).filter(x => x.shift_date === date && x.chemical_id === c.id && (x.machine_group || '1_10') === group);
            let actual = 0, noLeft = 0;
            mine.forEach(x => {
              let left = prim === 'l' ? (x.leftover_l != null ? +x.leftover_l : x.leftover_kg != null ? toL(c,+x.leftover_kg,'kg') : null) : (x.leftover_kg != null ? +x.leftover_kg : x.leftover_l != null ? toKg(c,+x.leftover_l,'l') : null);
              const size = prim === 'l' ? +c.bottle_l : +c.bottle_kg;
              if (left == null || !isFinite(left)) { noLeft++; left = 0; }
              actual += used[x.id] != null ? used[x.id] : size - Math.max(0, Math.min(size, left));   // used: учтён подключённый остаток (см. chemUsed)
            });
            const actualOut = prim ? r6(actual) : '';
            let theoryPrim = theory;
            if (prim && theoryUnit !== prim) { const d = density(c); theoryPrim = d ? (theoryUnit === 'l' ? theory * d : theory / d) : null; }
            const theoryOut = theoryPrim == null ? '' : r6(theoryPrim);
            const diff = prim && theoryOut ? r6(actualOut-theoryOut) : '';
            const pct = prim && theoryOut ? r6((actualOut-theoryOut)/theoryOut*100) : '';
            xml=setCell(xml,'A'+row,serial(date)); xml=setCell(xml,'B'+row,group); xml=setCell(xml,'C'+row,c.name); xml=setCell(xml,'D'+row,c.kind==='main'?'основная':'дополнительная');
            xml=setCell(xml,'E'+row,theoryOut); xml=setCell(xml,'F'+row,actualOut); xml=setCell(xml,'G'+row,diff); xml=setCell(xml,'H'+row,pct); xml=setCell(xml,'I'+row,mine.length||''); xml=setCell(xml,'J'+row,noLeft||''); xml=setCell(xml,'K'+row,(prim||theoryUnit)==='l'?'л':'кг');
            // те же значения сразу в штуках, литрах и кг (пересчёт по размеру бутыли из настроек)
            const trio = (v, u) => {
              if (v === '' || v == null) return ['', '', ''];
              const d = density(c), size1 = prim === 'l' ? +c.bottle_l : prim === 'kg' ? +c.bottle_kg : 0;
              const l = u === 'l' ? v : (d ? v / d : ''), kg = u === 'kg' ? v : (d ? v * d : '');
              return [prim && size1 > 0 ? r6(v / size1) : '', l === '' ? '' : r6(l), kg === '' ? '' : r6(kg)];
            };
            const tu = prim || theoryUnit, tt = trio(theoryOut, tu), aa = prim ? trio(actualOut, tu) : ['', '', ''];
            [tt[0], aa[0], tt[1], aa[1], tt[2], aa[2]].forEach((v, i) => { xml = setCell(xml, LET(12 + i) + row, v); });
            row++;
          }
        }
      }
      return xml;
    }
    { const gp=path['Химия по дозаторам']; if(!gp) throw new Error('В шаблоне нет листа «Химия по дозаторам»'); zip.file(gp, fillChemistryDetail(await zip.file(gp).async('string'), days, refs, changes, connects, used)); }
    if (!/fullCalcOnLoad/.test(wb)) zip.file('xl/workbook.xml', wb.replace(/<calcPr\b([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>'));
    return zip;
  }

  return { TYPES, build, html, warnings, summaryRow, fillWorkbook, fmt, esc, serial };
})();
if (typeof module !== 'undefined') module.exports = Blank;
