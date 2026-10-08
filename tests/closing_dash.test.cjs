// Этап 4: напоминание «пора закрыть месяц». Запуск: node tests/closing_dash.test.cjs
const assert=require('assert');const fs=require('fs'),vm=require('vm'),path=require('path');const sb={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../closing-dash.js'),'utf8'),sb);const D=sb.module.exports;let ok=0;
const t=(n,f)=>{f();ok++;console.log('  ✓',n);};
t('нет замеров — просим начальный',()=>assert.equal(D.reminder(null,'2026-10-07').level,'info'));
t('месяц закончился, стирок нового месяца ещё не было — пора закрыть (warn)',()=>assert.equal(D.reminder({boundary_date:'2026-10-15',kind:'interval',opens_month:'2026-10'},'2026-11-01',{newMonthWash:false}).level,'warn'));
t('так же для замеров старого формата (без opens_month)',()=>assert.equal(D.reminder({boundary_date:'2026-10-15',kind:'interval'},'2026-11-01').level,'warn'));
t('месяц закрыт 1 числа — тихо',()=>assert.equal(D.reminder({boundary_date:'2026-11-01',kind:'month',opens_month:'2026-11'},'2026-11-01'),null));
t('месяц закрыт вечером в последний день — тихо',()=>assert.equal(D.reminder({boundary_date:'2026-10-31',kind:'month',opens_month:'2026-11'},'2026-11-01'),null));
t('первая стирка нового месяца уже была, месяц не закрыт — красное (дальше только суперадмин)',()=>assert.equal(D.reminder({boundary_date:'2026-10-15',kind:'interval',opens_month:'2026-10'},'2026-11-03',{newMonthWash:true}).level,'bad'));
t('последний день месяца — подсказка',()=>assert.equal(D.reminder({boundary_date:'2026-10-15',kind:'interval',opens_month:'2026-10'},'2026-10-31').level,'info'));
t('внутри месяца после закрытия — тихо',()=>assert.equal(D.reminder({boundary_date:'2026-11-01',kind:'month',opens_month:'2026-11'},'2026-11-12'),null));
t('внутри месяца закрытие отчёта в любое время — без напоминаний',()=>assert.equal(D.reminder({boundary_date:'2026-10-12',kind:'interval',opens_month:'2026-10'},'2026-10-20'),null));
t('декабрь → январь переход года',()=>assert.equal(D.reminder({boundary_date:'2026-12-10',kind:'interval',opens_month:'2026-12'},'2027-01-01').level,'warn'));
console.log('Итого: '+ok+' прошло, 0 не прошло');
