// Alle Flugzeuge auf einer Canvas-Ebene – schnell genug auch für mehrere tausend Positionen
import { ICONS, altColor, extrapolate, labelOf } from '../common.js';
import { settings, isFav } from './settings.js';

const RAD = Math.PI / 180;
const PATHS = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, new Path2D(v.d)]));
const isEmergency = ac => !!ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);

export function createAircraftLayer(map, app) {
  const L = window.L;
  const pane = map.createPane('aircraft');
  pane.style.zIndex = 450;
  pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', '', pane);
  const g = canvas.getContext('2d');
  let dpr = 1, w = 0, h = 0, raf = 0;
  let list = [];
  let trail = [];
  let coverage = null;
  let hits = [];

  function resize() {
    const s = map.getSize();
    dpr = window.devicePixelRatio || 1;
    w = s.x; h = s.y;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  resize();

  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  map.on('move', schedule);
  map.on('resize', () => { resize(); schedule(); });
  map.on('zoomstart', () => { canvas.style.visibility = 'hidden'; });
  map.on('zoomend', () => { canvas.style.visibility = ''; schedule(); });
  let tick = 0;
  setInterval(() => { if (map.getZoom() >= 9 || ++tick % 2 === 0) schedule(); }, 500);

  function sizeFor(z) { return Math.max(13, Math.min(28, 9 + (z - 4) * 2.6)); }

  function drawTrail(sel, now) {
    if (!trail.length || !sel) return;
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    let prev = null;
    for (const p of trail) {
      const pt = map.latLngToContainerPoint([p[0], p[1]]);
      if (prev) {
        g.strokeStyle = altColor(p[2], false, 'alt', '#4cc2ff');
        g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(pt.x, pt.y); g.stroke();
      }
      prev = pt;
    }
    if (prev) {
      const cur = map.latLngToContainerPoint(extrapolate(sel, now));
      g.setLineDash([3, 4]);
      g.strokeStyle = altColor(sel.altFt, sel.onGround, 'alt', '#4cc2ff');
      g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(cur.x, cur.y); g.stroke();
      g.setLineDash([]);
    }
  }

  function drawCoverage() {
    if (!coverage) return;
    const c = map.latLngToContainerPoint([coverage.lat, coverage.lon]);
    const edge = map.latLngToContainerPoint([coverage.lat + coverage.radiusKm / 111.2, coverage.lon]);
    const r = Math.abs(c.y - edge.y);
    g.save();
    g.setLineDash([6, 6]);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255, 181, 71, .7)';
    g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  function draw() {
    const tl = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, tl);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const now = app.nowServer();
    const z = map.getZoom();
    const base = sizeFor(z);
    const selId = app.selectedId;
    const sel = selId ? app.get(selId) : null;

    drawCoverage();
    drawTrail(sel, now);

    // Reihenfolge: Boden zuerst, dann nach Höhe – hohe Flugzeuge liegen oben, das gewählte ganz oben
    const items = [];
    for (const ac of list) {
      if (ac.id !== selId && !app.visible(ac)) continue;
      const pos = extrapolate(ac, now);
      const p = map.latLngToContainerPoint(pos);
      if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      items.push({ ac, x: p.x, y: p.y });
    }
    items.sort((a, b) => (a.ac.id === selId) - (b.ac.id === selId) || (a.ac.onGround ? -1 : a.ac.altFt ?? 0) - (b.ac.onGround ? -1 : b.ac.altFt ?? 0));

    hits = [];
    for (const it of items) {
      const { ac, x, y } = it;
      const ic = ICONS[ac.cls] || ICONS.plane;
      const size = base * ic.scale * (ac.onGround ? 0.8 : 1);
      const k = size / 32;
      const isSel = ac.id === selId;
      it.fav = settings.favorites.length > 0 && isFav(ac);
      if (it.fav && !isSel) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = 'rgba(255, 181, 71, .18)';
        g.strokeStyle = '#ffb547';
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, size * 0.72, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      if (isSel) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = 'rgba(76, 194, 255, .22)';
        g.strokeStyle = '#4cc2ff';
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, size * 0.72, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      const a = ic.rotate ? (ac.track || 0) * RAD : 0;
      const cos = Math.cos(a) * k * dpr, sin = Math.sin(a) * k * dpr;
      g.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
      g.fillStyle = isEmergency(ac) ? '#ff4d6d' : ac.lost ? '#7d8799' : altColor(ac.altFt, ac.onGround, 'alt', '#4cc2ff');
      g.lineWidth = 1.1 / k;
      g.strokeStyle = isSel ? '#ffffff' : 'rgba(0, 0, 0, .65)';
      g.fill(PATHS[ac.cls] || PATHS.plane);
      g.stroke(PATHS[ac.cls] || PATHS.plane);
      it.size = size;
      hits.push({ id: ac.id, x, y, r: Math.max(11, size * 0.6) });
    }

    // Beschriftungen (ohne Überlappung)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Favoriten und das gewählte Flugzeug sind immer beschriftet, alle anderen je nach Einstellung und Zoom
    const allLabels = app.settings.labels && (z >= 7 || items.length < 120);
    {
      const twoLines = z >= 9;
      g.font = '600 11.5px Inter, system-ui, sans-serif';
      g.textBaseline = 'top';
      g.lineJoin = 'round';
      const placed = [];
      const free = (r) => !placed.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
      for (let i = items.length - 1; i >= 0; i--) { // obere zuerst
        const { ac, x, y, size } = items[i];
        if (!allLabels && !items[i].fav && ac.id !== app.selectedId) continue;
        const l1 = labelOf(ac);
        const l2 = twoLines ? [app.fmt.altShort(ac.altFt, ac.onGround), ac.icaoType].filter(Boolean).join(' · ') : '';
        const tw = Math.max(g.measureText(l1).width, l2 ? g.measureText(l2).width * 0.9 : 0);
        const r = { x: x + size * 0.55, y: y - 7, w: tw + 4, h: l2 ? 27 : 14 };
        if (ac.id !== app.selectedId && !items[i].fav && !free(r)) continue;
        placed.push(r);
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(5, 10, 20, .85)';
        g.fillStyle = '#ffffff';
        g.font = '600 11.5px Inter, system-ui, sans-serif';
        g.strokeText(l1, r.x, r.y); g.fillText(l1, r.x, r.y);
        if (l2) {
          g.font = '500 10.5px Inter, system-ui, sans-serif';
          g.fillStyle = '#c9d6ea';
          g.strokeText(l2, r.x, r.y + 13); g.fillText(l2, r.x, r.y + 13);
        }
      }
    }
  }

  return {
    setData(arr) { list = arr; schedule(); },
    setTrail(pts) { trail = pts || []; schedule(); },
    setCoverage(c) { coverage = c; schedule(); },
    redraw: schedule,
    /** Flugzeug unter einem Bildschirmpunkt (oder null) */
    hit(pt) {
      let best = null, bd = Infinity;
      for (const hh of hits) {
        const d = Math.hypot(hh.x - pt.x, hh.y - pt.y);
        if (d <= hh.r && d < bd) { best = hh.id; bd = d; }
      }
      return best;
    },
  };
}
