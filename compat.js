// Запасной вариант для старых телефонов и планшетов, где нет CSS-свойства aspect-ratio (Chrome до 88, Safari до 15):
// без него круглые барабаны машин и картинки химии получают нулевую высоту. Здесь высота считается от ширины.
(function () {
  try { if (window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1')) return; } catch (e) {}
  var R = [['.mv', 4 / 4.5], ['.dr', 1], ['.t1 .dm', 1], ['.wm-d', 1], ['.ci', 4 / 3], ['.ci.sm', 1], ['.cn-lab', 1 / 1.05]];
  var pend = false;
  function fix() {
    pend = false;
    R.forEach(function (r) {
      var els = document.querySelectorAll(r[0]);
      for (var i = 0; i < els.length; i++) {
        var e = els[i], w = e.offsetWidth;
        if (w > 0) { var h = Math.round(w / r[1]); if (e.__h !== h) { e.style.height = h + 'px'; e.__h = h; } }
      }
    });
  }
  function sched() { if (!pend) { pend = true; (window.requestAnimationFrame || setTimeout)(fix); } }
  function init() {
    sched();
    window.addEventListener('resize', sched); window.addEventListener('orientationchange', sched);
    if (window.MutationObserver) new MutationObserver(sched).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
