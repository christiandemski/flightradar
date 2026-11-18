import path from 'node:path';

const list = (v, d) => (v ?? d).split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  // Reihenfolge egal – alle Quellen werden zusammengeführt (Dedup per ICAO-Hex)
  sources: list(process.env.SOURCES, 'adsbfi,adsblol,ogn'),
  // z. B. http://raspberrypi.local/tar1090/data/aircraft.json (eigener ADS-B-Empfänger)
  readsbUrl: process.env.READSB_URL || '',
  // planespotters.net verlangt Kontakt-URL/E-Mail im User-Agent; leer = Fotos aus adsbdb
  photoContact: process.env.PHOTO_CONTACT || '',
  // Airline-Logos nach ICAO-Code, der Reihe nach probiert; {icao} wird ersetzt (Quellen müssen bei Unbekannt 404 liefern)
  logoUrls: list(process.env.LOGO_URLS ?? process.env.LOGO_URL, [
    'https://raw.githubusercontent.com/sexym0nk3y/airline-logos/main/logos/{icao}.png',
    'https://raw.githubusercontent.com/Jxck-S/airline-logos/main/flightaware_logos/{icao}.png',
    'https://raw.githubusercontent.com/Jxck-S/airline-logos/main/radarbox_logos/{icao}.png',
  ].join(',')),
  // gesetzt => Verwaltung (/admin) und Schreib-APIs per Basic-Auth geschützt (Benutzer egal)
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // PUBLIC_MAP=0 => auch die Live-Karte (/) braucht das Passwort
  publicMap: process.env.PUBLIC_MAP !== '0',
  // optional: Schlüssel von openaip.net für die Luftraum-Ebene auf der Live-Karte
  openaipKey: process.env.OPENAIP_KEY || '',
  userAgent: 'flightradar-display/0.1',
};
