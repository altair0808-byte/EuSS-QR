const fs=require('fs'),vm=require('vm');
const T0='2026-10-07T01:00:00Z', ts=m=>new Date(Date.parse(T0)+m*60e3).toISOString();
const chems=[{id:1,name:'EMULSIFIER',kind:'main',bottle_l:20,bottle_kg:22}];
const loads=[...Array(40)].map((_,i)=>({ts:ts(10+i*30),machine:(i%12)+1,wash_type_id:1,shift_date:'2026-10-07'}));
const data={report_changes:[{id:'A',ts:'2026-10-06T10:00:00Z',shift_date:'2026-10-06',chemical_id:1,machine_group:'1_10',leftover_l:2},{id:'B',ts:'2026-10-06T10:00:00Z',shift_date:'2026-10-06',chemical_id:1,machine_group:'11_12',leftover_l:2}],report_connects:[],
 report_moves:[{ts:ts(100),shift_date:'2026-10-07',chemical_id:1,machine_group:'1_10',kind:'take',amount_l:3},{ts:ts(101),shift_date:'2026-10-07',chemical_id:1,machine_group:'11_12',kind:'take',amount_l:3},{ts:ts(102),shift_date:'2026-10-07',chemical_id:1,machine_group:'1_10',kind:'pour',amount_l:6}],report_loads:loads};
const sb={rpc:(fn)=>{const r={then:(res)=>res({data:data[fn]||[],error:null}),range:()=>r};return r}};
const cache={};const mkEl=()=>new Proxy({style:{},classList:{toggle(){}},dataset:{}},{get:(t,k)=>k in t?t[k]:undefined,set:(t,k,v)=>{t[k]=v;return true}});
const el=mkEl();el.querySelector=s=>s.includes(':focus')?null:(cache[s]||(cache[s]=mkEl()));el.isConnected=true;
let raf=null;const ctx={sb,document:{head:{insertAdjacentHTML(){}}},requestAnimationFrame:f=>{raf=f},Date,Math,String,Promise,Object,Array,JSON};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('storage-anim.js','utf8')+';this.SA=StorageAnim;',ctx);
const refs={water:55,chemicals:chems,recipes:[{wash_type_id:1,chemical_id:1,ml_per_l:3}]};
(async()=>{await ctx.SA.mount(el,{refs,date:'2026-10-07',st:6,tz:5,can:true});
 el.onclick({target:{closest:()=>({dataset:{a:'go'},textContent:''})}});
 for(let t=0,k=0;k<400;k++){t+=400;raf&&raf(t)}   // ~ быстро прокручиваем сутки (3×: 30 с)
 const tb=cache['[data-r=tb]'].innerHTML.replace(/<[^>]+>/g,'|').replace(/\|+/g,'|');console.log(tb);
 const pan=cache['[data-r=pan]'].innerHTML.replace(/<[^>]+>/g,'|').replace(/\|+/g,'|').slice(0,260);console.log(pan);})();
