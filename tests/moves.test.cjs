const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const sb={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../report-calc.js'),'utf8'),sb);const{calcReport,chemUsed}=sb.module.exports;
const refs={water:55,washTypes:[],recipes:[],chemicals:[{id:1,name:'E',kind:'main',bottle_l:20,bottle_kg:22}]};
const chg=o=>({id:'c'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T05:00:00Z',...o}),mv=o=>({id:'m'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T02:00:00Z',...o});
const row=(r,g)=>r.groups[g].chem.find(c=>c.id===1),near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-9,`${m}: ждали ${b}, получили ${a}`);let ok=0,bad=0;const t=(n,f)=>{try{f();ok++;console.log('  ✓',n)}catch(e){bad++;console.log('  ✗',n,'\n    ',e.message)}};
// сценарий: по 3 л забрали из дозаторов 1-10 и 11-12, 6 л залили в 1-10
const M=[mv({machine_group:'1_10',kind:'take',amount_l:3,ts:'2026-10-07T01:00:00Z'}),mv({machine_group:'11_12',kind:'take',amount_l:3,ts:'2026-10-07T01:05:00Z'}),mv({machine_group:'1_10',kind:'pour',amount_l:6,ts:'2026-10-07T01:10:00Z'})];
const C=[chg({id:'A',machine_group:'1_10',leftover_l:4}),chg({id:'B',machine_group:'11_12',leftover_l:2})];
const r=calcReport([],C,refs,[],null,M);
t('1-10: бутыль 20 − 3 + 6 = 23 л, остаток 4 → расход 19 л',()=>near(row(r,'1_10').actual.l,19,'1_10'));
t('11-12: 20 − 3 = 17 л, остаток 2 → расход 15 л',()=>near(row(r,'11_12').actual.l,15,'11_12'));
t('забрано по 3 л в каждом, залито 6 л только в 1-10',()=>{near(row(r,'1_10').took.l,3,'t1');near(row(r,'11_12').took.l,3,'t2');near(row(r,'1_10').put.l,6,'p1');near(row(r,'11_12').put.l,0,'p2')});
t('запас: 3 + 3 − 6 = 0 (+ остатки замен 4 и 2 = 6)',()=>near(row(r,'all').stock.l,6,'stock'));
t('без перемещений: те же замены дают 16 и 18 (контроль)',()=>{const q=calcReport([],C,refs,[]);near(row(q,'1_10').actual.l,16,'a');near(row(q,'11_12').actual.l,18,'b')});
t('перемещения только забрали (без заливки): запас вырос, расход не вырос',()=>{const q=calcReport([],[chg({id:'A',leftover_l:4})],refs,[],null,[mv({kind:'take',amount_l:3})]);near(row(q,'1_10').actual.l,13,'used');near(row(q,'all').stock.l,7,'stock')});
t('моя заливка из запаса в другой дозатор не трогает соседний дозатор',()=>near(chemUsed(refs,[chg({id:'X',machine_group:'11_12',leftover_l:1})],[],[mv({machine_group:'1_10',kind:'pour',amount_l:5})]).used.X,19,'X'));
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);process.exit(bad?1:0);
