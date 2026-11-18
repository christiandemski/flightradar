// Detail-Panel für das gewählte Flugzeug
import {
  esc, labelOf, airlineOf, airlineName, typeName, CLS_LABEL, KIND_LABEL, SOURCE_LABEL, distanceKm, compass, altColor, vrArrow,
} from '../common.js';

const ago = s => (s < 60 ? `vor ${Math.max(0, Math.round(s))} s` : s < 3600 ? `vor ${Math.round(s / 60)} min` : `vor ${Math.round(s / 3600)} h`);
const de = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Schlüssel für Favoriten und Direktlinks: Flugnummer > Rufzeichen > Kennzeichen > Hex */
export function favKey(ac, det) {
  return (det?.route?.callsignIata || ac.callsign || ac.reg || ac.hex || '').toUpperCase();
}

export function createPanel(app) {
  const el = document.getElementById('panel');
  let cur = { id: null, det: undefined, photoKey: null };

  el.innerHTML = `
    <div class="p-head"><div class="p-logo none" data-x="logo">✈</div><div class="p-title"><div class="p-cs" data-x="cs"></div><div class="p-sub" data-x="sub"></div></div>
      <button class="icon-btn" data-act="close" title="Schließen (Esc)" aria-label="Schließen">✕</button></div>
    <div class="p-body">
      <div class="p-photo" data-x="photo"><div class="nophoto">Kein Foto</div></div>
      <div data-x="badges"></div>
      <div data-x="route"></div>
      <div class="grid" data-x="grid"></div>
      <div class="chart" data-x="chart"><div class="k"><span>Höhenprofil</span><span data-x="chartInfo"></span></div><canvas></canvas></div>
      <div class="p-actions" data-x="actions"></div>
      <div class="ext" data-x="ext"></div>
    </div>`;
  const $ = k => el.querySelector(`[data-x="${k}"]`);

  el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') app.select(null);
    if (act === 'follow') app.setFollow(!app.follow);
    if (act === 'center') app.centerOn(app.selectedId);
    if (act === 'fav' || act === 'share') {
      const ac = app.get(app.selectedId);
      if (!ac) return;
      const key = favKey(ac, app.details(ac));
      if (act === 'fav') {
        const saved = app.favorites.findFor(ac);
        if (saved) { app.favorites.remove(saved); app.toast(`${saved} aus den Favoriten entfernt`); }
        else if (app.favorites.add(key)) app.toast(`${key} in den Favoriten gespeichert`);
        update();
      } else if (!ac.callsign && !ac.reg) {
        // ohne Flugnummer/Kennzeichen (z. B. FLARM): Link auf das Flugzeug selbst
        app.share(null, `Flugzeug ${labelOf(ac)}`, e.target, `/#ac=${encodeURIComponent(ac.id)}`);
      } else app.share(key, `Flug ${key}`, e.target);
    }
  });

  function logo(ac, det) {
    const icao = det?.route?.airline?.icao || airlineOf(ac);
    const box = $('logo');
    if (box.dataset.icao === (icao || '')) return;
    box.dataset.icao = icao || '';
    if (!icao) { box.outerHTML = '<div class="p-logo none" data-x="logo" data-icao="">✈</div>'; return; }
    const img = new Image();
    img.className = 'p-logo';
    img.alt = '';
    img.dataset.x = 'logo';
    img.dataset.icao = icao;
    img.onerror = () => { img.outerHTML = `<div class="p-logo none" data-x="logo" data-icao="${esc(icao)}">✈</div>`; };
    img.src = `/api/logo/${icao}`;
    box.replaceWith(img);
  }

  function photo(ac, det) {
    const p = det?.photo;
    const key = p?.url || (det === undefined ? 'loading' : 'none');
    if (cur.photoKey === key) return;
    cur.photoKey = key;
    const box = $('photo');
    box.classList.toggle('empty', !p);
    if (!p) { box.innerHTML = `<div class="nophoto">${det === undefined ? 'Lade Daten …' : 'Kein Foto vorhanden'}</div>`; return; }
    box.innerHTML = `<img src="${esc(p.url)}" alt="Foto ${esc(ac.reg || '')}" loading="lazy">${p.credit ? (p.link ? `<a class="credit" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.credit)}</a>` : `<span class="credit">${esc(p.credit)}</span>`) : ''}`;
    box.querySelector('img').onerror = () => { box.classList.add('empty'); box.innerHTML = '<div class="nophoto">Foto nicht verfügbar</div>'; };
  }

  function route(ac, det) {
    const r = det?.route;
    const box = $('route');
    if (!r?.origin || !r?.destination) {
      box.className = 'route none';
      box.innerHTML = ac.kind === 'flarm' ? 'FLARM-Sender – keine Flugplandaten' : (det === undefined ? 'Route wird geladen …' : 'Keine Routeninformation');
      return;
    }
    const o = r.origin, d = r.destination, fmt = app.fmt;
    let bar = '', meta = '', warn = '';
    if (o.lat != null && d.lat != null) {
      const flown = distanceKm(o.lat, o.lon, ac.lat, ac.lon);
      const left = distanceKm(ac.lat, ac.lon, d.lat, d.lon);
      const total = distanceKm(o.lat, o.lon, d.lat, d.lon);
      const pct = Math.max(0, Math.min(100, (flown / Math.max(1, flown + left)) * 100));
      bar = `<div class="bar"><i style="width:${pct}%"></i><em style="left:${pct}%">✈</em></div>`;
      const eta = ac.gsKt > 50 && !ac.onGround ? left / (ac.gsKt * 1.852) : null;
      meta = `<div class="meta"><span>${fmt.dist(flown)} geflogen</span><span>${fmt.dist(left)} verbleibend${eta != null ? ` · ~${eta < 1 ? `${Math.round(eta * 60)} min` : `${Math.floor(eta)} h ${Math.round((eta % 1) * 60)} min`}` : ''}</span></div>`;
      if (flown + left > total * 1.35 + 50) warn = '<div class="meta"><span>⚠ Route laut Datenbank – passt nicht zur aktuellen Position</span></div>';
    }
    box.className = 'route';
    box.innerHTML = `
      <div class="ap"><b>${esc(o.iata || o.icao)}</b><span title="${esc(o.name)}">${esc(o.city || o.name || '')}</span></div>
      <div class="mid">→</div>
      <div class="ap dst"><b>${esc(d.iata || d.icao)}</b><span title="${esc(d.name)}">${esc(d.city || d.name || '')}</span></div>
      ${bar}${meta}${warn}`;
  }

  function grid(ac, det) {
    const fmt = app.fmt;
    const age = (app.nowServer() - ac.posTime) / 1000;
    const cell = (k, v, wide) => `<div class="${wide ? 'wide' : ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const a = det?.aircraft;
    const typ = typeName(ac, det);
    const rows = [
      cell('Typ', `${esc(typ || '–')}${ac.icaoType && typ !== ac.icaoType ? ` <small>${esc(ac.icaoType)}</small>` : ''}`, true),
      cell('Kennzeichen', esc(ac.reg || a?.reg || ac.cn || '–')),
      cell(ac.hex ? 'ICAO-Hex' : 'FLARM-ID', esc((ac.hex || ac.id.replace(/^ogn-/, '')).toUpperCase())),
    ];
    if (a?.owner) rows.push(cell('Halter', `${esc(a.owner)}${a.ownerCountry ? ` <small>${esc(a.ownerCountry)}</small>` : ''}`, true));
    rows.push(
      cell('Höhe', `${fmt.alt(ac.altFt, ac.onGround)} ${ac.onGround ? '' : vrArrow(ac.vrFpm)}`),
      cell('Steigrate', fmt.vr(ac.vrFpm)),
      cell('Geschw. (Grund)', fmt.speed(ac.gsKt)),
      cell('Kurs', ac.track != null ? `${Math.round(ac.track)}° <small>${compass(ac.track)}</small>` : '–'),
    );
    if (ac.altGeomFt != null) rows.push(cell('GPS-Höhe', fmt.alt(ac.altGeomFt)));
    if (ac.navAltFt != null) rows.push(cell('Eingest. Höhe', fmt.alt(ac.navAltFt)));
    if (ac.tas != null || ac.ias != null) rows.push(cell('TAS / IAS', `${ac.tas != null ? fmt.speed(ac.tas) : '–'} <small>/ ${ac.ias != null ? fmt.speed(ac.ias) : '–'}</small>`));
    if (ac.mach != null) rows.push(cell('Mach', de(ac.mach, 2)));
    if (ac.windKt != null) rows.push(cell('Wind', `${fmt.speed(ac.windKt)} <small>aus ${Math.round(ac.windDir ?? 0)}°</small>`));
    if (ac.oatC != null) rows.push(cell('Außentemp.', `${Math.round(ac.oatC)} °C`));
    rows.push(
      cell('Squawk', esc(ac.squawk || '–')),
      cell('Signal', esc(KIND_LABEL[ac.kind] || ac.kind || '–')),
      cell('Position', `${de(ac.lat, 4)}, ${de(ac.lon, 4)}`),
      cell('Letzte Meldung', ac.lost ? `<span style="color:var(--alert)">${ago(age)}</span>` : ago(age)),
      cell('Quellen', esc((ac.sources || []).map(s => SOURCE_LABEL[s] || s).join(', ') || '–'), true),
    );
    $('grid').innerHTML = rows.join('');
  }

  function badges(ac) {
    const b = [];
    if (ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk)) b.push(`<span class="badge emg">NOTFALL ${esc(ac.emergency || ac.squawk)}</span>`);
    if (ac.military) b.push('<span class="badge mil">MILITÄR</span>');
    if (ac.ladd || ac.pia) b.push(`<span class="badge hid">FR24-GESPERRT (${[ac.ladd && 'LADD', ac.pia && 'PIA'].filter(Boolean).join('/')})</span>`);
    if (ac.kind === 'flarm') b.push('<span class="badge fl">FLARM</span>');
    if (ac.lost) b.push('<span class="badge lost">KEIN SIGNAL</span>');
    const note = ac.ladd || ac.pia
      ? '<div class="note">Der Halter hat die Anzeige bei kommerziellen Diensten wie Flightradar24 sperren lassen. Die offenen Quellen hier zeigen das Flugzeug trotzdem.</div>'
      : '';
    $('badges').innerHTML = b.length ? `<div class="badges">${b.join('')}</div>${note}` : '';
  }

  function chart(trail, ac) {
    const box = $('chart');
    const pts = (trail || []).filter(p => p[2] != null);
    if (pts.length < 3) { box.hidden = true; return; }
    box.hidden = false;
    const cv = box.querySelector('canvas');
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const t0 = pts[0][3], t1 = Math.max(pts[pts.length - 1][3], t0 + 1);
    const maxAlt = Math.max(1000, ...pts.map(p => p[2])) * 1.1;
    const spd = pts.filter(p => p[4] != null);
    const maxSpd = Math.max(100, ...spd.map(p => p[4])) * 1.1;
    const X = t => ((t - t0) / (t1 - t0)) * (w - 2) + 1;
    const Y = (v, m) => h - 14 - (v / m) * (h - 20);
    // Höhe als Fläche, eingefärbt nach Höhe
    const grad = g.createLinearGradient(0, h, 0, 0);
    for (const a of [0, 0.25, 0.5, 0.75, 1]) grad.addColorStop(a, altColor(a * maxAlt, false, 'alt'));
    g.beginPath();
    g.moveTo(X(pts[0][3]), h - 14);
    for (const p of pts) g.lineTo(X(p[3]), Y(p[2], maxAlt));
    g.lineTo(X(pts[pts.length - 1][3]), h - 14);
    g.closePath();
    g.globalAlpha = 0.35; g.fillStyle = grad; g.fill();
    g.globalAlpha = 1; g.strokeStyle = grad; g.lineWidth = 2;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, X(p[3]), Y(p[2], maxAlt))); g.stroke();
    // Geschwindigkeit als Linie
    if (spd.length > 2) {
      g.strokeStyle = 'rgba(255, 255, 255, .55)'; g.lineWidth = 1.2; g.setLineDash([3, 3]);
      g.beginPath(); spd.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, X(p[3]), Y(p[4], maxSpd))); g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = '#8b9cb8'; g.font = '10px Inter, sans-serif'; g.textBaseline = 'bottom';
    g.fillText(`vor ${Math.round((t1 - t0) / 60000)} min`, 2, h);
    g.textAlign = 'right'; g.fillText('jetzt', w - 2, h);
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`max. ${app.fmt.alt(Math.max(...pts.map(p => p[2])))}`, 2, 0);
    $('chartInfo').textContent = spd.length > 2 ? 'Fläche: Höhe · gestrichelt: Geschwindigkeit' : '';
    void ac;
  }

  function actions(ac) {
    $('actions').innerHTML = `
      <button class="btn ${app.follow ? 'on' : ''}" data-act="follow" title="Karte folgt dem Flugzeug">${app.follow ? '◉ Folgen an' : '◎ Folgen'}</button>
      <button class="btn" data-act="center">Zentrieren</button>
      <button class="btn ${app.favorites.findFor(ac) ? 'fav-on' : ''}" data-act="fav" title="In den Favoriten speichern">${app.favorites.findFor(ac) ? '★ Gemerkt' : '☆ Merken'}</button>
      <button class="btn" data-act="share" title="Direktlink zu diesem Flug teilen">↗ Teilen</button>`;
    const hex = ac.hex;
    const links = [];
    if (hex) {
      links.push(`<a href="https://globe.adsb.fi/?icao=${hex}" target="_blank" rel="noopener">adsb.fi</a>`);
      links.push(`<a href="https://globe.adsbexchange.com/?icao=${hex}" target="_blank" rel="noopener">ADS-B Exchange</a>`);
      links.push(`<a href="https://www.planespotters.net/hex/${hex.toUpperCase()}" target="_blank" rel="noopener">Planespotters</a>`);
    }
    if (ac.reg) links.push(`<a href="https://www.flightradar24.com/data/aircraft/${encodeURIComponent(ac.reg.toLowerCase())}" target="_blank" rel="noopener">Flightradar24</a>`);
    $('ext').innerHTML = links.length ? `Extern: ${links.join('')}` : '';
  }

  function head(ac, det) {
    const r = det?.route;
    const airline = r?.airline?.name || airlineName(airlineOf(ac));
    const flightNo = r?.callsignIata && r.callsignIata !== ac.callsign ? r.callsignIata : '';
    $('cs').innerHTML = `${esc(labelOf(ac))}${flightNo ? `<small>${esc(flightNo)}</small>` : ''}`;
    $('sub').textContent = [airline, typeName(ac, det) || CLS_LABEL[ac.cls]].filter(Boolean).join(' · ');
  }

  function update() {
    const ac = app.get(app.selectedId);
    if (!ac) return;
    const det = app.details(ac);
    head(ac, det);
    logo(ac, det);
    photo(ac, det);
    badges(ac);
    route(ac, det);
    grid(ac, det);
    chart(app.trail, ac);
    actions(ac);
  }

  return {
    show() {
      if (cur.id !== app.selectedId) { cur = { id: app.selectedId, photoKey: null }; el.querySelector('.p-body').scrollTop = 0; }
      el.hidden = false;
      update();
    },
    hide() { el.hidden = true; cur = { id: null, photoKey: null }; },
    update() { if (!el.hidden) update(); },
  };
}
