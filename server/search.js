import { get, gate, normReadsb, classify } from './sources.js';
import { searchAirports } from './airports.js';

// IATA-Airline-Code → ICAO (für Flugnummern wie "LH400" → Rufzeichen "DLH400")
const IATA_ICAO = {
  LH: 'DLH', EW: 'EWG', DE: 'CFG', X3: 'TUI', EN: 'DLA', CL: 'CLH', '4Y': 'OCN', FR: 'RYR', RK: 'RUK', U2: 'EZY', EC: 'EJU', DS: 'EZS',
  W6: 'WZZ', W4: 'WMT', VY: 'VLG', BA: 'BAW', AF: 'AFR', KL: 'KLM', LX: 'SWR', OS: 'AUA', SN: 'BEL', SK: 'SAS', AY: 'FIN', IB: 'IBE',
  TP: 'TAP', AZ: 'ITY', LO: 'LOT', TK: 'THY', PC: 'PGT', XQ: 'SXS', EK: 'UAE', QR: 'QTR', EY: 'ETD', UA: 'UAL', DL: 'DAL', AA: 'AAL',
  AC: 'ACA', SQ: 'SIA', CX: 'CPA', NH: 'ANA', JL: 'JAL', CA: 'CCA', CZ: 'CSN', MU: 'CES', AI: 'AIC', LY: 'ELY', DY: 'NOZ', D8: 'NSZ',
  FI: 'ICE', A3: 'AEE', OK: 'CSA', RO: 'ROT', BT: 'BTI', MS: 'MSR', AT: 'RAM', SV: 'SVA', KU: 'KAC', ET: 'ETH', MH: 'MAS', BR: 'EVA',
  LS: 'EXS', TO: 'TVF', HV: 'TRA', DI: 'MBU', LG: 'LGL', WK: 'EDW', A5: 'HOP', B6: 'JBU', WN: 'SWA', AS: 'ASA', NK: 'NKS', F9: 'FFT',
  QF: 'QFA', NZ: 'ANZ', KE: 'KAL', OZ: 'AAR', CI: 'CAL', TG: 'THA', VN: 'HVN', GA: 'GIA', PR: 'PAL', WY: 'OMA', GF: 'GFA', RJ: 'RJA',
  ME: 'MEA', PS: 'AUI', HY: 'UZB', KC: 'KZR', J2: 'AHY', A9: 'TGZ', SU: 'AFL', JU: 'ASL', OU: 'CTN', JP: 'ADR', '0B': 'BMS', FB: 'LZB',
  VS: 'VIR', EI: 'EIN', BE: 'BEE', LM: 'LOG', T3: 'EZE', XR: 'CXI', BY: 'TOM', MT: 'TCX', HG: 'NLY', '4U': 'GWI', ST: 'GMI', '2L': 'OAW',
  OA: 'OAL', BJ: 'LBT', TB: 'JAF', XC: 'CAI', VF: 'TKJ', '8Q': 'OHY', SM: 'MSC', NO: 'NOS', NE: 'NMA', V7: 'VOE', IG: 'ISS', '5O': 'FPO',
  QS: 'TVS', LA: 'LAN', AV: 'AVA', CM: 'CMP', AM: 'AMX', AR: 'ARG', G3: 'GLO', AD: 'AZU', SA: 'SAA', KQ: 'KQA', WB: 'RWD', '6E': 'IGO',
  UK: 'VTI', '3U': 'CSC', HU: 'CHH', ZH: 'CSZ', FM: 'CSH', '5X': 'UPS', FX: 'FDX', CV: 'CLX', QY: 'BCS', D0: 'DHK', '3S': 'BOX',
};

const compact = ac => ({ ...ac, cls: classify(ac) });

/** Kandidaten für Rufzeichen aus einer Eingabe wie "LH 400", "LH0400", "DLH400" */
export function callsignCandidates(q) {
  const Q = q.toUpperCase().replace(/[\s-]+/g, '');
  const out = new Set();
  if (/^[A-Z0-9]{2,8}$/.test(Q)) out.add(Q);
  const m = Q.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]{0,2})$/);
  if (m && IATA_ICAO[m[1]]) out.add(IATA_ICAO[m[1]] + m[2].replace(/^0+(?=\d)/, ''));
  const m3 = Q.match(/^([A-Z]{3})0+(\d+[A-Z]{0,2})$/);
  if (m3) out.add(m3[1] + m3[2]);
  return [...out];
}

