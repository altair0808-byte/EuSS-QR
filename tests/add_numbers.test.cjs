// Проверки: числа без округления, «Добавить химию» (суперадмин), проживающие (только админы).
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const R=f=>path.join(__dirname,'..',f),src=f=>fs.readFileSync(R(f),'utf8');
let ok=0,bad=0;const t=(n,f)=>{try{f();ok++;console.log('  ✓',n)}catch(e){bad++;console.log('  ✗',n,'\n    ',e.message)}};
const ta=async(n,f)=>{try{await f();ok++;console.log('  ✓',n)}catch(e){bad++;console.log('  ✗',n,'\n    ',e.message)}};
const load=(files,ctx)=>{vm.createContext(ctx);files.forEach(f=>vm.runInContext(src(f),ctx));return ctx};

// ---------- 1) формат чисел ----------
const N=load(['num.js'],{module:{exports:{}}}).module.exports;
t('0,175 остаётся 0,175 (а не 0,18)',()=>assert.strictEqual(N.fmt(0.175),'0,175'));
t('0,350 пишется как 0,35',()=>assert.strictEqual(N.fmt(0.350),'0,35'));
t('целое без «,00»',()=>assert.strictEqual(N.fmt(12),'12'));
t('порошок: 2 пачки по 175 г = 0,35 кг, 3 пачки = 0,525 кг',()=>{assert.strictEqual(N.fmt(2*175/1000),'0,35');assert.strictEqual(N.fmt(3*175/1000),'0,525')});
t('хвост плавающей точки скрыт: 0,1+0,2 = 0,3',()=>assert.strictEqual(N.fmt(0.1+0.2),'0,3'));
t('отрицательный ноль не показывается',()=>assert.strictEqual(N.fmt(-1e-9),'0'));
t('для «≈» можно ограничить знаки',()=>assert.strictEqual(N.fmt(1/3,3),'0,333'));
t('ввод с запятой разбирается',()=>assert.strictEqual(N.parse('0,175'),0.175));
t('в полях ввода значение без пробелов и с точкой',()=>assert.strictEqual(N.plain(0.175),'0.175'));
// бланк: тот же формат
const B=load(['blanc.js'],{module:{exports:{}}}).module.exports;
t('бланк Excel-вида: fmt(0.175) = 0,175',()=>assert.strictEqual(B.fmt(0.175),'0,175'));
t('в форме замены нет принудительного округления до сотых',()=>{const s=src('form.html');assert.ok(!/toFixed\(2\)/.test(s));assert.ok(!/minimumFractionDigits: 2/.test(s))});
t('в остатках и хранилище нет округления до сотых',()=>{assert.ok(!/minimumFractionDigits: d/.test(src('leftover.js')));assert.ok(!/maximumFractionDigits: 2/.test(src('storage-anim.js')))});
t('поля количества принимают 0,175 (step=any вместо 0.01)',()=>{['form.html','settings.html','storage-anim.js'].forEach(f=>assert.ok(!/step="0\.01"/.test(src(f)),f))});
t('каждая страница, где используется Num, подключает num.js',()=>{
  fs.readdirSync(R('.')).filter(f=>f.endsWith('.html')).forEach(f=>{const s=src(f);
    const uses=/\bNum\.|Leftover\.|StorageAnim|Residents\./.test(s)||/<script src="(leftover|storage-anim|residents)\.js">/.test(s);
    if(uses)assert.ok(/<script src="num\.js">/.test(s),f+': нет num.js')})});

