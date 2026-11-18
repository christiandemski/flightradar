import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { distanceKm, bearingDeg } from './geo.js';
import { classify } from './sources.js';

const TRAIL_MS = 6 * 60e3;
const IDLE_MS = 3 * 60e3;
const statsDir = path.join(config.dataDir, 'stats');

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, lokale Zeit
const labelOf = ac => ac.callsign || ac.reg || ac.cn || ac.hex || ac.id;

function emptyStats() {
  return { day: today(), seen: {}, count: 0, cls: {}, airlines: {}, military: 0, hidden: 0, flarm: 0, hours: Array(24).fill(0), maxAlt: null, maxSpeed: null, closest: null };
}

function loadStats(id) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(statsDir, `${id}.json`), 'utf8'));
    if (s.day === today()) return s;
  } catch { /* noch keine Statistik */ }
  return emptyStats();
}

function saveStats(id, s) {
  fs.mkdirSync(statsDir, { recursive: true });
  const f = path.join(statsDir, `${id}.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(s));
  fs.renameSync(`${f}.tmp`, f);
}

export function summarizeStats(s) {
  const top = Object.entries(s.airlines).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { day: s.day, count: s.count, cls: s.cls, military: s.military, hidden: s.hidden, flarm: s.flarm, hours: s.hours, maxAlt: s.maxAlt, maxSpeed: s.maxSpeed, closest: s.closest, topAirlines: top };
}

export class Tracker {
  constructor(sources) {
    this.sources = sources;
    this.areas = new Map();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  /** Bildschirme mit (fast) gleichem Standort teilen sich ein Abfragegebiet */
  areaFor(screen) {
    const key = `${screen.lat.toFixed(2)}_${screen.lon.toFixed(2)}`;
    let a = this.areas.get(key);
    if (!a) {
      a = new Area(key, screen.lat, screen.lon, this.sources);
      this.areas.set(key, a);
    }
    a.attach(screen);
    return a;
  }

  tick() {
    const now = Date.now();
    for (const [k, a] of this.areas) {
      if (now - a.lastUsed > IDLE_MS) {
        a.flush();
        this.areas.delete(k);
      } else {
        a.tick(now);
      }
    }
  }

  flush() {
    for (const a of this.areas.values()) a.flush();
  }

  status() {
    return [...this.areas.values()].map(a => ({
      key: a.key, lat: a.lat, lon: a.lon, radiusKm: Math.round(a.radiusKm), aircraft: a.merged.length,
      screens: [...a.screens.keys()], sources: a.sourceStatus(),
    }));
  }
}

class Area {
  constructor(key, lat, lon, sources) {
    Object.assign(this, { key, lat, lon, radiusKm: 0, lastUsed: Date.now() });
    this.state = sources.map(src => ({ src, nextAt: 0, inflight: false, fails: 0, lastOk: 0, lastErr: null, count: 0, maxAge: 60e3 }));
    this.recs = new Map();     // sourceId -> Map(id -> record)
    this.trails = new Map();   // id -> { pts: [[lat, lon, altFt, t]], last }
    this.screens = new Map();  // screenId -> { cfg, stats, dirty, lastUsed }
    this.merged = [];
    this.ready = new Promise(r => { this._ready = r; });
    setTimeout(() => this._ready(), 8000);
  }

  attach(screen) {
    const now = Date.now();
    this.lastUsed = now;
    const need = distanceKm(this.lat, this.lon, screen.lat, screen.lon) + screen.radiusKm;
    if (need > this.radiusKm) {
      const first = this.radiusKm === 0;
      this.radiusKm = need;
      // größeres Gebiet: schnelle Quellen sofort neu abfragen
      if (!first) for (const s of this.state) if (s.src.intervalMs < 60e3) s.nextAt = 0;
    }
    let sc = this.screens.get(screen.id);
    if (!sc) {
      sc = { stats: loadStats(screen.statsId || screen.id), dirty: false, savedAt: now };
      this.screens.set(screen.id, sc);
    }
    sc.cfg = screen;
    sc.lastUsed = now;
  }

  tick(now) {
    for (const st of this.state) {
      if (!st.inflight && now >= st.nextAt) this.poll(st);
    }
    for (const [id, sc] of this.screens) {
      if (sc.dirty && now - sc.savedAt > 60e3) this.saveScreen(id, sc);
      if (now - sc.lastUsed > IDLE_MS) {
        this.saveScreen(id, sc);
        this.screens.delete(id);
      }
    }
  }

  async poll(st) {
    st.inflight = true;
    try {
      const { list, nextMs } = await st.src.fetch({ lat: this.lat, lon: this.lon, radiusKm: this.radiusKm * 1.05 });
      const m = new Map();
      for (const r of list) m.set(r.id, r);
      this.recs.set(st.src.id, m);
      const interval = nextMs || st.src.intervalMs;
      Object.assign(st, { fails: 0, lastOk: Date.now(), lastErr: null, count: list.length, nextAt: Date.now() + interval, maxAge: Math.max(60e3, interval + 30e3) });
      this.update();
    } catch (e) {
      st.fails++;
      st.lastErr = e.message;
      let wait = Math.min(st.src.intervalMs * 2 ** st.fails, 10 * 60e3);
      const reset = Number(e.headers?.get?.('x-ratelimit-reset'));
      if (e.status === 429 && reset > 0) wait = reset * 1000;
      st.nextAt = Date.now() + wait;
    } finally {
      st.inflight = false;
    }
  }

  update() {
    const now = Date.now();
    const groups = new Map();
    for (const st of this.state) {
      const m = this.recs.get(st.src.id);
      if (!m) continue;
      for (const r of m.values()) {
        if (now - r.posTime > st.maxAge) continue;
        let g = groups.get(r.id);
        if (!g) groups.set(r.id, (g = []));
        g.push(r);
      }
    }

    // Felder zusammenführen: neueste Position gewinnt, fehlende Felder aus anderen Quellen auffüllen
    const merged = [];
    for (const g of groups.values()) {
      g.sort((a, b) => a.posTime - b.posTime);
      const out = { sources: [] };
      for (const r of g) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'boolean') out[k] = out[k] || v;
          else if (v != null) out[k] = v;
        }
        if (!out.sources.includes(r.source)) out.sources.push(r.source);
      }
      // Flugzeug mit ICAO-Hex aus OGN → Kennung als FLARM-Kind nur, wenn keine ADS-B-Quelle
      out.onGround = g[g.length - 1].onGround;
      const nonOgn = g.filter(r => r.source !== 'ogn');
      if (nonOgn.length) out.kind = nonOgn[nonOgn.length - 1].kind;
      out.cls = classify(out);
      merged.push(out);
    }
    // OGN-Empfänger melden auch ADS-B-Flugzeuge, teils ohne ICAO-Hex → Dubletten per Nähe entfernen
    const adsb = merged.filter(a => a.kind !== 'flarm');
    this.merged = merged.filter(a => {
      if (a.kind !== 'flarm') return true;
      return !adsb.some(b =>
        (a.reg && b.reg && a.reg.replace('-', '') === b.reg.replace('-', ''))
        || (Math.abs((a.altFt ?? 0) - (b.altFt ?? 0)) < 1500
          && distanceKm(a.lat, a.lon, b.lat, b.lon) < 1.5 + ((b.gsKt || 0) * 1.852 * Math.abs(b.posTime - a.posTime)) / 3.6e6 * 1.1));
    });

    // Spuren
    for (const ac of this.merged) {
      if (ac.onGround) continue;
      let t = this.trails.get(ac.id);
      if (!t) this.trails.set(ac.id, (t = { pts: [] }));
      const last = t.pts[t.pts.length - 1];
      if (!last || ac.posTime - last[3] > 8000 || distanceKm(last[0], last[1], ac.lat, ac.lon) > 0.4) {
        if (!last || ac.posTime > last[3]) t.pts.push([ac.lat, ac.lon, Math.round(ac.altFt ?? 0), ac.posTime]);
      }
      t.last = now;
    }
    for (const [id, t] of this.trails) {
      while (t.pts.length && now - t.pts[0][3] > TRAIL_MS) t.pts.shift();
      if (!t.pts.length || now - t.last > 5 * 60e3) this.trails.delete(id);
    }

    // Tagesstatistik je Bildschirm
    for (const sc of this.screens.values()) this.updateStats(sc, now);
    this._ready();
  }

  updateStats(sc, now) {
    const cfg = sc.cfg;
    if (sc.stats.day !== today()) sc.stats = emptyStats();
    const s = sc.stats;
    for (const ac of this.merged) {
      if (ac.onGround || now - ac.posTime > 60e3) continue;
      const d = distanceKm(cfg.lat, cfg.lon, ac.lat, ac.lon);
      if (d > cfg.radiusKm) continue;
      const label = labelOf(ac);
      if (!s.seen[ac.id]) {
        s.seen[ac.id] = 1;
        s.count++;
        s.cls[ac.cls] = (s.cls[ac.cls] || 0) + 1;
        const al = ac.callsign?.match(/^([A-Z]{3})\d/)?.[1];
        if (al) s.airlines[al] = (s.airlines[al] || 0) + 1;
        if (ac.military) s.military++;
        if (ac.ladd || ac.pia) s.hidden++;
        if (ac.kind === 'flarm') s.flarm++;
        s.hours[new Date().getHours()]++;
        sc.dirty = true;
      }
      if (ac.altFt != null && ac.altFt < 70000 && (!s.maxAlt || ac.altFt > s.maxAlt.v)) { s.maxAlt = { v: Math.round(ac.altFt), label, t: now }; sc.dirty = true; }
      if (ac.gsKt != null && ac.gsKt < 1000 && (!s.maxSpeed || ac.gsKt > s.maxSpeed.v)) { s.maxSpeed = { v: Math.round(ac.gsKt), label, t: now }; sc.dirty = true; }
      if (!s.closest || d < s.closest.v) { s.closest = { v: Math.round(d * 100) / 100, label, alt: Math.round(ac.altFt ?? 0), t: now }; sc.dirty = true; }
    }
  }

  saveScreen(id, sc) {
    if (!sc.dirty) return;
    if (id.endsWith('~preview')) { sc.dirty = false; return; } // Vorschau-Statistik nicht speichern
    try { saveStats(id, sc.stats); } catch (e) { console.error('Statistik speichern fehlgeschlagen:', e.message); }
    sc.dirty = false;
    sc.savedAt = Date.now();
  }

  flush() {
    for (const [id, sc] of this.screens) this.saveScreen(id, sc);
  }

  sourceStatus() {
    return this.state.map(s => ({
      id: s.src.id, name: s.src.name, ok: !!s.lastOk && !s.lastErr, lastOk: s.lastOk || null,
      error: s.lastErr, count: s.count, nextIn: Math.max(0, Math.round((s.nextAt - Date.now()) / 1000)),
    }));
  }

  /** gefilterte Liste für einen Bildschirm */
  viewFor(screen) {
    const out = [];
    for (const ac of this.merged) {
      const distKm = distanceKm(screen.lat, screen.lon, ac.lat, ac.lon);
      if (distKm > screen.radiusKm) continue;
      if (screen.hideGround && ac.onGround) continue;
      if (!screen.showOgn && ac.kind === 'flarm') continue;
      if (!ac.onGround && ac.altFt != null && (ac.altFt < screen.minAltFt || ac.altFt > screen.maxAltFt)) continue;
      const t = this.trails.get(ac.id);
      out.push({
        ...ac,
        distKm: Math.round(distKm * 100) / 100,
        bearing: Math.round(bearingDeg(screen.lat, screen.lon, ac.lat, ac.lon)),
        trail: t ? t.pts.map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, p[2]]) : [],
      });
    }
    out.sort((a, b) => a.distKm - b.distKm);
    const sc = this.screens.get(screen.id);
    return { aircraft: out, sources: this.sourceStatus(), stats: sc ? summarizeStats(sc.stats) : null };
  }
}
