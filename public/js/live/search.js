// Suche: Flugnummer, Rufzeichen, Kennzeichen, Hex, Typ und Flughäfen
import { esc, labelOf, airlineOf, airlineName, CLS_LABEL } from '../common.js';

const MATCH = { callsign: 'Rufzeichen', 'callsign-prefix': 'Rufzeichen', reg: 'Kennzeichen', 'reg-prefix': 'Kennzeichen', hex: 'Hex', cn: 'Wettbewerbsk.', type: 'Typ', global: 'weltweit' };

export function createSearch(app) {
  const input = document.getElementById('q');
  const box = document.getElementById('results');
  let items = [], active = -1, seq = 0, deb;

  function render(res, q, loading) {
    items = [];
    const html = [];
    if (res.aircraft?.length) {
      html.push('<li class="grp">Flugzeuge</li>');
      for (const ac of res.aircraft.slice(0, 12)) {
        const i = items.push({ kind: 'ac', ac }) - 1;
        const al = airlineName(airlineOf(ac));
        const icao = airlineOf(ac);
        html.push(`<li class="item" data-i="${i}" role="option">
          <span class="ic">${icao ? `<img src="/api/logo/${icao}" alt="" onerror="this.replaceWith('✈')">` : '✈'}</span>
          <span class="main"><span class="t1">${esc(labelOf(ac))}${ac.reg && ac.callsign ? ` · ${esc(ac.reg)}` : ''}</span>
          <span class="t2">${esc([al, ac.icaoType || CLS_LABEL[ac.cls], app.fmt.alt(ac.altFt, ac.onGround)].filter(Boolean).join(' · '))}</span></span>
          <span class="tag">${MATCH[ac.match] || ''}</span></li>`);
      }
    }
    if (res.airports?.length) {
      html.push('<li class="grp">Flughäfen</li>');
      for (const a of res.airports) {
        const i = items.push({ kind: 'ap', ap: a }) - 1;
        html.push(`<li class="item" data-i="${i}" role="option"><span class="ic">🛬</span>
          <span class="main"><span class="t1">${esc(a.name)}</span><span class="t2">${esc([a.city, a.country].filter(Boolean).join(', '))}</span></span>
          <span class="tag">${esc(a.iata || a.icao)}</span></li>`);
      }
    }
    if (!items.length) html.push(`<li class="hint">${loading ? 'Suche …' : `Nichts gefunden für „${esc(q)}“. Flugzeuge außerhalb des Kartenausschnitts findet die Suche über Rufzeichen, Flugnummer, Kennzeichen oder Hex-Code.`}</li>`);
    else if (loading) html.push('<li class="hint">Suche weltweit …</li>');
    box.innerHTML = html.join('');
    box.hidden = false;
    active = items.length ? 0 : -1;
    mark();
  }

  function mark() {
    box.querySelectorAll('.item').forEach(li => li.classList.toggle('active', Number(li.dataset.i) === active));
    box.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
  }

  async function run(q) {
    const id = ++seq;
    if (q.length < 2) { box.hidden = true; return; }
    // erst lokal (schnell), dann mit weltweiter Suche
    try {
      const local = await (await fetch(`/api/search?global=0&q=${encodeURIComponent(q)}`)).json();
      if (id !== seq) return;
      const exact = local.aircraft.some(a => ['callsign', 'reg', 'hex'].includes(a.match));
      render(local, q, !exact && q.length >= 3);
      if (exact || q.length < 3) return;
      const all = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
      if (id !== seq) return;
      render(all, q, false);
    } catch {
      if (id === seq) { box.innerHTML = '<li class="hint">Suche gerade nicht möglich</li>'; box.hidden = false; }
    }
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    box.hidden = true;
    input.blur();
    if (it.kind === 'ac') app.selectFromSearch(it.ac);
    else app.showAirport(it.ap);
  }

  input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => run(input.value.trim()), 280); });
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) box.hidden = false; });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (active >= 0) choose(active); else { clearTimeout(deb); run(input.value.trim()); } }
    else if (e.key === 'Escape') { box.hidden = true; input.blur(); }
  });
  box.addEventListener('mousedown', e => { const li = e.target.closest('.item'); if (li) { e.preventDefault(); choose(Number(li.dataset.i)); } });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#search')) box.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input && !e.target.closest('input, select, textarea')) { e.preventDefault(); input.focus(); input.select(); }
  });
}
