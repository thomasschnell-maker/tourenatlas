/* global maplibregl */
// Touren-Paket: Touren mit mehreren Stationen, Routing entlang echter Wege,
// Fotos je Station mit gespeichertem 3D-Blick. Daten bleiben lokal auf dem Gerät.

import { ACTIVITIES, ASSIST, ROUTER, TOUR_COLORS, assignPhotos, calibrateEbike, implausibleClimb, batteryCurve, brouterUrl, captureView, formatDuration, newStation, newTour, nextColor, parseBrouter, parseGpx, stationDistances, stationsFromTrack, tourGpx, tourLine, tourStats, viewFromPhoto } from './tours-core.js';
import { readExif } from './exif.js';
import { blobToDataUrl, compressImage, dataUrlToBlob, requestPersistence, store } from './tours-store.js';
import { geocode, splitPlaces } from '../search.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 17.5c4-1 2-6 6-7.5s2-2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.5 2.5"/></svg>';
const COLOR = TOUR_COLORS[0];
const colorOf = (t) => t?.color || COLOR;
const EMPTY = { type: 'FeatureCollection', features: [] };

let ctx = null;
let tours = [];
let current = null;
let adding = false;
let stats = null;
let year = 'all'; // Zeitverlauf: Jahresfilter der Tourenliste und der Übersichtskarte
const thumbUrls = new Map();

// ---------- Kartenebenen ----------
function lastActivity() {
  try {
    const a = localStorage.getItem('ta.activity');
    return a && ACTIVITIES[a] ? a : 'hike';
  } catch {
    return 'hike';
  }
}

let group = null; // Gruppenfilter: nur diese Tourfamilie auf der Karte

