import { SPECIAL_TYPES, esc, labelOf, typeName, compassLong, elevationDeg, iconSvg, cssVar, airlineName, airlineOf, logoHtml } from './common.js';

// Überflug-Alarm: prüft bei jeder Datenabfrage alle Flugzeuge gegen die Regeln des Bildschirms

const EMERGENCY = { 7500: 'Entführung (7500)', 7600: 'Funkausfall (7600)', 7700: 'Notfall (7700)' };
export const RULE_LABELS = {
  emergency: 'Notfall-Squawk',
  mil: 'Militär',
  hidden: 'FR24-gesperrt',
  special: 'Besonderes Flugzeug',
  lowheli: 'Hubschrauber tief',
  close: 'Sehr nah',
  watch: 'Merkliste',
};

function watchMatch(ac, list) {
  if (!list.length) return null;
  const vals = [ac.icaoType, ac.callsign, ac.reg, ac.reg?.replace('-', ''), ac.hex].filter(Boolean).map(v => v.toUpperCase());
  return list.find(w => vals.some(v => v === w || (w.length >= 3 && v.startsWith(w)))) || null;
}

/** liefert [{rule, text}] – leere Liste = kein Alarm */
export function matchRules(ac, cfg) {
  const r = cfg.rules;
  const hits = [];
  if (ac.onGround) return hits;
  const sq = ac.squawk;
  if (r.emergency && (EMERGENCY[sq] || ac.emergency)) hits.push({ rule: 'emergency', text: EMERGENCY[sq] || `Notfall: ${ac.emergency}` });
  if (ac.distKm > cfg.radiusKm) return hits; // Notfälle im ganzen Umkreis, alles andere nur im Alarm-Radius
  if (r.mil && ac.military) hits.push({ rule: 'mil', text: 'Militärflugzeug' });
  if (r.hidden && (ac.ladd || ac.pia)) hits.push({ rule: 'hidden', text: 'Bei Flightradar24 gesperrt (LADD/PIA)' });
  if (r.special && SPECIAL_TYPES.has(ac.icaoType)) hits.push({ rule: 'special', text: 'Besonderes Flugzeug' });
  if (r.lowheli && ac.cls === 'heli' && (ac.altFt ?? 99999) < 2000) hits.push({ rule: 'lowheli', text: 'Hubschrauber im Tiefflug' });
  if (r.close && ac.distKm <= cfg.closeKm && (ac.altFt ?? 99999) <= cfg.closeAltFt) hits.push({ rule: 'close', text: 'Fliegt sehr nah vorbei' });
  if (r.watch) {
    const list = cfg.watch.split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const w = watchMatch(ac, list);
    if (w) hits.push({ rule: 'watch', text: `Merkliste: ${w}` });
  }
  return hits;
}

export function createAlerts(ctx, { onActive }) {
  const el = document.getElementById('alert');
  const seen = new Map(); // id -> Zeitpunkt des letzten Alarms
  const queue = [];
  let showing = null;
  let hideTimer = null;
  let audio = null;

  function chime() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      audio.resume?.();
      const t0 = audio.currentTime;
      [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([f, dt]) => {
        const o = audio.createOscillator();
        const gn = audio.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        gn.gain.setValueAtTime(0.0001, t0 + dt);
        gn.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.9);
        o.connect(gn).connect(audio.destination);
        o.start(t0 + dt);
        o.stop(t0 + dt + 1);
      });
    } catch { /* Audio nicht erlaubt (Autoplay) */ }
  }
  // Browser erlauben Ton erst nach einer Interaktion – erster Klick/Taste schaltet frei
  const unlock = () => { try { audio ||= new AudioContext(); audio.resume(); } catch { /* egal */ } };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  function render(item) {
    const { ac, hits } = item;
    const live = ctx.aircraft.find(a => a.id === ac.id) || ac;
    const fmt = ctx.fmt;
    const det = ctx.details(live);
    const elev = elevationDeg(live.altFt, live.distKm);
    const r = det?.route;
    const route = r?.origin && r?.destination ? `${r.origin.iata || r.origin.icao} → ${r.destination.iata || r.destination.icao}` : '';
    const airline = r?.airline?.name || airlineName(airlineOf(live)) || '';
    const emergency = hits.some(h => h.rule === 'emergency');
    el.className = `show${emergency ? ' emergency' : ''}`;
    el.innerHTML = `
      <div class="al-icon">${iconSvg({ ...live, track: 45 }, cssVar(emergency ? '--alert' : '--accent'), 64)}</div>
      <div class="al-body">
        <div class="al-reason">${hits.map(h => `<span>${esc(h.text)}</span>`).join('')}</div>
        <div class="al-cs">${logoHtml(ctx, live, 'big')}${esc(labelOf(live))} <small>${esc([airline, route].filter(Boolean).join(' · '))}</small></div>
        <div class="al-type">${esc(typeName(live, det))}${live.reg ? ` · ${esc(live.reg)}` : ''}</div>
        <div class="al-facts">
          <span>${fmt.alt(live.altFt, live.onGround)}</span><span>${fmt.speed(live.gsKt)}</span><span>${fmt.dist(live.distKm)}</span>
          <span><i class="arr" style="transform:rotate(${live.bearing}deg)">↑</i> ${compassLong(live.bearing)}${elev > 0 ? `, ${Math.round(elev)}° hoch` : ''}</span>
        </div>
      </div>`;
  }

  function next() {
    clearTimeout(hideTimer);
    showing = queue.shift() || null;
    if (!showing) {
      el.className = '';
      onActive(false);
      return;
    }
    const cfg = ctx.screen.alerts;
    render(showing);
    onActive(cfg.wake);
    if (cfg.sound) chime();
    hideTimer = setTimeout(next, cfg.seconds * 1000);
  }

  el.addEventListener('click', next); // Antippen = Alarm wegklicken

  return {
    /** nach jeder Datenabfrage aufrufen */
    check() {
      const cfg = ctx.screen?.alerts;
      if (!cfg?.enabled) {
        if (showing) { queue.length = 0; next(); }
        return;
      }
      const now = Date.now();
      for (const ac of ctx.aircraft) {
        const last = seen.get(ac.id);
        if (last && now - last < cfg.cooldownMin * 60e3) continue;
        const hits = matchRules(ac, cfg);
        if (!hits.length) continue;
        seen.set(ac.id, now);
        const item = { ac, hits };
        if (hits.some(h => h.rule === 'emergency')) queue.unshift(item); else queue.push(item);
      }
      for (const [id, t] of seen) if (now - t > 24 * 3600e3) seen.delete(id);
      if (!showing && queue.length) next();
      else if (showing) render(showing); // Werte aktualisieren
    },
    /** zum Ausprobieren aus der Verwaltung: ?testalert */
    test() {
      const ac = ctx.aircraft.find(a => !a.onGround);
      if (!ac) return;
      queue.unshift({ ac, hits: [{ rule: 'watch', text: 'Test-Alarm' }] });
      next();
    },
  };
}
