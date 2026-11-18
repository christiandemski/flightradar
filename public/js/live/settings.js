// Einstellungen der Live-Karte – pro Browser gespeichert
const KEY = 'flugradar.live.v1';

export const DEFAULTS = {
  base: 'dark',
  overlays: { airports: true, rain: false, night: false, airspace: false },
  labels: true,
  units: 'metric',
  filter: {
    airliner: true, light: true, heli: true, glider: true, ground: false, flarm: true,
    onlyMil: false, onlyHidden: false, onlyFav: false, minAlt: 0, maxAlt: 60000,
  },
  view: { lat: 50.11, lon: 8.68, z: 8 },
  favorites: [],          // [{ q: 'LH400', note: 'Anna' }]
};

function merge(def, val) {
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return val === undefined || typeof val !== typeof def ? def : val;
  const out = {};
  for (const k of Object.keys(def)) out[k] = merge(def[k], val?.[k]);
  return out;
}

function load() {
  try { return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return merge(DEFAULTS, {}); }
}

export const settings = load();

let t;
export function save() {
  clearTimeout(t);
  t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* privates Fenster o. Ä. */ } }, 200);
}

/** weicht der Filter vom Standard ab? (für den Hinweis-Punkt am Ebenen-Knopf) */
export function filterActive() {
  return Object.keys(DEFAULTS.filter).some(k => settings.filter[k] !== DEFAULTS.filter[k]);
}

// Favoriten: Flugzeug-IDs, die zu einem gespeicherten Flug gehören (füllt favorites.js)
export const favState = { ids: new Set() };
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function isFav(ac) {
  if (!ac) return false;
  if (favState.ids.has(ac.id)) return true;
  const keys = [ac.callsign, ac.reg, ac.hex, ac.cn].filter(Boolean).map(norm);
  return settings.favorites.some(f => keys.includes(norm(f.q)));
}

/** Flugzeug nach den Filtereinstellungen anzeigen? */
export function passes(ac) {
  const f = settings.filter;
  // Favoriten immer zeigen; mit „Nur Favoriten“ ausschließlich sie
  if (settings.favorites.length && isFav(ac)) return true;
  if (f.onlyFav) return false;
  const onGround = ac.onGround || ac.cls === 'ground';
  if (onGround && !f.ground) return false;
  if (ac.kind === 'flarm' && !f.flarm) return false;
  if (!onGround) {
    const c = ac.cls;
    if ((c === 'heavy' || c === 'jet' || c === 'plane') && !f.airliner) return false;
    if (c === 'light' && !f.light) return false;
    if (c === 'heli' && !f.heli) return false;
    if ((c === 'glider' || c === 'balloon' || c === 'drone') && !f.glider) return false;
    if (ac.altFt != null && (ac.altFt < f.minAlt || ac.altFt > f.maxAlt)) return false;
  }
  if (f.onlyMil || f.onlyHidden) {
    if (!((f.onlyMil && ac.military) || (f.onlyHidden && (ac.ladd || ac.pia)))) return false;
  }
  return true;
}
