import { altColor, cssVar, extrapolate, iconSvg, labelOf, nearListHtml, esc, typeShort, logoHtml } from '../common.js';

let leafletP;
function loadLeaflet() {
  leafletP ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = reject;
    document.head.append(js);
  });
  return leafletP;
}

export function create(el, ctx) {
  el.innerHTML = `<div class="map-wrap"><div class="map"></div></div>
    <aside class="side card"><h3>In der Nähe</h3><ol class="near"></ol></aside>`;
  const mapEl = el.querySelector('.map');
  const nearEl = el.querySelector('.near');
  let map, L, timer, alive = true;
  const markers = new Map(); // id -> { m, trail }

  const theme = {
    tiles: cssVar('--map-tiles') || 'dark', acMode: cssVar('--ac-mode') || 'alt', ac: cssVar('--ac'),
    ring: cssVar('--ring-strong'), accent: cssVar('--accent'), alert: cssVar('--alert'),
  };

  loadLeaflet().then(lib => {
    if (!alive) return;
    L = lib;
    const s = ctx.screen;
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, zoomSnap: 0.25 }).setView([s.lat, s.lon], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap-Mitwirkende',
    }).addTo(map);
    const outer = L.circle([s.lat, s.lon], { radius: s.radiusKm * 1000, color: theme.ring, weight: 1.5, fill: false, interactive: false }).addTo(map);
    for (const f of [0.25, 0.5, 0.75]) {
      L.circle([s.lat, s.lon], { radius: s.radiusKm * 1000 * f, color: theme.ring, weight: 1, dashArray: '4 6', fill: false, interactive: false }).addTo(map);
    }
    L.circleMarker([s.lat, s.lon], { radius: 6, color: theme.accent, fillColor: theme.accent, fillOpacity: 1, weight: 2 }).addTo(map);
    const fit = () => { map.invalidateSize(); map.fitBounds(outer.getBounds(), { padding: [10, 10] }); };
    fit();
    new ResizeObserver(fit).observe(mapEl);
    sync();
    timer = setInterval(move, 1000);
  }).catch(err => {
    console.error('Karte:', err);
    mapEl.innerHTML = '<div class="empty">Karte konnte nicht geladen werden (offline?)</div>';
  });

  function colorOf(ac) {
    const emergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
    return emergency ? theme.alert : altColor(ac.altFt, ac.onGround, theme.acMode, theme.ac);
  }

  function html(ac) {
    const focus = ac.id === ctx.focusId ? ' focus' : '';
    return `<div class="ac-mk${focus}">${iconSvg(ac, colorOf(ac), 26)}<span class="ac-lbl">${logoHtml(ctx, ac, 'sm')}${esc(labelOf(ac))}${typeShort(ac) ? `<span class="t">${esc(typeShort(ac))}</span>` : ''}<small>${ctx.fmt.altShort(ac.altFt, ac.onGround)} · ${ctx.fmt.speed(ac.gsKt)}</small></span></div>`;
  }

  function sync() {
    if (!map) return;
    const seen = new Set();
    const now = ctx.nowServer();
    for (const ac of ctx.aircraft) {
      seen.add(ac.id);
      const pos = extrapolate(ac, now);
      let e = markers.get(ac.id);
      const icon = L.divIcon({ className: 'ac-icon', html: html(ac), iconSize: [0, 0] });
      if (!e) {
        e = {
          m: L.marker(pos, { icon, interactive: false, keyboard: false }).addTo(map),
          trail: L.polyline([], { weight: 2, opacity: 0.55, interactive: false }).addTo(map),
        };
        markers.set(ac.id, e);
      } else {
        e.m.setIcon(icon);
      }
      e.ac = ac;
      e.trail.setStyle({ color: colorOf(ac) });
      e.trail.setLatLngs([...(ac.trail || []).map(p => [p[0], p[1]]), pos]);
      e.m.setLatLng(pos);
    }
    for (const [id, e] of markers) {
      if (!seen.has(id)) { e.m.remove(); e.trail.remove(); markers.delete(id); }
    }
  }

  function move() {
    const now = ctx.nowServer();
    for (const e of markers.values()) {
      const pos = extrapolate(e.ac, now);
      e.m.setLatLng(pos);
      const ll = e.trail.getLatLngs();
      if (ll.length) { ll[ll.length - 1] = L.latLng(pos); e.trail.setLatLngs(ll); }
    }
  }

  return {
    update() {
      sync();
      nearEl.innerHTML = nearListHtml(ctx, ctx.aircraft.slice(0, 9));
    },
    unmount() {
      alive = false;
      clearInterval(timer);
      map?.remove();
    },
  };
}