/** Tourenliste nach Gruppen (Tourfamilie mit Rückweg-Varianten), je Tour Farbe + Kennzahlen. */
function renderGroups(esc) {
  const list = visibleTours();
  if (!list.length) return '<p class="muted">Noch keine Touren. Lege die erste an oder übernimm deine Touren.</p>';
  const groups = new Map();
  for (const t of list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'))) {
    const g = t.group || 'Ohne Gruppe';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  return [...groups.entries()]
    .map(
      ([g, ts]) => `<section class="tgroup ${group && group !== g ? 'dim' : ''}">
        <button type="button" class="tgroup-head" data-group="${esc(g)}" aria-pressed="${group === g}">${esc(g)} <small>${ts.length} ${ts.length === 1 ? 'Tour' : 'Varianten'}${group === g ? ' · nur diese auf der Karte' : ''}</small></button>
        <ul class="tour-list">${ts
          .map(
            (t) => `<li><button type="button" data-open="${esc(t.id)}"><i class="tdot" style="background:${esc(colorOf(t))}"></i><b>${esc(t.variant || t.name)}</b>
              <small>${esc(ACTIVITIES[t.activity || 'hike'].label)} · ${t.stations.length} Stationen${t.summary ? ` · ${(t.summary.length / 1000).toFixed(1)} km · ${Math.round(t.summary.up)} Hm` : ''}</small></button></li>`
          )
          .join('')}</ul></section>`
    )
    .join('');
}

const tourYear = (t) => (t.date || t.created || '').slice(0, 4);
const visibleTours = () => tours.filter((t) => year === 'all' || tourYear(t) === year);
const mapTours = () => visibleTours().filter((t) => !group || (t.group || 'Ohne Gruppe') === group);

/** Übersicht: alle Touren des gewählten Jahres; Stationen ohne Nummer. */
function overviewGeo() {
  const line = [];
  const stations = [];
  for (const t of mapTours()) {
    const coords = tourLine(t.stations, t.segments);
    const color = colorOf(t);
    if (coords.length >= 2) line.push({ type: 'Feature', properties: { routed: true, tour: t.id, color }, geometry: { type: 'LineString', coordinates: coords } });
    t.stations.forEach((s) => stations.push({ type: 'Feature', properties: { id: s.id, tour: t.id, n: '', name: s.name, photos: s.photos.length, color }, geometry: { type: 'Point', coordinates: s.lngLat } }));
  }
  return { line: { type: 'FeatureCollection', features: line }, stations: { type: 'FeatureCollection', features: stations } };
}

function photoGeo() {
  return {
    type: 'FeatureCollection',
    features: (current?.photoPins || []).map((p) => ({ type: 'Feature', properties: { id: p.id, station: p.stationId }, geometry: { type: 'Point', coordinates: p.lngLat } }))
  };
}

function geo() {
  if (!current) return overviewGeo();
  const st = current.stations;
  const lineFeatures = [];
  for (let i = 1; i < st.length; i++) {
    const seg = current.segments[i - 1];
    const routed = seg?.coords?.length >= 2;
    lineFeatures.push({
      type: 'Feature',
      properties: { routed, color: colorOf(current) },
      geometry: { type: 'LineString', coordinates: routed ? seg.coords : [st[i - 1].lngLat, st[i].lngLat] }
    });
  }
  return {
    line: { type: 'FeatureCollection', features: lineFeatures },
    stations: {
      type: 'FeatureCollection',
      features: st.map((s, i) => ({
        type: 'Feature',
        properties: { id: s.id, n: String(i + 1), name: s.name, photos: s.photos.length, color: colorOf(current) },
        geometry: { type: 'Point', coordinates: s.lngLat }
      }))
    }
  };
}

function addLayers(map) {
  if (map.getSource('tour-line')) return;
  const g = geo();
  map.addSource('tour-line', { type: 'geojson', data: g.line, attribution: ROUTER.attribution });
  map.addSource('tour-stations', { type: 'geojson', data: g.stations });
  map.addLayer({ id: 'tour-casing', type: 'line', source: 'tour-line', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
  map.addLayer({
    id: 'tour-line',
    type: 'line',
    source: 'tour-line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    // Luftlinie gestrichelt: dort liegt keine geprüfte Wegführung vor.
    paint: { 'line-color': ['coalesce', ['get', 'color'], COLOR], 'line-width': 4.5, 'line-dasharray': ['case', ['get', 'routed'], ['literal', [1, 0]], ['literal', [1.5, 1.5]]] }
  });
  map.addLayer({
    id: 'tour-stations',
    type: 'circle',
    source: 'tour-stations',
    paint: {
      'circle-radius': ['case', ['==', ['get', 'n'], ''], 6, 11],
      'circle-color': ['coalesce', ['get', 'color'], COLOR],
      'circle-stroke-color': ['case', ['>', ['get', 'photos'], 0], '#ffd400', '#ffffff'],
      'circle-stroke-width': 3,
      // 'map': mit 3D-Gelände sonst im Test unsichtbar (viewport-Ausrichtung + Terrain).
      'circle-pitch-alignment': 'map'
    }
  });
  map.addSource('tour-photos', { type: 'geojson', data: photoGeo() });
  map.addLayer({
    id: 'tour-photos',
    type: 'circle',
    source: 'tour-photos',
    paint: { 'circle-radius': 6, 'circle-color': '#ffb300', 'circle-stroke-color': '#3d2a00', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' }
  });
  map.addLayer({
    id: 'tour-station-labels',
    type: 'symbol',
    source: 'tour-stations',
    layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-pitch-alignment': 'map' },
    paint: { 'text-color': '#ffffff' }
  });
}

function refreshMap() {
  ctx.map.getSource('tour-photos')?.setData(photoGeo());
  const g = geo();
  ctx.map.getSource('tour-line')?.setData(g.line);
  ctx.map.getSource('tour-stations')?.setData(g.stations);
}

// ---------- Routing ----------
async function routeSegment(a, b) {
  if (current.mode !== 'route') return { coords: null };
  try {
    const profile = ACTIVITIES[current.activity || 'hike'].profile;
    const res = await fetch(brouterUrl(a.lngLat, b.lngLat, profile));
    if (!res.ok) throw new Error(`BRouter: HTTP ${res.status}`);
    return { coords: parseBrouter(await res.json(), a.lngLat, b.lngLat) };
  } catch (err) {
    return { coords: null, error: err.message };
  }
}

async function rebuildSegments(indices) {
  const st = current.stations;
  current.segments.length = Math.max(0, st.length - 1);
  const todo = indices ?? st.slice(1).map((_, i) => i);
  ctx.toast(`Berechne Route …`, { busy: true });
  for (const i of todo) {
    if (i < 0 || i >= st.length - 1) continue;
    if (current.segments[i]?.recorded) continue; // aufgezeichnete GPX-Spur nie überschreiben
    current.segments[i] = await routeSegment(st[i], st[i + 1]);
  }
  const failed = current.segments.filter((s) => s?.error);
  if (failed.length) ctx.toast(`${failed.length} Abschnitt(e) als Luftlinie: ${failed[0].error}`, { error: true, ttl: 7000 });
  else ctx.toast('');
  await persist();
}

async function persist() {
  await store.putTour(current);
  stats = await tourStats(tourLine(current.stations, current.segments), ctx.sampler, 25, current.activity || 'hike');
  current.summary = stats ? { length: stats.length, up: stats.up, timeH: stats.timeH } : null;
  await store.putTour(current);
  refreshMap();
  render();
}

// ---------- Stationen ----------
async function addStation(lngLat, name) {
  const ll = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
  const s = newStation(ll, current.stations.length + 1);
  if (name) s.name = name;
  s.ele = await ctx.sampler.elevation(s.lngLat);
  current.stations.push(s);
  refreshMap();
  if (current.stations.length > 1) await rebuildSegments([current.stations.length - 2]);
  else await persist();
}

/** "Sonthofen, Burgberg, Immenstadt" → je Ort der beste Treffer (Region zuerst) als Station. */
async function addPlaces(text) {
  const names = splitPlaces(text);
  if (!names.length) return;
  const missing = [];
  for (const [i, entry] of names.entries()) {
    // "Altmummen|Alt Mummen|Mummen": Schreibweisen der Reihe nach probieren.
    const alts = entry.split('|').map((x) => x.trim()).filter(Boolean);
    const q = alts[0];
    ctx.toast(`Suche „${q}“ (${i + 1}/${names.length}) …`, { busy: true, ttl: 0 });
    try {
      let hit = null;
      for (const alt of alts) {
        hit = (await geocode(alt))[0];
        if (hit) break;
      }
      if (!hit) {
        missing.push(q);
        continue;
      }
      if (!hit.inRegion) missing.push(`${q} (ausserhalb, trotzdem gesetzt)`);
      await addStation(hit.lngLat, hit.name);
    } catch (err) {
      missing.push(`${q} (${err.message})`);
    }
  }
  if (missing.length) ctx.toast(`Nicht eindeutig: ${missing.join(', ')}`, { error: true, ttl: 8000 });
  else ctx.toast(`${names.length} Station(en) gesetzt`);
  fitTour();
}

function fitTours(list) {
  const b = new maplibregl.LngLatBounds();
  list.forEach((t) => t.stations.forEach((s) => b.extend(s.lngLat)));
  if (!b.isEmpty()) ctx.map.fitBounds(b, { padding: visiblePadding(), maxZoom: 14, duration: 1200 });
}

function fitTour() {
  if (!current?.stations.length) return;
  const b = new maplibregl.LngLatBounds();
  current.stations.forEach((s) => b.extend(s.lngLat));
  ctx.map.fitBounds(b, { padding: visiblePadding(), maxZoom: 15, duration: 1200 });
}

/** Aus der Ortssuche gepinnt: in die offene Tour, sonst neue Tour anlegen. */
async function pinStation({ name, lngLat }) {
  if (!current) {
    current = { ...newTour(`Tour ${new Date().toLocaleDateString('de-DE')}`), activity: lastActivity(), color: nextColor(tours) };
    await store.putTour(current);
    tours = await store.allTours();
    current = tours.find((x) => x.id === current.id);
    requestPersistence();
  }
  ctx.openPane('tours');
  await addStation(lngLat, name);
  ctx.toast(`„${name}“ als Station ${current.stations.length} gesetzt`);
  fitTour();
}

async function removeStation(id) {
  const i = current.stations.findIndex((s) => s.id === id);
  if (i < 0) return;
  for (const pid of current.stations[i].photos) await store.deletePhoto(pid);
  current.stations.splice(i, 1);
  // Nachbarn neu verbinden: Abschnitt vor und nach der Station entfallen, einer wird neu berechnet.
  if (i > 0 && i < current.stations.length) {
    current.segments.splice(i - 1, 2, null);
    await rebuildSegments([i - 1]);
  } else {
    current.segments.splice(Math.max(0, i - 1), 1);
    await persist();
  }
}

function flyToStation(s) {
  const v = s.view;
  ctx.map.flyTo(v ? { center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: 2200 } : { center: s.lngLat, zoom: 15, duration: 1500 });
}

// ---------- Fotos ----------
/** Foto verkleinern und speichern; EXIF vorher lesen (das Verkleinern entfernt es). */
async function storePhoto(station, file, view, exif) {
  const big = await compressImage(file, 1600, 0.85);
  const small = await compressImage(file, 320, 0.75);
  const photo = {
    id: `${station.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    tourId: current.id,
    stationId: station.id,
    blob: big.blob,
    thumb: small.blob,
    w: big.w,
    h: big.h,
    name: file.name,
    created: new Date().toISOString(),
    takenAt: exif.takenAt,
    lngLat: exif.lngLat,
    direction: exif.direction,
    view
  };
  await store.putPhoto(photo);
  station.photos.push(photo.id);
  if (exif.lngLat) (current.photoPins ||= []).push({ id: photo.id, stationId: station.id, lngLat: exif.lngLat });
  return photo;
}

async function addPhotos(station, files) {
  ctx.toast(`Speichere ${files.length} Foto(s) …`, { busy: true });
  const view = captureView(ctx.map);
  try {
    for (const file of files) await storePhoto(station, file, view, readExif(await file.arrayBuffer()));
    // Blick der Station: beim ersten Foto übernehmen, später nur auf Wunsch ("Blick speichern").
    if (!station.view) station.view = view;
    await persist();
    ctx.toast(`${files.length} Foto(s) mit 3D-Blick gespeichert`);
  } catch (err) {
    ctx.toast(`Foto nicht gespeichert: ${err.message}`, { error: true, ttl: 7000 });
  }
}

/** Viele Fotos auf einmal: Station per Aufnahmeort/-zeit, 3D-Blick aus Standort + Blickrichtung. */
async function autoAssignPhotos(files, fallbackIndex) {
  if (!current.stations.length) return ctx.toast('Erst Stationen setzen', { error: true });
  ctx.toast(`Lese ${files.length} Foto(s) …`, { busy: true, ttl: 0 });
  try {
    const exifs = await Promise.all(files.map(async (f) => readExif(await f.arrayBuffer())));
    const plan = assignPhotos(exifs, current.stations, { fallbackIndex });
    const count = { ort: 0, zeit: 0, rest: 0 };
    for (const [i, file] of files.entries()) {
      ctx.toast(`Speichere Foto ${i + 1}/${files.length} …`, { busy: true, ttl: 0 });
      const st = current.stations[plan[i].station];
      const view = viewFromPhoto(exifs[i]) || captureView(ctx.map);
      await storePhoto(st, file, view, exifs[i]);
      if (!st.view) st.view = view;
      if (/Aufnahmeort,/.test(plan[i].reason)) count.ort++;
      else if (/Aufnahmezeit/.test(plan[i].reason)) count.zeit++;
      else count.rest++;
    }
    await persist();
    ctx.toast(`${files.length} Foto(s): ${count.ort} per Aufnahmeort, ${count.zeit} per Aufnahmezeit, ${count.rest} an gewählte Station`, { ttl: 8000, error: count.rest > 0 });
  } catch (err) {
    ctx.toast(`Fotos nicht zugeordnet: ${err.message}`, { error: true, ttl: 7000 });
  }
}

async function thumbUrl(id) {
  if (!thumbUrls.has(id)) {
    const p = await store.getPhoto(id);
    thumbUrls.set(id, p ? URL.createObjectURL(p.thumb) : '');
  }
  return thumbUrls.get(id);
}

async function openLightbox(station, photoId) {
  const p = await store.getPhoto(photoId);
  if (!p) return;
  const url = URL.createObjectURL(p.blob);
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img alt="">
    <div class="lb-bar"><span>${ctx.esc(station.name)} · ${ctx.esc(new Date(p.created).toLocaleDateString('de-DE'))}</span>
      <button type="button" class="btn" data-lb="view">3D-Blick</button>
      <button type="button" class="btn" data-lb="del">Löschen</button>
      <button type="button" class="btn" data-lb="close">✕</button></div>`;
  box.querySelector('img').src = url;
  const close = () => {
    URL.revokeObjectURL(url);
    box.remove();
  };
  box.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-lb]')?.dataset.lb;
    if (a === 'close' || e.target === box) close();
    if (a === 'view') {
      close();
      const v = p.view || station.view;
      if (v) ctx.map.flyTo({ ...v, duration: 2200 });
      else flyToStation(station);
    }
    if (a === 'del' && confirm('Foto löschen?')) {
      await store.deletePhoto(p.id);
      station.photos = station.photos.filter((x) => x !== p.id);
      current.photoPins = (current.photoPins || []).filter((x) => x.id !== p.id);
      close();
      await persist();
    }
  });
  document.body.appendChild(box);
}

// ---------- Akku-Schätzung: Stufe × persönlicher Faktor ----------
function batteryScale(t) {
  const cal = calibrateEbike(tours);
  return { scale: (ASSIST[t.assist || 'tour']?.f ?? 1) * cal.factor, cal };
}

// ---------- Höhenprofil + Akkuverlauf ----------
const PW = 300;
const PH = 120;
let cursor = null;

function profileSvg(t) {
  const pts = stats.profile.filter((p) => p.ele != null);
  if (pts.length < 2) return '';
  const dMax = stats.profile[stats.profile.length - 1].dist || 1;
  const span = Math.max(80, stats.max - stats.min);
  const lo = (stats.max + stats.min) / 2 - span / 2;
  const x = (d) => ((d / dMax) * PW).toFixed(1);
  const y = (e) => (PH - 14 - ((e - lo) / span) * (PH - 28)).toFixed(1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.dist)},${y(p.ele)}`).join('');
  let svg = `<path class="area" d="${line}L${PW},${PH}L0,${PH}Z"/><path class="line" d="${line}"/>`;
  // Stationen
  stationDistances(t.stations, stats.profile).forEach((d, i) => {
    svg += `<line class="st" x1="${x(d)}" x2="${x(d)}" y1="0" y2="${PH}"/><text class="stn" x="${x(d)}" y="${PH - 2}" text-anchor="middle">${i + 1}</text>`;
  });
  let legend = `<span><i class="sw-ele"></i>Höhe ${Math.round(stats.min)}–${Math.round(stats.max)} m</span>`;
  if ((t.activity || 'hike') === 'ebike') {
    const cap = t.batteryCapacityWh || 625;
    const c = batteryCurve(stats.profile, cap, 5, batteryScale(t).scale);
    const by = (pct) => (8 + (1 - pct / 100) * (PH - 22)).toFixed(1);
    const step = Math.max(1, Math.floor(c.points.length / 300));
    const bl = c.points.filter((_, i) => i % step === 0 || i === c.points.length - 1).map((p, i) => `${i ? 'L' : 'M'}${x(p.dist)},${by(p.pct)}`).join('');
    svg += `<path class="batt" d="${bl}"/>`;
    c.swaps.forEach((d) => {
      svg += `<line class="swap" x1="${x(d)}" x2="${x(d)}" y1="0" y2="${PH}"/><text class="swapt" x="${x(d)}" y="9" text-anchor="middle">⚡</text>`;
    });
    legend += `<span><i class="sw-batt"></i>Akku ${cap} Wh</span>`;
    legend += c.swaps.length ? `<span>⚡ Wechsel bei km ${c.swaps.map((d) => (d / 1000).toFixed(0)).join(', ')}</span>` : '<span>ohne Akkuwechsel</span>';
  }
  return `<svg class="tprofile" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" aria-label="Höhenprofil der Tour">${svg}
    <line class="cursor" x1="-10" x2="-10" y1="0" y2="${PH}"/></svg><div class="plegend">${legend}</div>`;
}

function profileCursor(ev) {
  const svg = ev.target.closest('svg.tprofile');
  if (!svg || !stats) return;
  const r = svg.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  const target = f * stats.profile[stats.profile.length - 1].dist;
  const p = stats.profile.reduce((b, q) => (Math.abs(q.dist - target) < Math.abs(b.dist - target) ? q : b), stats.profile[0]);
  cursor = cursor || new maplibregl.Marker({ color: '#00b8d4', scale: 0.7 });
  cursor.setLngLat(p.coord).addTo(ctx.map);
  const l = svg.querySelector('line.cursor');
  l.setAttribute('x1', f * PW);
  l.setAttribute('x2', f * PW);
  ctx.toast(`km ${(p.dist / 1000).toFixed(1)} · ${p.ele != null ? Math.round(p.ele) + ' m' : '–'}`, { ttl: 1500 });
}

// ---------- Meine Touren (Vorlagen aus data/touren.json) ----------
async function importMyTours() {
  let list;
  try {
    const res = await fetch('data/touren.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch (err) {
    return ctx.toast(`Tourenliste nicht ladbar: ${err.message}`, { error: true, ttl: 6000 });
  }
  // Neu oder in der Liste korrigiert (höhere version) → übernehmen bzw. die vorhandene Tour neu aufbauen.
  const todo = list.filter((v) => {
    const t = tours.find((x) => x.templateId === v.id);
    return !t || (t.templateVersion || 1) < (v.version || 1);
  });
  // Reine Zusatzangaben (z. B. tatsächlich verbrauchte Akkus) ohne Neuaufbau ergänzen – Fotos bleiben erhalten.
  for (const v of list) {
    const t = tours.find((x) => x.templateId === v.id);
    if (t && v.actualBatteries && !t.actualBatteries) {
      t.actualBatteries = v.actualBatteries;
      if (v.batteryCapacityWh) t.batteryCapacityWh = v.batteryCapacityWh;
      await store.putTour(t);
    }
  }
  if (!todo.length) return ctx.toast('Alle Touren aus der Liste sind aktuell übernommen');
  requestPersistence();
  for (const v of todo) {
    const old = tours.find((x) => x.templateId === v.id);
    if (old) for (const st of old.stations) for (const pid of st.photos) await store.deletePhoto(pid);
    const t = {
      ...newTour(v.name),
      ...(old ? { id: old.id, date: old.date, color: old.color } : { color: nextColor(tours) }),
      templateId: v.id,
      templateVersion: v.version || 1,
      group: v.group || '',
      variant: v.variant || '',
      activity: v.activity || 'hike',
      note: v.note || '',
      ...(v.actualBatteries ? { actualBatteries: v.actualBatteries } : {}),
      ...(v.batteryCapacityWh ? { batteryCapacityWh: v.batteryCapacityWh } : {})
    };
    if (v.date) t.date = v.date;
    await store.putTour(t);
    tours = await store.allTours();
    await openTour(t.id);
    await addPlaces(v.places.join('; '));
  }
  ctx.toast(`${todo.length} Tour(en) übernommen – Stationen bitte prüfen`, { ttl: 6000 });
}

// ---------- GPX-Import: aufgezeichnete Spur als Tour ----------
async function importGpx(file) {
  try {
    const { name, coords, time } = parseGpx(await file.text());
    const t = newTour(name);
    if (time) t.date = time.slice(0, 10);
    const idx = stationsFromTrack(coords, 10);
    t.stations = idx.map((i, k) => newStation(coords[i], k + 1));
    t.stations.forEach((s, k) => (s.name = k === 0 ? 'Start' : k === idx.length - 1 ? 'Ziel' : `ca. km ${k * 10}`));
    t.segments = idx.slice(1).map((end, k) => ({ coords: coords.slice(idx[k], end + 1), recorded: true }));
    const eles = await ctx.sampler.elevations(t.stations.map((s) => s.lngLat));
    t.stations.forEach((s, k) => (s.ele = eles[k]));
    await store.putTour(t);
    tours = await store.allTours();
    await openTour(t.id);
    await persist();
    ctx.toast(`„${name}“ übernommen (${coords.length} Punkte) – Aktivität wählen`);
  } catch (err) {
    ctx.toast(`GPX nicht lesbar: ${err.message}`, { error: true, ttl: 7000 });
  }
}

// ---------- Backup ----------
async function exportBackup(tour) {
  const photos = await store.photosOfTour(tour.id);
  const data = {
    format: 'tourenatlas-backup',
    version: 1,
    exported: new Date().toISOString(),
    tour,
    photos: await Promise.all(photos.map(async ({ blob, thumb, ...meta }) => ({ ...meta, data: await blobToDataUrl(blob), thumbData: await blobToDataUrl(thumb) })))
  };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `tour-${slug(tour.name)}-${tour.date || ''}.json`);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.format !== 'tourenatlas-backup' || !data.tour?.id || !Array.isArray(data.tour.stations)) throw new Error('Keine Tourenatlas-Sicherung');
    if (tours.some((t) => t.id === data.tour.id) && !confirm(`„${data.tour.name}“ existiert schon. Überschreiben?`)) return;
    for (const p of data.photos || []) {
      const { data: d, thumbData, ...meta } = p;
      await store.putPhoto({ ...meta, blob: await dataUrlToBlob(d), thumb: await dataUrlToBlob(thumbData) });
    }
    await store.putTour(data.tour);
    tours = await store.allTours();
    ctx.toast(`„${data.tour.name}“ wiederhergestellt (${(data.photos || []).length} Fotos)`);
    render();
  } catch (err) {
    ctx.toast(`Sicherung nicht lesbar: ${err.message}`, { error: true, ttl: 7000 });
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const slug = (s) => String(s || 'tour').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '');

// ---------- Ansicht ----------
function setAdding(on) {
  adding = on;
  ctx.pane.querySelector('[data-t="add"]')?.classList.toggle('on', on);
  ctx.map.getCanvas().style.cursor = on ? 'crosshair' : '';
  // Beim Setzen Blatt einklappen, damit die Karte frei ist.
  ctx.setSheetPeek?.(on);
  if (on) ctx.toast('Auf die Karte tippen = Station setzen', { ttl: 5000 });
  else ctx.toast('');
}

function render() {
  const { pane, esc } = ctx;
  if (!current) {
    const years = [...new Set(tours.map(tourYear).filter(Boolean))].sort().reverse();
    const chips = years.length > 0 ? `<div class="chips">${['all', ...years].map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === year}">${y === 'all' ? 'Alle' : y}</button>`).join('')}</div>` : '';
    pane.innerHTML = `
      ${chips}
      <div class="row"><button type="button" class="btn primary" data-t="new">+ Neue Tour</button>
        <label class="btn">Sicherung laden<input type="file" accept=".json,application/json" data-t="import" hidden></label></div>
      <div class="row"><button type="button" class="btn" data-t="mine">Meine Touren übernehmen</button>
        <label class="btn">GPX laden<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" data-t="gpxfile" hidden></label></div>
      ${renderGroups(esc)}
      ${visibleTours().length ? '<p class="muted">Alle Touren der Auswahl sind auf der Karte; Linie antippen öffnet die Tour. Für ein Jahresplakat: Jahr wählen, dann Tab „Plakat“.</p>' : ''}
      <p class="muted">Touren und Fotos bleiben nur auf diesem Gerät. Safari löscht sie nach 7 Tagen ohne Besuch, ausser die App liegt auf dem Home-Bildschirm. Sicherung regelmässig exportieren.</p>`;
    return;
  }
  const t = current;
  const failed = t.segments.filter((s) => s?.error).length;
  pane.innerHTML = `
    <button type="button" class="link" data-t="back">‹ Alle Touren</button>
    <div class="row"><input data-t="name" value="${esc(t.name)}" aria-label="Name der Tour"><input type="date" data-t="date" value="${esc(t.date || '')}" aria-label="Datum"></div>
    <div class="row"><input data-t="group" value="${esc(t.group || '')}" placeholder="Gruppe, z. B. Ofterschwanger Horn" aria-label="Gruppe"><input data-t="variant" value="${esc(t.variant || '')}" placeholder="Variante, z. B. Rückweg 2" aria-label="Variante"></div>
    <div class="colors" role="radiogroup" aria-label="Farbe">${TOUR_COLORS.map((c) => `<label><input type="radio" name="tcolor" value="${c}" ${colorOf(t) === c ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}
      <button type="button" class="btn sm" data-t="variantcopy">Als Variante kopieren</button></div>
    <div class="seg" role="radiogroup" aria-label="Aktivität">${Object.entries(ACTIVITIES)
      .map(([k, a]) => `<label><input type="radio" name="tact" value="${k}" ${(t.activity || 'hike') === k ? 'checked' : ''}><span>${a.label}</span></label>`)
      .join('')}</div>
    <div class="seg" role="radiogroup" aria-label="Verbindung">
      <label><input type="radio" name="tmode" value="route" ${t.mode === 'route' ? 'checked' : ''}><span>Wegen folgen</span></label>
      <label><input type="radio" name="tmode" value="line" ${t.mode === 'line' ? 'checked' : ''}><span>Luftlinie</span></label>
    </div>
    <form class="row" data-t="places-form"><input data-t="places" placeholder="Orte: Sonthofen, Burgberg, Immenstadt" aria-label="Orte als Stationen" enterkeyhint="done"><button type="submit" class="btn">Setzen</button></form>
    <button type="button" class="btn primary wide ${adding ? 'on' : ''}" data-t="add">${adding ? 'Fertig mit Setzen' : '+ Station auf Karte setzen'}</button>
    ${
      stats
        ? `<dl class="stats"><dt>Länge</dt><dd>${(stats.length / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</dd>
           <dt>Auf / Ab</dt><dd>${Math.round(stats.up)} / ${Math.round(stats.down)} Hm</dd>
           <dt>${(t.activity || 'hike') === 'hike' ? 'Gehzeit (DIN 33466)' : 'Fahrzeit (Faustregel)'}</dt><dd>${formatDuration(stats.timeH)}</dd>
           ${
             stats.batteryWh != null
               ? `<dt>Akku (${batteryScale(t).cal.n ? `kalibriert aus ${batteryScale(t).cal.n} Fahrt${batteryScale(t).cal.n > 1 ? 'en' : ''}` : 'Faustregel'})</dt><dd>~${Math.round((stats.batteryWh * batteryScale(t).scale) / 10) * 10} Wh ≈ ${((stats.batteryWh * batteryScale(t).scale) / (t.batteryCapacityWh || 625)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Akkus à
                  <select data-t="battery" aria-label="Akkugrösse">${[400, 500, 625, 750, 800]
                    .map((w) => `<option value="${w}" ${w === (t.batteryCapacityWh || 625) ? 'selected' : ''}>${w} Wh</option>`)
                    .join('')}</select></dd>`
               : ''
           }
           <dt>Höhe</dt><dd>${Math.round(stats.min ?? 0)}–${Math.round(stats.max ?? 0)} m</dd></dl>`
        : ''
    }
    ${
      (t.activity || 'hike') === 'ebike'
        ? `<div class="row ebike">
            <label>Stufe <select data-t="assist">${Object.entries(ASSIST).map(([k, a]) => `<option value="${k}" ${(t.assist || 'tour') === k ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
            <label>Tatsächlich <input type="number" min="0" max="9" step="0.1" inputmode="decimal" data-t="actual" value="${t.actualBatteries ?? ''}" placeholder="–"> Akkus</label>
          </div>
          <p class="muted">Trag nach der Fahrt ein, wie viele Akkus du wirklich gebraucht hast – die Schätzung lernt daraus (Median über alle Fahrten${batteryScale(t).cal.n ? `, dein Faktor: ${batteryScale(t).cal.factor.toFixed(2)}` : ''}).</p>`
        : ''
    }
    ${stats && implausibleClimb(stats.length, stats.up, t.activity || 'hike') ? `<ul class="findings"><li class="warn">${Math.round(stats.up / (stats.length / 1000))} Hm/km sind unrealistisch – vermutlich Luftlinie über Gelände; Route prüfen (Wegen folgen) oder Zwischenstationen setzen</li></ul>` : ''}
    ${stats ? profileSvg(t) : ''}
    ${failed ? `<ul class="findings"><li class="warn">${failed} Abschnitt(e) nur Luftlinie – Wegführung nicht geprüft</li></ul>` : ''}
    ${t.segments.some((x) => x?.recorded) ? '<ul class="findings"><li class="ok">Aufgezeichnete GPX-Spur – Strecke gemessen, nicht berechnet</li></ul>' : ''}
    ${(t.activity || 'hike') !== 'hike' ? '<p class="muted">Rad/E-Bike-Werte sind Faustregeln (±30 %): Wind, Gewicht, Unterstützungsstufe und Temperatur verändern Zeit und Akku deutlich.</p>' : ''}
    <textarea data-t="note" rows="2" placeholder="Notiz zur Tour" aria-label="Notiz">${esc(t.note || '')}</textarea>
    <ol class="stations">${t.stations
      .map(
        (s, i) => `<li data-sid="${esc(s.id)}">
          <div class="st-head"><span class="badge">${i + 1}</span><input value="${esc(s.name)}" data-s="name" aria-label="Name der Station">
            <small>${s.ele != null ? Math.round(s.ele) + ' m' : ''}</small></div>
          <div class="thumbs" data-s="thumbs"></div>
          <div class="st-actions">
            <label class="btn sm">📷 Foto<input type="file" accept="image/*" multiple data-s="photo" hidden></label>
            <button type="button" class="btn sm" data-s="view" title="Aktuellen 3D-Blick für diese Station speichern">${s.view ? 'Blick ✓' : 'Blick speichern'}</button>
            <button type="button" class="btn sm" data-s="fly">Hinfliegen</button>
            <button type="button" class="btn sm danger" data-s="del" aria-label="Station löschen">✕</button>
          </div></li>`
      )
      .join('')}</ol>
    <div class="autophoto">
      <label class="btn primary">📷 Fotos automatisch zuordnen<input type="file" accept="image/*" multiple data-t="autophotos" hidden></label>
      <label class="muted">ohne Ort/Zeit an <select data-t="fallback">${t.stations.map((s, i) => `<option value="${i}" ${i === t.stations.length - 1 ? 'selected' : ''}>${i + 1}. ${esc(s.name)}</option>`).join('')}</select></label>
    </div>
    <p class="muted">Automatisch: Station nach Aufnahmeort (GPS) oder Aufnahmezeit; der 3D-Blick schaut vom Aufnahmeort in Fotorichtung. Am iPhone beim Auswählen unter „Optionen“ den Ort mitsenden. Einzelnes Foto über „📷 Foto“ an der Station: speichert den aktuell eingestellten Blick.</p>
    <button type="button" class="btn wide" data-t="offline" ${t.stations.length < 1 ? 'disabled' : ''}>Tour offline speichern</button>
    <div class="row"><button type="button" class="btn" data-t="gpx" ${t.stations.length < 2 ? 'disabled' : ''}>GPX</button>
      <button type="button" class="btn" data-t="backup">Sicherung</button>
      <button type="button" class="btn danger" data-t="delete">Tour löschen</button></div>`;
  // Vorschaubilder nachladen
  for (const s of t.stations) {
    const el = pane.querySelector(`li[data-sid="${CSS.escape(s.id)}"] [data-s="thumbs"]`);
    s.photos.forEach(async (pid) => {
      const url = await thumbUrl(pid);
      if (!url || !el) return;
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Foto';
      img.dataset.pid = pid;
      el.appendChild(img);
    });
  }
}

async function openTour(id) {
  current = tours.find((t) => t.id === id) || null;
  stats = null;
  setAdding(false);
  refreshMap();
  render();
  if (current?.stations.length) {
    const b = new maplibregl.LngLatBounds();
    current.stations.forEach((s) => b.extend(s.lngLat));
    ctx.map.fitBounds(b, { padding: visiblePadding(), maxZoom: 15, duration: 1200 });
    stats = await tourStats(tourLine(current.stations, current.segments), ctx.sampler, 25, current.activity || 'hike');
    render();
  }
}

/** Kartenrand, der nicht vom Blatt oder der Suche verdeckt ist – damit die Tour sichtbar landet. */
function visiblePadding() {
  const sheet = document.getElementById('sheet');
  const r = sheet && !sheet.hidden ? sheet.getBoundingClientRect() : null;
  const mapH = ctx.map.getContainer().clientHeight;
  const wide = window.innerWidth >= 900;
  return {
    top: 80,
    right: 60,
    bottom: r && !wide ? Math.min(mapH - 160, mapH - r.top + 30) : 90,
    left: r && wide ? r.right + 30 : 30
  };
}

function station(el) {
  const id = el.closest('li[data-sid]')?.dataset.sid;
  return current?.stations.find((s) => s.id === id);
}

// ---------- Ereignisse ----------
function wire(pane) {
  pane.addEventListener('pointermove', profileCursor);
  pane.addEventListener('pointerdown', profileCursor);
  pane.addEventListener('pointerleave', () => cursor?.remove());
  pane.addEventListener('submit', (e) => {
    if (e.target.dataset.t !== 'places-form') return;
    e.preventDefault();
    const input = e.target.querySelector('[data-t="places"]');
    const text = input.value;
    input.value = '';
    input.blur();
    addPlaces(text);
  });
  pane.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    const open = e.target.closest('[data-open]')?.dataset.open;
    const s = e.target.closest('[data-s]')?.dataset.s;
    const img = e.target.closest('img[data-pid]');
    const g = e.target.closest('[data-group]')?.dataset.group;
    if (g) {
      group = group === g ? null : g;
      refreshMap();
      render();
      if (group) fitTours(mapTours());
      return;
    }
    const y = e.target.closest('[data-year]')?.dataset.year;
    if (y) {
      year = y;
      refreshMap();
      return render();
    }
    if (open) return openTour(open);
    if (img) return openLightbox(station(img), img.dataset.pid);
    if (t === 'new') {
      current = { ...newTour(`Tour ${new Date().toLocaleDateString('de-DE')}`), activity: lastActivity(), color: nextColor(tours) };
      await store.putTour(current);
      tours = await store.allTours();
      current = tours.find((x) => x.id === current.id);
      stats = null;
      // Nicht automatisch in den Tipp-Modus: Orte eintippen oder auf Karte setzen – beides sichtbar.
      render();
      pane.querySelector('[data-t="places"]')?.focus();
      requestPersistence();
    }
    if (t === 'back') {
      setAdding(false);
      current = null;
      refreshMap();
      tours = await store.allTours();
      render();
    }
    if (t === 'add') {
      setAdding(!adding);
      render();
    }
    if (t === 'gpx') {
      const line = tourLine(current.stations, current.segments);
      download(new Blob([tourGpx(current, line, await ctx.sampler.elevations(line))], { type: 'application/gpx+xml' }), `tour-${slug(current.name)}.gpx`);
    }
    if (t === 'backup') exportBackup(current);
    if (t === 'variantcopy') {
      // Kopie ohne Fotos, gleiche Gruppe, neue Farbe – danach z. B. den Rückweg ersetzen.
      const copy = {
        ...structuredClone({ ...current, stations: current.stations.map((x) => ({ ...x, photos: [] })) }),
        id: newTour().id,
        templateId: undefined,
        photoPins: [],
        group: current.group || current.name,
        variant: `${current.variant || 'Variante'} (Kopie)`,
        color: nextColor(tours),
        created: new Date().toISOString()
      };
      if (!current.group) current.group = copy.group;
      await store.putTour(current);
      await store.putTour(copy);
      tours = await store.allTours();
      await openTour(copy.id);
      ctx.toast('Variante angelegt – Stationen des Rückwegs löschen und neue setzen');
    }
    if (t === 'offline') {
      const line = tourLine(current.stations, current.segments);
      const pts = line.length ? line : current.stations.map((x) => x.lngLat);
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      ctx.saveOffline([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], `„${current.name}“`);
    }
    if (t === 'mine') importMyTours();
    if (t === 'delete' && confirm(`Tour „${current.name}“ mit allen Fotos löschen?`)) {
      await store.deleteTour(current.id);
      current = null;
      tours = await store.allTours();
      refreshMap();
      render();
    }
    const st = s && station(e.target);
    if (!st) return;
    if (s === 'view') {
      st.view = captureView(ctx.map);
      await persist();
      ctx.toast(`3D-Blick für „${st.name}“ gespeichert`);
    }
    if (s === 'fly') flyToStation(st);
    if (s === 'del' && confirm(`„${st.name}“ löschen?`)) removeStation(st.id);
  });

  pane.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.t === 'import' && el.files?.[0]) return importBackup(el.files[0]);
    if (el.dataset.t === 'gpxfile' && el.files?.[0]) return importGpx(el.files[0]);
    if (!current) return;
    if (el.dataset.t === 'name') current.name = el.value.trim() || current.name;
    if (el.dataset.t === 'date') current.date = el.value;
    if (el.name === 'tmode') {
      current.mode = el.value;
      return rebuildSegments();
    }
    if (el.name === 'tact') {
      current.activity = el.value;
      try {
        localStorage.setItem('ta.activity', el.value); // nächste neue Tour startet mit derselben Aktivität
      } catch {}
      // Anderes Routing-Profil (Wanderwege ↔ Radwege): Strecke neu berechnen.
      return current.mode === 'route' ? rebuildSegments() : persist();
    }
    if (el.dataset.t === 'assist') {
      current.assist = el.value;
      await store.putTour(current);
      return render();
    }
    if (el.dataset.t === 'actual') {
      const v = Number(String(el.value).replace(',', '.'));
      current.actualBatteries = Number.isFinite(v) && v > 0 ? v : null;
      await store.putTour(current);
      return render();
    }
    if (el.dataset.t === 'battery') {
      current.batteryCapacityWh = Number(el.value);
      return persist();
    }
    if (el.dataset.t === 'note') current.note = el.value;
    if (el.dataset.t === 'group') current.group = el.value.trim();
    if (el.dataset.t === 'variant') current.variant = el.value.trim();
    if (el.name === 'tcolor') {
      current.color = el.value;
      await store.putTour(current);
      refreshMap();
      return;
    }
    if (el.dataset.t === 'autophotos' && el.files?.length) {
      const fb = Number(pane.querySelector('[data-t="fallback"]')?.value || 0);
      return autoAssignPhotos([...el.files], fb);
    }

    const st = station(el);
    if (st && el.dataset.s === 'name') st.name = el.value.trim() || st.name;
    if (st && el.dataset.s === 'photo' && el.files?.length) return addPhotos(st, [...el.files]);
    await store.putTour(current);
    refreshMap();
  });
}

