// Красная полоса внизу экрана с текстом первой ошибки страницы (JS-ошибка или сбой запроса).
// Нужна, чтобы «не нажимается» не оставалось загадкой: сфотографируйте полосу и пришлите.
// Ничего не меняет в работе сайта. Закрывается крестиком. Выключить: открыть любую страницу с ?err=0, включить: ?err=1.
(function () {
  var on = true;
  try { var q = location.search.match(/[?&]err=([01])/); if (q) localStorage.setItem('euss_err', q[1]); on = localStorage.getItem('euss_err') !== '0'; } catch (e) {}
  var bar = null, n = 0;
  function show(msg) {
    if (!on || n >= 3) return; n++;
    try {
      if (!bar) {
        bar = document.createElement('div'); bar.id = 'errbar'; bar.setAttribute('role', 'alert');
        bar.style.cssText = 'position:fixed;left:.5rem;right:.5rem;bottom:calc(.5rem + env(safe-area-inset-bottom,0px));z-index:500;max-height:40vh;overflow:auto;padding:.6rem 2.4rem .6rem .8rem;border-radius:.6rem;background:#b42318;color:#fff;font:600 .8rem/1.35 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0/.35);word-break:break-word';
        var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Закрыть');
        x.style.cssText = 'position:absolute;top:.2rem;right:.2rem;width:2.2rem;height:2.2rem;border:0;background:none;color:#fff;font-size:1.1rem;cursor:pointer';
        x.onclick = function () { bar.remove(); bar = null; };
        bar.appendChild(x); (document.body || document.documentElement).appendChild(bar);
      }
      var p = document.createElement('div'); p.textContent = msg; p.style.marginTop = bar.children.length > 1 ? '.35rem' : '0'; bar.appendChild(p);
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    if (!e.message && e.target && e.target !== window) return;   // сбой загрузки картинки/шрифта - не ошибка кода
    show('Ошибка: ' + e.message + (e.filename ? ' [' + String(e.filename).split('/').pop() + ':' + e.lineno + ']' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; show('Ошибка: ' + ((r && r.message) || r)); });
  window.ErrBar = { show: show };
})();
