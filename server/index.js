import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { config } from './config.js';
import { geocode, distanceKm } from './geo.js';
import { airportsIn, loadAirports, metar } from './airports.js';
import { search } from './search.js';
import { buildSources } from './sources.js';
import { Tracker } from './tracker.js';
import { details, weather } from './details.js';
import { getLogo } from './logos.js';
import { ScreenStore, VIEWS, THEMES, normalizeScreen } from './store.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const store = new ScreenStore(config.dataDir);
const sources = buildSources();
const tracker = new Tracker(sources);

if (!store.list().length) {
  store.create({ name: 'Beispiel', locationQuery: 'Frankfurt am Main', label: 'Frankfurt am Main', lat: 50.1109, lon: 8.6821, radiusKm: 60 });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  let data = isObj ? JSON.stringify(body) : body;
  const h = { 'content-type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers };
  // große Antworten (Live-Karte mit vielen Flugzeugen) komprimieren
  if (isObj && data.length > 4096 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')) {
    data = zlib.gzipSync(data, { level: 5 });
    h['content-encoding'] = 'gzip';
    h.vary = 'accept-encoding';
  }
  res.writeHead(status, h);
  res.end(data);
}

/** "s,w,n,e" → Ausschnitt oder null */
function parseBbox(v) {
  const b = String(v || '').split(',').map(Number);
  if (b.length !== 4 || b.some(n => !Number.isFinite(n))) return null;
  const [s, w, n, e] = b;
  if (s >= n) return null;
  const clampLon = x => ((((x + 180) % 360) + 360) % 360) - 180;
  // weiter als einmal um die Erde → ganze Welt
  return e - w >= 360 ? { s: Math.max(-90, s), w: -180, n: Math.min(90, n), e: 180 } : { s: Math.max(-90, s), w: clampLon(w), n: Math.min(90, n), e: clampLon(e) };
}

function serveFile(res, file) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(publicDir)) return send(res, 403, 'Forbidden');
  fs.readFile(resolved, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(resolved)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

function authorized(req) {
  if (!config.adminPassword) return true;
  const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':');
  return pass === config.adminPassword;
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1e5) throw new Error('Body zu groß');
  }
  return data ? JSON.parse(data) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const q = k => url.searchParams.get(k);

  try {
    const mapApi = ['/', '/api/live', '/api/trail', '/api/search', '/api/airports', '/api/metar'].includes(p);
    const needsAuth = p === '/admin' || p === '/api/geocode' || (p.startsWith('/api/screens') && req.method !== 'GET') || (mapApi && !config.publicMap);
    if (needsAuth && !authorized(req)) {
      return send(res, 401, 'Anmeldung erforderlich', { 'www-authenticate': 'Basic realm="flightradar"' });
    }

    if (p === '/') return serveFile(res, path.join(publicDir, 'live.html'));
    if (p === '/admin' || p === '/admin/') return serveFile(res, path.join(publicDir, 'admin.html'));
    if (/^\/s\/[\w-]+\/?$/.test(p)) return serveFile(res, path.join(publicDir, 'screen.html'));
    // /s/ ohne Namen → erster Bildschirm (praktisch für den Kiosk-Start)
    if (p === '/s' || p === '/s/') {
      const first = store.list()[0];
      return send(res, 302, '', { location: first ? `/s/${encodeURIComponent(first.id)}${url.search}` : '/' });
    }

    if (p === '/api/meta') return send(res, 200, { views: VIEWS, themes: THEMES, sources: sources.map(s => ({ id: s.id, name: s.name })), openaipKey: config.openaipKey || null });

    // ---------- Live-Karte ----------
    if (p === '/api/live') {
      // b = geladener Bereich (etwas größer als sichtbar), v = sichtbarer Ausschnitt
      const b = parseBbox(q('b'));
      if (!b) return send(res, 400, { error: 'Ausschnitt (b=s,w,n,e) fehlt' });
      const v = parseBbox(q('v')) || b;
      // Mittelpunkt und Radius des sichtbaren Ausschnitts (Datenquellen fragen im Umkreis ab)
      const clat = (v.s + v.n) / 2;
      let clon = v.w <= v.e ? (v.w + v.e) / 2 : (v.w + v.e + 360) / 2;
      if (clon > 180) clon -= 360;
      const need = Math.max(distanceKm(clat, clon, v.n, v.w), distanceKm(clat, clon, v.s, v.w), distanceKm(clat, clon, v.n, v.e), distanceKm(clat, clon, v.s, v.e));
      const area = tracker.liveArea(clat, clon, need * 1.15);
      await area.ready;
      const partial = distanceKm(area.lat, area.lon, clat, clon) + need > area.radiusKm * 1.02;
      return send(res, 200, {
        serverTime: Date.now(),
        coverage: { lat: area.lat, lon: area.lon, radiusKm: Math.round(area.radiusKm) },
        partial,
        aircraft: area.liveView(b),
        sources: area.sourceStatus(),
      });
    }
    if (p === '/api/trail') {
      const id = String(q('id') || '').toLowerCase();
      if (!/^[\w~-]{3,20}$/.test(id)) return send(res, 400, { error: 'id fehlt' });
      return send(res, 200, { id, trail: tracker.trailFor(id) });
    }
    if (p === '/api/search') return send(res, 200, await search(q('q'), tracker, { global: q('global') !== '0' }));
    if (p === '/api/airports') {
      const b = parseBbox(q('b'));
      if (!b) return send(res, 400, { error: 'Ausschnitt (b=s,w,n,e) fehlt' });
      return send(res, 200, await airportsIn(b, Number(q('z')) || 6), { 'cache-control': 'max-age=600' });
    }
    if (p === '/api/metar') return send(res, 200, { metar: await metar(q('icao')) });

    if (p === '/api/screens') {
      if (req.method === 'GET') return send(res, 200, store.list());
      if (req.method === 'POST') return send(res, 201, store.create(await readBody(req)));
    }
    const sm = p.match(/^\/api\/screens\/([\w-]+)$/);
    if (sm) {
      const id = sm[1];
      if (req.method === 'GET') { const s = store.get(id); return s ? send(res, 200, s) : send(res, 404, { error: 'Bildschirm nicht gefunden' }); }
      if (req.method === 'PUT') { const s = store.update(id, await readBody(req)); return s ? send(res, 200, s) : send(res, 404, { error: 'Bildschirm nicht gefunden' }); }
      if (req.method === 'DELETE') return send(res, store.remove(id) ? 200 : 404, { ok: true });
    }

    if (p === '/api/geocode') return send(res, 200, await geocode(q('q')));

    if (p === '/api/aircraft') {
      let screen = store.get(q('screen'));
      if (!screen) return send(res, 404, { error: 'Bildschirm nicht gefunden' });
      // Live-Vorschau aus der Verwaltung: ungespeicherte Einstellungen anwenden (wird nicht gespeichert)
      const draft = q('preview');
      if (draft) {
        try {
          screen = { ...normalizeScreen(JSON.parse(draft), screen), id: `${screen.id}~preview`, statsId: screen.id };
        } catch { /* ungültiger Entwurf (z. B. Standort leer) → gespeicherte Einstellungen zeigen */ }
      }
      const area = tracker.areaFor(screen);
      await area.ready;
      return send(res, 200, { serverTime: Date.now(), screen, ...area.viewFor(screen) });
    }

    if (p === '/api/details') return send(res, 200, await details({ hex: q('hex'), callsign: q('cs') }), { 'cache-control': 'max-age=3600' });

    const lm = p.match(/^\/api\/logo\/([A-Za-z]{3})$/);
    if (lm) {
      const buf = await getLogo(lm[1]);
      if (!buf) return send(res, 404, 'kein Logo', { 'cache-control': 'max-age=3600' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=604800' });
      return res.end(buf);
    }

    if (p === '/api/weather') {
      const lat = Number(q('lat')), lon = Number(q('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return send(res, 400, { error: 'lat/lon fehlen' });
      return send(res, 200, await weather(lat, lon));
    }

    if (p === '/api/status') return send(res, 200, { areas: tracker.status() });

    if (req.method === 'GET') return serveFile(res, path.join(publicDir, p));
    send(res, 405, 'Method not allowed');
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Flugradar läuft: http://localhost:${config.port}/  (Bildschirme: http://localhost:${config.port}/admin)`);
  setTimeout(() => loadAirports(), 3000); // Flughafenliste im Hintergrund vorbereiten (für Suche und Karte)
  console.log(`Quellen: ${sources.map(s => s.name).join(', ')}`);
  if (!config.adminPassword) console.log('Hinweis: Verwaltung ohne Passwort (ADMIN_PASSWORD setzen, bevor es ins Internet geht).');
});

const shutdown = () => { tracker.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
