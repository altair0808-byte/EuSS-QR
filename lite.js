// Облегчённый режим для слабых планшетов и телефонов: без декоративных анимаций и размытия, реже опрос сервера.
// Включается сам (мало памяти, мало ядер, старый браузер). Вручную: открыть любую страницу с ?lite=1 (включить) или ?lite=0 (выключить).
(function () {
  var v = null;
  try { var q = location.search.match(/[?&]lite=([01])/); if (q) localStorage.setItem('euss_lite', q[1]); v = localStorage.getItem('euss_lite'); } catch (e) {}
  var weak = false;
  try {
    weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
      !(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1'));
  } catch (e) {}
  window.LITE = v === '1' || (v !== '0' && !!weak);
  window.pollMs = function (ms) { return window.LITE ? ms * 2 : ms; };   // в облегчённом режиме опрос вдвое реже
  if (!window.LITE) return;
  document.documentElement.className += ' lite';
  var st = document.createElement('style');
  // Анимация стиральных машин (барабан, вода, пена) остаётся и в облегчённом режиме, отключена только тряска корпуса. Окна подтверждения и загрузки не трогаем.
  st.textContent = 'html.lite *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;transition-duration:0s!important}' +
    'html.lite .wm.on .wm-d,html.lite .on .dr,html.lite .on .dr::after,' +
    'html.lite .t1.on .dm,html.lite .t1.on .dm::after,html.lite .t1.on i,html.lite .cn-liq,html.lite .cn-liq::before,html.lite .cn-liq::after{animation:none!important}';
  (document.head || document.documentElement).appendChild(st);
})();
