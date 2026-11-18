import { ICONS, COMPASS_SHORT, altColor, bearingDeg, cssVar, distanceKm, elevationDeg, extrapolate, labelOf, sunPosition, typeShort, logoFor, drawLogo } from '../common.js';

// Himmelsblick: "Was sehe ich gerade aus dem Fenster?" – waagerecht Himmelsrichtung, senkrecht Höhenwinkel
const RAD = Math.PI / 180;
const paths = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, new Path2D(v.d)]));
const ELEV_LINES = [5, 10, 20, 30, 45, 60, 75, 90];

// Himmelsfarben je Sonnenstand (Grad) – oben / Horizont
const SKY_STOPS = [
  [-18, '#03050c', '#0a1124'], [-8, '#0a1030', '#2a2350'], [-3, '#1c2a5c', '#c9645a'],
  [2, '#3d63a8', '#f2a86b'], [8, '#3f7fd0', '#b8d7f0'], [25, '#2f78d6', '#a9d4f7'],
];
function lerpColor(a, b, t) {
  const pa = a.match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
function skyColors(sunEl) {
  if (sunEl <= SKY_STOPS[0][0]) return [SKY_STOPS[0][1], SKY_STOPS[0][2]];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const [e0, t0, h0] = SKY_STOPS[i], [e1, t1, h1] = SKY_STOPS[i + 1];
    if (sunEl <= e1) { const t = (sunEl - e0) / (e1 - e0); return [lerpColor(t0, t1, t), lerpColor(h0, h1, t)]; }
  }
  const l = SKY_STOPS[SKY_STOPS.length - 1];
  return [l[1], l[2]];
}

// feste "Sterne" und Horizont-Silhouette (deterministisch, damit nichts flackert)
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const STARS = (() => { const r = rng(42); return Array.from({ length: 140 }, () => [r(), r() ** 1.6, r() * 1.3 + 0.3]); })();
const HILLS = (() => { const r = rng(7); const pts = []; let v = 0.5; for (let i = 0; i <= 120; i++) { v += (r() - 0.5) * 0.25; v = Math.min(1, Math.max(0, v)); pts.push(v); } return pts; })();

