// Live-Karte: frei bewegliche Karte mit allen Flugzeugen, Suche, Details und Ebenen
import { makeFmt, labelOf, extrapolate, esc, typeShort, SOURCE_LABEL } from '../common.js';
import { settings, save, passes } from './settings.js';
import { createAircraftLayer } from './aclayer.js';
import { createLayers } from './layers.js';
import { createPanel } from './panel.js';
import { createSearch } from './search.js';

const L = window.L;
const POLL_MS = 5000;

// ---------- Zustand ----------
const app = {
  settings,
  fmt: makeFmt(settings.units),
  aircraft: new Map(),
  serverOffset: 0,
  selectedId: null,
  follow: false,
  trail: [],
  nowServer: () => Date.now() + app.serverOffset,
  get: id => (id ? app.aircraft.get(id) : null),
  visible: ac => passes(ac),
};

// ---------- Karte ----------
const hash = new URLSearchParams(location.hash.slice(1));
const ll = (hash.get('ll') || '').split(',').map(Number);
const start = ll.length === 3 && ll.every(Number.isFinite) ? { lat: ll[0], lon: ll[1], z: ll[2] } : settings.view;
const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 3, maxZoom: 18, zoomSnap: 0.5, preferCanvas: false })
  .setView([start.lat, start.lon], start.z);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
map.attributionControl.setPrefix('');

