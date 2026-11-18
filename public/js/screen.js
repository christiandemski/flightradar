import { makeFmt, wmo, esc, airlineName, SOURCE_LABEL, labelOf, onLogoLoaded } from './common.js';
import { createAlerts } from './alerts.js';

const VIEW_MODULES = {
  radar: () => import('./views/radar.js'),
  map: () => import('./views/map.js'),
  info: () => import('./views/info.js'),
  board: () => import('./views/board.js'),
  sky: () => import('./views/sky.js'),
};
const VIEW_NAMES = { radar: 'Radar', map: 'Karte', info: 'Info', board: 'Tafel', sky: 'Himmelsblick' };

const screenId = decodeURIComponent(location.pathname.split('/')[2] || '');
const $ = id => document.getElementById(id);
const viewEl = $('view');

// ---------- gemeinsamer Zustand für alle Ansichten ----------
const detailCache = new Map();
const detailQueue = [];
let detailActive = 0;

const ctx = {
  screen: null,
  fmt: makeFmt('metric'),
  aircraft: [],
  sources: [],
  stats: null,
  weather: null,
  offset: 0,
  focusId: null,
  nowServer: () => Date.now() + ctx.offset,
  get focus() { return ctx.aircraft.find(a => a.id === ctx.focusId) || null; },
  /** Stammdaten/Route/Foto – liefert sofort Cache-Wert oder null und lädt im Hintergrund */
  details(ac) {
    if (!ac.hex && !ac.callsign) return null;
    const key = `${ac.hex || ''}|${ac.callsign || ''}`;
    const hit = detailCache.get(key);
    if (hit !== undefined) return hit;
    detailCache.set(key, null);
    detailQueue.push({ key, ac });
    pumpDetails();
    return null;
  },
};

