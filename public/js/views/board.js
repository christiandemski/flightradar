import { airlineName, airlineOf, compass, labelOf, CLS_LABEL, logoHtml } from '../common.js';

// Abflugtafel-Optik: feste Spaltenbreiten in Zeichen, geänderte Felder "klappen" um
const COLS = [
  ['Flug', 8], ['Airline', 13], ['Von', 4], ['Nach', 4], ['Typ', 4], ['Höhe', 7], ['Tempo', 5], ['Entf.', 6], ['Ri.', 3],
];

export function create(el, ctx) {
  const logos = !!ctx.screen?.showLogos;
  const logoCol = c => (logos && c === 1 ? '<span class="blogo"></span>' : '');
  el.innerHTML = `<div class="board"><div class="brow bhead">${COLS.map(([n, w], c) => `${logoCol(c)}<span class="bc" style="--w:${w}">${n}</span>`).join('')}</div><div class="brows"></div></div>`;
  const rowsEl = el.querySelector('.brows');
  const prev = new Map(); // "row:col" -> text

  function cells(ac) {
    const fmt = ctx.fmt;
    const det = ctx.details(ac);
    const r = det?.route;
    const al = r?.airline?.name || airlineName(airlineOf(ac)) || CLS_LABEL[ac.cls] || '';
    return [
      labelOf(ac),
      al,
      r?.origin ? r.origin.iata || r.origin.icao : '',
      r?.destination ? r.destination.iata || r.destination.icao : '',
      ac.icaoType || '',
      fmt.altShort(ac.altFt, ac.onGround),
      fmt.speedNum(ac.gsKt),
      fmt.dist(ac.distKm).replace(' ', ''),
      compass(ac.bearing),
    ];
  }

  function render() {
    const rowH = parseFloat(getComputedStyle(el).fontSize) * 2.4;
    const n = Math.max(3, Math.floor(rowsEl.clientHeight / rowH) || 10);
    const list = ctx.aircraft.filter(a => !a.onGround).slice(0, n);
    let html = '';
    for (let i = 0; i < n; i++) {
      const ac = list[i];
      const vals = ac ? cells(ac) : COLS.map(() => '');
      html += `<div class="brow${ac?.id === ctx.focusId ? ' focus' : ''}">`;
      vals.forEach((v, c) => {
        const w = COLS[c][1];
        const text = String(v).toUpperCase().slice(0, w).padEnd(w, ' ');
        const key = `${i}:${c}`;
        const changed = prev.has(key) && prev.get(key) !== text;
        prev.set(key, text);
        if (logos && c === 1) html += `<span class="blogo">${ac ? logoHtml(ctx, ac) : ''}</span>`;
        html += `<span class="bc${changed ? ' flip' : ''}" style="--w:${w}">${[...text].map(ch => `<i>${ch === ' ' ? '&nbsp;' : ch.replace('<', '&lt;')}</i>`).join('')}</span>`;
      });
      html += '</div>';
    }
    rowsEl.innerHTML = html;
  }

  return { update: render, unmount() {} };
}
