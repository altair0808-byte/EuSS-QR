// Теория и факт расхода химии. Чистая функция, без обращения к базе.
// loads: report_loads; changes: report_changes;
// refs: { water, washTypes, chemicals, recipes }
function calcReport(loads, changes, refs) {
  const { water, washTypes, chemicals, recipes } = refs;
  const amt = {};                      // chemical_id -> теория: л (main, мл/1000) или л/кг (extra)
  const byWash = {}, byPart = { day: 0, night: 0 }, rec = {}, extra = {};
  recipes.forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
  chemicals.filter(c => c.kind === 'extra').forEach(c => extra[c.id] = c);
  const mains = chemicals.filter(c => c.kind === 'main');
  let kg = 0;
  loads.forEach(l => {
    const w = byWash[l.wash_type_id] || (byWash[l.wash_type_id] = { n: 0, kg: 0 });
    w.n++; w.kg += +l.weight_kg || 0; kg += +l.weight_kg || 0;
    if (l.part in byPart) byPart[l.part]++;
    mains.forEach(c => { amt[c.id] = (amt[c.id] || 0) + water * (rec[l.wash_type_id + ':' + c.id] || 0) / 1000; });
    Object.entries(l.extras || {}).forEach(([id, q]) => {
      const c = extra[id]; if (!c) return;
      amt[id] = (amt[id] || 0) + (+q || 0) * (+c.per_unit || 0) / 1000;
    });
  });

  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null; // кг на литр
  const conv = (c, v, from, to) => { if (from === to) return v; const d = dens(c); return d ? (from === 'l' ? v * d : v / d) : null; };
  const both = (c, v, u) => ({ l: conv(c, v, u, 'l'), kg: conv(c, v, u, 'kg') });

  const chem = chemicals.map(c => {
    const prim = +c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null);   // в чём считаем разницу
    const size = prim === 'l' ? +c.bottle_l : prim === 'kg' ? +c.bottle_kg : null;
    const tu = (c.kind === 'extra' && c.per_unit_unit === 'g') ? 'kg' : 'l';
    const theory = both(c, amt[c.id] || 0, tu);
    const mine = changes.filter(x => x.chemical_id === c.id);
    let actual = null, noLeft = 0, diff = null, pct = null, theoryPrim = null;
    if (prim) {
      let sum = 0;
      mine.forEach(x => {
        let left = prim === 'l'
          ? (x.leftover_l != null ? +x.leftover_l : x.leftover_kg != null ? conv(c, +x.leftover_kg, 'kg', 'l') : null)
          : (x.leftover_kg != null ? +x.leftover_kg : x.leftover_l != null ? conv(c, +x.leftover_l, 'l', 'kg') : null);
        if (left == null) { noLeft++; left = 0; }
        sum += size - Math.max(0, Math.min(size, left));
      });
      actual = both(c, sum, prim);
      theoryPrim = prim === 'l' ? theory.l : theory.kg;
      if (theoryPrim != null) {
        diff = sum - theoryPrim;
        pct = theoryPrim > 0 ? diff / theoryPrim * 100 : null;
      }
    }
    return { id: c.id, name: c.name, kind: c.kind, prim, size, theory, actual, changes: mine.length, noLeft, diff, pct };
  });
  return { total: loads.length, kg, byPart, byWash, chem };
}
if (typeof module !== 'undefined') module.exports = { calcReport };
