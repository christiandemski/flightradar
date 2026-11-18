import { config } from './config.js';

const HEADERS = { 'user-agent': config.userAgent, accept: 'application/json' };
const nm = km => Math.min(250, Math.max(5, Math.ceil(km / 1.852)));
const f4 = n => n.toFixed(4);

// Manche Dienste erlauben nur ~1 Abfrage/s pro IP – alle Abfragen an denselben Dienst laufen durch ein "Tor"
const gates = new Map();
export function gate(key, gapMs) {
  const prev = gates.get(key) || Promise.resolve();
  gates.set(key, prev.then(() => new Promise(r => setTimeout(r, gapMs))));
  return prev;
}

export async function get(url, { text = false, timeout = 12000 } = {}) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    e.headers = res.headers;
    throw e;
  }
  return { res, body: text ? await res.text() : await res.json() };
}

function kindOf(t = '') {
  if (t.startsWith('mlat')) return 'mlat';
  if (t.startsWith('tisb')) return 'tisb';
  if (t.startsWith('adsr')) return 'adsr';
  if (t.startsWith('adsc')) return 'adsc';
  if (t.startsWith('mode_s')) return 'modes';
  if (t.startsWith('other')) return 'other';
  return 'adsb';
}

/** readsb/tar1090-JSON (adsb.fi, adsb.lol, airplanes.live, eigener Empfänger) → einheitliches Format */
export function normReadsb(a, now, source) {
  if (a.lat == null || a.lon == null || !a.hex) return null;
  const ground = a.alt_baro === 'ground';
  const alt = ground ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : a.alt_geom ?? null);
  const flags = a.dbFlags || 0;
  return {
    id: a.hex.toLowerCase(),
    hex: a.hex.replace('~', '').toLowerCase(),
    callsign: (a.flight || '').trim() || null,
    reg: a.r || null,
    icaoType: a.t || null,
    desc: a.desc || null,
    lat: a.lat,
    lon: a.lon,
    altFt: alt,
    onGround: ground,
    gsKt: a.gs ?? null,
    track: a.track ?? a.true_heading ?? a.mag_heading ?? null,
    vrFpm: a.baro_rate ?? a.geom_rate ?? null,
    altGeomFt: typeof a.alt_geom === 'number' ? a.alt_geom : null,
    navAltFt: a.nav_altitude_mcp ?? a.nav_altitude_fms ?? null,
    ias: a.ias ?? null,
    tas: a.tas ?? null,
    mach: a.mach ?? null,
    heading: a.true_heading ?? a.mag_heading ?? null,
    windDir: a.wd ?? null,
    windKt: a.ws ?? null,
    oatC: a.oat ?? null,
    squawk: a.squawk || null,
    emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
    category: a.category || null,
    military: !!(flags & 1),
    pia: !!(flags & 4),
    ladd: !!(flags & 8),
    kind: kindOf(a.type),
    posTime: now - (a.seen_pos ?? a.seen ?? 0) * 1000,
    source,
  };
}

function readsbSource(id, name, intervalMs, urlFn, { adaptRate = false, gapMs = 0 } = {}) {
  return {
    id, name, intervalMs,
    async fetch(area) {
      if (gapMs) await gate(id, gapMs);
      const { res, body } = await get(urlFn(area));
      const now = Date.now();
      const list = (body.ac || body.aircraft || []).map(a => normReadsb(a, now, id)).filter(Boolean);
      let nextMs;
      if (adaptRate) {
        // adsb.lol: 500 Abfragen/Tag – Intervall an verbleibendes Kontingent anpassen
        const rem = Number(res.headers.get('x-ratelimit-remaining'));
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        if (Number.isFinite(rem) && Number.isFinite(reset) && reset > 0) {
          nextMs = Math.max(intervalMs, (reset * 1000) / Math.max(0.5, rem - 20));
        }
      }
      return { list, nextMs };
    },
  };
}

