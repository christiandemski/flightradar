// Favoriten: gespeicherte Flüge (Flugnummer, Rufzeichen oder Kennzeichen), weltweit verfolgt
import { esc, labelOf, routeShort, airlineOf } from '../common.js';
import { settings, save, favState, isFav } from './settings.js';

const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const POLL_MS = 45000;

export function createFavorites(app, { onChange }) {
  const sheet = document.getElementById('favs');
  const btn = document.getElementById('btnFavs');
  const count = document.getElementById('favCount');
  const status = new Map(); // norm(q) -> { ac, checked }
  let timer, loading = false;

  /** Server fragen, wo die gespeicherten Flüge gerade sind */
  async function refresh() {
    clearTimeout(timer);
    const list = settings.favorites;
    if (list.length && !loading) {
      loading = true;
      try {
        const j = await (await fetch(`/api/watch?q=${encodeURIComponent(list.map(f => f.q).join(','))}`)).json();
        favState.ids = new Set();
        for (const r of j.results) {
          status.set(norm(r.q), { ac: r.ac, checked: Date.now() });
          if (r.ac) favState.ids.add(r.ac.id);
        }
        onChange();
      } catch { /* nächster Versuch */ }
      loading = false;
    }
    if (!sheet.hidden) render();
    badge();
    timer = setTimeout(refresh, document.hidden ? POLL_MS * 3 : POLL_MS);
  }

  function badge() {
    const n = settings.favorites.length;
    const air = settings.favorites.filter(f => status.get(norm(f.q))?.ac).length;
    count.hidden = !n;
    count.textContent = air ? `${air}/${n}` : String(n);
    count.classList.toggle('air', air > 0);
  }

  /** aktuelle Daten: lieber aus der Live-Karte (frischer), sonst vom letzten Abgleich */
  function current(f) {
    const st = status.get(norm(f.q));
    const live = st?.ac ? app.get(st.ac.id) : [...app.aircraft.values()].find(a => isFav(a) && [a.callsign, a.reg, a.hex].some(k => norm(k) === norm(f.q)));
    return { ac: live || st?.ac || null, checked: !!st };
  }

  function render() {
    const fmt = app.fmt;
    const items = settings.favorites.map((f, i) => {
      const { ac, checked } = current(f);
      let line;
      if (ac) {
        const det = app.details(ac);
        const rt = routeShort(det);
        line = `<span class="air">● ${ac.onGround ? 'am Boden' : 'in der Luft'}</span> · ${esc(labelOf(ac))}${rt ? ` · ${esc(rt)}` : ''}${ac.onGround ? '' : ` · ${fmt.alt(ac.altFt)}`}`;
      } else line = checked ? '<span class="off">nicht in der Luft</span>' : 'wird gesucht …';
      const icao = ac ? airlineOf(ac) : null;
      return `<li class="fav ${ac ? 'on' : ''}" data-i="${i}">
        <span class="ic">${icao ? `<img src="/api/logo/${icao}" alt="" onerror="this.replaceWith('★')">` : '★'}</span>
        <span class="main"><span class="t1">${esc(f.q)}${f.note ? ` <small>${esc(f.note)}</small>` : ''}</span><span class="t2">${line}</span></span>
        <button class="icon-btn sm" data-share="${i}" title="Link teilen" aria-label="Link teilen">↗</button>
        <button class="icon-btn sm" data-del="${i}" title="Entfernen" aria-label="Entfernen">✕</button></li>`;
    }).join('');
    sheet.innerHTML = `
      <h4>Favoriten</h4>
      <form class="fav-add" id="favForm" autocomplete="off">
        <input name="q" placeholder="Flugnummer, Rufzeichen oder Kennzeichen" maxlength="20" required aria-label="Flug">
        <input name="note" placeholder="Notiz, z. B. Anna nach New York" maxlength="40" aria-label="Notiz">
        <button class="btn" type="submit">Hinzufügen</button>
      </form>
      ${settings.favorites.length ? `<ul class="favlist">${items}</ul>` : '<p class="muted small">Noch keine Favoriten. Flüge kannst du auch im Detail-Panel mit ☆ merken.</p>'}
      <label class="opt"><input type="checkbox" id="onlyFav" ${settings.filter.onlyFav ? 'checked' : ''}><span>Nur Favoriten auf der Karte zeigen</span></label>
      <p class="muted small">Gespeichert in diesem Browser. Flüge werden weltweit gesucht, auch außerhalb des Kartenausschnitts.</p>`;
  }

  function add(q, note = '') {
    q = q.trim().toUpperCase().replace(/\s+/g, ' ');
    if (q.length < 2) return false;
    if (settings.favorites.some(f => norm(f.q) === norm(q))) return false;
    settings.favorites.push({ q, note: note.trim() });
    save();
    refresh();
    onChange();
    return true;
  }
  function remove(q) {
    settings.favorites = settings.favorites.filter(f => norm(f.q) !== norm(q));
    status.delete(norm(q));
    if (!settings.favorites.length && settings.filter.onlyFav) settings.filter.onlyFav = false;
    save();
    favState.ids = new Set(); // füllt der nächste Abgleich neu
    refresh();
    onChange();
  }

  sheet.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (add(String(fd.get('q')), String(fd.get('note') || ''))) render();
    else e.target.elements.q.select();
  });
  sheet.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { remove(settings.favorites[Number(del.dataset.del)].q); return; }
    const sh = e.target.closest('[data-share]');
    if (sh) { const f = settings.favorites[Number(sh.dataset.share)]; app.share(f.q, f.note ? `Flug ${f.q} (${f.note})` : `Flug ${f.q}`, sh); return; }
    const li = e.target.closest('li.fav');
    if (li) {
      const f = settings.favorites[Number(li.dataset.i)];
      const { ac } = current(f);
      if (ac) { app.selectFromSearch(ac); if (window.innerWidth <= 720) toggle(false); }
      else app.toast(`${f.q} ist gerade nicht in der Luft`);
    }
  });
  sheet.addEventListener('change', e => {
    if (e.target.id === 'onlyFav') { settings.filter.onlyFav = e.target.checked; save(); onChange(); }
  });

  const toggle = open => {
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { app.closeSheets?.('favs'); render(); }
  };
  btn.addEventListener('click', () => toggle(sheet.hidden));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) toggle(false); });
  setInterval(() => { if (!sheet.hidden && !sheet.contains(document.activeElement)) render(); }, 5000);

  refresh();
  return {
    add, remove,
    has: q => settings.favorites.some(f => norm(f.q) === norm(q)),
    /** gespeicherter Eintrag (q) zu einem Flugzeug oder null */
    findFor(ac) {
      if (!ac) return null;
      const keys = [ac.callsign, ac.reg, ac.hex, ac.cn, app.details(ac)?.route?.callsignIata].filter(Boolean).map(norm);
      const f = settings.favorites.find(x => keys.includes(norm(x.q)) || (status.get(norm(x.q))?.ac?.id === ac.id));
      return f ? f.q : null;
    },
    close: () => toggle(false),
    refresh,
  };
}
