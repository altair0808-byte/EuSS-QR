// Рисунок стиральной машины: квадратный корпус, ручка и кнопки сверху, экранчик с цифрами остатка времени, круглый люк.
// Одинаково выглядит на главной (index.html) и в загрузке белья (form.html). Только CSS и разметка, без картинок.
// WM.html({ n: номер машины, on: идёт стирка, left: минут осталось, scr: текст на экранчике вместо времени })
const WM = (() => {
  const A = 'var(--pri,var(--ac,#2aa3b5))';
  const css = `
.wm{position:relative;display:flex;flex-direction:column;gap:.4rem;width:100%;max-width:7.6rem;margin:0 auto;padding:.4rem;border:2px solid #cfd8dc;border-radius:.85rem;background:linear-gradient(#fff,#e9eef1);box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 2px 5px rgb(0 0 0/.1);color:#90a4ae;transition:border-color .2s,box-shadow .2s}
.wm-t{display:flex;align-items:center;gap:.25rem}
.wm-k{flex:none;width:.75rem;height:.75rem;border-radius:50%;background:#b0bec5;box-shadow:inset 0 0 0 .14rem #fff,0 0 0 1px #b0bec5}
.wm-t svg{flex:none;display:block;width:.62rem;height:.62rem}
.wm-s{flex:1;min-width:1.9rem;margin-left:.15rem;padding:.12rem .3rem;border-radius:.3rem;background:#0e2a2f;color:#2f6a6e;font:700 .95rem/1.15 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:right;letter-spacing:.06em;box-shadow:inset 0 1px 3px rgb(0 0 0/.6)}
.wm-d{position:relative;width:100%;aspect-ratio:1;display:grid;place-items:center;overflow:hidden;border-radius:50%;border:.3rem solid #b0bec5;background:radial-gradient(circle at 34% 28%,#fff 0 10%,#d7eef3 38%,#a9d3de);box-shadow:inset 0 0 0 .14rem #fff,0 1px 2px rgb(0 0 0/.15)}
.wm-d svg{position:absolute;top:0;left:0;width:100%;height:100%;display:block}
.wm-d b{position:relative;z-index:2;font-family:Sora,sans-serif;font-size:1.25rem;line-height:1;color:#1d3f49;text-shadow:0 1px 0 #fff,0 0 4px #fff}
.wm-d .wm-sh{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;opacity:.7}
.wm-d .wm-hl{fill:none;stroke:#b8dae0;stroke:color-mix(in oklab,${A} 35%,#fff);stroke-width:2.2;stroke-dasharray:1.5 7;stroke-linecap:round}
.wm-d .wm-wa{fill:${A};opacity:.28}.wm-d .wm-wb{fill:${A};opacity:.42}
.wm-d .wm-wa,.wm-d .wm-wb{fill:color-mix(in oklab,${A} 55%,#fff)}
.wm-d .wm-wa{opacity:.55}.wm-d .wm-wb{opacity:.8}
.wm-d .wm-c1{fill:#a3d0d8}.wm-d .wm-c2{fill:#f4b581}.wm-d .wm-c3{fill:#fff;stroke:#b0bec5;stroke-width:1}
.wm-d .wm-fo{fill:#fff;stroke:#cfe6ec;stroke-width:.8;opacity:0}
.wm-d .wm-bu{fill:#fff;fill-opacity:.55;stroke:#fff;stroke-width:.9;opacity:0}
.wm-d .wm-dr{fill:#f27fb0;opacity:0}
.wm-d .wm-dr.b{fill:#4fc3e8}
.wm-d .wm-dw,.wm-d .wm-dm,.wm-d .wm-fz{display:none}
.wm.on .wm-dw,.wm.on .wm-dm,.wm.on .wm-fz{display:inline}
.wm.on{border-color:${A};box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 3px 10px ${A};box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 3px 10px color-mix(in oklab,${A} 35%,transparent)}
.wm.on .wm-s{color:#5ef2d6;text-shadow:0 0 6px rgb(94 242 214/.55)}
.wm.on .wm-t svg:first-of-type{color:${A}}
.wm.on .wm-d{animation:wmsh .35s linear infinite}
.wm.on .wm-r{border-color:${A};border-color:color-mix(in oklab,${A} 70%,transparent);animation:wmsp 3.2s linear infinite}
.wm.on .wm-dm{transform-box:view-box;transform-origin:50% 50%;animation:wmsp 3.4s linear infinite}
.wm.on .wm-wa{animation:wmwa 1.9s linear infinite}
.wm.on .wm-wb{animation:wmwb 1.3s linear infinite}
.wm.on .wm-fo{transform-box:fill-box;transform-origin:50% 100%;animation:wmfo 1.6s ease-in-out infinite}
.wm.on .wm-bu{animation:wmup 2.4s ease-in infinite}
.wm.on .wm-dr{animation:wmdr 5.5s ease-in infinite}
.wm.set{border-color:#53be70}.wm.set .wm-s{color:#8be59d}
@keyframes wmsp{to{transform:rotate(360deg)}}
@keyframes wmsh{25%{transform:translate(.7px,-.5px)}75%{transform:translate(-.6px,.5px)}}
@keyframes wmwa{to{transform:translateX(50px)}}
@keyframes wmwb{to{transform:translateX(-50px)}}
@keyframes wmfo{0%,100%{opacity:.95;transform:scale(1)}50%{opacity:1;transform:scale(1.18,1.3)}}
@keyframes wmup{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:.95}70%{opacity:.8}100%{transform:translateY(-46px) scale(1.15);opacity:0}}
@keyframes wmdr{0%{transform:translateY(-8px);opacity:0}6%{opacity:1}22%{transform:translateY(34px);opacity:1}26%,100%{transform:translateY(34px);opacity:0}}
@media(prefers-reduced-motion:reduce){.wm.on .wm-d,.wm.on .wm-r,.wm.on .wm-dm,.wm.on .wm-wa,.wm.on .wm-wb,.wm.on .wm-fo,.wm.on .wm-bu,.wm.on .wm-dr{animation:none}.wm.on .wm-fo{opacity:.9}}`;
  function mount() { if (document.getElementById('wm-css')) return; const s = document.createElement('style'); s.id = 'wm-css'; s.textContent = css; document.head.appendChild(s); }
  const time = m => m == null ? '--' : m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m);
  const drop = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1S2.2 5 2.2 7.4a3.8 3.8 0 0 0 7.6 0C9.8 5 6 1 6 1Z" fill="currentColor"/></svg>';
  const wavei = '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1 4q2-2.5 4 0t4 0 4 0M1 8.5q2-2.5 4 0t4 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  // фаза по часам: перерисовка панели (каждую минуту) не сбрасывает вращение и пену
  let off = 0;   // сдвиг по номеру машины, чтобы все не крутились синхронно
  const ph = p => 'animation-delay:' + (-(((Date.now() / 1000) + off) % p)).toFixed(2) + 's';
  const wave = y => { let d = 'M-50 ' + y; for (let x = 0; x < 200; x += 50) d += ' q12.5 -5 25 0 t25 0'; return d + ' V100 H-50 Z'; };
  // пена у поверхности воды: кружки разного размера, качаются в разной фазе
  const FOAM = [[14, 40, 5.5, 1.6], [25, 37, 6.5, 1.3], [37, 40, 5, 1.8], [49, 36, 7, 1.5], [61, 40, 5.5, 1.2], [72, 37, 6.5, 1.7], [84, 40, 5, 1.4], [31, 34, 4, 1.9], [56, 33, 4.5, 1.1], [78, 33, 3.8, 1.6]];
  // пузырьки химии со дна: x, y старт, радиус, период, сдвиг
  const BUB = [[22, 92, 2.6, 2.4, 0], [34, 96, 1.8, 2.1, .7], [45, 93, 3.1, 2.7, 1.4], [57, 97, 2, 2.2, .3], [68, 92, 2.8, 2.5, 1.9], [79, 95, 1.7, 2, 1.1], [39, 90, 1.5, 1.9, 2.2], [63, 94, 2.3, 2.6, .5]];
  function door(on, n) {
    if (!on) return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="wm-hl" cx="50" cy="50" r="30"/><path class="wm-sh" d="M24 36a30 30 0 0 1 16-14"/></svg>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
<path class="wm-wa wm-dw" style="${ph(1.9)}" d="${wave(44)}"/><path class="wm-wb wm-dw" style="${ph(1.3)}" d="${wave(47)}"/>
<g class="wm-dm" style="${ph(3.4)}"><circle class="wm-hl" cx="50" cy="50" r="31"/>
<ellipse class="wm-c1" cx="36" cy="60" rx="11" ry="7" transform="rotate(-25 36 60)"/><circle class="wm-c2" cx="63" cy="43" r="8"/><rect class="wm-c3" x="46" y="66" width="17" height="10" rx="4" transform="rotate(20 54 71)"/></g>
${BUB.map(b => `<circle class="wm-bu wm-fz" style="animation-delay:${(-((Date.now() / 1000 + off + b[4]) % b[3])).toFixed(2)}s;animation-duration:${b[3]}s" cx="${b[0]}" cy="${b[1]}" r="${b[2]}"/>`).join('')}
${FOAM.map(f => `<circle class="wm-fo wm-fz" style="animation-delay:${(-((Date.now() / 1000 + off + f[0] / 10) % f[3])).toFixed(2)}s;animation-duration:${f[3]}s" cx="${f[0]}" cy="${f[1]}" r="${f[2]}"/>`).join('')}
<circle class="wm-dr wm-fz" style="${ph(5.5)}" cx="40" cy="8" r="2.6"/><circle class="wm-dr b wm-fz" style="animation-delay:${(-((Date.now() / 1000 + off + 2.7) % 5.5)).toFixed(2)}s" cx="62" cy="8" r="2.6"/>
<path class="wm-sh" d="M24 36a30 30 0 0 1 16-14"/></svg>`;
  }
  function html(o) {
    mount();
    const on = !!o.on, n = String(o.n).padStart(2, '0');
    off = (+o.n || 0) * 0.37;
    const scr = o.scr != null ? o.scr : on ? time(o.left) : '--';
    return `<span class="wm ${on ? 'on' : ''} ${o.set ? 'set' : ''}" aria-hidden="true"><span class="wm-t"><span class="wm-k"></span>${drop}${wavei}<span class="wm-s">${scr}</span></span>` +
      `<span class="wm-d">${door(on, n)}<span class="wm-r"></span><b>${n}</b></span></span>`;
  }
  return { html, mount };
})();
