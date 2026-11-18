import { config } from './config.js';

// Stammdaten (Typ, Halter, Route, Foto) – mit Cache, damit externe Dienste geschont werden
const cache = new Map(); // key -> { exp, value | promise }
const OK_TTL = 12 * 3600e3;
const MISS_TTL = 3600e3;

async function getJson(url, ua = config.userAgent) {
  const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = fn().then(
    v => { cache.set(key, { exp: Date.now() + (v ? OK_TTL : MISS_TTL), value: Promise.resolve(v) }); return v; },
    () => { cache.set(key, { exp: Date.now() + 5 * 60e3, value: Promise.resolve(null) }); return null; },
  );
  cache.set(key, { exp: Date.now() + 60e3, value });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return value;
}

const airport = a => a && { iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_iso_name, lat: a.latitude, lon: a.longitude };

function route(callsign) {
  if (!callsign || !/^[A-Z0-9]{3,8}$/.test(callsign)) return Promise.resolve(null);
  return cached(`r:${callsign}`, async () => {
    const j = await getJson(`https://api.adsbdb.com/v0/callsign/${callsign}`);
    const fr = j?.response?.flightroute;
    if (!fr) return null;
    return {
      callsignIata: fr.callsign_iata || null,
      airline: fr.airline ? { name: fr.airline.name, icao: fr.airline.icao, iata: fr.airline.iata, country: fr.airline.country_iso } : null,
      origin: airport(fr.origin),
      destination: airport(fr.destination),
    };
  });
}

function aircraft(hex) {
  if (!hex || !/^[0-9a-f]{6}$/.test(hex)) return Promise.resolve(null);
  return cached(`a:${hex}`, async () => {
    const a = (await getJson(`https://api.adsbdb.com/v0/aircraft/${hex}`))?.response?.aircraft;
    if (!a) return null;
    return {
      type: a.type, icaoType: a.icao_type, manufacturer: a.manufacturer, reg: a.registration,
      owner: a.registered_owner, ownerCountry: a.registered_owner_country_iso_name,
      photo: a.url_photo ? { url: a.url_photo, thumb: a.url_photo_thumbnail, credit: 'airport-data.com', link: null } : null,
    };
  });
}

function planespotters(hex) {
  if (!config.photoContact || !hex) return Promise.resolve(null);
  return cached(`p:${hex}`, async () => {
    const ua = `${config.userAgent} (+${config.photoContact})`;
    const p = (await getJson(`https://api.planespotters.net/pub/photos/hex/${hex}`, ua))?.photos?.[0];
    if (!p) return null;
    return { url: p.thumbnail_large?.src || p.thumbnail?.src, thumb: p.thumbnail?.src, credit: `© ${p.photographer} / planespotters.net`, link: p.link };
  });
}

export async function details({ hex, callsign }) {
  hex = (hex || '').toLowerCase();
  callsign = (callsign || '').toUpperCase().trim();
  const [r, a, p] = await Promise.all([route(callsign), aircraft(hex), planespotters(hex)]);
  return { route: r, aircraft: a, photo: p || a?.photo || null };
}

const wcache = new Map();
export async function weather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = wcache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,visibility,is_day&daily=sunrise,sunset&timezone=auto&forecast_days=1`);
  const c = j?.current || {};
  const value = {
    temp: c.temperature_2m, code: c.weather_code, wind: c.wind_speed_10m, windDir: c.wind_direction_10m,
    clouds: c.cloud_cover, visibility: c.visibility, isDay: c.is_day === 1,
    sunrise: j?.daily?.sunrise?.[0], sunset: j?.daily?.sunset?.[0],
  };
  wcache.set(key, { exp: Date.now() + 10 * 60e3, value });
  return value;
}
