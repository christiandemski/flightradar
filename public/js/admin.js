const $ = s => document.querySelector(s);
const form = $('#form');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const VIEWS = {
  radar: ['Radar', 'Radarschirm mit Ringen, Spuren und Liste'],
  map: ['Karte', 'Echte Karte mit Flugzeugen und Spuren'],
  info: ['Info', 'Nächstes Flugzeug groß mit Foto & Route'],
  board: ['Tafel', 'Abflugtafel mit Klapp-Effekt'],
  sky: ['Himmelsblick', 'Blick aus dem Fenster: Richtung & Höhe'],
  rotate: ['Wechsel', 'Mehrere Ansichten im Wechsel'],
};
const THEMES = {
  nacht: ['Nacht', 'Modern, dunkel', 'linear-gradient(135deg,#0a1120,#15213a 60%,#4cc2ff)'],
  phosphor: ['Phosphor', 'Grüner Röhren-Radar', 'linear-gradient(135deg,#010701,#032a07 60%,#8dff95)'],
  amber: ['Amber', 'Flughafen-Anzeige', 'linear-gradient(135deg,#0b0804,#1f1405 60%,#ffb000)'],
  hell: ['Hell', 'Für helle Räume', 'linear-gradient(135deg,#ffffff,#edf1f6 60%,#0a6cff)'],
};

let screens = [];
let currentId = null;

const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
  return j;
};

// ---- Auswahlfelder aufbauen ----
$('#viewChoices').innerHTML = Object.entries(VIEWS).map(([k, [n, d]]) =>
  `<label class="choice"><input type="radio" name="view" value="${k}"><b>${n}</b><small>${d}</small></label>`).join('');
$('#rotateChoices').innerHTML = Object.entries(VIEWS).filter(([k]) => k !== 'rotate').map(([k, [n]]) =>
  `<label><input type="checkbox" name="rotateViews" value="${k}"> ${n}</label>`).join('');
$('#themeChoices').innerHTML = Object.entries(THEMES).map(([k, [n, d, bg]]) =>
  `<label class="choice"><input type="radio" name="theme" value="${k}"><div class="sw" style="background:${bg}"></div><b>${n}</b><small>${d}</small></label>`).join('');

function updateOutputs() {
  for (const o of document.querySelectorAll('.out')) {
    const v = form.elements[o.dataset.for].value;
    o.textContent = o.hasAttribute('data-pct') ? `${Math.round(v * 100)} %` : `${v}${o.dataset.suffix ?? ' km'}`;
  }
  $('#rotateBox').hidden = form.elements.view.value !== 'rotate';
  $('#alertBox').hidden = !form.elements['alerts.enabled'].checked;
}
form.addEventListener('input', updateOutputs);

// Live-Vorschau: ungespeicherte Änderungen sofort im Vorschaufenster zeigen
let dirty = false;
let previewTimer = null;
function sendPreview() {
  const win = $('#preview').contentWindow;
  if (!win || !currentId) return;
  win.postMessage({ type: 'flugradar-preview', screen: dirty ? read() : null }, location.origin);
}
function onFormChange(e) {
  if (e.target.name === 'slug' || e.target.name === 'locationQuery') return; // ändern die Darstellung nicht
  dirty = true;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(sendPreview, 350);
  $('#saveMsg').className = 'hint';
  $('#saveMsg').textContent = 'Ungespeicherte Änderungen – Vorschau zeigt den Entwurf.';
}
form.addEventListener('input', onFormChange);
form.addEventListener('change', onFormChange);
$('#preview').addEventListener('load', () => { if (dirty) sendPreview(); });

// ---- Liste ----
function renderList() {
  $('#list').innerHTML = screens.map(s => `
    <li data-id="${esc(s.id)}" class="${s.id === currentId ? 'active' : ''}">
      <b>${esc(s.name)}</b>
      <small>${esc(s.label || `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`)}</small>
      <div class="tags"><span class="tag">${VIEWS[s.view][0]}</span><span class="tag">${THEMES[s.theme][0]}</span><span class="tag">${s.radiusKm} km</span><span class="tag">/s/${esc(s.id)}</span></div>
    </li>`).join('') || '<li><small>Noch keine Bildschirme.</small></li>';
}
$('#list').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (li) select(li.dataset.id);
});

async function load() {
  screens = await api('/api/screens');
  renderList();
  const want = location.hash.slice(1);
  if (screens.length) select(screens.find(s => s.id === want) ? want : (currentId && screens.find(s => s.id === currentId) ? currentId : screens[0].id));
}

// ---- Editor ----
const getPath = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, p, val) {
  const ks = p.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
  cur[ks[ks.length - 1]] = val;
}

function fill(s) {
  for (const el of form.elements) {
    if (el.name?.includes('.')) {
      const v = getPath(s, el.name);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
      continue;
    }
    if (!el.name || !(el.name in s)) continue;
    if (el.type === 'checkbox' && el.name === 'rotateViews') el.checked = s.rotateViews.includes(el.value);
    else if (el.type === 'checkbox') el.checked = !!s[el.name];
    else if (el.type === 'radio') el.checked = s[el.name] === el.value;
    else el.value = s[el.name] ?? '';
  }
  updateOutputs();
}