function pumpDetails() {
  while (detailActive < 3 && detailQueue.length) {
    const { key, ac } = detailQueue.shift();
    detailActive++;
    fetch(`/api/details?hex=${encodeURIComponent(ac.hex || '')}&cs=${encodeURIComponent(ac.callsign || '')}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { detailCache.set(key, d); scheduleRender(); })
      .catch(() => {})
      .finally(() => { detailActive--; pumpDetails(); });
  }
}

onLogoLoaded(() => scheduleRender());

let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  setTimeout(() => { renderPending = false; current.inst?.update(); }, 250);
}

// ---------- Ansichten ----------
let current = { name: null, inst: null };
let manualView = null;
let rotateIdx = 0;
let rotateTimer = null;

let showSeq = 0;
async function showView(name) {
  if (current.name === name) return;
  const token = ++showSeq;
  const mod = await VIEW_MODULES[name]();
  if (token !== showSeq) return;
  current.inst?.unmount?.();
  viewEl.innerHTML = '';
  viewEl.className = `view-${name}`;
  viewEl.classList.add('fade-in');
  const inst = mod.create(viewEl, ctx);
  current = { name, inst };
  inst.update();
  setTimeout(() => viewEl.classList.remove('fade-in'), 600);
}

function viewList() {
  const s = ctx.screen;
  return s.view === 'rotate' ? s.rotateViews : [s.view];
}

function applyView() {
  clearInterval(rotateTimer);
  const s = ctx.screen;
  if (manualView) return showView(manualView);
  if (s.view === 'rotate') {
    rotateIdx %= s.rotateViews.length;
    showView(s.rotateViews[rotateIdx]);
    rotateTimer = setInterval(() => {
      rotateIdx = (rotateIdx + 1) % s.rotateViews.length;
      showView(s.rotateViews[rotateIdx]);
    }, s.rotateSeconds * 1000);
  } else {
    showView(s.view);
  }
}

// Tastatur: 1–5 Ansicht wählen, 0 = wie konfiguriert, F = Vollbild, A = Test-Alarm; Klick auf Kopfzeile = nächste Ansicht
const ORDER = ['radar', 'map', 'info', 'board', 'sky'];
addEventListener('keydown', e => {
  if (e.key === 'a' || e.key === 'A') alerts.test();
  if (e.key >= '1' && e.key <= '5') { manualView = ORDER[+e.key - 1]; applyView(); toast(VIEW_NAMES[manualView]); }
  if (e.key === '0') { manualView = null; applyView(); toast('Automatisch'); }
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
$('hdr').addEventListener('click', () => {
  const i = ORDER.indexOf(current.name);
  manualView = ORDER[(i + 1) % ORDER.length];
  applyView();
  toast(VIEW_NAMES[manualView]);
});
viewEl.addEventListener('dblclick', toggleFullscreen);
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

let toastTimer;
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Konfiguration (kommt bei jeder Abfrage mit → Änderungen wirken sofort) ----------
let cfgStamp = '';
function applyScreen(s) {
  const stamp = JSON.stringify(s);
  if (stamp === cfgStamp) return;
  const prev = ctx.screen;
  cfgStamp = stamp;
  ctx.screen = s;
  ctx.fmt = makeFmt(s.units);
  document.body.className = `theme-${s.theme}${document.body.classList.contains('nocursor') ? ' nocursor' : ''}`;
  document.title = `${s.name} – Flugradar`;
  $('hName').textContent = s.name;
  $('hLabel').textContent = s.label || '';
  if (!prev || prev.view !== s.view || prev.rotateSeconds !== s.rotateSeconds || String(prev.rotateViews) !== String(s.rotateViews)) {
    applyView();
  } else if (prev.theme !== s.theme || prev.showLogos !== s.showLogos || prev.units !== s.units || prev.radiusKm !== s.radiusKm || prev.lat !== s.lat || prev.lon !== s.lon) {
    const name = current.name; // Ansicht neu aufbauen (Farben, Maßstab)
    current.name = null;
    showView(name);
  }
  if (!prev || prev.lat !== s.lat || prev.lon !== s.lon) loadWeather();
  updateDim();
}

// ---------- Fokus: nächstes Flugzeug, mit "Haltezeit" gegen Flackern ----------
let focusSince = 0;
function pickFocus() {
  const air = ctx.aircraft.filter(a => !a.onGround);
  const best = air[0];
  const cur = air.find(a => a.id === ctx.focusId);
  if (!best) { ctx.focusId = null; return; }
  if (!cur || (best.id !== cur.id && Date.now() - focusSince > 20000 && best.distKm < cur.distKm * 0.85)) {
    ctx.focusId = best.id;
    focusSince = Date.now();
  }
}

// ---------- Datenabfrage ----------
let failCount = 0;
let pollTimer = null;
let pollSeq = 0;

// Live-Vorschau: Die Verwaltung schickt ungespeicherte Einstellungen per postMessage (nur mit ?preview=1)
const previewMode = new URLSearchParams(location.search).has('preview');
let draft = null;
if (previewMode) {
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'flugradar-preview') return;
    draft = e.data.screen ? JSON.stringify(e.data.screen) : null;
    manualView = null;
    poll();
  });
}

async function poll() {
  clearTimeout(pollTimer);
  const seq = ++pollSeq;
  let delay = 3000;
  try {
    const r = await fetch(`/api/aircraft?screen=${encodeURIComponent(screenId)}${draft ? `&preview=${encodeURIComponent(draft)}` : ''}`);
    if (seq !== pollSeq) return; // inzwischen neuere Abfrage gestartet
    if (r.status === 404) {
      viewEl.innerHTML = `<div class="empty">Bildschirm „${esc(screenId)}“ nicht gefunden.<br><a href="/">Zur Verwaltung</a></div>`;
      pollTimer = setTimeout(poll, 15000);
      return;
    }
    const j = await r.json();
    if (seq !== pollSeq) return;
    ctx.offset = j.serverTime - Date.now();
    ctx.aircraft = j.aircraft;
    ctx.sources = j.sources;
    ctx.stats = j.stats;
    applyScreen(j.screen);
    pickFocus();
    renderChrome();
    current.inst?.update();
    alerts.check();
    failCount = 0;
    delay = j.screen.refreshSec * 1000;
  } catch {
    failCount++;
    if (failCount > 1) toast('Keine Verbindung zum Server …', 4000);
    delay = Math.min(30000, 3000 * failCount);
  }
  if (seq === pollSeq) pollTimer = setTimeout(poll, delay);
}

function renderChrome() {
  const s = ctx.screen, fmt = ctx.fmt, list = ctx.aircraft;
  const air = list.filter(a => !a.onGround).length;
  $('hCount').innerHTML = `<b>${air}</b> in der Luft <span class="muted">· Umkreis ${fmt.dist(s.radiusKm)}</span>`;

  const st = ctx.stats;
  if (st) {
    const parts = [`Heute <b>${st.count}</b> gesehen`];
    if (st.topAirlines?.[0]) parts.push(`meiste: <b>${esc(airlineName(st.topAirlines[0][0]) || st.topAirlines[0][0])}</b> (${st.topAirlines[0][1]})`);
    if (st.maxAlt) parts.push(`höchstes: <b>${esc(st.maxAlt.label)}</b> ${fmt.alt(st.maxAlt.v)}`);
    if (st.maxSpeed) parts.push(`schnellstes: <b>${esc(st.maxSpeed.label)}</b> ${fmt.speed(st.maxSpeed.v)}`);
    if (st.closest) parts.push(`am nächsten: <b>${esc(st.closest.label)}</b> ${fmt.dist(st.closest.v)}`);
    if (st.military) parts.push(`Militär ${st.military}`);
    if (st.hidden) parts.push(`FR24-gesperrt ${st.hidden}`);
    if (st.flarm) parts.push(`FLARM ${st.flarm}`);
    $('fStats').innerHTML = parts.join('<span class="sep">·</span>');
  }
  $('fSources').innerHTML = ctx.sources.map(src =>
    `<span class="src ${src.ok ? 'ok' : src.error ? 'err' : 'wait'}" title="${esc(src.error || `${src.count} Objekte`)}">${esc(SOURCE_LABEL[src.id] || src.name)}</span>`).join('');
}

// ---------- Uhr, Wetter, Nachtmodus ----------
function tickClock() {
  const d = new Date();
  $('hClock').textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

async function loadWeather() {
  const s = ctx.screen;
  if (!s) return;
  try {
    const w = await (await fetch(`/api/weather?lat=${s.lat}&lon=${s.lon}`)).json();
    ctx.weather = w;
    const [icon, text] = wmo(w.code, w.isDay);
    const wind = w.wind != null ? ` · Wind ${Math.round(w.wind)} km/h` : '';
    $('hWeather').innerHTML = `<span title="${esc(text)}">${icon}</span> ${Math.round(w.temp)}°${esc(wind)}`;
  } catch { /* Wetter ist optional */ }
}

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function updateDim() {
  const s = ctx.screen;
  let on = false;
  if (s?.dimFrom && s?.dimTo) {
    const d = new Date();
    const now = d.getHours() * 60 + d.getMinutes();
    const a = minutes(s.dimFrom), b = minutes(s.dimTo);
    on = a <= b ? now >= a && now < b : now >= a || now < b;
  }
  $('dim').style.opacity = on && !alertWake ? String(1 - s.dimLevel) : '0';
}

// Überflug-Alarm (hebt auf Wunsch die Nachtdimmung kurz auf)
let alertWake = false;
const alerts = createAlerts(ctx, { onActive(wake) { alertWake = wake; updateDim(); } });

// Mauszeiger ausblenden & Bildschirm wach halten (Tablet/Kiosk)
let cursorTimer = setTimeout(() => document.body.classList.add('nocursor'), 3000); // auch ohne Mausbewegung ausblenden
addEventListener('mousemove', () => {
  document.body.classList.remove('nocursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('nocursor'), 3000);
});
async function wakeLock() {
  try { await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wakeLock());

tickClock();
setInterval(tickClock, 1000);
setInterval(loadWeather, 10 * 60e3);
setInterval(updateDim, 30e3);
wakeLock();
poll();

window.__flugradar = { ctx, labelOf, testAlert: () => alerts.test() };