const regKey = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** passt ein Flugzeug zur Suche? Liefert, worüber es gefunden wurde */
function matchOf(ac, Q, cands) {
  const cs = ac.callsign?.toUpperCase();
  if (cs && cands.includes(cs)) return 'callsign';
  if (ac.hex && ac.hex.toUpperCase() === Q) return 'hex';
  if (ac.reg && regKey(ac.reg) === regKey(Q)) return 'reg';
  if (ac.cn && ac.cn.toUpperCase() === Q) return 'cn';
  if (ac.icaoType && ac.icaoType.toUpperCase() === Q) return 'type';
  if (Q.length >= 3 && cs?.startsWith(Q)) return 'callsign-prefix';
  if (Q.length >= 4 && ac.reg && regKey(ac.reg).startsWith(regKey(Q))) return 'reg-prefix';
  return null;
}
const RANK = { callsign: 0, hex: 0, reg: 0, cn: 1, 'callsign-prefix': 2, 'reg-prefix': 2, type: 3 };

/** weltweite Suche bei adsb.fi (nur, wenn wir das Flugzeug nicht ohnehin schon kennen) */
async function globalLookup(Q, cands) {
  const urls = [];
  for (const c of cands.slice(0, 2)) urls.push(`https://opendata.adsb.fi/api/v2/callsign/${encodeURIComponent(c)}`);
  if (/^[0-9A-F]{6}$/.test(Q)) urls.push(`https://opendata.adsb.fi/api/v2/hex/${Q.toLowerCase()}`);
  // Kennzeichen: wie eingegeben, sonst mit Bindestrich nach dem Länderpräfix (D-AIXA, OE-LBA, HB-JNA …)
  const raw = Q.replace(/\s+/g, '');
  if (raw.includes('-')) urls.push(`https://opendata.adsb.fi/api/v2/registration/${encodeURIComponent(raw)}`);
  else if (/^(D|F|G|I|M|B|C)[A-Z]{4}$/.test(raw)) urls.push(`https://opendata.adsb.fi/api/v2/registration/${raw[0]}-${raw.slice(1)}`);
  else if (/^(OE|HB|PH|OO|OY|SE|LN|OH|EI|EC|CS|SP|OK|OM|HA|YR|LZ|SX|TC|9H|4X|VH|ZK|JA|HL)[A-Z0-9]{3}$/.test(raw)) urls.push(`https://opendata.adsb.fi/api/v2/registration/${raw.slice(0, 2)}-${raw.slice(2)}`);
  else if (/^N\d[0-9A-Z]{1,4}$/.test(raw)) urls.push(`https://opendata.adsb.fi/api/v2/registration/${raw}`);

  const found = new Map();
  for (const url of urls.slice(0, 3)) {
    try {
      await gate('adsbfi', 1100);
      const { body } = await get(url, { timeout: 8000 });
      const now = Date.now();
      for (const a of body.ac || body.aircraft || []) {
        const r = normReadsb(a, now, 'adsbfi');
        if (r) found.set(r.id, compact(r));
      }
    } catch { /* Dienst nicht erreichbar – Suche liefert dann nur lokale Treffer */ }
    if (found.size) break;
  }
  return [...found.values()];
}

export async function search(q, tracker, { global = true } = {}) {
  q = String(q || '').trim().slice(0, 40);
  if (q.length < 2) return { aircraft: [], airports: [] };
  const Q = q.toUpperCase();
  const cands = callsignCandidates(q);
  const local = tracker.find(ac => !!matchOf(ac, Q, cands), 200)
    .map(ac => ({ ...ac, match: matchOf(ac, Q, cands) }))
    .sort((a, b) => RANK[a.match] - RANK[b.match] || (a.callsign || '').localeCompare(b.callsign || ''))
    .slice(0, 30);
  const exact = local.some(a => RANK[a.match] <= 1);
  const [airports, remote] = await Promise.all([
    searchAirports(q),
    global && !exact && /^[A-Z0-9\s-]{3,10}$/i.test(q) ? globalLookup(Q, cands) : [],
  ]);
  const ids = new Set(local.map(a => a.id));
  const aircraft = [...local, ...remote.filter(a => !ids.has(a.id)).map(a => ({ ...a, match: 'global' }))];
  for (const a of aircraft) delete a.source;
  return { aircraft, airports };
}