export function create(el, ctx) {
  el.innerHTML = '<div class="sky-wrap"><canvas></canvas><div class="sky-note"></div></div>';
  const wrap = el.querySelector('.sky-wrap');
  const canvas = el.querySelector('canvas');
  const note = el.querySelector('.sky-note');
  const g = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0, lastFrame = 0;

  const theme = {
    mode: cssVar('--sky-mode') || 'real', bg: cssVar('--radar-bg'), inner: cssVar('--radar-inner'), ring: cssVar('--ring'),
    ringStrong: cssVar('--ring-strong'), text: cssVar('--text'), muted: cssVar('--muted'), accent: cssVar('--accent'),
    alert: cssVar('--alert'), ac: cssVar('--ac'), acMode: cssVar('--ac-mode') || 'alt', font: cssVar('--font'), mono: cssVar('--mono'),
    ground: cssVar('--ground') || '#05080f', glow: cssVar('--glow') === '1',
  };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = wrap.clientWidth; h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - lastFrame < 50) return; // 20 fps genügt
    lastFrame = t;
    draw();
  }
  raf = requestAnimationFrame(frame);

  let behind = 0;

  function draw() {
    const s = ctx.screen;
    if (!s || !w) return;
    const cfg = s.sky;
    const fmt = ctx.fmt;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fs = Math.max(11, Math.min(w / 70, h / 40));
    const left = fs * 2.6, right = w - fs * 1.2, top = fs * 1.2, horizon = h - fs * 3.2;
    const half = cfg.fov / 2;
    const relAz = az => ((az - cfg.direction + 540) % 360) - 180;
    const X = az => left + ((relAz(az) + half) / cfg.fov) * (right - left);
    const Y = e => horizon - (Math.min(e, cfg.maxElev) / cfg.maxElev) * (horizon - top);
    const inView = az => cfg.fov >= 360 || Math.abs(relAz(az)) <= half;

    // Himmel
    const sun = sunPosition(new Date(), s.lat, s.lon);
    let skyTop = theme.inner, skyHor = theme.bg;
    if (theme.mode === 'real') [skyTop, skyHor] = skyColors(sun.el);
    const grad = g.createLinearGradient(0, top, 0, horizon);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(1, skyHor);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, horizon);

    const night = theme.mode !== 'real' || sun.el < -4;
    if (night) {
      g.fillStyle = theme.mode === 'real' ? '#fff' : theme.muted;
      const a = theme.mode === 'real' ? Math.min(1, (-4 - sun.el) / 8) : 0.5;
      for (const [sx, sy, r] of STARS) {
        g.globalAlpha = a * (0.35 + (r - 0.3) * 0.5);
        g.beginPath(); g.arc(sx * w, top + sy * (horizon - top) * 0.95, r * 0.8, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }

    // Sonne
    if (sun.el > -2 && inView(sun.az)) {
      const sx = X(sun.az), sy = Y(Math.max(sun.el, 0));
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, fs * 6);
      halo.addColorStop(0, 'rgba(255,240,190,.75)');
      halo.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = halo;
      g.beginPath(); g.arc(sx, sy, fs * 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = theme.mode === 'real' ? '#fff6d8' : theme.accent;
      g.beginPath(); g.arc(sx, sy, fs * 1.1, 0, Math.PI * 2); g.fill();
    }

    // Höhenlinien
    g.font = `${fs * 0.75}px ${theme.mono}`;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const e of ELEV_LINES) {
      if (e > cfg.maxElev) break;
      const y = Y(e);
      g.strokeStyle = theme.ring; g.lineWidth = 1; g.setLineDash([3, 7]);
      g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = theme.mode === 'real' && !night ? 'rgba(255,255,255,.75)' : theme.muted;
      g.fillText(`${e}°`, left - fs * 0.4, y);
    }

    // Boden mit Hügel-Silhouette
    g.fillStyle = theme.ground;
    g.beginPath();
    g.moveTo(0, h);
    HILLS.forEach((v, i) => g.lineTo((i / (HILLS.length - 1)) * w, horizon - v * fs * 0.9));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.strokeStyle = theme.ringStrong; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, horizon); g.lineTo(w, horizon); g.stroke();

    // Himmelsrichtungen
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let a = 0; a < 360; a += 10) {
      if (!inView(a)) continue;
      const x = X(a);
      if (x < left - 1 || x > right + 1) continue;
      const major = a % 45 === 0;
      g.strokeStyle = major ? theme.ringStrong : theme.ring;
      g.beginPath(); g.moveTo(x, horizon); g.lineTo(x, horizon + (major ? fs * 0.7 : fs * 0.35)); g.stroke();
      if (a % 30 === 0 || major) {
        const lbl = major ? COMPASS_SHORT[a / 22.5] : `${a}°`;
        g.font = `${major ? 700 : 400} ${fs * (major ? 1.05 : 0.75)}px ${theme.font}`;
        g.fillStyle = major ? theme.text : theme.muted;
        g.fillText(lbl, x, horizon + fs * 0.9);
      }
    }

    // Flugzeuge
    const now = ctx.nowServer();
    const items = [];
    behind = 0;
    for (const ac of ctx.aircraft) {
      if (ac.onGround) continue;
      const [lat, lon] = extrapolate(ac, now);
      const d = distanceKm(s.lat, s.lon, lat, lon);
      const b = bearingDeg(s.lat, s.lon, lat, lon);
      const e = elevationDeg(ac.altFt, d);
      if (e == null || e < -0.5) continue;
      if (!inView(b)) { behind++; continue; }
      // Bewegungsrichtung auf dem Bildschirm: Position in 30 s
      const [lat2, lon2] = extrapolate({ ...ac, posTime: ac.posTime - 30000 }, now);
      const d2 = distanceKm(s.lat, s.lon, lat2, lon2);
      const e2 = elevationDeg(ac.altFt, d2);
      const b2 = bearingDeg(s.lat, s.lon, lat2, lon2);
      items.push({ ac, d, x: X(b), y: Y(Math.max(e, 0)), x2: X(b2), y2: Y(Math.max(e2 ?? e, 0)), wrap: Math.abs(relAz(b2) - relAz(b)) > 90 });
    }
    items.sort((a, b) => b.d - a.d); // nahe zuletzt → vorne

    const placed = [];
    const hit = r => placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
    const labels = [];
    for (const it of items) {
      const { ac, x, y, d } = it;
      const emergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
      const color = emergency ? theme.alert : altColor(ac.altFt, false, theme.acMode, theme.ac);
      const size = Math.min(3.2, Math.max(0.75, 14 / Math.max(d, 2))) * fs / 14;
      let ang = 0;
      if (!it.wrap && (Math.abs(it.x2 - x) > 0.5 || Math.abs(it.y2 - y) > 0.5)) {
        ang = Math.atan2(it.y2 - y, it.x2 - x) + Math.PI / 2;
        // kleiner Bewegungspfeil
        g.strokeStyle = color; g.globalAlpha = 0.5; g.lineWidth = 1.5; g.setLineDash([2, 4]);
        g.beginPath(); g.moveTo(x, y); g.lineTo(it.x2, it.y2); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
      const focus = ac.id === ctx.focusId;
      if (focus) {
        g.strokeStyle = theme.accent; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, size * 22 + 4, 0, Math.PI * 2); g.stroke();
      }
      const ic = ICONS[ac.cls] || ICONS.plane;
      g.save();
      g.translate(x, y);
      if (ic.rotate) g.rotate(ang);
      g.scale(size * ic.scale, size * ic.scale);
      if (theme.glow) { g.shadowColor = color; g.shadowBlur = 10; }
      g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.2;
      g.fill(paths[ac.cls] || paths.plane);
      g.stroke(paths[ac.cls] || paths.plane);
      g.restore();
      placed.push({ x: x - size * 14, y: y - size * 14, w: size * 28, h: size * 28 });
      labels.push({ ...it, size, focus });
    }

    // Beschriftung: nahe zuerst
    labels.sort((a, b) => (b.focus - a.focus) || (a.d - b.d));
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    for (const { ac, x, y, size, focus, d } of labels) {
      const l1 = labelOf(ac);
      const l2 = [typeShort(ac), fmt.altShort(ac.altFt), fmt.dist(d)].filter(Boolean).join(' · ');
      const f1 = `700 ${fs * (focus ? 1.05 : 0.9)}px ${theme.font}`, f2 = `${fs * 0.75}px ${theme.mono}`;
      g.font = f1; const w1 = g.measureText(l1).width;
      g.font = f2; const w2 = g.measureText(l2).width;
      const logo = s.showLogos ? logoFor(ac) : null;
      const lw = logo ? fs * 1.75 + 4 : 0;
      const bw = Math.max(w1, w2) + 4 + lw, bh = fs * 2, off = size * 14 + 4;
      const spot = [[off, -bh / 2], [-off - bw, -bh / 2], [-bw / 2, -off - bh], [-bw / 2, off]]
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy, w: bw, h: bh })).find(r => !hit(r) && r.y > 0 && r.y + r.h < horizon + fs);
      if (!spot) continue;
      placed.push(spot);
      const dayText = theme.mode === 'real' && !night;
      g.shadowColor = dayText ? 'rgba(0,0,0,.6)' : theme.glow ? theme.text : 'transparent';
      g.shadowBlur = dayText ? 4 : theme.glow ? 6 : 0;
      g.font = f1; g.fillStyle = dayText ? '#fff' : theme.text;
      if (logo) { g.shadowBlur = 0; drawLogo(g, logo, spot.x + 2, spot.y + fs * 0.1, fs * 1.75); g.shadowBlur = dayText ? 4 : theme.glow ? 6 : 0; }
      g.fillText(l1, spot.x + 2 + lw, spot.y + fs * 0.95);
      g.font = f2; g.fillStyle = dayText ? 'rgba(255,255,255,.85)' : theme.muted;
      g.fillText(l2, spot.x + 2 + lw, spot.y + fs * 1.8);
      g.shadowBlur = 0;
    }
  }

  function updateNote() {
    const s = ctx.screen;
    const dirName = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'][Math.round(s.sky.direction / 45) % 8];
    note.textContent = s.sky.fov >= 360 ? 'Rundumblick' : `Blick nach ${dirName} · ${s.sky.fov}° Sichtfeld${behind ? ` · ${behind} weitere außerhalb` : ''}`;
  }

  return {
    update: updateNote,
    unmount() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
