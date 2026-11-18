import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Flughäfen aus OurAirports (gemeinfrei). Einmal laden, als kompaktes JSON zwischenspeichern, monatlich erneuern.
const SRC = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const FILE = path.join(config.dataDir, 'airports.json');
const MAX_AGE = 30 * 86400e3;
const FORMAT_LEN = 11; // Felder pro Eintrag – ändert sich das Format, wird neu geladen
const TYPES = { large_airport: 3, medium_airport: 2, small_airport: 1 };

let list = null;
let loading = null;
let failedAt = 0;

/** einfacher CSV-Parser (Anführungszeichen, "" und Zeilenumbrüche in Feldern) */
function* csvRows(text) {
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      yield row;
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

function parse(text) {
  const rows = csvRows(text);
  const head = rows.next().value;
  const col = name => head.indexOf(name);
  const C = {
    ident: col('ident'), type: col('type'), name: col('name'), lat: col('latitude_deg'), lon: col('longitude_deg'), elev: col('elevation_ft'),
    country: col('iso_country'), city: col('municipality'), sched: col('scheduled_service'), gps: col('gps_code'), icao: col('icao_code'), iata: col('iata_code'), kw: col('keywords'),
  };
  const out = [];
  for (const r of rows) {
    const t = TYPES[r[C.type]];
    if (!t) continue;
    const icao = [r[C.icao], r[C.gps], r[C.ident]].find(v => v && /^[A-Z]{4}$/.test(v)) || '';
    const iata = C.iata >= 0 && /^[A-Z]{3}$/.test(r[C.iata]) ? r[C.iata] : '';
    if (t === 1 && !icao && !iata) continue;
    out.push([icao, iata, r[C.name], r[C.city] || '', r[C.country] || '', Number(Number(r[C.lat]).toFixed(5)), Number(Number(r[C.lon]).toFixed(5)), r[C.elev] === '' ? null : Number(r[C.elev]), t, r[C.sched] === 'yes' ? 1 : 0, C.kw >= 0 && t >= 2 ? r[C.kw].slice(0, 120) : '']);
  }
  return out;
}

const fromArr = a => ({ icao: a[0], iata: a[1], name: a[2], city: a[3], country: a[4], lat: a[5], lon: a[6], elevFt: a[7], size: a[8], sched: !!a[9], kw: a[10] || '' });

export function loadAirports() {
  if (list) return Promise.resolve(list);
  if (!loading && Date.now() - failedAt < 10 * 60e3) return Promise.resolve([]);
  loading ||= (async () => {
    let stale = null;
    try {
      const st = fs.statSync(FILE);
      stale = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (Date.now() - st.mtimeMs < MAX_AGE && stale[0]?.length === FORMAT_LEN) return (list = stale.map(fromArr));
    } catch { /* noch nicht geladen */ }
    try {
      const res = await fetch(SRC, { headers: { 'user-agent': config.userAgent }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = parse(await res.text());
      if (arr.length < 1000) throw new Error('Flughafenliste unvollständig');
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(arr));
      console.log(`Flughäfen geladen: ${arr.length}`);
      return (list = arr.map(fromArr));
    } catch (e) {
      console.error('Flughäfen laden fehlgeschlagen:', e.message);
      if (stale) return (list = stale.map(fromArr));
      failedAt = Date.now();
      return [];
    }
  })().finally(() => { loading = null; });
  return loading;
}

/** Flughäfen im Ausschnitt – je weiter herausgezoomt, desto nur die größeren */
export async function airportsIn({ s, w, n, e }, zoom) {
  const all = await loadAirports();
  const minSize = zoom < 6 ? 3 : zoom < 9 ? 2 : 1;
  const out = [];
  for (const a of all) {
    if (a.size < minSize || a.lat < s || a.lat > n) continue;
    if (w <= e ? (a.lon < w || a.lon > e) : (a.lon < w && a.lon > e)) continue;
    out.push(a);
  }
  out.sort((x, y) => y.size - x.size || y.sched - x.sched);
  return out.slice(0, 600);
}

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function searchAirports(q, limit = 8) {
  const all = await loadAirports();
  const Q = q.trim().toUpperCase();
  if (Q.length < 3) return [];
  const nq = norm(q.trim());
  const scored = [];
  for (const a of all) {
    let score = 0;
    if (a.iata === Q || a.icao === Q) score = 100;
    else if (Q.length >= 4 && a.icao.startsWith(Q)) score = 60;
    else {
      const name = norm(a.name), city = norm(a.city), kw = norm(a.kw);
      if (city === nq) score = 50;
      else if (city.startsWith(nq) || name.startsWith(nq)) score = 40;
      else if (name.includes(nq) || city.includes(nq)) score = 20;
      else if (nq.length >= 4 && kw.includes(nq)) score = 30;
    }
    if (score) scored.push([score + a.size * 3 + (a.sched ? 3 : 0), a]);
  }
  return scored.sort((x, y) => y[0] - x[0]).slice(0, limit).map(x => x[1]);
}

// Aktuelles Flugplatzwetter (METAR) von aviationweather.gov
const metarCache = new Map();
export async function metar(icao) {
  icao = String(icao || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) return null;
  const hit = metarCache.get(icao);
  if (hit && hit.exp > Date.now()) return hit.value;
  let value = null;
  try {
    const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, { headers: { 'user-agent': config.userAgent }, signal: AbortSignal.timeout(8000) });
    if (res.ok && res.status !== 204) {
      const m = (await res.json())?.[0];
      if (m) value = { raw: m.rawOb, cat: m.fltCat || null, time: m.obsTime ? m.obsTime * 1000 : null, temp: m.temp, wind: m.wspd, windDir: m.wdir };
    }
  } catch { /* kein Wetter verfügbar */ }
  metarCache.set(icao, { exp: Date.now() + 5 * 60e3, value });
  return value;
}