// Mein Standort (nur auf Knopfdruck)
const Locate = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() {
    const bar = L.DomUtil.create('div', 'leaflet-bar');
    const a = L.DomUtil.create('a', 'locate-btn', bar);
    a.href = '#';
    a.title = 'Mein Standort';
    a.setAttribute('role', 'button');
    a.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"/></svg>';
    L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); locate(); });
    return bar;
  },
});
new Locate().addTo(map);
let meMarker = null;
function locate() {
  if (!navigator.geolocation) return toast('Standort wird von diesem Browser nicht unterstützt');
  navigator.geolocation.getCurrentPosition(p => {
    const pos = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) meMarker = L.marker(pos, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(map);
    else meMarker.setLatLng(pos);
    map.setView(pos, Math.max(map.getZoom(), 9));
  }, () => toast('Standort nicht verfügbar'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

const layer = createAircraftLayer(map, app);
app.hitAircraft = pt => layer.hit(pt);
const panel = createPanel(app);

// ---------- Hinweise ----------
const banner = document.getElementById('banner');
let toastTimer;
function toast(msg) {
  banner.textContent = msg;
  banner.dataset.kind = 'toast';
  banner.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { banner.dataset.kind = ''; showCoverageHint(); }, 4000);
}
let partial = false;
function showCoverageHint() {
  if (banner.dataset.kind === 'toast') return;
  banner.hidden = !partial;
  if (partial) banner.textContent = 'Weit herausgezoomt: Flugzeuge nur im markierten Umkreis (ca. 460 km) um die Kartenmitte';
}

// ---------- Detaildaten (Route, Typ, Foto) ----------
const detCache = new Map();
app.details = ac => {
  const key = `${ac.hex || ''}|${ac.callsign || ''}`;
  if (!ac.hex && !ac.callsign) return null;
  const hit = detCache.get(key);
  if (hit) return hit.value;
  detCache.set(key, { value: undefined });
  fetch(`/api/details?hex=${encodeURIComponent(ac.hex || '')}&cs=${encodeURIComponent(ac.callsign || '')}`)
    .then(r => r.json())
    .then(v => { detCache.set(key, { value: v }); if (ac.id === app.selectedId) panel.update(); })
    .catch(() => detCache.set(key, { value: null }));
  return undefined;
};

// ---------- Daten laden ----------
let pollTimer, ctrl, lastBounds = null;
async function poll() {
  clearTimeout(pollTimer);
  ctrl?.abort();
  ctrl = new AbortController();
  const b = map.getBounds().pad(0.25);
  const bb = x => [x.getSouth(), x.getWest(), x.getNorth(), x.getEast()].map(v => v.toFixed(3)).join(',');
  try {
    const res = await fetch(`/api/live?b=${bb(b)}&v=${bb(map.getBounds())}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    apply(await res.json());
    lastBounds = b;
  } catch (e) {
    if (e.name === 'AbortError') return;
    document.getElementById('stCount').textContent = 'Keine Verbindung zum Server – neuer Versuch …';
  }
  pollTimer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
}

function apply(j) {
  app.serverOffset = j.serverTime - Date.now();
  const next = new Map();
  for (const ac of j.aircraft) next.set(ac.id, ac);
  // gewähltes Flugzeug behalten, auch wenn es gerade nicht gemeldet wird
  const sel = app.aircraft.get(app.selectedId);
  if (sel && !next.has(sel.id) && app.nowServer() - sel.posTime < 10 * 60e3) next.set(sel.id, { ...sel, lost: true });
  app.aircraft = next;
  layer.setData([...next.values()]);
  partial = j.partial;
  layer.setCoverage(j.partial ? j.coverage : null);
  showCoverageHint();
  status(j.sources);
  const cur = app.get(app.selectedId);
  if (cur && !cur.lost && app.trail.length) {
    const last = app.trail[app.trail.length - 1];
    if (cur.posTime > last[3]) app.trail.push([cur.lat, cur.lon, cur.altFt ?? 0, cur.posTime, cur.gsKt]);
    layer.setTrail(app.trail);
  }
  panel.update();
}

function status(sources = []) {
  const all = [...app.aircraft.values()];
  const vis = all.filter(passes);
  const b = map.getBounds();
  const inView = vis.filter(a => b.contains([a.lat, a.lon]));
  const n = k => inView.filter(k).length;
  const extra = [
    n(a => a.kind === 'flarm') && `${n(a => a.kind === 'flarm')} FLARM`,
    n(a => a.military) && `${n(a => a.military)} Militär`,
    n(a => a.ladd || a.pia) && `${n(a => a.ladd || a.pia)} bei FR24 gesperrt`,
  ].filter(Boolean).join(' · ');
  const hidden = all.length - vis.length;
  document.getElementById('stCount').innerHTML = `<b>${inView.length.toLocaleString('de-DE')}</b> Flugzeuge im Ausschnitt${extra ? ` · ${extra}` : ''}${hidden ? ` · ${hidden} ausgefiltert` : ''}`;
  document.getElementById('stSources').innerHTML = sources.map(s => `<span class="src ${s.ok ? 'ok' : s.error ? 'err' : ''}" title="${esc(s.error || `${s.count} Flugzeuge`)}">${esc(SOURCE_LABEL[s.id] || s.name)}</span>`).join('');
}

// ---------- Auswahl ----------
let trailTimer;
async function loadTrail() {
  clearTimeout(trailTimer);
  const id = app.selectedId;
  if (!id) return;
  try {
    const j = await (await fetch(`/api/trail?id=${encodeURIComponent(id)}`)).json();
    if (id !== app.selectedId) return;
    app.trail = j.trail || [];
    layer.setTrail(app.trail);
    panel.update();
  } catch { /* später erneut */ }
  trailTimer = setTimeout(loadTrail, 30000);
}

app.select = id => {
  if (id === app.selectedId) return;
  app.selectedId = id;
  app.trail = [];
  layer.setTrail([]);
  if (!id) { app.setFollow(false); panel.hide(); } else { panel.show(); loadTrail(); }
  layer.redraw();
  writeHash();
};
app.setFollow = on => {
  app.follow = on;
  if (on) app.centerOn(app.selectedId);
  panel.update();
};
// Kartenmitte so wählen, dass ein Punkt im freien Bereich neben bzw. über dem Detail-Panel liegt
function centerFor(latlng, zoom = map.getZoom()) {
  const el = document.getElementById('panel');
  let dx = 0, dy = 0;
  if (!el.hidden) {
    const r = el.getBoundingClientRect();
    if (window.innerWidth <= 720) dy = r.height / 2; else dx = -(r.right) / 2;
  }
  return map.unproject(map.project(latlng, zoom).add([dx, dy]), zoom);
}
app.centerOn = id => {
  const ac = app.get(id);
  if (ac) map.panTo(centerFor(extrapolate(ac, app.nowServer())), { animate: true });
};
// Treffer aus der Suche: hinfliegen und auswählen, auch wenn es noch nicht geladen ist
app.selectFromSearch = ac => {
  if (!app.aircraft.has(ac.id)) {
    app.aircraft.set(ac.id, ac);
    layer.setData([...app.aircraft.values()]);
  }
  app.select(ac.id);
  panel.show();
  const z = Math.max(map.getZoom(), ac.onGround ? 12 : 8);
  map.setView(centerFor([ac.lat, ac.lon], z), z);
};
app.showAirport = a => {
  map.setView([a.lat, a.lon], a.size === 3 ? 11 : 12);
};

// mit dem Flugzeug mitwandern
setInterval(() => {
  if (!app.follow) return;
  const ac = app.get(app.selectedId);
  if (!ac || ac.lost) return;
  const target = centerFor(extrapolate(ac, app.nowServer()));
  const a = map.latLngToContainerPoint(target), c = map.latLngToContainerPoint(map.getCenter());
  if (a.distanceTo(c) > 4) map.panTo(target, { animate: true, duration: 0.9, easeLinearity: 1 });
}, 1000);
setInterval(() => panel.update(), 2000);

// ---------- Maus ----------
const hover = document.getElementById('hover');
map.on('mousemove', e => {
  const id = layer.hit(e.containerPoint);
  map.getContainer().style.cursor = id ? 'pointer' : '';
  const ac = app.get(id);
  if (!ac) { hover.hidden = true; return; }
  hover.innerHTML = `<b>${esc(labelOf(ac))}</b> <span>${esc(typeShort(ac) || '')}</span><br><span>${app.fmt.alt(ac.altFt, ac.onGround)} · ${app.fmt.speed(ac.gsKt)}</span>`;
  hover.style.left = `${e.originalEvent.clientX + 14}px`;
  hover.style.top = `${e.originalEvent.clientY + 12}px`;
  hover.hidden = false;
});
map.on('mouseout', () => { hover.hidden = true; });
map.on('click', e => app.select(layer.hit(e.containerPoint)));
map.on('dragstart', () => { if (app.follow) app.setFollow(false); });

// ---------- Kartenbewegung ----------
let moveDeb;
map.on('moveend', () => {
  const c = map.getCenter();
  settings.view = { lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), z: map.getZoom() };
  save();
  writeHash();
  status();
  // nur sofort neu laden, wenn der Ausschnitt den zuletzt geladenen Bereich verlässt
  const b = map.getBounds();
  if (lastBounds && lastBounds.contains(b) && !partial) return;
  clearTimeout(moveDeb);
  moveDeb = setTimeout(poll, 300);
});

function writeHash() {
  const c = map.getCenter();
  const p = new URLSearchParams();
  p.set('ll', `${c.lat.toFixed(4)},${c.lng.toFixed(4)},${map.getZoom()}`);
  if (app.selectedId) p.set('ac', app.selectedId);
  history.replaceState(null, '', `#${p.toString().replace(/%2C/g, ',')}`);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && app.selectedId && !e.target.closest('input')) app.select(null);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

// ---------- Start ----------
const meta = await fetch('/api/meta').then(r => r.json()).catch(() => ({}));
createLayers(map, app, {
  openaipKey: meta.openaipKey,
  onFilter: () => { layer.redraw(); status(); },
  onUnits: () => { app.fmt = makeFmt(settings.units); layer.redraw(); panel.update(); },
  onLabels: () => layer.redraw(),
});
createSearch(app);

const wanted = hash.get('ac');
await poll();
if (wanted) {
  if (app.aircraft.has(wanted)) { app.select(wanted); app.centerOn(wanted); }
  else {
    // nicht im Ausschnitt → weltweit suchen
    const r = await fetch(`/api/search?q=${encodeURIComponent(wanted)}`).then(x => x.json()).catch(() => null);
    const hit = r?.aircraft?.find(a => a.id === wanted) || r?.aircraft?.[0];
    if (hit) app.selectFromSearch(hit); else toast('Das Flugzeug aus dem Link ist gerade nicht in der Luft');
  }
}
