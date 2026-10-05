// Расчёт теоретического расхода. Чистая функция, без обращения к базе.
// loads: строки из report_loads; refs: { water, washTypes, chemicals, recipes }
function calcReport(loads, refs) {
  const { water, washTypes, chemicals, recipes } = refs;
  const ml = {};                       // chemical_id -> мл (main) или единицы*расход (extra)
  const units = {};                    // для extra: сколько единиц списано
  const byWash = {};                   // wash_type_id -> { n, kg }
  const byPart = { day: 0, night: 0 };
  const rec = {};
  recipes.forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);
  const mains = chemicals.filter(c => c.kind === 'main');
  const extra = {}; chemicals.filter(c => c.kind === 'extra').forEach(c => extra[c.id] = c);
  let kg = 0;
  loads.forEach(l => {
    const w = byWash[l.wash_type_id] || (byWash[l.wash_type_id] = { n: 0, kg: 0 });
    w.n++; w.kg += +l.weight_kg || 0; kg += +l.weight_kg || 0;
    if (l.part in byPart) byPart[l.part]++;
    mains.forEach(c => { ml[c.id] = (ml[c.id] || 0) + water * (rec[l.wash_type_id + ':' + c.id] || 0); });
    Object.entries(l.extras || {}).forEach(([id, q]) => {
      const c = extra[id]; if (!c) return;
      units[id] = (units[id] || 0) + (+q || 0);
      ml[id] = (ml[id] || 0) + (+q || 0) * (+c.per_unit || 0);
    });
  });
  const chem = chemicals.map(c => {
    const amount = ml[c.id] || 0;
    return c.kind === 'main'
      ? { id: c.id, name: c.name, kind: 'main', liters: amount / 1000, bottles: c.bottle_l ? amount / 1000 / c.bottle_l : null }
      : { id: c.id, name: c.name, kind: 'extra', units: units[c.id] || 0, amount };
  });
  return { total: loads.length, kg, byPart, byWash, chem };
}
if (typeof module !== 'undefined') module.exports = { calcReport };