export default {
  id: 'tours',
  title: 'Touren',
  icon: ICON,

  async mount(c) {
    ctx = c;
    wire(c.pane);
    window.addEventListener('ta:pin', (e) => pinStation(e.detail));
    // Aufnahmeort antippen → Foto öffnen
    c.map.on('click', 'tour-photos', (e) => {
      const f = e.features[0]?.properties;
      const st = current?.stations.find((x) => x.id === f?.station);
      if (st) openLightbox(st, f.id);
    });
    // Übersicht: Tour antippen öffnet sie.
    const openFromMap = (e) => {
      if (adding || current) return;
      const id = e.features[0]?.properties.tour;
      if (id) {
        c.openPane('tours');
        openTour(id);
      }
    };
    c.map.on('click', 'tour-line', openFromMap);
    c.map.on('click', 'tour-stations', openFromMap);
    c.map.on('click', 'tour-stations', (e) => {
      if (adding) return;
      const id = e.features[0]?.properties.id;
      const s = current?.stations.find((x) => x.id === id);
      if (!s) return;
      c.openPane('tours');
      c.pane.querySelector(`li[data-sid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    try {
      tours = await store.allTours();
    } catch (err) {
      c.toast(`Lokaler Speicher nicht verfügbar: ${err.message}`, { error: true, ttl: 8000 });
    }
    refreshMap();
    render();
  },

  onStyle(map) {
    addLayers(map);
  },

  onDeactivate() {
    if (adding) setAdding(false);
  },

  onMapClick(lngLat) {
    if (!adding || !current) return false;
    addStation(lngLat);
    return true;
  }
};
