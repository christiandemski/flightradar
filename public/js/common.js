// Gemeinsame Helfer für alle Ansichten

const RAD = Math.PI / 180;

export const COMPASS_SHORT = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const COMPASS_LONG = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
export const compass = b => COMPASS_SHORT[Math.round(((b % 360) + 360) % 360 / 22.5) % 16];
export const compassLong = b => COMPASS_LONG[Math.round(((b % 360) + 360) % 360 / 45) % 8];

const de = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function makeFmt(units) {
  const avi = units === 'aviation';
  return {
    aviation: avi,
    unitKm: avi ? 1.852 : 1,
    unit: avi ? 'NM' : 'km',
    alt(ft, ground) {
      if (ground) return 'Boden';
      if (ft == null) return '–';
      if (avi) return ft >= 6000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${de(Math.round(ft / 50) * 50)} ft`;
      return `${de(Math.round((ft * 0.3048) / 10) * 10)} m`;
    },
    altShort(ft, ground) {
      if (ground) return 'GND';
      if (ft == null) return '';
      return avi ? `FL${Math.round(ft / 100)}` : `${de(Math.round((ft * 0.3048) / 100) * 100)}m`;
    },
    speed(kt) {
      if (kt == null) return '–';
      return avi ? `${Math.round(kt)} kt` : `${Math.round(kt * 1.852)} km/h`;
    },
    speedNum(kt) { return kt == null ? '' : String(Math.round(avi ? kt : kt * 1.852)); },
    dist(km) {
      if (km == null) return '–';
      const v = km / (avi ? 1.852 : 1);
      return `${de(v, v < 10 ? 1 : 0)} ${avi ? 'NM' : 'km'}`;
    },
    vr(fpm) {
      if (fpm == null) return '–';
      if (Math.abs(fpm) < 100) return 'level';
      return avi ? `${fpm > 0 ? '+' : ''}${de(Math.round(fpm / 50) * 50)} ft/min` : `${fpm > 0 ? '+' : ''}${de(fpm * 0.00508, 1)} m/s`;
    },
  };
}

export const vrArrow = fpm => (fpm == null || Math.abs(fpm) < 300 ? '→' : fpm > 0 ? '↗' : '↘');

export const KIND_LABEL = { adsb: 'ADS-B', mlat: 'MLAT', flarm: 'FLARM (OGN)', tisb: 'TIS-B', adsr: 'ADS-R', adsc: 'ADS-C', modes: 'Mode S', other: 'Sonstige' };
export const CLS_LABEL = { heavy: 'Großraumflugzeug', jet: 'Verkehrsflugzeug', plane: 'Flugzeug', light: 'Kleinflugzeug', heli: 'Hubschrauber', glider: 'Segelflugzeug', balloon: 'Ballon/Luftschiff', drone: 'Drohne', ground: 'Bodenfahrzeug' };
export const SOURCE_LABEL = { adsbfi: 'adsb.fi', adsblol: 'adsb.lol', airplaneslive: 'airplanes.live', ogn: 'OGN', readsb: 'Eigener Empfänger' };

export const AIRLINES = {
  DLH: 'Lufthansa', EWG: 'Eurowings', CFG: 'Condor', TUI: 'TUIfly', DLA: 'Air Dolomiti', CLH: 'Lufthansa CityLine', LHX: 'Lufthansa City',
  RYR: 'Ryanair', EZY: 'easyJet', EJU: 'easyJet Europe', EZS: 'easyJet Switzerland', WZZ: 'Wizz Air', WMT: 'Wizz Air Malta', VLG: 'Vueling',
  BAW: 'British Airways', AFR: 'Air France', KLM: 'KLM', SWR: 'Swiss', AUA: 'Austrian', BEL: 'Brussels Airlines', SAS: 'SAS', FIN: 'Finnair',
  IBE: 'Iberia', TAP: 'TAP Air Portugal', ITY: 'ITA Airways', LOT: 'LOT', THY: 'Turkish Airlines', PGT: 'Pegasus', SXS: 'SunExpress',
  UAE: 'Emirates', QTR: 'Qatar Airways', ETD: 'Etihad', UAL: 'United', DAL: 'Delta', AAL: 'American', ACA: 'Air Canada', SIA: 'Singapore Airlines',
  CPA: 'Cathay Pacific', ANA: 'ANA', JAL: 'Japan Airlines', CCA: 'Air China', CSN: 'China Southern', AIC: 'Air India', ELY: 'El Al',
  NOZ: 'Norwegian', NSZ: 'Norwegian', ICE: 'Icelandair', AEE: 'Aegean', CSA: 'Czech Airlines', ROT: 'TAROM', BTI: 'airBaltic',
  GEC: 'Lufthansa Cargo', BOX: 'AeroLogic', DHK: 'DHL', BCS: 'DHL (EAT)', FDX: 'FedEx', UPS: 'UPS', CLX: 'Cargolux', ABR: 'ASL Airlines',
  MSR: 'EgyptAir', RAM: 'Royal Air Maroc', SVA: 'Saudia', KAC: 'Kuwait Airways', ETH: 'Ethiopian', MAS: 'Malaysia', EVA: 'EVA Air',
  GAF: 'Luftwaffe', GAM: 'Heer', NATO: 'NATO', CHX: 'ADAC Luftrettung', DRF: 'DRF Luftrettung', BPO: 'Bundespolizei', DCK: 'Deutsche Flugsicherung',
  NJE: 'NetJets', EXS: 'Jet2', TVF: 'Transavia France', TRA: 'Transavia', MBU: 'Marabu', DCS: 'DC Aviation', LGL: 'Luxair', EDW: 'Edelweiss', HOP: 'Air France Hop',
};
export const airlineName = icao => AIRLINES[icao] || null;
export const airlineOf = ac => ac.callsign?.match(/^([A-Z]{3})\d/)?.[1] || null;

export const labelOf = ac => ac.callsign || ac.reg || ac.cn || (ac.hex ? ac.hex.toUpperCase() : `FLARM-${ac.id.slice(-4).toUpperCase()}`);

// WMO-Wettercodes (Open-Meteo)
export function wmo(code, isDay = true) {
  const t = {
    0: [isDay ? '☀️' : '🌙', 'Klar'], 1: [isDay ? '🌤️' : '🌙', 'Überwiegend klar'], 2: ['⛅', 'Teils bewölkt'], 3: ['☁️', 'Bedeckt'],
    45: ['🌫️', 'Nebel'], 48: ['🌫️', 'Raureifnebel'], 51: ['🌦️', 'Nieselregen'], 53: ['🌦️', 'Nieselregen'], 55: ['🌦️', 'Nieselregen'],
    56: ['🌧️', 'Gefrierender Niesel'], 57: ['🌧️', 'Gefrierender Niesel'], 61: ['🌧️', 'Leichter Regen'], 63: ['🌧️', 'Regen'], 65: ['🌧️', 'Starker Regen'],
    66: ['🌧️', 'Gefrierender Regen'], 67: ['🌧️', 'Gefrierender Regen'], 71: ['🌨️', 'Leichter Schnee'], 73: ['🌨️', 'Schnee'], 75: ['❄️', 'Starker Schnee'],
    77: ['🌨️', 'Schneegriesel'], 80: ['🌦️', 'Regenschauer'], 81: ['🌧️', 'Regenschauer'], 82: ['⛈️', 'Starke Schauer'], 85: ['🌨️', 'Schneeschauer'],
    86: ['🌨️', 'Schneeschauer'], 95: ['⛈️', 'Gewitter'], 96: ['⛈️', 'Gewitter mit Hagel'], 99: ['⛈️', 'Gewitter mit Hagel'],
  };
  return t[code] || ['', ''];
}

/** Position zum Zeitpunkt "jetzt" (Server-Zeit) per Koppelnavigation fortschreiben */
export function extrapolate(ac, nowServer) {
  if (ac.onGround || ac.gsKt == null || ac.track == null) return [ac.lat, ac.lon];
  const dt = Math.min(90, Math.max(0, (nowServer - ac.posTime) / 1000));
  const dKm = (ac.gsKt * 1.852 * dt) / 3600;
  const t = ac.track * RAD;
  const lat = ac.lat + (dKm * Math.cos(t)) / 110.574;
  const lon = ac.lon + (dKm * Math.sin(t)) / (111.32 * Math.cos(ac.lat * RAD));
  return [lat, lon];
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Winkel über dem Horizont (mit Erdkrümmung) */
export function elevationDeg(altFt, distKm) {
  if (altFt == null || distKm == null) return null;
  const h = altFt * 0.3048;
  const d = Math.max(distKm * 1000, 1);
  return Math.atan((h - (d * d) / (2 * 6371000)) / d) / RAD;
}

// Farben nach Höhe (ähnlich tar1090)
const HUE_STOPS = [[0, 20], [2000, 32], [4000, 43], [6000, 54], [8000, 72], [9000, 85], [11000, 140], [20000, 180], [30000, 220], [40000, 300]];
export function altColor(ft, ground, mode, fallback) {
  if (mode === 'mono') return fallback;
  if (ground) return mode === 'alt-dark' ? '#777' : '#999';
  if (ft == null) return fallback;
  let h = HUE_STOPS[HUE_STOPS.length - 1][1];
  for (let i = 0; i < HUE_STOPS.length - 1; i++) {
    const [a0, h0] = HUE_STOPS[i], [a1, h1] = HUE_STOPS[i + 1];
    if (ft <= a1) { h = h0 + ((Math.max(ft, a0) - a0) / (a1 - a0)) * (h1 - h0); break; }
  }
  return mode === 'alt-dark' ? `hsl(${h} 80% 38%)` : `hsl(${h} 85% 60%)`;
}

// Icons (SVG-Pfade, Nase zeigt nach oben, Mitte 0/0, ca. 32×32)
const PLANE = 'M0,-14 L2,-9 L2,-3 L13,3 L13,6 L2,3.5 L1.6,9 L5,12 L5,14 L0,12.6 L-5,14 L-5,12 L-1.6,9 L-2,3.5 L-13,6 L-13,3 L-2,-3 L-2,-9 Z';
export const ICONS = {
  heavy: { d: PLANE, scale: 1.25, rotate: true },
  jet: { d: PLANE, scale: 1.05, rotate: true },
  plane: { d: PLANE, scale: 0.95, rotate: true },
  light: { d: 'M0,-11 L1.5,-8 L1.5,-4 L13,-3 L13,-0.5 L1.5,0 L1.2,7 L4.5,8.5 L4.5,10 L0,9.5 L-4.5,10 L-4.5,8.5 L-1.2,7 L-1.5,0 L-13,-0.5 L-13,-3 L-1.5,-4 L-1.5,-8 Z', scale: 0.9, rotate: true },
  glider: { d: 'M0,-8 L1,-6 L1,-2.5 L16,-1.6 L16,-0.4 L1,0.2 L0.6,9 L3.5,10 L3.5,11 L0,10.7 L-3.5,11 L-3.5,10 L-0.6,9 L-1,0.2 L-16,-0.4 L-16,-1.6 L-1,-2.5 L-1,-6 Z', scale: 0.9, rotate: true },
  heli: { d: 'M0,-7 C3,-7 3.5,-3 3.5,0 C3.5,3 2,5 1,6 L0.6,12 L3,12 L3,13.5 L-3,13.5 L-3,12 L-0.6,12 L-1,6 C-2,5 -3.5,3 -3.5,0 C-3.5,-3 -3,-7 0,-7 Z M-11,-1 L11,-1 L11,0.5 L-11,0.5 Z M-0.75,-11 L0.75,-11 L0.75,10 L-0.75,10 Z', scale: 0.95, rotate: true },
  balloon: { d: 'M0,-11 C6,-11 8,-6 8,-3 C8,2 3,5 2,7 L-2,7 C-3,5 -8,2 -8,-3 C-8,-6 -6,-11 0,-11 Z M-2,8.5 L2,8.5 L2,11.5 L-2,11.5 Z', scale: 0.85, rotate: false },
  drone: { d: 'M-2.5,-2.5 L2.5,-2.5 L2.5,2.5 L-2.5,2.5 Z M-9,-9 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 M9,-9 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 M-9,9 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 M9,9 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0', scale: 0.8, rotate: false },
  ground: { d: 'M-4,-6 L4,-6 L4,6 L-4,6 Z', scale: 0.7, rotate: true },
};

export function iconSvg(ac, color, sizePx = 26) {
  const ic = ICONS[ac.cls] || ICONS.plane;
  const rot = ic.rotate ? ac.track || 0 : 0;
  const s = sizePx * ic.scale;
  return `<svg width="${s}" height="${s}" viewBox="-16 -16 32 32" style="transform:rotate(${rot}deg)"><path d="${ic.d}" fill="${color}" stroke="rgba(0,0,0,.55)" stroke-width="1" fill-rule="nonzero"/></svg>`;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim();

/** Routen-Kurzform "FRA → JFK" aus Detaildaten */
export function routeShort(det) {
  const r = det?.route;
  if (!r?.origin || !r?.destination) return '';
  return `${r.origin.iata || r.origin.icao} → ${r.destination.iata || r.destination.icao}`;
}

/** Liste "In der Nähe" – wird von Radar, Karte und Info genutzt */
export function nearListHtml(ctx, list, { skipId } = {}) {
  const fmt = ctx.fmt;
  return list.filter(a => a.id !== skipId).map(ac => {
    const det = ctx.details(ac);
    const al = det?.route?.airline?.name || airlineName(airlineOf(ac)) || CLS_LABEL[ac.cls] || '';
    const rt = routeShort(det);
    const badges = [ac.military ? '<b class="badge mil">MIL</b>' : '', ac.ladd || ac.pia ? '<b class="badge hid">FR24-gesperrt</b>' : '', ac.kind === 'flarm' ? '<b class="badge fl">FLARM</b>' : ''].join('');
    return `<li class="${ac.id === ctx.focusId ? 'focus' : ''}">
      <div class="l1">${logoHtml(ctx, ac)}<span class="cs">${esc(labelOf(ac))}</span>${badges}<span class="dist">${fmt.dist(ac.distKm)} <i class="arr" style="transform:rotate(${ac.bearing}deg)">↑</i></span></div>
      <div class="l2"><span>${esc(rt || al)}</span><span>${esc(ac.icaoType || '')} · ${fmt.altShort(ac.altFt, ac.onGround)} ${vrArrow(ac.vrFpm)}</span></div>
    </li>`;
  }).join('');
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

// ---------- Flugzeugtypen ----------
const TYPE_NAMES = {
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321', A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900neo', A338: 'Airbus A330-800neo', A343: 'Airbus A340-300', A346: 'Airbus A340-600',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380', A306: 'Airbus A300-600', A310: 'Airbus A310', A3ST: 'Airbus Beluga', A337: 'Airbus BelugaXL',
  BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300', A400: 'Airbus A400M', A124: 'Antonov An-124', A225: 'Antonov An-225',
  B712: 'Boeing 717', B733: 'Boeing 737-300', B734: 'Boeing 737-400', B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400',
  B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B773: 'Boeing 777-300', B77W: 'Boeing 777-300ER', B778: 'Boeing 777-8', B779: 'Boeing 777-9',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10', BLCF: 'Boeing 747 Dreamlifter',
  E170: 'Embraer 170', E175: 'Embraer 175', E190: 'Embraer 190', E195: 'Embraer 195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2',
  E35L: 'Embraer Legacy 600', E55P: 'Embraer Phenom 300', E50P: 'Embraer Phenom 100', E545: 'Embraer Legacy 450', E550: 'Embraer Praetor 600',
  CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000',
  DH8D: 'De Havilland Dash 8-400', AT72: 'ATR 72', AT76: 'ATR 72-600', AT75: 'ATR 72-500', AT45: 'ATR 42-500', AT46: 'ATR 42-600',
  GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650', GLEX: 'Bombardier Global Express', GL5T: 'Bombardier Global 5000', GL7T: 'Bombardier Global 7500',
  CL35: 'Bombardier Challenger 350', CL60: 'Bombardier Challenger 600', C25A: 'Cessna Citation CJ2', C25B: 'Cessna Citation CJ3', C25C: 'Cessna Citation CJ4',
  C56X: 'Cessna Citation Excel', C68A: 'Cessna Citation Latitude', C700: 'Cessna Citation Longitude', PC12: 'Pilatus PC-12', PC24: 'Pilatus PC-24',
  C172: 'Cessna 172', C152: 'Cessna 152', C182: 'Cessna 182', C208: 'Cessna Caravan', P28A: 'Piper PA-28', DA40: 'Diamond DA40', DA42: 'Diamond DA42', DA62: 'Diamond DA62', SR22: 'Cirrus SR22',
  EC35: 'Airbus H135', EC45: 'Airbus H145', EC30: 'Airbus H130', EC55: 'Airbus H155', EC75: 'Airbus H175', H160: 'Airbus H160', AS65: 'Airbus Dauphin', R44: 'Robinson R44', A139: 'Leonardo AW139', A169: 'Leonardo AW169', NH90: 'NH90', CH47: 'Boeing CH-47 Chinook', H60: 'Sikorsky Black Hawk',
  C130: 'Lockheed C-130 Hercules', C30J: 'Lockheed C-130J', C17: 'Boeing C-17', C5M: 'Lockheed C-5M Galaxy', K35R: 'Boeing KC-135', A332K: 'Airbus A330 MRTT', MRTT: 'Airbus A330 MRTT',
  EUFI: 'Eurofighter Typhoon', F35: 'Lockheed F-35', F16: 'General Dynamics F-16', TOR: 'Panavia Tornado', P8: 'Boeing P-8 Poseidon', E3TF: 'Boeing E-3 AWACS', B52: 'Boeing B-52',
  CONC: 'Concorde', DC3: 'Douglas DC-3', JU52: 'Junkers Ju 52',
};
export const SPECIAL_TYPES = new Set(['A388', 'B748', 'A124', 'A225', 'AN22', 'A3ST', 'A337', 'BLCF', 'C5M', 'B52', 'CONC', 'DC3', 'JU52', 'A400', 'C17', 'E3TF', 'P8', 'B744', 'IL76', 'U2', 'SR71']);

const titleCase = s => s.toLowerCase().replace(/(^|[\s\-/(])([a-zà-ü])/g, (m, a, b) => a + b.toUpperCase());

/** lesbarer Typname: adsbdb-Stammdaten > eigene Tabelle > Beschreibung aus den ADS-B-Daten > ICAO-Code */
export function typeName(ac, det) {
  const a = det?.aircraft;
  if (a?.manufacturer && a?.type) {
    const man = titleCase(a.manufacturer.replace(/\b(Company|Corporation|Industrie|Industries|Aircraft|S\.?A\.?S?\.?)\b/gi, '').trim());
    return a.type.toLowerCase().startsWith(man.toLowerCase().split(' ')[0]) ? a.type : `${man} ${a.type}`;
  }
  if (ac.icaoType && TYPE_NAMES[ac.icaoType]) return TYPE_NAMES[ac.icaoType];
  if (ac.desc) return ac.kind === 'flarm' ? ac.desc : titleCase(ac.desc);
  return ac.icaoType || CLS_LABEL[ac.cls] || '';
}
/** kurzer Typ für Beschriftungen */
export const typeShort = ac => ac.icaoType || (ac.kind === 'flarm' ? ({ glider: 'Segler', heli: 'Heli', balloon: 'Ballon', drone: 'Drohne' }[ac.cls] || '') : '');

// ---------- Sonnenstand (genug genau für die Himmelsdarstellung) ----------
export function sunPosition(date, lat, lon) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const H = ((gmst * 15 + lon) * RAD) - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / RAD + 180;
  return { az: (az + 360) % 360, el: el / RAD };
}

// ---------- Airline-Logos (Option pro Bildschirm) ----------
const logoState = new Map(); // ICAO -> { img, ok }
let logoListener = () => {};
export const onLogoLoaded = fn => { logoListener = fn; };

/** geladenes Logo-Bild oder null (lädt beim ersten Aufruf im Hintergrund) */
export function logoFor(ac) {
  const icao = airlineOf(ac);
  if (!icao) return null;
  let s = logoState.get(icao);
  if (!s) {
    const img = new Image();
    s = { img, ok: false };
    logoState.set(icao, s);
    img.onload = () => { s.ok = true; logoListener(); };
    img.onerror = () => setTimeout(() => logoState.delete(icao), 3600e3); // später erneut versuchen
    img.src = `/api/logo/${icao}`;
  }
  return s.ok ? s.img : null;
}

export function logoHtml(ctx, ac, cls = '') {
  if (!ctx.screen?.showLogos) return '';
  const img = logoFor(ac);
  return img ? `<img class="logo ${cls}" src="${img.src}" alt="">` : '';
}

/** Logo in Canvas zeichnen (abgerundetes Quadrat), liefert die belegte Breite */
let logoFilter = { key: null, value: 'none' };
export function drawLogo(g, img, x, y, size) {
  const r = size * 0.18;
  if (logoFilter.key !== document.body.className) logoFilter = { key: document.body.className, value: cssVar('--logo-filter') || 'none' };
  g.save();
  g.filter = logoFilter.value;
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, size, size, r) : g.rect(x, y, size, size);
  g.clip();
  g.fillStyle = '#fff';
  g.fillRect(x, y, size, size);
  const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
  g.restore();
  return size;
}