// OGN-Gerätetypen (live.glidernet.org)
const OGN_TYPES = {
  1: 'Segelflugzeug', 2: 'Schleppflugzeug', 3: 'Hubschrauber', 4: 'Fallschirmspringer', 5: 'Absetzflugzeug',
  6: 'Hängegleiter', 7: 'Gleitschirm', 8: 'Motorflugzeug', 9: 'Jet', 10: 'Unbekannt', 11: 'Ballon',
  12: 'Luftschiff', 13: 'Drohne', 15: 'Hindernis',
};

function ognSource() {
  return {
    id: 'ogn', name: 'OGN (FLARM)', intervalMs: 15000,
    async fetch(area) {
      const dLat = area.radiusKm / 111;
      const dLon = area.radiusKm / (111 * Math.cos((area.lat * Math.PI) / 180));
      const url = `https://live.glidernet.org/lxml.php?a=0&b=${f4(area.lat + dLat)}&c=${f4(area.lat - dLat)}&d=${f4(area.lon + dLon)}&e=${f4(area.lon - dLon)}`;
      const { body } = await get(url, { text: true });
      const now = Date.now();
      const list = [];
      for (const m of body.matchAll(/<m a="([^"]+)"/g)) {
        const f = m[1].split(',');
        if (f.length < 14) continue;
        const age = Number(f[6]);
        const type = Number(f[10]);
        if (!(age <= 180) || type === 15) continue;
        const icao = f[12] && f[12] !== '0' ? f[12].toLowerCase().padStart(6, '0') : null;
        const anon = f[2].startsWith('_');
        const regLooksLikeId = /^[0-9a-f]{6,8}$/i.test(f[3]);
        const gsKt = Number(f[8]) / 1.852;
        list.push({
          id: icao || `ogn-${f[13]}`,
          hex: icao,
          callsign: null,
          cn: anon ? null : f[2],
          reg: regLooksLikeId ? null : f[3],
          icaoType: null,
          desc: OGN_TYPES[type] || null,
          lat: Number(f[0]),
          lon: Number(f[1]),
          altFt: Number(f[4]) * 3.28084,
          onGround: gsKt < 3,
          gsKt,
          track: Number(f[7]),
          vrFpm: Number(f[9]) * 196.85,
          ognType: type,
          kind: 'flarm',
          posTime: now - age * 1000,
          source: 'ogn',
        });
      }
      return { list };
    },
  };
}

export function buildSources() {
  const factories = {
    adsbfi: () => readsbSource('adsbfi', 'adsb.fi', 5000,
      a => `https://opendata.adsb.fi/api/v3/lat/${f4(a.lat)}/lon/${f4(a.lon)}/dist/${nm(a.radiusKm)}`, { gapMs: 1100 }),
    adsblol: () => readsbSource('adsblol', 'adsb.lol', 180000,
      a => `https://api.adsb.lol/v2/point/${f4(a.lat)}/${f4(a.lon)}/${nm(a.radiusKm)}`, { adaptRate: true }),
    airplaneslive: () => readsbSource('airplaneslive', 'airplanes.live', 10000,
      a => `https://api.airplanes.live/v2/point/${f4(a.lat)}/${f4(a.lon)}/${nm(a.radiusKm)}`, { gapMs: 1100 }),
    ogn: ognSource,
    readsb: () => readsbSource('readsb', 'Eigener Empfänger', 2000, () => config.readsbUrl),
  };
  const ids = [...config.sources];
  if (config.readsbUrl && !ids.includes('readsb')) ids.unshift('readsb');
  return ids.filter(id => factories[id]).map(id => factories[id]());
}

/** grobe Klasse für das Icon */
export function classify(ac) {
  const c = ac.category || '';
  const t = ac.ognType;
  if (c.startsWith('C')) return 'ground';
  if (c === 'A7' || t === 3) return 'heli';
  if (c === 'B1' || t === 1 || t === 6 || t === 7) return 'glider';
  if (c === 'B2' || t === 11 || t === 12) return 'balloon';
  if (c === 'B6' || t === 13) return 'drone';
  if (c === 'A5' || c === 'A4') return 'heavy';
  if (c === 'A3' || c === 'A2' || t === 9) return 'jet';
  if (c === 'A1' || t === 2 || t === 5 || t === 8) return 'light';
  return 'plane';
}