// ---------- 2) «Добавить химию» (суперадмин): kind = 'add' ----------
const calc=load(['report-calc.js'],{module:{exports:{}}}).module.exports;
const refs={water:55,washTypes:[],recipes:[],chemicals:[{id:1,name:'E',kind:'main',bottle_l:20,bottle_kg:22}]};
const chg=o=>({id:'c'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T05:00:00Z',...o}),mv=o=>({id:'m'+Math.random(),chemical_id:1,machine_group:'1_10',ts:'2026-10-07T02:00:00Z',...o});
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-9,`${m}: ждали ${b}, получили ${a}`);
const row=(r,g)=>r.groups[g].chem.find(c=>c.id===1);
t('добавили 0,175 л: расход = 20 + 0,175 − остаток 2 = 18,175 л',()=>{const u=calc.chemUsed(refs,[chg({id:'A',leftover_l:2})],[],[mv({kind:'add',amount_l:0.175})]).used;near(u.A,18.175,'A')});
t('добавили 7,5 л в 1–10: расход 25,5 при остатке 2, второй дозатор не тронут',()=>{const u=calc.chemUsed(refs,[chg({id:'A',leftover_l:2}),chg({id:'B',machine_group:'11_12',leftover_l:2})],[],[mv({kind:'add',amount_l:7.5})]).used;near(u.A,25.5,'A');near(u.B,18,'B')});
t('приход запас бригадира не меняет, а «залито из запаса» запас уменьшает',()=>{
  const C=[chg({id:'A',leftover_l:4})];
  const a=calc.calcReport([],C,refs,[],null,[mv({kind:'add',amount_l:5})]);
  near(row(a,'all').stock.l,4,'stock after add');near(row(a,'all').added.l,5,'added');near(row(a,'all').put.l,0,'put');
  const p=calc.calcReport([],C,refs,[],null,[mv({kind:'take',amount_l:3,ts:'2026-10-07T01:00:00Z'}),mv({kind:'pour',amount_l:2,ts:'2026-10-07T01:10:00Z'})]);
  near(row(p,'all').stock.l,5,'stock after take/pour');near(row(p,'all').put.l,2,'put')});

const sa=async(moves,isSuper)=>{
  const T0='2026-10-07T01:00:00Z',data={report_changes:[{id:'A',ts:'2026-10-06T10:00:00Z',shift_date:'2026-10-06',chemical_id:1,machine_group:'1_10',leftover_l:2}],report_moves:moves,report_loads:[]};
  const ctx={sb:{rpc:fn=>{const r={then:res=>res({data:data[fn]||[],error:null}),range:()=>r};return r}},document:{head:{insertAdjacentHTML(){}}},requestAnimationFrame(){},setInterval(){return 0},clearInterval(){},Date,Math,String,Promise,Object,Array,JSON};
  const el={querySelector:()=>null,querySelectorAll:()=>[],isConnected:true};
  load(['num.js','storage-anim.js'],ctx);vm.runInContext('this.SA=StorageAnim',ctx);
  await ctx.SA.mount(el,{refs:{water:55,chemicals:refs.chemicals,recipes:[]},date:'2026-10-07',st:6,tz:5,can:true,isSuper});
  return el.innerHTML;
};
(async()=>{
  const mvAdd=[{id:'m1',ts:'2026-10-07T01:30:00Z',shift_date:'2026-10-07',chemical_id:1,machine_group:'1_10',kind:'add',amount_l:0.175,amount_kg:0.1925}];
  const h1=await sa(mvAdd,true),h2=await sa(mvAdd,false);
  await ta('суперадмин видит кнопку «Добавить химию» у обоих дозаторов',()=>assert.strictEqual((h1.match(/data-m="add"/g)||[]).length,2));
  await ta('админ и бригадир кнопки не видят',()=>assert.ok(!/data-m="add"/.test(h2)));
  await ta('уровень поднялся: бутыль 20 + 0,175 = 20,175 л (без округления)',()=>assert.ok(h2.includes('20,175 л'),h2.replace(/<[^>]+>/g,'|').replace(/\|+/g,'|').slice(0,300)));
  await ta('показано «Добавлено суперадмином +0,175 л · 0,1925 кг»',()=>assert.ok(/Добавлено суперадмином <b>\+0,175 л · 0,1925 кг/.test(h2)));
  await ta('запас после прихода не вырос и не уменьшился (остаток замены 2 л)',()=>assert.ok(/В запасе <b>2 л/.test(h2)));

  // ---------- 3) проживающие: только админы ----------
  const mk=(rows,admin,err)=>({sb:{rpc:async(fn,a)=>{mk.calls.push([fn,a]);
      if(fn==='is_admin')return{data:admin,error:null};
      if(fn==='get_residents')return err?{data:null,error:{message:'denied'}}:{data:admin?rows:[],error:null};
      if(fn==='set_residents')return{error:null};return{data:null,error:{message:'?'}}}},
    document:{getElementById:()=>null,head:{appendChild(){}},createElement:()=>({}),activeElement:null},toast(){},Date,Math,String,Promise,Object,Array,JSON});
  mk.calls=[];
  const res=load(['residents.js'],mk([{day:'2026-10-07',cnt:12}],true));vm.runInContext('this.RS=Residents',res);
  await ta('админ: is_admin = true',async()=>assert.strictEqual(await res.RS.isAdmin(),true));
  const el={innerHTML:'',querySelector:()=>null};await res.RS.mount(el,'2026-10-07',{today:'2026-10-07'});
  await ta('карточка показывает введённое число 12 и поле ввода',()=>{assert.ok(/value="12"/.test(el.innerHTML),el.innerHTML.slice(0,300));assert.ok(/Видят только админы/.test(el.innerHTML))});
  const el2={innerHTML:'',querySelector:()=>null};await res.RS.mount(el2,'2026-10-09',{today:'2026-10-07'});
  await ta('на будущую смену поле ввода не рисуется',()=>assert.ok(!/id="rs-n"/.test(el2.innerHTML)));
  const non=load(['residents.js'],mk([{day:'2026-10-07',cnt:12}],false,true));vm.runInContext('this.RS=Residents',non);
  await ta('не админ: is_admin = false, числа не загружаются',async()=>{assert.strictEqual(await non.RS.isAdmin(),false);assert.strictEqual(await non.RS.range('2026-10-01','2026-10-31'),null)});
  await ta('до выполнения stage13.sql (функции нет): раздел просто не показывается',async()=>{const x=load(['residents.js'],{sb:{rpc:async()=>({data:null,error:{message:'function is_admin() does not exist'}})},document:{head:{appendChild(){}}},Date,Math,String,Promise,Object,Array,JSON});vm.runInContext('this.RS=Residents',x);assert.strictEqual(await x.RS.isAdmin(),false)});
  // SQL: проверки роли на стороне базы
  const sql=src('stage13.sql');
  await ta('SQL: таблица проживающих закрыта (RLS, без политик, права сняты)',()=>{assert.ok(/alter table resident_counts enable row level security/.test(sql));assert.ok(/revoke all on resident_counts from anon, authenticated/.test(sql));assert.ok(!/create policy[^;]*resident_counts/.test(sql))});
  await ta('SQL: get_residents и set_residents проверяют is_admin()',()=>{assert.ok(/where is_admin\(\) and r\.day between/.test(sql));assert.ok(/if not is_admin\(\) then raise exception 'Проживающих/.test(sql))});
  await ta('SQL: chem_add только для суперадмина',()=>assert.ok(/create or replace function chem_add[\s\S]*?if not is_super\(\) then raise exception/.test(sql)));
  await ta('SQL: проживающие не пишутся в журнал, который видят бригадиры',()=>assert.ok(!/audit_row\('resident/.test(sql)&&!/insert into audit_log[^;]*resident/.test(sql)));
  console.log(`\nИтого: ${ok} прошло, ${bad} не прошло`);process.exit(bad?1:0);
})();
