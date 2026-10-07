// Числа без округления: показываем столько знаков, сколько в числе есть на самом деле.
//   0,175 → «0,175»   0,350 → «0,35»   12,0 → «12»   1234,5 → «1 234,5»
// Лишние нули справа убираются, но цифры не округляются. Единственное, что скрыто, — «хвост» двоичной арифметики
// (0,1 + 0,2 = 0,30000000000000004 показывается как «0,3»).
// Показывается до 6 знаков после запятой (дальше идёт только «хвост» деления, вроде 1/3). При желании
// можно передать другое число знаков: Num.fmt(x, 3).
const Num = (() => {
  const clean = n => Number(Number(n).toPrecision(12));              // убирает хвост плавающей точки
  function fmt(n, max = 6) {
    n = +n;
    if (!isFinite(n)) return '–';
    const s = clean(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: max });
    return /^[-−]0$/.test(s) ? '0' : s;                           // «-0» не показываем
  }
  // число для значения в поле ввода (точка, без пробелов): 0.175 → "0.175"
  const plain = n => { n = +n; return isFinite(n) ? String(clean(n)) : ''; };
  // число из текста, в том числе с запятой: "0,175" → 0.175; пусто или мусор → NaN
  const parse = s => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? NaN : Number(t); };
  return { fmt, plain, parse, clean };
})();
if (typeof module !== 'undefined') module.exports = Num;
