// Списание остатка: списанное не попадает в запас, но расход за период не меняется.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const sb={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../report-calc.js'),'utf8'),sb);const{calcReport}=sb.module.exports;
const refs={water:55,washTypes:[],recipes:[],chemicals:[{id:1,name:'E',kind:'main',bottle_l:20,bottle_kg:22}]};
const chg=o=>({id:'c'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T05:00:00Z',...o});
const row=r=>r.groups['1_10'].chem.find(c=>c.id===1);
let ok=0,bad=0;const t=(n,f)=>{try{f();ok++;console.log('  ✓',n)}catch(e){bad++;console.log('  ✗',n,'\n    ',e.message)}};
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-9,`${m}: ждали ${b}, получили ${a}`);
const A=chg({id:'A',leftover_l:3,ts:'2026-10-06T05:00:00Z'}),B=chg({id:'B',leftover_l:2});
t('без списания: запас 3 + 2 = 5 л',()=>near(row(calcReport([],[A,B],refs)).stock.l,5,'stock'));
t('списан остаток 3 л: в запасе только 2 л',()=>near(row(calcReport([],[{...A,written_off_at:'2026-10-07T06:00:00Z'},B],refs)).stock.l,2,'stock'));
t('списаны оба: запас 0',()=>near(row(calcReport([],[{...A,written_off_at:'x'},{...B,written_off_at:'x'}],refs)).stock.l,0,'stock'));
t('расход (факт) от списания не меняется',()=>{
  const a=row(calcReport([],[A,B],refs)).actual.l,b=row(calcReport([],[{...A,written_off_at:'x'},{...B,written_off_at:'x'}],refs)).actual.l;near(b,a,'actual');near(a,(20-3)+(20-2),'actual=35');});
t('исправленная запись пересчитывает запас по новым цифрам',()=>near(row(calcReport([],[{...A,leftover_l:1},B],refs)).stock.l,3,'stock'));
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);process.exit(bad?1:0);
