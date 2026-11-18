import { ICONS, altColor, cssVar, extrapolate, labelOf, nearListHtml, typeShort, logoFor, drawLogo } from '../common.js';

const NICE = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200];
const CARD = { 0: 'N', 90: 'O', 180: 'S', 270: 'W' };
const RAD = Math.PI / 180;
const paths = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, new Path2D(v.d)]));

export function create(el, ctx) {
  el.innerHTML = `
    <div class="radar-wrap"><canvas></canvas></div>
    <aside class="side card"><h3>In der Nähe</h3><ol class="near"></ol></aside>`;
  const wrap = el.querySelector('.radar-wrap');
  const canvas = el.querySelector('canvas');
  const g = canvas.getContext('2d');
  const nearEl = el.querySelector('.near');

  let w = 0, h = 0, dpr = 1, raf = 0, lastFrame = 0;
  let theme = readTheme();

  function readTheme() {
    return {
      bg: cssVar('--bg'), radarBg: cssVar('--radar-bg'), radarInner: cssVar('--radar-inner'),
      ring: cssVar('--ring'), ringStrong: cssVar('--ring-strong'), text: cssVar('--text'), muted: cssVar('--muted'),
      accent: cssVar('--accent'), alert: cssVar('--alert'), sweep: cssVar('--sweep'), ac: cssVar('--ac'),
      acMode: cssVar('--ac-mode') || 'alt', font: cssVar('--font'), mono: cssVar('--mono'), glow: cssVar('--glow') === '1',
    };
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = wrap.clientWidth;
    h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - lastFrame < 33) return; // ~30 fps reicht und schont den Pi
    lastFrame = t;
    draw(t);
  }
  raf = requestAnimationFrame(frame);

  function draw(t) {
    const s = ctx.screen;
    if (!s || !w) return;
    const fmt = ctx.fmt;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const fs = Math.max(11, Math.min(w, h) / 48);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - fs * 2.2;
    const k = R / s.radiusKm;
    const cosLat = Math.cos(s.lat * RAD);
    const proj = (lat, lon) => [cx + (lon - s.lon) * 111.32 * cosLat * k, cy - (lat - s.lat) * 110.574 * k];

    // Scheibe
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, theme.radarInner);
    grad.addColorStop(1, theme.radarBg);
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    // Ringe
    const radiusU = s.radiusKm / fmt.unitKm;
    const step = NICE.find(n => radiusU / n <= 5) || 200;
    g.font = `${fs * 0.85}px ${theme.mono}`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    for (let r = step; r < radiusU - step * 0.15; r += step) {
      const rp = r * fmt.unitKm * k;
      g.strokeStyle = theme.ring; g.lineWidth = 1;
      g.setLineDash([4, 6]);
      g.beginPath(); g.arc(cx, cy, rp, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.fillStyle = theme.muted;
      g.fillText(`${r.toLocaleString('de-DE')} ${fmt.unit}`, cx + rp * 0.707 + 4, cy - rp * 0.707 - 2);
    }
    g.strokeStyle = theme.ringStrong; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();

    // Achsenkreuz und Gradskala
    g.strokeStyle = theme.ring; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 5) {
      const len = a % 30 === 0 ? 10 : 4;
      const sa = Math.sin(a * RAD), ca = -Math.cos(a * RAD);
      g.strokeStyle = a % 30 === 0 ? theme.ringStrong : theme.ring;
      g.beginPath(); g.moveTo(cx + sa * R, cy + ca * R); g.lineTo(cx + sa * (R - len), cy + ca * (R - len)); g.stroke();
      if (a % 30 === 0) {
        const lbl = CARD[a] || String(a);
        g.fillStyle = CARD[a] ? theme.text : theme.muted;
        g.font = `${CARD[a] ? 700 : 400} ${fs * (CARD[a] ? 1.15 : 0.8)}px ${theme.font}`;
        g.fillText(lbl, cx + sa * (R + fs * 1.1), cy + ca * (R + fs * 1.1));
      }
    }

    // Radarstrahl
    if (s.showSweep && g.createConicGradient) {
      const ang = ((t / 1000) * (Math.PI * 2)) / 6;
      const wedge = 0.9;
      const cg = g.createConicGradient(ang - Math.PI / 2 - wedge, cx, cy);
      cg.addColorStop(0, 'rgba(0,0,0,0)');
      cg.addColorStop(wedge / (Math.PI * 2), theme.sweep);
      cg.addColorStop(wedge / (Math.PI * 2) + 0.001, 'rgba(0,0,0,0)');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cg;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = theme.sweep; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(ang) * R, cy - Math.cos(ang) * R); g.stroke();
    }

    // Standort
    g.strokeStyle = theme.accent; g.fillStyle = theme.accent; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.stroke();

    // Flugzeuge
    const now = ctx.nowServer();
    const iconScale = fs / 15;
    const blink = Math.floor(t / 500) % 2 === 0;
    const list = [...ctx.aircraft].reverse(); // nächstes zuletzt → oben
    const drawn = [];
    for (const ac of list) {
      const [lat, lon] = extrapolate(ac, now);
      const [x, y] = proj(lat, lon);
      if ((x - cx) ** 2 + (y - cy) ** 2 > (R + 4) ** 2) continue;
      const emergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
      const color = emergency ? theme.alert : altColor(ac.altFt, ac.onGround, theme.acMode, theme.ac);

      // Spur
      if (ac.trail?.length) {
        g.strokeStyle = color; g.globalAlpha = 0.45; g.lineWidth = 1.5;
        g.beginPath();
        ac.trail.forEach((p, i) => { const [px, py] = proj(p[0], p[1]); i ? g.lineTo(px, py) : g.moveTo(px, py); });
        g.lineTo(x, y);
        g.stroke();
        g.globalAlpha = 1;
      }

      const focus = ac.id === ctx.focusId;
      if (focus) {
        g.strokeStyle = theme.accent; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, fs * 1.5 + Math.sin(t / 300) * 2, 0, Math.PI * 2); g.stroke();
      }
      if (emergency && blink) {
        g.strokeStyle = theme.alert; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, fs * 2, 0, Math.PI * 2); g.stroke();
      }

      const ic = ICONS[ac.cls] || ICONS.plane;
      g.save();
      g.translate(x, y);
      if (ic.rotate) g.rotate((ac.track || 0) * RAD);
      g.scale(iconScale * ic.scale * 0.6, iconScale * ic.scale * 0.6);
      if (theme.glow) { g.shadowColor = color; g.shadowBlur = 12; }
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,.6)';
      g.lineWidth = 1.2;
      g.fill(paths[ac.cls] || paths.plane);
      g.stroke(paths[ac.cls] || paths.plane);
      g.restore();

      drawn.push({ ac, x, y, focus });
    }

    // Beschriftungen: Fokus und nahe Flugzeuge zuerst, überlappende weglassen bzw. versetzen
    drawn.sort((a, b) => (b.focus - a.focus) || (a.ac.distKm - b.ac.distKm));
    const placed = [];
    const hit = r => placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
    for (const d of drawn) placed.push({ x: d.x - fs * 0.6, y: d.y - fs * 0.6, w: fs * 1.2, h: fs * 1.2 });
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    for (const { ac, x, y, focus } of drawn) {
      const l1 = labelOf(ac) + (ac.military ? ' ⚑' : '');
      const l2 = [typeShort(ac), fmt.altShort(ac.altFt, ac.onGround), ac.gsKt != null ? fmt.speedNum(ac.gsKt) : ''].filter(Boolean).join(' ');
      const f1 = `700 ${fs * (focus ? 1.05 : 0.9)}px ${theme.font}`;
      const f2 = `${fs * 0.78}px ${theme.mono}`;
      g.font = f1; const w1 = g.measureText(l1).width;
      g.font = f2; const w2 = g.measureText(l2).width;
      const logo = s.showLogos ? logoFor(ac) : null;
      const lw = logo ? fs * 1.75 + 4 : 0;
      const bw = Math.max(w1, w2) + 4 + lw, bh = fs * 2;
      const cands = [[fs * 0.9, -fs * 1.1], [-fs * 0.9 - bw, -fs * 1.1], [fs * 0.9, fs * 0.1], [-fs * 0.9 - bw, fs * 0.1], [-bw / 2, -fs * 0.8 - bh], [-bw / 2, fs * 0.8]];
      let spot = null;
      for (const [dx, dy] of cands) {
        const r = { x: x + dx, y: y + dy, w: bw, h: bh };
        if (!hit(r)) { spot = r; break; }
      }
      if (!spot) {
        if (!focus) continue;
        spot = { x: x + cands[0][0], y: y + cands[0][1], w: bw, h: bh };
      }
      placed.push(spot);
      if (theme.glow) { g.shadowColor = theme.text; g.shadowBlur = 6; }
      g.font = f1; g.fillStyle = theme.text;
      if (logo) drawLogo(g, logo, spot.x + 2, spot.y + fs * 0.15, fs * 1.75);
      g.fillText(l1, spot.x + 2 + lw, spot.y + fs * 0.95);
      g.font = f2; g.fillStyle = theme.muted;
      g.fillText(l2, spot.x + 2 + lw, spot.y + fs * 1.85);
      g.shadowBlur = 0;
    }
  }

  return {
    update() {
      nearEl.innerHTML = nearListHtml(ctx, ctx.aircraft.slice(0, 9));
    },
    unmount() {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
    retheme() { theme = readTheme(); },
  };
}
