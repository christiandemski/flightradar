import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VIEWS = ['radar', 'map', 'info', 'board', 'sky', 'rotate'];
export const ALERT_RULES = ['mil', 'emergency', 'hidden', 'special', 'lowheli', 'close', 'watch'];

const SKY_DEFAULTS = { direction: 180, fov: 180, maxElev: 60 };
const ALERT_DEFAULTS = {
  enabled: false,
  radiusKm: 20,           // Alarm nur innerhalb dieses Umkreises
  rules: { mil: true, emergency: true, hidden: false, special: true, lowheli: true, close: false, watch: true },
  closeKm: 3,             // "sehr nah": Entfernung …
  closeAltFt: 5000,       // … und Höhe darunter
  watch: '',              // eigene Liste: Typen, Kennzeichen, Callsign-Präfixe, Hex – kommagetrennt
  sound: true,
  wake: true,             // Nachtdimmung während des Alarms aufheben
  seconds: 20,            // Anzeigedauer
  cooldownMin: 30,        // gleiches Flugzeug frühestens wieder nach …
};
export const THEMES = ['nacht', 'phosphor', 'amber', 'hell'];

const DEFAULTS = {
  name: 'Neuer Bildschirm',
  locationQuery: '',
  label: '',
  lat: null,
  lon: null,
  radiusKm: 50,
  view: 'radar',
  rotateViews: ['radar', 'info'],
  rotateSeconds: 30,
  theme: 'nacht',
  units: 'metric',        // metric | aviation
  hideGround: true,
  showOgn: true,
  minAltFt: 0,
  maxAltFt: 60000,
  showSweep: true,
  showLogos: false,       // kleine Airline-Logos einblenden
  refreshSec: 3,
  dimFrom: '',            // "22:00"
  dimTo: '',              // "07:00"
  dimLevel: 0.35,         // Helligkeit im Nachtmodus 0..1
  nightMode: 'dim',      // dim = abdunkeln | off = Display ausschalten (Pi-Kiosk; sonst wird gedimmt)
  sky: SKY_DEFAULTS,      // Himmelsblick: Blickrichtung (°), Sichtfeld (°), max. Höhenwinkel (°)
  alerts: ALERT_DEFAULTS, // Überflug-Alarm
};

function normalizeSky(i = {}, b = SKY_DEFAULTS) {
  b = { ...SKY_DEFAULTS, ...b };
  return {
    direction: ((num(i.direction, b.direction, -360, 720) % 360) + 360) % 360,
    fov: num(i.fov, b.fov, 60, 360),
    maxElev: num(i.maxElev, b.maxElev, 20, 90),
  };
}

function normalizeAlerts(i = {}, b = ALERT_DEFAULTS) {
  b = { ...ALERT_DEFAULTS, ...b, rules: { ...ALERT_DEFAULTS.rules, ...(b.rules || {}) } };
  const rules = {};
  for (const r of ALERT_RULES) rules[r] = bool(i.rules?.[r], b.rules[r]);
  return {
    enabled: bool(i.enabled, b.enabled),
    radiusKm: num(i.radiusKm, b.radiusKm, 1, 400),
    rules,
    closeKm: num(i.closeKm, b.closeKm, 0.5, 50),
    closeAltFt: num(i.closeAltFt, b.closeAltFt, 100, 50000),
    watch: str(i.watch, b.watch, 500),
    sound: bool(i.sound, b.sound),
    wake: bool(i.wake, b.wake),
    seconds: num(i.seconds, b.seconds, 5, 300),
    cooldownMin: num(i.cooldownMin, b.cooldownMin, 1, 1440),
  };
}

