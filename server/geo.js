import { config } from './config.js';

const R = 6371.0088;
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;

export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': config.userAgent, accept: 'application/json', 'accept-language': 'de' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  return res.json();
}

/**
 * Akzeptiert:  "52.52, 13.40"  |  "10115"  |  "AT 1010" / "CH-8000"  |  freier Ortsname/Adresse
 */
export async function geocode(q) {
  q = String(q || '').trim();
  if (!q) throw new Error('Leere Eingabe');

  const c = q.match(/^(-?\d{1,2}(?:[.]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.]\d+)?)$/);
  if (c) {
    const lat = Number(c[1]), lon = Number(c[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  }

  const p = q.match(/^(?:([a-zA-Z]{2})[\s-]*)?(\d{4,5})$/);
  if (p) {
    const cc = p[1] ? p[1].toLowerCase() : p[2].length === 5 ? 'de' : 'at,ch';
    const hits = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&postalcode=${p[2]}&countrycodes=${cc}`);
    const hit = hits?.[0];
    if (hit) {
      const a = hit.address || {};
      const town = a.city || a.town || a.village || a.municipality || a.suburb || '';
      return { lat: Number(hit.lat), lon: Number(hit.lon), label: `${p[2]} ${town}`.trim() };
    }
  }

  const j = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
  const hit = j?.[0];
  if (!hit) throw new Error('Ort nicht gefunden');
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name.split(',').slice(0, 2).join(',').trim() };
}
