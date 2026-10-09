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
.wm-d .wm-w{position:absolute;left:-30%;bottom:-8%;width:160%;height:0;border-radius:42%;background:${A};background:color-mix(in oklab,${A} 40%,transparent)}
.wm-d .wm-r{position:absolute;top:.1rem;right:.1rem;bottom:.1rem;left:.1rem;border:.14rem dashed transparent;border-radius:50%}
.wm-d b{position:relative;font-family:Sora,sans-serif;font-size:1.25rem;line-height:1;color:#1d3f49;text-shadow:0 1px 0 #fff}
.wm-d .wm-p{position:absolute;bottom:18%;width:.28rem;height:.28rem;border-radius:50%;background:#fff;opacity:0}
.wm-d .wm-p:nth-of-type(1){left:28%}.wm-d .wm-p:nth-of-type(2){left:52%}.wm-d .wm-p:nth-of-type(3){left:68%}
.wm.on{border-color:${A};box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 3px 10px ${A};box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 3px 10px color-mix(in oklab,${A} 35%,transparent)}
.wm.on .wm-s{color:#5ef2d6;text-shadow:0 0 6px rgb(94 242 214/.55)}
.wm.on .wm-t svg:first-of-type{color:${A}}
.wm.on .wm-d{animation:wmsh .35s linear infinite}
.wm.on .wm-w{height:62%;animation:wmw 2.2s ease-in-out infinite}
.wm.on .wm-r{border-color:${A};border-color:color-mix(in oklab,${A} 70%,transparent);animation:wmsp 3.2s linear infinite}
.wm.on .wm-p{animation:wmb 1.8s ease-in infinite}.wm.on .wm-p:nth-of-type(2){animation-delay:.6s}.wm.on .wm-p:nth-of-type(3){animation-delay:1.1s}
.wm.set{border-color:#53be70}.wm.set .wm-s{color:#8be59d}
@keyframes wmsp{to{transform:rotate(360deg)}}
@keyframes wmsh{25%{transform:translate(.7px,-.5px)}75%{transform:translate(-.6px,.5px)}}
@keyframes wmw{50%{transform:translateX(8%) rotate(4deg)}}
@keyframes wmb{0%{opacity:0;transform:translateY(0)}20%{opacity:.9}100%{opacity:0;transform:translateY(-1.4rem)}}
@media(prefers-reduced-motion:reduce){.wm.on .wm-d,.wm.on .wm-w,.wm.on .wm-r,.wm.on .wm-p{animation:none}}`;
  function mount() { if (document.getElementById('wm-css')) return; const s = document.createElement('style'); s.id = 'wm-css'; s.textContent = css; document.head.appendChild(s); }
  const time = m => m == null ? '--' : m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m);
  const drop = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1S2.2 5 2.2 7.4a3.8 3.8 0 0 0 7.6 0C9.8 5 6 1 6 1Z" fill="currentColor"/></svg>';
  const wave = '<svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1 4q2-2.5 4 0t4 0 4 0M1 8.5q2-2.5 4 0t4 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function html(o) {
    mount();
    const on = !!o.on, n = String(o.n).padStart(2, '0');
    const scr = o.scr != null ? o.scr : on ? time(o.left) : '--';
    return `<span class="wm ${on ? 'on' : ''} ${o.set ? 'set' : ''}" aria-hidden="true"><span class="wm-t"><span class="wm-k"></span>${drop}${wave}<span class="wm-s">${scr}</span></span>` +
      `<span class="wm-d"><span class="wm-w"></span><span class="wm-p"></span><span class="wm-p"></span><span class="wm-p"></span><span class="wm-r"></span><b>${n}</b></span></span>`;
  }
  return { html, mount };
})();