const num = (v, d, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const bool = (v, d) => (v === undefined ? d : v === true || v === 'true' || v === 'on' || v === 1);
const time = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');
const str = (v, d, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : d);

export function normalizeScreen(input, base = DEFAULTS) {
  const s = { ...DEFAULTS, ...base };
  const i = input || {};
  s.name = str(i.name, s.name, 60) || 'Bildschirm';
  s.locationQuery = str(i.locationQuery, s.locationQuery);
  s.label = str(i.label, s.label);
  s.lat = num(i.lat, s.lat, -90, 90);
  s.lon = num(i.lon, s.lon, -180, 180);
  s.radiusKm = num(i.radiusKm, s.radiusKm, 2, 400);
  s.view = VIEWS.includes(i.view) ? i.view : s.view;
  if (Array.isArray(i.rotateViews)) {
    const rv = i.rotateViews.filter(v => VIEWS.includes(v) && v !== 'rotate');
    s.rotateViews = rv.length ? [...new Set(rv)] : ['radar', 'info'];
  }
  s.rotateSeconds = num(i.rotateSeconds, s.rotateSeconds, 5, 3600);
  s.theme = THEMES.includes(i.theme) ? i.theme : s.theme;
  s.units = ['metric', 'aviation'].includes(i.units) ? i.units : s.units;
  s.hideGround = bool(i.hideGround, s.hideGround);
  s.showOgn = bool(i.showOgn, s.showOgn);
  s.showSweep = bool(i.showSweep, s.showSweep);
  s.showLogos = bool(i.showLogos, s.showLogos);
  s.minAltFt = num(i.minAltFt, s.minAltFt, 0, 100000);
  s.maxAltFt = num(i.maxAltFt, s.maxAltFt, 0, 100000);
  s.refreshSec = num(i.refreshSec, s.refreshSec, 2, 60);
  s.dimFrom = i.dimFrom !== undefined ? time(i.dimFrom) : s.dimFrom;
  s.dimTo = i.dimTo !== undefined ? time(i.dimTo) : s.dimTo;
  s.dimLevel = num(i.dimLevel, s.dimLevel, 0.05, 1);
  s.nightMode = ['dim', 'off'].includes(i.nightMode) ? i.nightMode : s.nightMode;
  s.sky = normalizeSky(i.sky, s.sky);
  s.alerts = normalizeAlerts(i.alerts, s.alerts);
  if (s.lat == null || s.lon == null) throw new Error('Standort fehlt (Koordinaten)');
  return s;
}

function slug(name) {
  const base = name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return base || 'screen';
}

export class ScreenStore {
  constructor(dir) {
    this.file = path.join(dir, 'screens.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      // ältere Einträge um neue Einstellungen (Standardwerte) ergänzen
      this.screens = JSON.parse(fs.readFileSync(this.file, 'utf8')).map(x => ({ ...x, ...normalizeScreen(x, x) }));
    } catch {
      this.screens = [];
    }
  }

  save() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.screens, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  list() { return this.screens; }
  // alte Adressen (nach Umbenennen des Slugs) funktionieren weiter
  get(id) { return this.screens.find(s => s.id === id) || this.screens.find(s => s.aliases?.includes(id)) || null; }

  create(input) {
    const { id: _ignored, aliases: _a, ...s } = normalizeScreen(input);
    let id = slug(typeof input?.slug === 'string' && input.slug.trim() ? input.slug : s.name);
    if (this.get(id)) id = `${id}-${crypto.randomBytes(2).toString('hex')}`;
    const screen = { id, ...s, aliases: [], createdAt: new Date().toISOString() };
    this.screens.push(screen);
    this.save();
    return screen;
  }

  update(id, input) {
    const idx = this.screens.findIndex(s => s.id === id);
    if (idx < 0) return null;
    const old = this.screens[idx];
    let newId = old.id;
    const aliases = [...(old.aliases || [])];
    if (typeof input?.slug === 'string' && input.slug.trim()) {
      const wanted = slug(input.slug);
      if (wanted !== old.id) {
        const other = this.get(wanted);
        if (other && other.id !== old.id) throw new Error(`Adresse „${wanted}“ ist schon vergeben`);
        newId = wanted;
        if (!aliases.includes(old.id)) aliases.push(old.id);
        const ai = aliases.indexOf(wanted);
        if (ai >= 0) aliases.splice(ai, 1); // zurück zu einer früheren Adresse
        const statsDir = path.join(path.dirname(this.file), 'stats');
        try { fs.renameSync(path.join(statsDir, `${old.id}.json`), path.join(statsDir, `${newId}.json`)); } catch { /* keine Statistik */ }
      }
    }
    const screen = { ...normalizeScreen(input, old), id: newId, aliases, createdAt: old.createdAt, updatedAt: new Date().toISOString() };
    this.screens[idx] = screen;
    this.save();
    return screen;
  }

  remove(id) {
    const n = this.screens.length;
    this.screens = this.screens.filter(s => s.id !== id);
    if (this.screens.length !== n) this.save();
    return this.screens.length !== n;
  }
}
