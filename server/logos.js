import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Airline-Logos nach ICAO-Code (aus dem Callsign): Quellen der Reihe nach probieren, Ergebnis lokal zwischenspeichern
const dir = path.join(config.dataDir, 'logos');
const MISS_TTL = 7 * 24 * 3600e3; // nicht gefundene Logos erst nach einer Woche erneut versuchen
// Ändert sich die Quellenliste, werden alte "nicht gefunden"-Einträge ungültig
const SOURCES_SIG = config.logoUrls.join('\n');
const inflight = new Map();

async function fetchLogo(icao) {
  let transient = false;
  for (const tpl of config.logoUrls) {
    try {
      const res = await fetch(tpl.replace('{icao}', icao), {
        headers: { 'user-agent': config.userAgent },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
        return { buf: Buffer.from(await res.arrayBuffer()) };
      }
      if (res.status !== 404) transient = true; // Störung bei dieser Quelle → später erneut versuchen
    } catch {
      transient = true;
    }
  }
  return { buf: null, transient };
}

export async function getLogo(icao) {
  icao = String(icao || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(icao)) return null;
  const file = path.join(dir, `${icao}.png`);
  const miss = path.join(dir, `${icao}.none`);
  try { return await fs.promises.readFile(file); } catch { /* noch nicht im Cache */ }
  try {
    const st = await fs.promises.stat(miss);
    if (Date.now() - st.mtimeMs < MISS_TTL && (await fs.promises.readFile(miss, 'utf8')) === SOURCES_SIG) return null;
  } catch { /* kein (gültiger) Negativ-Eintrag */ }

  if (!inflight.has(icao)) {
    inflight.set(icao, (async () => {
      try {
        const { buf, transient } = await fetchLogo(icao);
        await fs.promises.mkdir(dir, { recursive: true });
        if (buf) {
          await fs.promises.writeFile(file, buf);
          await fs.promises.rm(miss, { force: true });
          return buf;
        }
        if (!transient) await fs.promises.writeFile(miss, SOURCES_SIG); // bei keiner Quelle vorhanden
        return null;
      } catch {
        return null;
      } finally {
        inflight.delete(icao);
      }
    })());
  }
  return inflight.get(icao);
}
