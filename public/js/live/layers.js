// Karten, Ebenen (Flughäfen, Regenradar, Tag/Nacht, Lufträume) und das Ebenen-/Filter-Menü
import { esc, altColor } from '../common.js';
import { settings, save, DEFAULTS, filterActive } from './settings.js';

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export const BASEMAPS = {
  dark: { name: 'Dunkel', swatch: '#1d2a3f', make: L => L.tileLayer(OSM, { maxZoom: 19, className: 'tl-dark', attribution: OSM_ATTR }) },
  light: { name: 'Straße', swatch: '#e8e4d8', make: L => L.tileLayer(OSM, { maxZoom: 19, attribution: OSM_ATTR }) },
  gray: { name: 'Grau', swatch: '#cfd3d8', make: L => L.tileLayer(OSM, { maxZoom: 19, className: 'tl-gray', attribution: OSM_ATTR }) },
  topo: {
    name: 'Gelände', swatch: '#b9c99a',
    make: L => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc', attribution: `${OSM_ATTR}, SRTM | Stil: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)` }),
  },
  sat: {
    name: 'Satellit', swatch: '#3b4a33',
    make: L => L.layerGroup([
      L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 18, attribution: 'Bilder © Esri, Maxar, Earthstar Geographics' }),
      L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 18, className: 'tl-sat-labels' }),
    ]),
  },
};

const ALT_LEVELS = [0, 1000, 2000, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 60000];

