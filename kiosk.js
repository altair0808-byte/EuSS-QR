// Режим приложения (установлено на главный экран / полный экран): строка со временем (24 ч) и зарядом сверху,
// запрет масштабирования, выделения текста, контекстного меню и «потяни, чтобы обновить».
// Пароли вводятся в обычное поле со скрытыми символами (класс pwm), поэтому браузер не предлагает «Сохранить пароль».
// Включено везде. Выключить: открыть сайт с ?status=0, снова включить: ?status=1.
(function () {
  var dm = false, ov = null;
  try { ['standalone', 'fullscreen', 'minimal-ui'].forEach(function (m) { if (matchMedia('(display-mode: ' + m + ')').matches) dm = true; }); if (navigator.standalone === true) dm = true; } catch (e) {}
  try { var q = location.search.match(/[?&]status=([01])/); if (q) localStorage.setItem('euss_status', q[1]); ov = localStorage.getItem('euss_status'); } catch (e) {}
  // Ярлык из Samsung Internet открывается как обычная вкладка (display-mode: browser), поэтому режим определять по нему нельзя:
  // строка со временем и зарядом и ограничения включены везде, пока не выключено через ?status=0
  var on = ov !== '0';
  var showBar = on;
  dm = on;

  var css = 'input.pwm{-webkit-text-security:disc;text-security:disc}';
  if (dm) {
    css += 'html{overscroll-behavior:none;touch-action:pan-x pan-y;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}' +
      'html,body{-webkit-user-select:none;user-select:none}input,textarea,select,[contenteditable]{-webkit-user-select:text;user-select:text}' +
      'img{-webkit-user-drag:none}';
    try {   // масштабирование жестами выключено
      var mv = document.querySelector('meta[name=viewport]');
      if (mv) mv.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');
    } catch (e) {}
    document.addEventListener('contextmenu', function (e) { var t = e.target; if (!(t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) e.preventDefault(); });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }); });
    document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }
  if (showBar) {
    css += ':root{--sbh:1.7rem}html.sb body{padding-top:var(--sbh)}html.sb .hd{top:var(--sbh)}' +
      '#sbar{position:fixed;top:0;left:0;right:0;z-index:300;height:var(--sbh);padding:0 .9rem;display:flex;align-items:center;justify-content:space-between;' +
      'background:#123;color:#fff;font:700 .85rem/1 Manrope,system-ui,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none}' +
      '#sbar .lo{color:#ff8a80}@media print{#sbar{display:none}html.sb body{padding-top:0}}';
  }
  var st = document.createElement('style'); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
  if (!showBar) return;

  function build() {
    if (document.getElementById('sbar')) return;
    document.documentElement.className += ' sb';
    var bar = document.createElement('div'); bar.id = 'sbar'; bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<span id="sb-t"></span><span id="sb-b"></span>';
    document.body.appendChild(bar);
    var t = document.getElementById('sb-t'), b = document.getElementById('sb-b'), bat = null;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function clock() { var d = new Date(), s = two(d.getHours()) + ':' + two(d.getMinutes()); if (t.textContent !== s) t.textContent = s; }
    function power() {
      if (!bat) return;
      var p = Math.round(bat.level * 100), low = p <= 20 && !bat.charging;
      b.className = low ? 'lo' : ''; b.textContent = (bat.charging ? '⚡ ' : '') + p + '%';
    }
    clock(); setInterval(function () { if (!document.hidden) clock(); }, 10000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { clock(); power(); } });
    try {
      if (navigator.getBattery) navigator.getBattery().then(function (x) {
        bat = x; power(); ['levelchange', 'chargingchange'].forEach(function (n) { x.addEventListener(n, power); });
      }).catch(function () {});
    } catch (e) {}
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
