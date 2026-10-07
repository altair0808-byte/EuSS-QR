// «Сколько реально было в дозаторе»: ручной уровень (stage12.sql) заменяет полную бутыль в расчёте расхода,
// а на панели дальше вычитает стирки сам.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const sb={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../report-calc.js'),'utf8'),sb);const{calcReport,chemUsed}=sb.module.exports;
const refs={water:55,washTypes:[],recipes:[],chemicals:[{id:1,name:'E',kind:'main',bottle_l:20,bottle_kg:22}]};
const chg=o=>({id:'c'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T05:00:00Z',...o});
const lvl=o=>({id:'l'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T01:00:00Z',...o});
const mv=o=>({id:'m'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T02:00:00Z',...o});
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-9,`${m}: ждали ${b}, получили ${a}`);let ok=0,bad=0;const t=(n,f)=>{try{f();ok++;console.log('  ✓',n)}catch(e){bad++;console.log('  ✗',n,'\n    ',e.message)}};
const A=chg({id:'A',ts:'2026-10-07T00:00:00Z',leftover_l:4}), B=chg({id:'B',ts:'2026-10-07T10:00:00Z',leftover_l:2});
t('без уточнения: полная бутыль 20 − остаток 2 = 18 л (контроль)',()=>near(chemUsed(refs,[A,B],[]).used.B,18,'B'));
t('в дозаторе реально было 12 л: расход 12 − 2 = 10 л',()=>near(chemUsed(refs,[A,B],[],[],[lvl({ts:'2026-10-07T00:00:00Z',amount_l:12})]).used.B,10,'B'));
t('уровень в кг: 11 кг (при 20 л = 22 кг это 10 л) → расход 8 л',()=>near(chemUsed(refs,[A,B],[],[],[lvl({amount_kg:11})]).used.B,8,'B'));
t('уровень 0 — это ноль, а не «полная бутыль»',()=>near(chemUsed(refs,[A,B],[],[],[lvl({amount_l:0})]).used.B,0,'B'));
t('уровень действует на одну бутыль: следующая замена снова считается полной',()=>{
  const C=chg({id:'C',ts:'2026-10-07T20:00:00Z',leftover_l:5});const u=chemUsed(refs,[A,B,C],[],[],[lvl({amount_l:12})]).used;near(u.B,10,'B');near(u.C,15,'C')});
t('забрали 3 л после уточнения: 12 − 3 − 2 = 7 л',()=>near(chemUsed(refs,[A,B],[],[mv({kind:'take',amount_l:3})],[lvl({amount_l:12})]).used.B,7,'B'));
t('другой дозатор уточнение не трогает',()=>{const u=chemUsed(refs,[A,B],[],[],[lvl({machine_group:'11_12',amount_l:12})]).used;near(u.B,18,'B')});
t('более позднее уточнение заменяет подключённый остаток',()=>{
  const K={id:'K',chemical_id:1,machine_group:'1_10',ts:'2026-10-07T00:30:00Z',amount_l:5};near(chemUsed(refs,[A,B],[K],[],[lvl({ts:'2026-10-07T01:00:00Z',amount_l:8})]).used.B,6,'B')});
t('отчёт: факт = 12 − 2 = 10 л вместо 18',()=>{
  const r=calcReport([],[A,B],refs,[],{changes:[A,B],connects:[],levels:[lvl({ts:'2026-10-07T00:00:00Z',amount_l:12})]});
  near(r.groups.all.chem.find(c=>c.id===1).actual.l,16+10,'all')});
t('уточнение в хронологии после замены: не мешает, если оно раньше предыдущей замены',()=>{
  // уточнение за 2 часа до замены A: A потратит 12−4=8, а B считается от полной бутыли
  const u=chemUsed(refs,[A,B],[],[],[lvl({ts:'2026-10-06T22:00:00Z',amount_l:12})]).used;near(u.A,8,'A');near(u.B,18,'B')});
// --- панель «Хранилище»: уровень = реальное количество минус стирки после выбранного момента ---
const T0='2026-10-07T01:00:00Z',ts=m=>new Date(Date.parse(T0)+m*60e3).toISOString();
const chems=[{id:1,name:'E',kind:'main',bottle_l:20,bottle_kg:22}];
const loads=[...Array(10)].map((_,i)=>({ts:ts(10+i*5),machine:1,wash_type_id:1,shift_date:'2026-10-07'}));
const mkSb=data=>({rpc:fn=>{const r={then:res=>res({data:data[fn]||[],error:null}),range:()=>r};return r}});
const base={report_changes:[{id:'A',ts:'2026-10-06T10:00:00Z',shift_date:'2026-10-06',chemical_id:1,machine_group:'1_10',leftover_l:2}],report_loads:loads};
async function panel(extra){
  const ctx={sb:mkSb({...base,...extra}),document:{head:{insertAdjacentHTML(){}}},requestAnimationFrame(){},setInterval(){return 0},clearInterval(){},Date,Math,String,Promise,Object,Array,JSON};
  const el={querySelector:()=>null,querySelectorAll:()=>[],isConnected:true};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../storage-anim.js'),'utf8')+';this.SA=StorageAnim;',ctx);
  await ctx.SA.mount(el,{refs:{water:55,chemicals:chems,recipes:[{wash_type_id:1,chemical_id:1,ml_per_l:3}]},date:'2026-10-07',st:6,tz:5,can:true});
  return el.innerHTML.replace(/<[^>]+>/g,'|').replace(/\|+/g,'|');
}
(async()=>{
  const a=await panel({});
  t('без уточнения: 20 − 10 стирок × 0,165 = 18,35 л (в сотых)',()=>assert.ok(a.includes('18,35 л'),a.slice(0,400)));
  const b=await panel({report_levels:[{id:'L',ts:'2026-10-06T10:00:00Z',shift_date:'2026-10-06',chemical_id:1,machine_group:'1_10',amount_l:12,amount_kg:13.2}]});
  t('в дозаторе было 12 л: 12 − 1,65 = 10,35 л, стирки вычтены сами',()=>assert.ok(b.includes('10,35 л · 11,39 кг'),b.slice(0,500)));
  t('кнопка «Указать реальный уровень» есть',()=>assert.ok(b.includes('Указать реальный уровень')));
  const c=await panel({report_levels:[{id:'L',ts:'2026-10-06T10:00:00Z',shift_date:'2026-10-06',chemical_id:1,machine_group:'11_12',amount_l:5}]});
  t('уровень второго дозатора первый не трогает',()=>assert.ok(c.includes('18,35 л')));
  console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);process.exit(bad?1:0);
})();
//: ${ok} прошло, ${bad} не прошло`);process.exit(bad?1:0);
