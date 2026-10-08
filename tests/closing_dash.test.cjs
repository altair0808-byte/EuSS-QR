// Этап 4: напоминание «пора закрыть месяц». Запуск: node tests/closing_dash.test.cjs
const assert=require('assert');const fs=require('fs'),vm=require('vm'),path=require('path');const sb={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../closing-dash.js'),'utf8'),sb);const D=sb.module.exports;let ok=0;
const t=(n,f)=>{f();ok++;console.log('  ✓',n);};
t('нет замеров — просим начальный',()=>assert.equal(D.reminder(null,'2026-10-07').level,'info'));
t('1 число, месяц не закрыт — пора закрыть',()=>assert.equal(D.reminder({boundary_date:'2026-10-15',kind:'interval'},'2026-11-01').level,'warn'));
t('1 число, уже закрыт сегодня — тихо',()=>assert.equal(D.reminder({boundary_date:'2026-11-01',kind:'month'},'2026-11-01'),null));
t('пропущено 1 число — красное напоминание',()=>assert.equal(D.reminder({boundary_date:'2026-10-15',kind:'interval'},'2026-11-03').level,'bad'));
t('внутри месяца после закрытия — тихо',()=>assert.equal(D.reminder({boundary_date:'2026-11-01',kind:'month'},'2026-11-12'),null));
console.log('Итого: '+ok+' прошло, 0 не прошло');