function read() {
  const f = form.elements;
  const nested = {};
  for (const el of f) if (el.name?.includes('.')) setPath(nested, el.name, el.type === 'checkbox' ? el.checked : el.value);
  return {
    ...nested,
    name: f.name.value, slug: f.slug.value, label: f.label.value, locationQuery: f.locationQuery.value,
    lat: f.lat.value, lon: f.lon.value, radiusKm: f.radiusKm.value,
    view: f.view.value, rotateViews: [...document.querySelectorAll('input[name=rotateViews]:checked')].map(i => i.value),
    rotateSeconds: f.rotateSeconds.value, theme: f.theme.value, units: f.units.value,
    showSweep: f.showSweep.checked, showLogos: f.showLogos.checked, hideGround: f.hideGround.checked, showOgn: f.showOgn.checked,
    minAltFt: f.minAltFt.value, maxAltFt: f.maxAltFt.value,
    nightMode: f.nightMode.value, dimFrom: f.dimFrom.value, dimTo: f.dimTo.value, dimLevel: f.dimLevel.value, refreshSec: f.refreshSec.value,
  };
}

function select(id) {
  const s = screens.find(x => x.id === id);
  if (!s) return;
  currentId = id;
  history.replaceState(null, '', `#${id}`);
  $('#editor').hidden = false;
  $('#edTitle').textContent = s.name;
  $('#openLink').href = `/s/${encodeURIComponent(id)}`;
  $('#saveMsg').textContent = '';
  $('#geoMsg').textContent = '';
  fill(s);
  form.elements.slug.value = s.id;
  $('#slugPre').textContent = `${location.host}/s/`;
  const pv = $('#preview');
  dirty = false;
  if (pv.dataset.id !== id) { pv.src = `/s/${encodeURIComponent(id)}?preview=1`; pv.dataset.id = id; } else sendPreview();
  renderList();
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#saveMsg');
  const f = form.elements;
  if (!f.name.value.trim() || f.lat.value === '' || f.lon.value === '') {
    msg.className = 'hint err';
    msg.textContent = !f.name.value.trim() ? 'Bitte einen Namen eingeben.' : 'Bitte Standort suchen oder Breite/Länge eintragen.';
    return;
  }
  try {
    const s = await api(`/api/screens/${encodeURIComponent(currentId)}`, { method: 'PUT', body: JSON.stringify(read()) });
    const renamed = s.id !== currentId;
    screens = screens.map(x => (x.id === currentId ? s : x));
    if (renamed) select(s.id);
    dirty = false;
    sendPreview();
    $('#edTitle').textContent = s.name;
    renderList();
    msg.className = 'hint ok';
    msg.textContent = renamed ? `Gespeichert – neue Adresse /s/${s.id} (die alte leitet weiter).` : 'Gespeichert – der Bildschirm übernimmt es automatisch.';
  } catch (err) {
    msg.className = 'hint err';
    msg.textContent = err.message;
  }
});

async function geocode() {
  const m = $('#geoMsg');
  const q = form.elements.locationQuery.value.trim();
  if (!q) return;
  m.className = 'hint';
  m.textContent = 'Suche …';
  try {
    const g = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
    form.elements.lat.value = g.lat.toFixed(5);
    form.elements.lon.value = g.lon.toFixed(5);
    form.elements.label.value = g.label;
    onFormChange({ target: form.elements.lat });
    m.className = 'hint ok';
    m.textContent = `Gefunden: ${g.label} (${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}) – zum Übernehmen speichern.`;
  } catch (err) {
    m.className = 'hint err';
    m.textContent = err.message;
  }
}
$('#geoBtn').addEventListener('click', geocode);
form.elements.locationQuery.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); geocode(); } });

$('#newBtn').addEventListener('click', async () => {
  const name = prompt('Name des Bildschirms (z. B. Wohnzimmer):');
  if (!name) return;
  const base = screens.find(s => s.id === currentId);
  const s = await api('/api/screens', { method: 'POST', body: JSON.stringify({ ...(base || {}), name, lat: base?.lat ?? 50.11, lon: base?.lon ?? 8.68 }) });
  screens.push(s);
  select(s.id);
  form.elements.locationQuery.focus();
});

$('#dupBtn').addEventListener('click', async () => {
  const base = screens.find(s => s.id === currentId);
  const s = await api('/api/screens', { method: 'POST', body: JSON.stringify({ ...base, ...read(), name: `${base.name} (Kopie)` }) });
  screens.push(s);
  select(s.id);
});

$('#delBtn').addEventListener('click', async () => {
  const s = screens.find(x => x.id === currentId);
  if (!s || !confirm(`Bildschirm „${s.name}“ löschen?`)) return;
  await api(`/api/screens/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
  screens = screens.filter(x => x.id !== s.id);
  currentId = null;
  $('#editor').hidden = true;
  $('#preview').removeAttribute('src');
  delete $('#preview').dataset.id;
  load();
});

$('#testAlertBtn').addEventListener('click', () => $('#preview').contentWindow?.__flugradar?.testAlert());

// Vorschau skalieren
const frame = $('.pv-frame');
new ResizeObserver(() => { $('#preview').style.transform = `scale(${frame.clientWidth / 1280})`; }).observe(frame);

// Quellenstatus
async function status() {
  try {
    const { areas } = await api('/api/status');
    $('#status').innerHTML = areas.length ? `<h3 class="lbl">Datenquellen</h3>${areas[0].sources.map(s =>
      `<div class="src"><span>${esc(s.name)}</span><span class="${s.error ? 'err' : s.ok ? 'ok' : ''}">${s.error ? esc(s.error) : s.ok ? `${s.count} Objekte` : 'wartet'}</span></div>`).join('')}` : '';
  } catch { /* egal */ }
}
setInterval(status, 10000);
status();
load();