export function createLayers(map, app, { openaipKey, onFilter, onUnits, onLabels }) {
  const L = window.L;
  let base = null;
  const over = {};

  // ---------- Basiskarte ----------
  function setBase(id) {
    if (!BASEMAPS[id]) id = DEFAULTS.base;
    if (base) map.removeLayer(base);
    base = BASEMAPS[id].make(L).addTo(map);
    if (base.bringToBack) base.bringToBack();
    settings.base = id;
    save();
  }

  // ---------- Flughäfen ----------
  const apLayer = L.layerGroup();
  const apRenderer = L.svg({ padding: 0.2 });
  let apReq = 0;
  async function loadAirports() {
    if (!settings.overlays.airports) return;
    const b = map.getBounds().pad(0.2);
    const z = map.getZoom();
    const id = ++apReq;
    try {
      const res = await fetch(`/api/airports?b=${b.getSouth().toFixed(3)},${b.getWest().toFixed(3)},${b.getNorth().toFixed(3)},${b.getEast().toFixed(3)}&z=${Math.floor(z)}`);
      const list = await res.json();
      if (id !== apReq) return;
      apLayer.clearLayers();
      for (const a of list) {
        const m = L.circleMarker([a.lat, a.lon], {
          renderer: apRenderer, radius: a.size === 3 ? 5 : a.size === 2 ? 3.5 : 2.5, weight: a.size === 3 ? 1.5 : 1,
          color: a.size === 3 ? '#ffffff' : 'rgba(0, 0, 0, .6)', fillColor: a.size === 3 ? '#ffb547' : a.size === 2 ? '#c9a46a' : '#8b9cb8', fillOpacity: 0.95,
          bubblingMouseEvents: false,
        });
        const showLabel = (a.size === 3 && z >= 5) || (a.size === 2 && z >= 8) || z >= 10;
        if (showLabel) m.bindTooltip(a.iata || a.icao, { permanent: true, direction: 'right', offset: [5, 0], className: 'ap-label' });
        m.on('click', e => {
          const hit = app.hitAircraft(e.containerPoint);
          if (hit) return app.select(hit);
          openAirport(a, m);
        });
        apLayer.addLayer(m);
      }
    } catch { /* Flughäfen später erneut */ }
  }

  function openAirport(a, m) {
    const size = { 3: 'Großer Flughafen', 2: 'Flughafen', 1: 'Flugplatz' }[a.size];
    const elev = a.elevFt != null ? (settings.units === 'aviation' ? `${a.elevFt} ft` : `${Math.round(a.elevFt * 0.3048)} m`) : '';
    const html = `<div class="apop"><h3>${esc(a.name)}</h3>
      <div class="codes">${[a.iata, a.icao].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="muted">${esc([a.city, a.country].filter(Boolean).join(', '))}${elev ? ` · Höhe ${elev}` : ''} · ${size}</div>
      <div class="metar">${a.icao ? '<pre>METAR wird geladen …</pre>' : ''}</div></div>`;
    m.bindPopup(html, { maxWidth: 320 }).openPopup();
    m.off('popupclose').on('popupclose', () => m.unbindPopup());
    if (!a.icao) return;
    fetch(`/api/metar?icao=${a.icao}`).then(r => r.json()).then(({ metar }) => {
      const el = m.getPopup()?.getElement()?.querySelector('.metar');
      if (!el) return;
      el.innerHTML = metar
        ? `<pre>${metar.cat ? `<span class="cat cat-${esc(metar.cat)}">${esc(metar.cat)}</span>  ` : ''}${esc(metar.raw)}</pre>`
        : '<pre>Kein aktuelles METAR</pre>';
    }).catch(() => {});
  }

  // ---------- Regenradar (RainViewer) ----------
  let rain = null, rainTimer = 0;
  async function updateRain() {
    clearTimeout(rainTimer);
    if (!settings.overlays.rain) return;
    try {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      const frame = j.radar?.past?.[j.radar.past.length - 1];
      if (!frame || !settings.overlays.rain) return;
      const url = `${j.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
      const next = L.tileLayer(url, { opacity: 0.6, maxNativeZoom: 7, maxZoom: 19, zIndex: 5, attribution: 'Regenradar © <a href="https://www.rainviewer.com">RainViewer</a>' });
      next.addTo(map);
      if (rain) { const old = rain; setTimeout(() => map.removeLayer(old), 1500); }
      rain = next;
    } catch { /* Radar nicht erreichbar */ }
    rainTimer = setTimeout(updateRain, 10 * 60e3);
  }
  function removeRain() { clearTimeout(rainTimer); if (rain) map.removeLayer(rain); rain = null; }

  // ---------- Tag/Nacht-Grenze ----------
  let night = null, nightTimer = 0;
  function nightPolygon(date) {
    const n = date.getTime() / 86400000 + 2440587.5 - 2451545;
    const Lm = (280.46 + 0.9856474 * n) % 360;
    const gm = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
    const lambda = (Lm + 1.915 * Math.sin(gm) + 0.02 * Math.sin(2 * gm)) * Math.PI / 180;
    const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * 180 / Math.PI;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const gmst = ((18.697374558 + 24.06570982441908 * n) % 24) * 15;
    const sunLon = ((ra - gmst + 540) % 360) - 180;
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const lat = Math.atan(-Math.cos((lon - sunLon) * Math.PI / 180) / Math.tan(dec)) * 180 / Math.PI;
      pts.push([lat, lon]);
    }
    const pole = dec > 0 ? -89.9 : 89.9;
    return [[pole, -180], ...pts, [pole, 180]];
  }
  function updateNight() {
    clearTimeout(nightTimer);
    if (!settings.overlays.night) return;
    const pts = nightPolygon(new Date());
    // dreimal nebeneinander, damit es auch über die Datumsgrenze hinaus passt
    const rings = [-360, 0, 360].map(off => pts.map(([la, lo]) => [la, lo + off]));
    if (night) night.setLatLngs(rings);
    else night = L.polygon(rings, { stroke: false, fillColor: '#000814', fillOpacity: 0.32, interactive: false, className: 'night-poly' }).addTo(map);
    nightTimer = setTimeout(updateNight, 5 * 60e3);
  }
  function removeNight() { clearTimeout(nightTimer); if (night) map.removeLayer(night); night = null; }

  // ---------- Lufträume (openAIP, nur mit Schlüssel) ----------
  let airspace = null;
  function setAirspace(on) {
    if (airspace) { map.removeLayer(airspace); airspace = null; }
    if (on && openaipKey) {
      airspace = L.tileLayer(`https://{s}.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(openaipKey)}`, {
        subdomains: 'abc', maxZoom: 19, maxNativeZoom: 14, minZoom: 4, zIndex: 6, attribution: 'Lufträume © <a href="https://www.openaip.net">openAIP</a>',
      }).addTo(map);
    }
  }

  function applyOverlays() {
    if (settings.overlays.airports) { apLayer.addTo(map); loadAirports(); } else { map.removeLayer(apLayer); apLayer.clearLayers(); }
    if (settings.overlays.rain) { if (!rain) updateRain(); } else removeRain();
    if (settings.overlays.night) updateNight(); else removeNight();
    setAirspace(settings.overlays.airspace);
  }

  let apDeb;
  map.on('moveend', () => { clearTimeout(apDeb); apDeb = setTimeout(loadAirports, 250); });

  // ---------- Menü ----------
  const sheet = document.getElementById('layers');
  const btn = document.getElementById('btnLayers');
  const dot = document.getElementById('filterDot');

  const fmtAlt = ft => (settings.units === 'aviation'
    ? (ft >= 6000 ? `FL${ft / 100}` : `${ft.toLocaleString('de-DE')} ft`)
    : `${(Math.round((ft * 0.3048) / 50) * 50).toLocaleString('de-DE')} m`);

  function render() {
    const f = settings.filter;
    const chk = (path, label, hint = '', sw = '') => {
      const [grp, key] = path.split('.');
      const val = key ? settings[grp][key] : settings[grp];
      return `<label class="opt"><input type="checkbox" data-path="${path}" ${val ? 'checked' : ''}>${sw ? `<i class="sw" style="background:${sw}"></i>` : ''}<span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    };
    const altOpts = sel => ALT_LEVELS.map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${v === 60000 ? 'unbegrenzt' : fmtAlt(v)}</option>`).join('');
    const legend = [0, 2000, 4000, 6000, 8000, 10000, 15000, 20000, 25000, 30000, 35000, 40000].map(a => `<i style="flex:1;background:${altColor(a, false, 'alt')}"></i>`).join('');
    sheet.innerHTML = `
      <h4>Karte</h4>
      <div class="basemaps">${Object.entries(BASEMAPS).map(([id, b]) => `
        <label><input type="radio" name="base" value="${id}" ${settings.base === id ? 'checked' : ''}>
          <span class="bm"><span class="sw" style="background:${b.swatch}"></span><span class="nm">${b.name}</span></span></label>`).join('')}
      </div>
      <h4>Ebenen</h4>
      ${chk('overlays.airports', 'Flughäfen', 'Klick zeigt Name und aktuelles Wetter (METAR)')}
      ${chk('overlays.rain', 'Regenradar', 'RainViewer, alle 10 Minuten aktualisiert')}
      ${chk('overlays.night', 'Tag/Nacht-Grenze')}
      ${openaipKey ? chk('overlays.airspace', 'Lufträume', 'openAIP') : ''}
      ${chk('labels', 'Beschriftungen', 'Rufzeichen, ab Zoomstufe 9 mit Höhe und Typ')}
      <h4>Einheiten</h4>
      <div class="seg" id="units"><button type="button" data-u="metric" class="${settings.units === 'metric' ? 'on' : ''}">Metrisch (m, km/h)</button><button type="button" data-u="aviation" class="${settings.units === 'aviation' ? 'on' : ''}">Luftfahrt (ft, kt)</button></div>
      <h4>Filter</h4>
      ${chk('filter.airliner', 'Verkehrs- und Geschäftsflugzeuge')}
      ${chk('filter.light', 'Kleinflugzeuge')}
      ${chk('filter.heli', 'Hubschrauber')}
      ${chk('filter.glider', 'Segelflugzeuge, Ballone, Drohnen')}
      ${chk('filter.flarm', 'FLARM-Sender (OGN)', 'Segelflug und Kleinflugzeuge ohne ADS-B')}
      ${chk('filter.ground', 'Am Boden', 'Rollende Flugzeuge und Bodenfahrzeuge')}
      ${chk('filter.onlyMil', 'Nur Militär', '', 'var(--mil)')}
      ${chk('filter.onlyHidden', 'Nur bei FR24 gesperrte', 'LADD/PIA – dort nicht oder anonym zu sehen', 'var(--hid)')}
      <div class="range" style="margin-top:6px">
        <label>Höhe ab<select data-alt="minAlt">${altOpts(f.minAlt)}</select></label>
        <label>bis<select data-alt="maxAlt">${altOpts(f.maxAlt)}</select></label>
      </div>
      <div class="legend">${legend}</div>
      <div class="legend-lbl"><span>Boden</span><span>${fmtAlt(10000)}</span><span>${fmtAlt(40000)}</span></div>
      <p style="margin:12px 0 0"><button type="button" class="lnk" id="resetFilter">Filter zurücksetzen</button></p>`;
    dot.hidden = !filterActive();
  }

  sheet.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'base') return setBase(t.value);
    if (t.dataset.alt) {
      settings.filter[t.dataset.alt] = Number(t.value);
      if (settings.filter.minAlt > settings.filter.maxAlt) settings.filter[t.dataset.alt === 'minAlt' ? 'maxAlt' : 'minAlt'] = Number(t.value);
      save(); render(); return onFilter();
    }
    const path = t.dataset.path;
    if (!path) return;
    const [grp, key] = path.split('.');
    if (key) settings[grp][key] = t.checked; else settings[grp] = t.checked;
    save();
    dot.hidden = !filterActive();
    if (grp === 'overlays') applyOverlays();
    else if (grp === 'labels') onLabels();
    else onFilter();
  });
  sheet.addEventListener('click', e => {
    const u = e.target.closest('[data-u]');
    if (u) { settings.units = u.dataset.u; save(); render(); onUnits(); }
    if (e.target.id === 'resetFilter') { settings.filter = structuredClone(DEFAULTS.filter); save(); render(); onFilter(); }
  });
  const toggle = open => {
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) render();
  };
  btn.addEventListener('click', () => toggle(sheet.hidden));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) toggle(false); });
  map.on('click', () => toggle(false));

  setBase(settings.base);
  applyOverlays();
  dot.hidden = !filterActive();
  return { close: () => toggle(false) };
}
