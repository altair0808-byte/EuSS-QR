// Минимальный писатель .xlsx без внешних библиотек (работает в браузере и в node, тестируется без сети).
// Умеет: листы, стили (шрифт, заливка, рамки, выравнивание, числовой формат), объединение ячеек, ширину колонок, высоту строк,
// закрепление областей, автофильтр, цвет вкладки, печать «по ширине страницы». Числа пишутся числами, текст — текстом.
//
//   const wb = new XlsxWriter.Workbook({ title: 'Закрытие', creator: 'EuSS' });
//   const st = wb.style({ font: { b: 1, color: 'FFFFFF', sz: 12 }, fill: '2AA3B5', align: { h: 'center', v: 'center', wrap: 1 }, border: 'thin', numFmt: '0.00' });
//   const ws = wb.addSheet('Итоги', { tab: '2AA3B5', widths: [30, 12, 12], freeze: { row: 4, col: 1 }, landscape: true, grid: false });
//   ws.set(1, 1, 'Текст', st); ws.merge(1, 1, 1, 3); ws.height(1, 28);
//   const bytes = wb.toBytes();          // Uint8Array
//   wb.download('файл.xlsx');            // только в браузере
const XlsxWriter = (() => {
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const ref = (r, c) => colName(c) + r;

  // ---------- zip (без сжатия) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {                                    // files: [{name, data: Uint8Array}]
    const parts = [], cen = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const lh = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0)]);
      parts.push(lh, name, f.data);
      cen.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += lh.length + name.length + sz;
    });
    let cl = 0; cen.forEach(p => cl += p.length);
    const end = new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cl), ...u32(off), 0, 0]);
    const all = [...parts, ...cen, end]; let total = 0; all.forEach(p => total += p.length);
    const out = new Uint8Array(total); let o = 0; all.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  // ---------- книга ----------
  class Workbook {
    constructor(o = {}) {
      this.o = o; this.sheets = [];
      this.fonts = [{ name: 'Calibri', sz: 11 }]; this.fills = ['none', 'gray125']; this.borders = ['']; this.numFmts = []; this.xfs = [{ font: 0, fill: 0, border: 0, numFmt: 0, align: null }];
      this.cache = new Map();
    }
    _idx(arr, v) { const k = JSON.stringify(v); let i = arr.findIndex(x => JSON.stringify(x) === k); if (i < 0) { arr.push(v); i = arr.length - 1; } return i; }
    // стиль: font {b,i,sz,color,name}, fill 'RRGGBB', border 'thin' | 'hair' | {l,r,t,b: 'thin'|'medium'|'hair'|{s,color}}, align {h,v,wrap,indent}, numFmt
    style(s = {}) {
      const key = JSON.stringify(s); if (this.cache.has(key)) return this.cache.get(key);
      const f = s.font ? { name: s.font.name || 'Calibri', sz: s.font.sz || 11, b: s.font.b ? 1 : 0, i: s.font.i ? 1 : 0, color: s.font.color || null } : 0;
      const font = f ? this._idx(this.fonts, f) : 0;
      const fill = s.fill ? this._idx(this.fills, s.fill) : 0;
      let border = 0;
      if (s.border) {
        const bc = typeof s.border === 'string' ? { l: s.border, r: s.border, t: s.border, b: s.border } : s.border;
        const norm = v => v ? (typeof v === 'string' ? { s: v, color: 'C9D6DA' } : { s: v.s || 'thin', color: v.color || 'C9D6DA' }) : null;
        border = this._idx(this.borders, JSON.stringify({ l: norm(bc.l), r: norm(bc.r), t: norm(bc.t), b: norm(bc.b) }));
      }
      let numFmt = 0;
      if (s.numFmt) { const builtin = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 }; numFmt = builtin[s.numFmt] != null ? builtin[s.numFmt] : 164 + this._idx(this.numFmts, s.numFmt); }
      const xf = { font, fill, border, numFmt, align: s.align || null };
      const id = this._idx(this.xfs, xf); this.cache.set(key, id); return id;
    }
    addSheet(name, o = {}) { const ws = new Sheet(this, String(name).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31), o); this.sheets.push(ws); return ws; }

    _stylesXml() {
      const fonts = this.fonts.map(f => `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}<sz val="${f.sz}"/><color rgb="FF${f.color || '000000'}"/><name val="${esc(f.name)}"/><family val="2"/></font>`).join('');
      const fills = this.fills.map(f => f === 'none' || f === 'gray125' ? `<fill><patternFill patternType="${f}"/></fill>` : `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
      const side = (n, v) => v ? `<${n} style="${v.s}"><color rgb="FF${v.color}"/></${n}>` : `<${n}/>`;
      const borders = this.borders.map(b => { if (!b) return '<border><left/><right/><top/><bottom/><diagonal/></border>'; const o = JSON.parse(b); return `<border>${side('left', o.l)}${side('right', o.r)}${side('top', o.t)}${side('bottom', o.b)}<diagonal/></border>`; }).join('');
      const nf = this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '';
      const xfs = this.xfs.map(x => {
        const a = x.align ? `<alignment${x.align.h ? ` horizontal="${x.align.h}"` : ''}${x.align.v ? ` vertical="${x.align.v}"` : ''}${x.align.wrap ? ' wrapText="1"' : ''}${x.align.indent ? ` indent="${x.align.indent}"` : ''}/>` : '';
        const at = `numFmtId="${x.numFmt}" fontId="${x.font}" fillId="${x.fill}" borderId="${x.border}" xfId="0"${x.numFmt ? ' applyNumberFormat="1"' : ''}${x.font ? ' applyFont="1"' : ''}${x.fill ? ' applyFill="1"' : ''}${x.border ? ' applyBorder="1"' : ''}${x.align ? ' applyAlignment="1"' : ''}`;
        return a ? `<xf ${at}>${a}</xf>` : `<xf ${at}/>`;
      }).join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf}<fonts count="${this.fonts.length}">${fonts}</fonts><fills count="${this.fills.length}">${fills}</fills><borders count="${this.borders.length}">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    }
    toBytes() {
      const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
      const files = [];
      const add = (name, text) => files.push({ name, data: enc.encode(text) });
      add('[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        this.sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
      add('_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
      add('docProps/core.xml', X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(this.o.title || '')}</dc:title><dc:creator>${esc(this.o.creator || 'EuSS')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
      add('docProps/app.xml', X + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EuSS</Application></Properties>');
      add('xl/workbook.xml', X + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews><sheets>${this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
      add('xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + this.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${this.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      add('xl/styles.xml', this._stylesXml());
      this.sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, s._xml(i === 0)));
      return zip(files);
    }
    toBlob() { return new Blob([this.toBytes()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
    download(filename) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(this.toBlob()); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
  }

  class Sheet {
    constructor(wb, name, o) { this.wb = wb; this.name = name; this.o = o; this.cells = new Map(); this.merges = []; this.heights = {}; this.maxR = 1; this.maxC = 1; }
    set(r, c, v, style) { this.cells.set(r + ':' + c, { r, c, v, s: style || 0 }); if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c; return this; }
    // закрасить/обвести диапазон тем же стилем (для объединённых ячеек и баннеров)
    fill(r1, c1, r2, c2, style) { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!this.cells.has(r + ':' + c)) this.set(r, c, null, style); return this; }
    merge(r1, c1, r2, c2) { this.merges.push([r1, c1, r2, c2]); return this; }
    height(r, pts) { this.heights[r] = pts; return this; }
    _xml(first) {
      const o = this.o, rows = {};
      this.cells.forEach(x => (rows[x.r] = rows[x.r] || []).push(x));
      const body = Object.keys(rows).map(Number).sort((a, b) => a - b).map(r => {
        const cs = rows[r].sort((a, b) => a.c - b.c).map(x => {
          const rf = ref(x.r, x.c), s = x.s ? ` s="${x.s}"` : '';
          if (x.v == null || x.v === '') return `<c r="${rf}"${s}/>`;
          if (typeof x.v === 'number') return isFinite(x.v) ? `<c r="${rf}"${s}><v>${x.v}</v></c>` : `<c r="${rf}"${s}/>`;
          return `<c r="${rf}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(x.v)}</t></is></c>`;
        }).join('');
        const h = this.heights[r] ? ` ht="${this.heights[r]}" customHeight="1"` : '';
        return `<row r="${r}"${h}>${cs}</row>`;
      }).join('');
      const fr = o.freeze ? `<pane${o.freeze.col ? ` xSplit="${o.freeze.col}"` : ''}${o.freeze.row ? ` ySplit="${o.freeze.row}"` : ''} topLeftCell="${ref((o.freeze.row || 0) + 1, (o.freeze.col || 0) + 1)}" activePane="${o.freeze.row && o.freeze.col ? 'bottomRight' : o.freeze.row ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
      const cols = o.widths ? `<cols>${o.widths.map((w, i) => w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '').join('')}</cols>` : '';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheetPr>${o.tab ? `<tabColor rgb="FF${o.tab}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${ref(this.maxR, this.maxC)}"/>` +
        `<sheetViews><sheetView${first ? ' tabSelected="1"' : ''}${o.grid === false ? ' showGridLines="0"' : ''} workbookViewId="0"${o.zoom ? ` zoomScale="${o.zoom}"` : ''}>${fr}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}` +
        `<sheetData>${body}</sheetData>${o.filter ? `<autoFilter ref="${o.filter}"/>` : ''}` +
        (this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${ref(m[0], m[1])}:${ref(m[2], m[3])}"/>`).join('')}</mergeCells>` : '') +
        `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${o.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
        `<headerFooter><oddFooter>&amp;L${esc(this.wb.o.footer || 'EuSS')}&amp;RСтр. &amp;P из &amp;N</oddFooter></headerFooter></worksheet>`;
    }
  }
  return { Workbook, colName, ref, crc32, zip };
})();
if (typeof module !== 'undefined') module.exports = XlsxWriter;
