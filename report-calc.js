// Теория и факт расхода химии с раздельными дозаторами.
// Группа 1_10 = машины 1-10, группа 11_12 = машины 11-12.
// connects: подключения остатка (report_connects). Они уменьшают факт: подключённый остаток уже был посчитан
// как «не израсходованный» при замене, а следующая замена посчитает всю бутыль целиком.
function calcReport(loads, changes, refs, connects) {
  connects = connects || [];
  const { water, washTypes, chemicals, recipes } = refs;
  const GROUPS = ['1_10','11_12'];
  const groupOfMachine = m => (+m <= 10 ? '1_10' : '11_12');
  const rec = {};
  recipes.forEach(r => rec[r.wash_type_id + ':' + r.chemical_id] = +r.ml_per_l || 0);

  const makeGroup = () => ({ total:0, kg:0, byWash:{}, chem:{} });
  const groups = { '1_10': makeGroup(), '11_12': makeGroup(), all: makeGroup() };
  const byPart = { day:0, night:0 };
  let kg = 0;

  function addLoad(group, l) {
    const w = group.byWash[l.wash_type_id] || (group.byWash[l.wash_type_id] = { n:0, kg:0 });
    w.n++; w.kg += +l.weight_kg || 0;
    group.total++; group.kg += +l.weight_kg || 0;
  }
  function addTheory(group, l) {
    chemicals.forEach(c => {
      if (c.kind === 'main') group.chem[c.id] = (group.chem[c.id] || 0) + water * (rec[l.wash_type_id + ':' + c.id] || 0) / 1000;
    });
    Object.entries(l.extras || {}).forEach(([id,q]) => {
      const c = chemicals.find(x => String(x.id) === String(id) && x.kind === 'extra');
      if (!c) return;
      const unit = c.per_unit_unit === 'g' ? 1000 : 1000; // theory is stored as l-equivalent / kg-equivalent below
      group.chem[c.id] = (group.chem[c.id] || 0) + (+q || 0) * (+c.per_unit || 0) / unit;
    });
  }

  loads.forEach(l => {
    const g = groupOfMachine(l.machine);
    addLoad(groups[g], l);
    addTheory(groups[g], l);
    addLoad(groups.all, l);
    addTheory(groups.all, l);
    if (l.part in byPart) byPart[l.part]++;
    kg += +l.weight_kg || 0;
  });

  const dens = c => (+c.bottle_l > 0 && +c.bottle_kg > 0) ? +c.bottle_kg / +c.bottle_l : null;
  const conv = (c,v,from,to) => {
    if (from === to) return v;
    const d = dens(c); if (!d) return null;
    return from === 'l' ? v*d : v/d;
  };
  const both = (c,v,u) => ({ l:conv(c,v,u,'l'), kg:conv(c,v,u,'kg') });

  function chemRows(groupKey) {
    return chemicals.map(c => {
      const prim = c.kind === 'extra' ? null : (+c.bottle_l > 0 ? 'l' : (+c.bottle_kg > 0 ? 'kg' : null)); // замены бутылей отмечаются только для основной химии
      const size = prim === 'l' ? +c.bottle_l : prim === 'kg' ? +c.bottle_kg : null;
      const tu = c.kind === 'extra' && c.per_unit_unit === 'g' ? 'kg' : 'l';
      const theory = both(c, groups[groupKey].chem[c.id] || 0, tu);
      const mine = changes.filter(x => x.chemical_id === c.id && (groupKey === 'all' || (x.machine_group || '1_10') === groupKey));
      let actual=null, noLeft=0, diff=null, pct=null, stock=null, connected=null, adj=0;
      const leftOf = x => prim==='l'
        ? (x.leftover_l != null ? +x.leftover_l : x.leftover_kg != null ? conv(c,+x.leftover_kg,'kg','l') : null)
        : (x.leftover_kg != null ? +x.leftover_kg : x.leftover_l != null ? conv(c,+x.leftover_l,'l','kg') : null);
      if (prim) {
        let sum=0, st=0;
        mine.forEach(x=>{
          let left = leftOf(x);
          if(left==null){noLeft++;left=0;}
          sum += size - Math.max(0,Math.min(size,left));
          if(!x.connect_id && left>0) st += Math.min(size,left);          // остаток лежит в запасе, ещё не подключён
        });
        let conn=0;
        connects.filter(x => +x.chemical_id === +c.id && (groupKey === 'all' || (x.machine_group || '1_10') === groupKey)).forEach(x=>{
          const a = prim==='l'
            ? (x.amount_l != null ? +x.amount_l : x.amount_kg != null ? conv(c,+x.amount_kg,'kg','l') : null)
            : (x.amount_kg != null ? +x.amount_kg : x.amount_l != null ? conv(c,+x.amount_l,'l','kg') : null);
          if(a==null||!(a>0))return;
          conn += a;
          adj += Math.ceil(a/size - 1e-9)*size - a;                        // «недолив»: ёмкость минус то, что реально подключили
        });
        sum -= adj;
        actual=both(c,sum,prim);
        stock=both(c,st,prim); connected=both(c,conn,prim);
        const theoryPrim=prim==='l'?theory.l:theory.kg;
        if(theoryPrim!=null){diff=sum-theoryPrim;pct=theoryPrim>0?diff/theoryPrim*100:null;}
      }
      return {id:c.id,name:c.name,kind:c.kind,prim,size,theory,actual,changes:mine.length,noLeft,diff,pct,stock,connected,adj};
    });
  }

  groups['1_10'].chemRows = chemRows; // internal marker
  return {
    total: loads.length, kg, byPart,
    groups: {
      '1_10': { total:groups['1_10'].total, kg:groups['1_10'].kg, byWash:groups['1_10'].byWash, chem:chemRows('1_10') },
      '11_12': { total:groups['11_12'].total, kg:groups['11_12'].kg, byWash:groups['11_12'].byWash, chem:chemRows('11_12') },
      all: { total:groups.all.total, kg:groups.all.kg, byWash:groups.all.byWash, chem:chemRows('all') }
    },
    byWash: groups.all.byWash
  };
}
if (typeof module !== 'undefined') module.exports = { calcReport };
