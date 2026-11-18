import { esc, labelOf, airlineName, airlineOf, CLS_LABEL, KIND_LABEL, SOURCE_LABEL, compassLong, elevationDeg, nearListHtml, distanceKm, extrapolate, iconSvg, cssVar, typeName, logoHtml } from '../common.js';

export function create(el, ctx) {
  el.innerHTML = `
    <section class="fcard card">
      <div class="photo"><img alt=""><div class="ph-none"></div><div class="ph-credit"></div></div>
      <div class="fbody">
        <div class="fhead">
          <div><div class="cs"></div><div class="airline"></div><div class="ftype"></div></div>
          <div class="badges"></div>
        </div>
        <div class="route"></div>
        <div class="grid"></div>
      </div>
    </section>
    <aside class="side card">
      <h3>Weitere in der Nähe</h3><ol class="near"></ol>
      <div class="hours"><h3>Heute pro Stunde</h3><div class="bars"></div></div>
    </aside>`;
  const q = s => el.querySelector(s);
  const img = q('.photo img');
  let shownPhoto = '';

  function cell(label, value, extra = '', cls = '') {
    return `<div class="c ${cls}"><span class="k">${label}</span><span class="v">${value}</span>${extra}</div>`;
  }

  function renderFocus() {
    const ac = ctx.focus;
    const fmt = ctx.fmt;
    const card = q('.fcard');
    if (!ac) {
      card.classList.add('none');
      q('.cs').textContent = 'Gerade ruhig am Himmel';
      q('.airline').textContent = 'Kein Luftfahrzeug im Umkreis';
      q('.ftype').textContent = '';
      q('.route').innerHTML = q('.grid').innerHTML = q('.badges').innerHTML = '';
      setPhoto(null, null);
      return;
    }
    card.classList.remove('none');
    const det = ctx.details(ac);
    const r = det?.route;
    const a = det?.aircraft;

    q('.cs').innerHTML = `${esc(labelOf(ac))}${r?.callsignIata && r.callsignIata !== ac.callsign ? ` <small>${esc(r.callsignIata)}</small>` : ''}`;
    q('.airline').innerHTML = `${logoHtml(ctx, ac, 'big')}<span>${esc(r?.airline?.name || airlineName(airlineOf(ac)) || a?.owner || CLS_LABEL[ac.cls] || '')}</span>`;

    const badges = [];
    if (ac.military) badges.push('<b class="badge mil">Militär</b>');
    if (ac.ladd || ac.pia) badges.push('<b class="badge hid" title="LADD/PIA – wird von Flightradar24 & Co. meist ausgeblendet">FR24-gesperrt</b>');
    if (ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk)) badges.push(`<b class="badge alert">NOTFALL ${esc(ac.squawk || ac.emergency)}</b>`);
    badges.push(`<b class="badge">${esc(KIND_LABEL[ac.kind] || ac.kind)}</b>`);
    q('.badges').innerHTML = badges.join('');

    // Route mit Fortschrittsbalken
    if (r?.origin && r?.destination) {
      const [lat, lon] = extrapolate(ac, ctx.nowServer());
      const dO = distanceKm(r.origin.lat, r.origin.lon, lat, lon);
      const dD = distanceKm(lat, lon, r.destination.lat, r.destination.lon);
      const p = Math.min(1, Math.max(0, dO / (dO + dD)));
      q('.route').innerHTML = `
        <div class="ap"><b>${esc(r.origin.iata || r.origin.icao)}</b><small>${esc(r.origin.city || r.origin.name)}</small></div>
        <div class="prog"><div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
          <span class="pl" style="left:${(p * 100).toFixed(1)}%">${iconSvg({ cls: 'jet', track: 90 }, cssVar('--accent'), 22)}</span>
          <small>${ctx.fmt.dist(dD)} bis zum Ziel</small></div>
        <div class="ap"><b>${esc(r.destination.iata || r.destination.icao)}</b><small>${esc(r.destination.city || r.destination.name)}</small></div>`;
    } else {
      q('.route').innerHTML = `<div class="noroute">${ac.kind === 'flarm' ? 'FLARM-Luftfahrzeug – keine Route' : 'Route unbekannt'}</div>`;
    }

    const elev = elevationDeg(ac.altFt, ac.distKm);
    const sky = ac.onGround ? 'am Boden'
      : `${compassLong(ac.bearing)}${elev != null && elev > 0 ? `, ${Math.round(elev)}° hoch` : ', unter dem Horizont'}`;
    const tName = typeName(ac, det) || '–';
    q('.ftype').innerHTML = `${esc(tName)}${ac.icaoType ? `<small>${esc(ac.icaoType)}</small>` : ''}`;
    q('.grid').innerHTML = [
      cell('Flugzeugtyp', `${esc(tName)}${ac.icaoType ? ` <span class="muted">(${esc(ac.icaoType)})</span>` : ''}`, '', 'wide'),
      cell('Kategorie', esc(CLS_LABEL[ac.cls] || '–')),
      cell('Kennzeichen', esc(a?.reg || ac.reg || ac.cn || '–')),
      cell('Höhe', fmt.alt(ac.altFt, ac.onGround)),
      cell('Geschwindigkeit', fmt.speed(ac.gsKt)),
      cell('Steigen/Sinken', fmt.vr(ac.vrFpm)),
      cell('Entfernung', fmt.dist(ac.distKm)),
      cell('Wo am Himmel?', `<i class="arr big" style="transform:rotate(${ac.bearing}deg)">↑</i> ${esc(sky)}`, '', 'wide'),
      cell('Kurs', ac.track != null ? `${Math.round(ac.track)}°` : '–'),
      cell('Squawk', esc(ac.squawk || '–')),
      cell('Quellen', esc(ac.sources.map(s => SOURCE_LABEL[s] || s).join(', ')), '', 'wide'),
    ].join('');

    setPhoto(det?.photo, ac);
  }

  function setPhoto(photo, ac) {
    const url = photo?.url || '';
    if (url === shownPhoto && url) return;
    shownPhoto = url;
    const box = q('.photo');
    q('.ph-credit').textContent = photo?.credit || '';
    if (url) {
      box.classList.remove('nophoto');
      img.onerror = () => { box.classList.add('nophoto'); };
      img.src = url;
    } else {
      box.classList.add('nophoto');
      img.removeAttribute('src');
      q('.ph-none').innerHTML = ac ? iconSvg({ cls: ac.cls, track: 45 }, cssVar('--muted'), 160) : '';
    }
  }

  function renderHours() {
    const h = ctx.stats?.hours;
    if (!h) return;
    const max = Math.max(1, ...h);
    const now = new Date().getHours();
    q('.bars').innerHTML = h.map((v, i) =>
      `<i class="${i === now ? 'now' : ''}" style="height:${Math.max(2, (v / max) * 100)}%" title="${i}:00 – ${v}"></i>`).join('')
      + '<div class="ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>';
  }

  return {
    update() {
      renderFocus();
      q('.near').innerHTML = nearListHtml(ctx, ctx.aircraft.slice(0, 8), { skipId: ctx.focusId });
      renderHours();
    },
    unmount() {},
  };
}
