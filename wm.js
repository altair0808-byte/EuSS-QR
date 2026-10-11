// Рисунок стиральной машины: квадратный корпус, ручка и кнопки сверху, экранчик с цифрами остатка времени, круглый люк.
// Одинаково выглядит на главной (index.html) и в загрузке белья (form.html). Только CSS и разметка, без картинок.
// WM.html({ n: номер машины, on: идёт стирка, left: минут осталось, scr: текст на экранчике вместо времени, ph: WM.phase(...) - этап: заполнение / стирка / сушка })
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
.wm-d .wm-hl{fill:none;stroke:#b8dae0;stroke-width:2.2;stroke-dasharray:1.5 7;stroke-linecap:round}
.wm-d .wm-wa{fill:${A};opacity:.28}.wm-d .wm-wb{fill:${A};opacity:.42}
.wm-d .wm-wa{opacity:.4}.wm-d .wm-wb{opacity:.6}
.wm-d .wm-c1{fill:#a3d0d8}.wm-d .wm-c2{fill:#f4b581}.wm-d .wm-c3{fill:#fff;stroke:#b0bec5;stroke-width:1}
.wm-d .wm-fo{fill:#fff;stroke:#cfe6ec;stroke-width:.8;opacity:0}
.wm-d .wm-bu{fill:#fff;fill-opacity:.55;stroke:#fff;stroke-width:.9;opacity:0}
.wm-d .wm-dr{fill:#f27fb0;opacity:0}
.wm-d .wm-dr.b{fill:#4fc3e8}
.wm-d .wm-dw,.wm-d .wm-dm,.wm-d .wm-fz{display:none}
.wm.on .wm-dw,.wm.on .wm-dm,.wm.on .wm-fz{display:inline}
.wm.on{border-color:${A};box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 3px 10px rgb(42 163 181/.35)}
.wm.on .wm-s{color:#5ef2d6;text-shadow:0 0 6px rgb(94 242 214/.55)}
.wm.on .wm-t svg:first-of-type{color:${A}}
.wm.on .wm-d{animation:wmsh .35s linear infinite}
.wm.on .wm-r{border-color:${A};opacity:1;animation:wmsp 3.2s linear infinite}
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
@supports(color:color-mix(in oklab,red,blue)){.wm-d .wm-hl{stroke:color-mix(in oklab,${A} 35%,#fff)}.wm.on{box-shadow:inset 0 -3px 0 rgb(0 0 0/.06),0 3px 10px color-mix(in oklab,${A} 35%,transparent)}.wm.on .wm-r{border-color:color-mix(in oklab,${A} 70%,transparent)}}
.wm-d .wm-lv{display:none}.wm.fill .wm-lv{display:inline;animation-name:wmlv;animation-timing-function:linear;animation-fill-mode:forwards;animation-iteration-count:1}
.wm-d .wm-fi,.wm-d .wm-hw,.wm-d .wm-st{display:none}
.wm.fill .wm-fi{display:inline;fill:#4fc3e8;opacity:0;animation:wmfi .8s ease-in infinite}
.wm.fill .wm-d,.wm.fill .wm-dm,.wm.fill .wm-fz{animation:none}.wm.fill .wm-fz{display:none}
.wm.dry .wm-dw,.wm.dry .wm-fz{display:none}
.wm.dry .wm-d{background:radial-gradient(circle at 34% 28%,#fff 0 10%,#fbe6d2 38%,#f3c9a3)}
.wm.dry .wm-dm{animation-duration:1.5s}
.wm.dry .wm-hw{display:inline;fill:none;stroke:#f08a3c;stroke-width:2.6;stroke-linecap:round;opacity:0;animation:wmht 2.2s ease-in infinite}
.wm.dry .wm-st{display:inline;fill:#fff;opacity:0;animation:wmst 2.8s ease-out infinite}
@keyframes wmlv{from{transform:translateY(56px)}to{transform:translateY(0)}}
@keyframes wmfi{0%{transform:translateY(0);opacity:0}12%{opacity:.95}85%{opacity:.9}100%{transform:translateY(30px);opacity:0}}
@keyframes wmht{0%{transform:translateY(8px);opacity:0}25%{opacity:.85}100%{transform:translateY(-34px);opacity:0}}
@keyframes wmst{0%{transform:translateY(6px) scale(.5);opacity:0}20%{opacity:.8}100%{transform:translateY(-40px) scale(1.5);opacity:0}}
@media(prefers-reduced-motion:reduce){.wm.fill .wm-lv,.wm.fill .wm-fi,.wm.dry .wm-dm,.wm.dry .wm-hw,.wm.dry .wm-st{animation:none}.wm.fill .wm-fi,.wm.dry .wm-hw,.wm.dry .wm-st{opacity:.5}}
.wk{display:inline-grid;place-items:center;flex:none;width:1.5em;height:1.5em;margin-right:.35rem;border-radius:.45rem;background:#90a4ae;background:var(--k,#90a4ae);font-size:.88em;line-height:1;vertical-align:middle;box-shadow:0 1px 2px rgb(0 0 0/.22)}
button[data-v][style*="--k"]{border-left:.32rem solid #90a4ae;border-left-color:var(--k)}
@media(prefers-reduced-motion:reduce){.wm.on .wm-d{animation:none}}`;
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

  // ---- этапы стирки: заполнение, стирка, сушка (минуты из wash_types: fill_min, wash_min, dry_min; minutes = сумма) ----
  // Если этапы не заданы (старые данные), всё время считается стиркой: поведение как раньше.
  const mins = w => {
    const f = +(w && w.fill_min) || 0, d = +(w && w.dry_min) || 0, tot = +(w && w.minutes) || 0;
    const wa = w && w.wash_min != null ? +w.wash_min || 0 : Math.max(0, tot - f - d);
    return { fill: f, wash: wa, dry: d, total: f + wa + d || tot };
  };
  const PH = { fill: 'Заполнение', wash: 'Стирка', dry: 'Сушка' };
  // где сейчас машина: phase, сколько секунд прошло внутри этапа (el) и его длина (len), всего осталось минут
  function phase(w, t0, now) {
    const m = mins(w), el = Math.max(0, ((now == null ? Date.now() : now) - t0) / 1000);
    const f = m.fill * 60, wa = m.wash * 60;
    let phase = 'wash', st = f, len = wa;
    if (el < f) { phase = 'fill'; st = 0; len = f; }
    else if (el >= f + wa && m.dry > 0) { phase = 'dry'; st = f + wa; len = m.dry * 60; }
    else if (m.fill === 0 && m.dry === 0) { st = 0; len = m.total * 60; }
    return { phase, el: Math.max(0, el - st), len, label: PH[phase], multi: m.fill > 0 || m.dry > 0 };
  }

  // ---- цвет и значок режима стирки: чтобы режимы не путались. Заданные в настройках (color, icon) главнее; иначе по названию ----
  const KD = [[/постел/i, '#4f86f7', '🛏️'], [/махр/i, '#17a99a', '🛁'], [/униформ.*бел|бел.*униформ/i, '#7d8da1', '🥼'], [/униформ|т[её]мн/i, '#455a64', '👔'],
    [/синтет/i, '#a35bd6', '🧵'], [/деликат/i, '#ec5f9b', '🌸'], [/спец/i, '#f08a3c', '🦺']];
  const PAL = ['#e5645a', '#3aa86b', '#c9a227', '#2f9ec7', '#8a6fd1', '#d9693f'];
  const hexOk = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
  const eh = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function kind(w) {
    w = w || {};
    const r = KD.find(k => k[0].test(String(w.name || '')));
    return { color: hexOk(w.color) ? w.color : r ? r[1] : PAL[(+w.id || 0) % PAL.length], icon: w.icon && String(w.icon).trim() ? [...String(w.icon).trim()].slice(0, 2).join('') : r ? r[2] : '🧺' };
  }
  function chip(w) { if (!w) return ''; mount(); const k = kind(w); return `<span class="wk" style="--k:${k.color}" aria-hidden="true">${eh(k.icon)}</span>`; }
  const bub = (x, y, r, p, d) => `<circle class="wm-st" style="animation-duration:${p}s;animation-delay:${(-(((Date.now() / 1000) + off + d) % p)).toFixed(2)}s" cx="${x}" cy="${y}" r="${r}"/>`;
  // заполнение: вода поднимается за время этапа (фаза по часам, перерисовка её не сбрасывает), сверху капает вода
  function fillDoor(z) {
    const dur = Math.max(5, z.len), dl = -Math.min(z.el, dur).toFixed(1);
    const drops = [[30, 0], [44, .27], [56, .55], [68, .14], [37, .41], [62, .68]].map(d => `<circle class="wm-fi" style="animation-delay:${(-(((Date.now() / 1000) + off + d[1]) % .8)).toFixed(2)}s" cx="${d[0]}" cy="10" r="2.2"/>`).join('');
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
<g class="wm-lv" style="animation-duration:${dur}s;animation-delay:${dl}s"><path class="wm-wa wm-dw" style="${ph(1.9)}" d="${wave(44)}"/><path class="wm-wb wm-dw" style="${ph(1.3)}" d="${wave(47)}"/></g>
<g class="wm-dm" style="${ph(3.4)}"><circle class="wm-hl" cx="50" cy="50" r="31"/>
<ellipse class="wm-c1" cx="36" cy="60" rx="11" ry="7" transform="rotate(-25 36 60)"/><circle class="wm-c2" cx="63" cy="43" r="8"/><rect class="wm-c3" x="46" y="66" width="17" height="10" rx="4" transform="rotate(20 54 71)"/></g>
${drops}<path class="wm-sh" d="M24 36a30 30 0 0 1 16-14"/></svg>`;
  }
  // сушка: барабан крутится быстрее, снизу поднимается тёплый воздух и пар, воды нет
  function dryDoor() {
    const hw = [[34, 1], [50, 1.5], [66, .5]].map(h => `<path class="wm-hw" style="animation-delay:${(-(((Date.now() / 1000) + off + h[1]) % 2.2)).toFixed(2)}s" d="M${h[0]} 88q-4-5 0-10t0-10"/>`).join('');
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
<g class="wm-dm" style="${ph(1.5)}"><circle class="wm-hl" cx="50" cy="50" r="31"/>
<ellipse class="wm-c1" cx="36" cy="60" rx="11" ry="7" transform="rotate(-25 36 60)"/><circle class="wm-c2" cx="63" cy="43" r="8"/><rect class="wm-c3" x="46" y="66" width="17" height="10" rx="4" transform="rotate(20 54 71)"/></g>
${hw}${bub(40, 84, 3, 2.8, 0)}${bub(55, 86, 2.4, 2.4, .9)}${bub(66, 82, 3.4, 3, 1.7)}${bub(47, 88, 2, 2.2, 2.1)}
<path class="wm-sh" d="M24 36a30 30 0 0 1 16-14"/></svg>`;
  }
  function door(on, n, pz) {
    if (!on) return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="wm-hl" cx="50" cy="50" r="30"/><path class="wm-sh" d="M24 36a30 30 0 0 1 16-14"/></svg>`;
    if (pz && pz.phase === 'fill') return fillDoor(pz);
    if (pz && pz.phase === 'dry') return dryDoor(pz);
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
    const pz = on && o.ph && o.ph.multi ? o.ph : null, pc = pz && pz.phase !== 'wash' ? ' ' + pz.phase : '';
    return `<span class="wm ${on ? 'on' : ''}${pc} ${o.set ? 'set' : ''}" aria-hidden="true"><span class="wm-t"><span class="wm-k"></span>${drop}${wavei}<span class="wm-s">${scr}</span></span>` +
      `<span class="wm-d">${door(on, n, pz)}<span class="wm-r"></span><b>${n}</b></span></span>`;
  }
  return { html, mount, mins, phase, PH, kind, chip };
})();
