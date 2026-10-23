/* global maplibregl */
// Touren-Paket: Touren mit mehreren Stationen, Routing entlang echter Wege,
// Fotos je Station mit gespeichertem 3D-Blick. Daten bleiben lokal auf dem Gerät.

import { ROUTER, brouterUrl, captureView, formatDuration, newStation, newTour, parseBrouter, tourGpx, tourLine, tourStats } from './tours-core.js';
import { blobToDataUrl, compressImage, dataUrlToBlob, requestPersistence, store } from './tours-store.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 17.5c4-1 2-6 6-7.5s2-2.5 2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.5 2.5"/></svg>';
const COLOR = '#d6007e';
const EMPTY = { type: 'FeatureCollection', features: [] };

let ctx = null;
let tours = [];
let current = null;
let adding = false;
let stats = null;
const thumbUrls = new Map();

// ---------- Kartenebenen ----------
function geo() {
  if (!current) return { line: EMPTY, stations: EMPTY };
  const st = current.stations;
  const lineFeatures = [];
  for (let i = 1; i < st.length; i++) {
    const seg = current.segments[i - 1];
    const routed = seg?.coords?.length >= 2;
    lineFeatures.push({
      type: 'Feature',
      properties: { routed },
      geometry: { type: 'LineString', coordinates: routed ? seg.coords : [st[i - 1].lngLat, st[i].lngLat] }
    });
  }
  return {
    line: { type: 'FeatureCollection', features: lineFeatures },
    stations: {
      type: 'FeatureCollection',
      features: st.map((s, i) => ({
        type: 'Feature',
        properties: { id: s.id, n: String(i + 1), name: s.name, photos: s.photos.length },
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
    paint: { 'line-color': COLOR, 'line-width': 4.5, 'line-dasharray': ['case', ['get', 'routed'], ['literal', [1, 0]], ['literal', [1.5, 1.5]]] }
  });
  map.addLayer({
    id: 'tour-stations',
    type: 'circle',
    source: 'tour-stations',
    paint: {
      'circle-radius': 11,
      'circle-color': COLOR,
      'circle-stroke-color': ['case', ['>', ['get', 'photos'], 0], '#ffd400', '#ffffff'],
      'circle-stroke-width': 3,
      // 'map': mit 3D-Gelände sonst im Test unsichtbar (viewport-Ausrichtung + Terrain).
      'circle-pitch-alignment': 'map'
    }
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
  const g = geo();
  ctx.map.getSource('tour-line')?.setData(g.line);
  ctx.map.getSource('tour-stations')?.setData(g.stations);
}

// ---------- Routing ----------
async function routeSegment(a, b) {
  if (current.mode !== 'route') return { coords: null };
  try {
    const res = await fetch(brouterUrl(a.lngLat, b.lngLat));
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
    current.segments[i] = await routeSegment(st[i], st[i + 1]);
  }
  const failed = current.segments.filter((s) => s?.error);
  if (failed.length) ctx.toast(`${failed.length} Abschnitt(e) als Luftlinie: ${failed[0].error}`, { error: true, ttl: 7000 });
  else ctx.toast('');
  await persist();
}

async function persist() {
  await store.putTour(current);
  stats = await tourStats(tourLine(current.stations, current.segments), ctx.sampler);
  current.summary = stats ? { length: stats.length, up: stats.up, timeH: stats.timeH } : null;
  await store.putTour(current);
  refreshMap();
  render();
}

// ---------- Stationen ----------
async function addStation(lngLat) {
  const s = newStation([lngLat.lng, lngLat.lat], current.stations.length + 1);
  s.ele = await ctx.sampler.elevation(s.lngLat);
  current.stations.push(s);
  refreshMap();
  if (current.stations.length > 1) await rebuildSegments([current.stations.length - 2]);
  else await persist();
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
async function addPhotos(station, files) {
  ctx.toast(`Speichere ${files.length} Foto(s) …`, { busy: true });
  const view = captureView(ctx.map);
  try {
    for (const file of files) {
      const big = await compressImage(file, 1600, 0.85);
      const small = await compressImage(file, 320, 0.75);
      const photo = { id: `${station.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, tourId: current.id, stationId: station.id, blob: big.blob, thumb: small.blob, w: big.w, h: big.h, name: file.name, created: new Date().toISOString(), view };
      await store.putPhoto(photo);
      station.photos.push(photo.id);
    }
    // Blick der Station: beim ersten Foto übernehmen, später nur auf Wunsch ("Blick speichern").
    if (!station.view) station.view = view;
    await persist();
    ctx.toast(`${files.length} Foto(s) mit 3D-Blick gespeichert`);
  } catch (err) {
    ctx.toast(`Foto nicht gespeichert: ${err.message}`, { error: true, ttl: 7000 });
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
      close();
      await persist();
    }
  });
  document.body.appendChild(box);
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
  if (on) ctx.toast('Tippe auf die Karte, um eine Station zu setzen', { ttl: 0 });
  else ctx.toast('');
}

function render() {
  const { pane, esc } = ctx;
  if (!current) {
    pane.innerHTML = `
      <div class="row"><button type="button" class="btn primary" data-t="new">+ Neue Tour</button>
        <label class="btn">Sicherung laden<input type="file" accept=".json,application/json" data-t="import" hidden></label></div>
      <ul class="tour-list">${
        tours
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .map(
            (t) => `<li><button type="button" data-open="${esc(t.id)}"><b>${esc(t.name)}</b>
              <small>${esc(t.date ? new Date(t.date).toLocaleDateString('de-DE') : '')} · ${t.stations.length} Stationen${
                t.summary ? ` · ${(t.summary.length / 1000).toFixed(1)} km · ${Math.round(t.summary.up)} Hm` : ''
              }</small></button></li>`
          )
          .join('') || '<li class="muted">Noch keine Touren. Lege die erste an.</li>'
      }</ul>
      <p class="muted">Touren und Fotos bleiben nur auf diesem Gerät. Safari löscht sie nach 7 Tagen ohne Besuch, ausser die App liegt auf dem Home-Bildschirm. Sicherung regelmässig exportieren.</p>`;
    return;
  }
  const t = current;
  const failed = t.segments.filter((s) => s?.error).length;
  pane.innerHTML = `
    <button type="button" class="link" data-t="back">‹ Alle Touren</button>
    <div class="row"><input data-t="name" value="${esc(t.name)}" aria-label="Name der Tour"><input type="date" data-t="date" value="${esc(t.date || '')}" aria-label="Datum"></div>
    <div class="seg" role="radiogroup" aria-label="Verbindung">
      <label><input type="radio" name="tmode" value="route" ${t.mode === 'route' ? 'checked' : ''}><span>Wegen folgen</span></label>
      <label><input type="radio" name="tmode" value="line" ${t.mode === 'line' ? 'checked' : ''}><span>Luftlinie</span></label>
    </div>
    <button type="button" class="btn primary wide ${adding ? 'on' : ''}" data-t="add">${adding ? 'Fertig mit Setzen' : '+ Station auf Karte setzen'}</button>
    ${
      stats
        ? `<dl class="stats"><dt>Länge</dt><dd>${(stats.length / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</dd>
           <dt>Auf / Ab</dt><dd>${Math.round(stats.up)} / ${Math.round(stats.down)} Hm</dd>
           <dt>Gehzeit (DIN 33466)</dt><dd>${formatDuration(stats.timeH)}</dd>
           <dt>Höhe</dt><dd>${Math.round(stats.min ?? 0)}–${Math.round(stats.max ?? 0)} m</dd></dl>`
        : ''
    }
    ${failed ? `<ul class="findings"><li class="warn">${failed} Abschnitt(e) nur Luftlinie – Wegführung nicht geprüft</li></ul>` : ''}
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
    <p class="muted">Tipp: erst den 3D-Blick einstellen, dann Foto hinzufügen – der Blick wird mit dem Foto gespeichert.</p>
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
    stats = await tourStats(tourLine(current.stations, current.segments), ctx.sampler);
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
  pane.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    const open = e.target.closest('[data-open]')?.dataset.open;
    const s = e.target.closest('[data-s]')?.dataset.s;
    const img = e.target.closest('img[data-pid]');
    if (open) return openTour(open);
    if (img) return openLightbox(station(img), img.dataset.pid);
    if (t === 'new') {
      current = newTour(`Tour ${new Date().toLocaleDateString('de-DE')}`);
      await store.putTour(current);
      tours = await store.allTours();
      current = tours.find((x) => x.id === current.id);
      stats = null;
      setAdding(true);
      render();
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
    if (!current) return;
    if (el.dataset.t === 'name') current.name = el.value.trim() || current.name;
    if (el.dataset.t === 'date') current.date = el.value;
    if (el.name === 'tmode') {
      current.mode = el.value;
      return rebuildSegments();
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
