/* global maplibregl */
import { REGION, SOURCES, SAC_SCALE, START_VIEW, VALIDATION } from './config.js';
import { DemSampler } from './dem.js';
import { fetchOverpass } from './overpass.js';
import { cellBbox, cellsForView } from './cells.js';
import { profileWay, qualitySummary, validatePeaks } from './validate.js';
import { aerialStyle, openFreeMapStyle, protomapsStyle } from './styles.js';
import { openPmtiles } from './offline.js';
import { PACKAGES } from './packages/index.js';
import { initSearch } from './search.js';
import { padBbox, prefetch, tileUrl, tilesForBbox } from './offline-area.js';
import { cellInBbox, loadRegionIndex } from './region.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtM = (v) => (v == null ? '–' : `${Math.round(v).toLocaleString('de-DE')} m`);
const fmtKm = (v) => `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km`;
const EMPTY = { type: 'FeatureCollection', features: [] };
const isPhone = window.matchMedia('(max-width: 899px)').matches;

const sampler = new DemSampler({ template: SOURCES.terrain.tiles[0], zoom: VALIDATION.demZoom });

// Zustand, der einen Stilwechsel überleben muss.
const state = {
  base: 'openfreemap',
  pmtilesUrl: null,
  terrain: true,
  exaggeration: 1.3,
  visibility: { hillshade: true, ways: true, bikeroutes: true, lifts: true, peaks: true },
  data: { ways: EMPTY, points: EMPTY, bikeroutes: EMPTY, selected: EMPTY }
};
const sourceState = { openfreemap: 'idle', protomaps: 'idle', terrain: 'idle', trails: 'idle', imagery: 'idle' };

// ---------- Statusmeldung ----------
let toastTimer = null;
function toast(text, { busy = false, error = false, ttl = busy ? 0 : 4000 } = {}) {
  const el = $('toast');
  clearTimeout(toastTimer);
  if (!text) {
    el.hidden = true;
    return;
  }
  el.textContent = text;
  el.className = `${busy ? 'busy' : ''} ${error ? 'error' : ''}`;
  el.hidden = false;
  if (ttl) toastTimer = setTimeout(() => (el.hidden = true), ttl);
}

// ---------- Karte ----------
if (!window.maplibregl) throw new Error('MapLibre GL konnte nicht geladen werden');

// Handy-Akku: 3D-Rendering kostet pro Pixel. Ab 2× Pixeldichte sieht man kaum Unterschied,
// 3× (iPhone) bedeutet aber 2,25× so viele Pixel. Energiesparmodus: 1,25×, ohne Schummerung.
let ecoMode = false;
try {
  ecoMode = localStorage.getItem('ta.eco') === '1';
} catch {}
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, ecoMode ? 1.25 : 2);

const map = new maplibregl.Map({
  container: 'map',
  pixelRatio: pixelRatio(),
  fadeDuration: 150,
  style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dde3e6' } }] },
  ...START_VIEW,
  maxPitch: 85,
  hash: true,
  attributionControl: false
});

/** Eigene Knöpfe an der Karte: zurück ins Allgäu, 3D an/aus. */
class AtlasControl {
  onAdd() {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group ta-ctrl';
    el.innerHTML = '<button type="button" data-c="home" title="Zurück ins Allgäu">⌂</button><button type="button" data-c="3d" title="3D an/aus" aria-pressed="true">3D</button>';
    el.querySelector('[data-c="home"]').addEventListener('click', () => map.flyTo({ ...START_VIEW, duration: 2500, essential: true }));
    el.querySelector('[data-c="3d"]').addEventListener('click', () => setTerrain(!state.terrain));
    this.el = el;
    return el;
  }
  onRemove() {
    this.el.remove();
  }
}

// Smartphone: Quellenangabe kompakt (ⓘ), vollständig unter Info.
map.addControl(new maplibregl.AttributionControl({ compact: isPhone }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new AtlasControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');

async function applyStyle() {
  const opts = { terrain: state.terrain, exaggeration: state.exaggeration, visibility: state.visibility, labelScale: isPhone ? 1.3 : 1.1 };
  try {
    let style;
    if (state.base === 'protomaps') style = protomapsStyle(state.pmtilesUrl, state.data, opts);
    else if (state.base === 'aerial') style = await aerialStyle(state.data, opts);
    else style = await openFreeMapStyle(state.data, opts);
    map.setStyle(style, { diff: false });
  } catch (err) {
    const id = state.base === 'protomaps' ? 'protomaps' : 'openfreemap';
    setSourceState(id, 'err', err.message);
    toast(`Grundkarte konnte nicht geladen werden: ${err.message}`, { error: true, ttl: 0 });
  }
}

map.on('style.load', () => {
  for (const p of PACKAGES) p.onStyle?.(map);
});
applyStyle();
map.once('style.load', scheduleLoad);

function setTerrain(on) {
  state.terrain = on;
  $('terrain').checked = on;
  document.querySelector('.ta-ctrl [data-c="3d"]')?.setAttribute('aria-pressed', String(on));
  map.setTerrain(on ? { source: 'terrain', exaggeration: state.exaggeration } : null);
  map.easeTo({ pitch: on ? Math.max(map.getPitch(), 55) : 0, duration: 800 });
}

// ---------- Quellenstatus ----------
const SOURCE_OF = (id) => {
  if (!id) return null;
  if (id === 'terrain' || id === 'hillshade') return 'terrain';
  if (id.startsWith('imagery')) return 'imagery';
  if (id === 'protomaps') return 'protomaps';
  if (id === 'openmaptiles' || id === 'ne2_shaded' || id === 'natural_earth') return 'openfreemap';
  return null;
};

map.on('data', (e) => {
  if (e.dataType !== 'source' || !e.tile) return;
  const id = SOURCE_OF(e.sourceId);
  if (id && sourceState[id] !== 'ok') setSourceState(id, 'ok');
});
map.on('error', (e) => {
  const id = SOURCE_OF(e.sourceId);
  // Luftbild: Kacheln ausserhalb von BY/AT dürfen fehlen – nur melden, wenn nichts lädt.
  if (id === 'imagery' && sourceState.imagery === 'ok') return;
  if (id) setSourceState(id, 'err', e.error?.message);
  else console.error(e.error || e);
});

function setSourceState(id, st, detail) {
  if (sourceState[id] === st && !detail) return;
  sourceState[id] = st;
  renderSources(id, detail);
}

function renderSources(changed, detail) {
  const label = { ok: 'aktiv', err: 'Fehler', idle: '–' };
  $('sources').innerHTML = Object.values(SOURCES)
    .map((s) => {
      const st = sourceState[s.id];
      const extra = s.id === changed && detail ? `<br><small>${esc(detail)}</small>` : '';
      return `<li><span class="state ${st}">${label[st]}</span><b>${esc(s.name)}</b>
        Lizenz: <a href="${s.licenseUrl}" target="_blank" rel="noopener">${esc(s.license)}</a>${extra}</li>`;
    })
    .join('');
}

// ---------- OSM-Wege live (Overpass, in Zellen) ----------
const cells = new Map(); // key → { ways, peaks } | 'pending'
const MAX_CELLS_CACHED = 80;
let loadTimer = null;
let loadGen = 0;
let zoomHintShown = false;

// Vorab berechnete Regionsdaten (falls vorhanden): Zellen kommen dann als statische Datei statt live von Overpass.
let region = null;
const regionReady = loadRegionIndex().then((idx) => {
  region = idx;
  if (idx) {
    setSourceState('trails', 'ok', `Regionsdaten vom ${new Date(idx.osmBase || idx.generated).toLocaleDateString('de-DE')} (${idx.counts?.ways ?? '?'} Wege)`);
    // Alte Generationen aus dem Gerätespeicher entfernen
    caches?.open('ta-cells-v1').then((c) => c.keys().then((ks) => ks.filter((r) => !r.url.includes(`/${idx.gen}/`)).forEach((r) => c.delete(r)))).catch(() => {});
  }
  return idx;
});

/** Eine Zelle laden: Regionsdatei (schnell, offline) – sonst live über Overpass. */
async function fetchCell(key) {
  await regionReady;
  const t = SOURCES.trails;
  const sameGrid = region && region.cellDeg[0] === t.cellDeg[0] && region.cellDeg[1] === t.cellDeg[1];
  if (sameGrid && region.set.has(key)) {
    // Auch Randzellen, deren Mitte knapp ausserhalb liegt: vorhandene Datei immer bevorzugen.
    const res = await fetch(region.url(key));
    if (res.ok) return { ...(await res.json()), meta: { osmBase: region.osmBase }, endpoint: 'Regionsdaten' };
  } else if (sameGrid && cellInBbox(key, t.cellDeg, region.bbox)) {
    // In der Region, aber ohne Datei: dort gibt es keine Wege (leere Zellen werden nicht gespeichert).
    return { ways: EMPTY, peaks: EMPTY, routes: EMPTY, meta: { osmBase: region.osmBase }, endpoint: 'Regionsdaten' };
  }
  return fetchOverpass(cellBbox(key, t.cellDeg), t.endpoints, undefined, t.timeoutMs);
}

map.on('moveend', scheduleLoad);

function scheduleLoad() {
  clearTimeout(loadTimer);
  // Im Hintergrund (App nicht sichtbar) nichts nachladen.
  if (document.hidden) return;
  loadTimer = setTimeout(loadWays, 500);
}
document.addEventListener('visibilitychange', () => !document.hidden && scheduleLoad());

/** Alle geladenen Zellen zu einem Datensatz zusammenführen (Wege an Zellgrenzen nur einmal). */
function rebuildData() {
  const ways = new Map();
  const points = new Map();
  const routes = [];
  for (const c of cells.values()) {
    if (c === 'pending') continue;
    for (const f of c.ways.features) ways.set(f.properties.osm_id, f);
    for (const f of c.peaks.features) points.set(f.properties.osm_id, f);
    // Radrouten sind je Zelle beschnitten: Teilstücke aneinanderreihen, nicht ersetzen.
    routes.push(...(c.routes?.features || []));
  }
  state.data.bikeroutes = { type: 'FeatureCollection', features: routes };
  map.getSource('bikeroutes')?.setData(state.data.bikeroutes);
  state.data.ways = { type: 'FeatureCollection', features: [...ways.values()] };
  state.data.points = { type: 'FeatureCollection', features: [...points.values()] };
  map.getSource('ways')?.setData(state.data.ways);
  map.getSource('points')?.setData(state.data.points);
}

async function loadWays() {
  const t = SOURCES.trails;
  if (map.getZoom() < t.minZoom) {
    // Hinweis nur einmal – sonst verdeckt er bei jeder Bewegung die Karte.
    if (!zoomHintShown) toast('Für farbige Bergwege näher heranzoomen', { ttl: 3000 });
    zoomHintShown = true;
    return;
  }
  const b = map.getBounds();
  const c = map.getCenter();
  // Handy: weniger Zellen je Bewegung (Akku, Datenvolumen); Energiesparmodus noch weniger.
  const maxCells = ecoMode ? 6 : isPhone ? 9 : t.maxCells;
  const wanted = cellsForView([c.lng, c.lat], [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], t.cellDeg, t.radiusKm, maxCells);
  const todo = wanted.filter((k) => !cells.has(k));
  if (!todo.length) return;

  const gen = ++loadGen;
  let done = 0;
  let failed = 0;
  let lastErr = null;
  let osmBase = null;
  // Aus Regionsdaten kommt alles in Sekundenbruchteilen – dann keine Ladeanzeige (ruhigeres Bild).
  const quiet = !!region;
  if (!quiet) toast(`Lade Bergwege … 0/${todo.length}`, { busy: true });

  const worker = async () => {
    while (todo.length && gen === loadGen) {
      const key = todo.shift();
      cells.set(key, 'pending');
      try {
        const res = await fetchCell(key);
        cells.set(key, { ways: res.ways, peaks: res.peaks, routes: res.routes });
        osmBase = res.meta.osmBase || osmBase;
        setSourceState('trails', 'ok', `Server: ${res.endpoint}`);
        rebuildData();
        validatePeaks(res.peaks, sampler).then(() => {
          map.getSource('points')?.setData(state.data.points);
          renderQuality();
        });
      } catch (err) {
        cells.delete(key); // beim nächsten Verschieben erneut versuchen
        failed++;
        lastErr = err;
      }
      done++;
      if (gen === loadGen && !quiet) toast(`Lade Bergwege … ${done}/${done + todo.length}`, { busy: true });
    }
  };
  // Regionsdateien kommen vom eigenen Server/Cache → mehr parallel; Overpass schonend mit 2.
  await Promise.all(Array.from({ length: region ? 6 : t.concurrency }, worker));
  if (gen !== loadGen) return;

  // Speicher begrenzen: älteste Zellen verwerfen.
  while (cells.size > MAX_CELLS_CACHED) cells.delete(cells.keys().next().value);
  renderQuality();
  if (failed && failed === done) {
    setSourceState('trails', 'err', lastErr?.message);
    toast(`Bergwege nicht geladen: ${lastErr?.message}. Karte verschieben zum erneuten Versuch.`, { error: true, ttl: 8000 });
  } else if (failed) {
    toast(`${done - failed}/${done} Bereiche geladen, ${failed} fehlgeschlagen (${lastErr?.message})`, { error: true, ttl: 6000 });
  } else if (!quiet) {
    const base = osmBase ? new Date(osmBase).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '';
    toast(`Bergwege geladen${base ? ` · OSM-Stand ${base}` : ''}`);
  }
}

function renderQuality() {
  const q = qualitySummary(state.data.ways, state.data.points);
  const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
  const rows = [
    ['Wege', `${q.ways} (${q.km.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km)`],
    ['mit SAC-Skala', `${pct(q.sacShare)} der Pfade`],
    ['Lifte / Hütten', `${q.lifts} / ${q.huts}`],
    ['Median Datenalter', q.medianAgeYears == null ? '–' : `${q.medianAgeYears.toFixed(1)} Jahre`],
    ['Gipfel OSM↔DEM', q.peaksChecked ? `${q.peaksChecked} geprüft, ${q.peaksWarn} auffällig` : `${q.peaks} (Prüfung läuft)`],
    ['Median |Δ Höhe|', q.peakMedianAbsDelta == null ? '–' : `${q.peakMedianAbsDelta} m`]
  ];
  $('quality').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

// ---------- Menü: Tab-Leiste + Blatt ----------
let activePane = null;

function openPane(name, title) {
  const pane = document.querySelector(`.pane[data-pane="${name}"]`);
  if (!pane) return;
  const prev = activePane;
  if (prev && prev !== name) PACKAGES.find((p) => p.id === prev)?.onDeactivate?.();
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p === pane));
  document.querySelectorAll('#tabbar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === name)));
  $('sheet-title').textContent = title || pane.dataset.title;
  $('sheet').hidden = false;
  setSheetPeek(false);
  $('sheet-body').scrollTop = 0;
  activePane = name;
  if (prev !== name) PACKAGES.find((p) => p.id === name)?.onActivate?.();
}

/** Blatt auf die Kopfzeile einklappen (Karte frei) oder wieder aufklappen. */
function setSheetPeek(peek) {
  $('sheet').classList.toggle('peek', peek);
  $('sheet-grip').setAttribute('aria-expanded', String(!peek));
}

function closeSheet() {
  PACKAGES.find((p) => p.id === activePane)?.onDeactivate?.();
  $('sheet').hidden = true;
  document.querySelectorAll('#tabbar button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  activePane = null;
}

// Pakete einhängen: eigener Tab (vor "Info") + eigenes Blatt.
for (const p of PACKAGES) {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.dataset.pane = p.id;
  pane.dataset.title = p.title;
  $('sheet-body').appendChild(pane);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.tab = p.id;
  btn.innerHTML = `${p.icon}<span>${esc(p.title)}</span>`;
  $('tabbar').insertBefore(btn, $('tabbar').querySelector('[data-tab="info"]'));
  p.mount({ map, pane, sampler, toast, esc, openPane, setSheetPeek, saveOffline });
}

initSearch({ map, toast, esc });

$('tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  if (activePane === btn.dataset.tab) closeSheet();
  else openPane(btn.dataset.tab);
});
$('sheet-close').addEventListener('click', closeSheet);
$('sheet-grip').addEventListener('click', () => setSheetPeek(!$('sheet').classList.contains('peek')));
$('sheet-title').addEventListener('click', () => setSheetPeek(!$('sheet').classList.contains('peek')));

// ---------- Interaktion auf der Karte ----------
for (const layer of ['ways', 'lifts', 'peaks', 'huts']) {
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
}

const prop = (v) => (v == null || v === 'null' ? null : v);

function pointPopup(f, lngLat) {
  const p = f.properties;
  let html;
  if (p.kind === 'peak') {
    html = `<b>${esc(prop(p.name) ?? 'Gipfel ohne Namen')}</b><br>
      OSM: ${prop(p.ele_raw) ? esc(p.ele_raw) + ' m' : '–'} · DEM: ${prop(p.ele_dem) != null ? esc(p.ele_dem) + ' m' : '–'}<br>
      <small>${esc(prop(p.check_text) ?? 'Prüfung läuft …')}</small>`;
  } else {
    const kind = p.kind === 'alpine_hut' ? 'Berghütte (bewirtschaftet)' : 'Unbewirtschaftete Hütte';
    html = `<b>${esc(prop(p.name) ?? kind)}</b><br>${esc(kind)}${prop(p.ele_raw) ? ` · ${esc(p.ele_raw)} m` : ''}`;
  }
  new maplibregl.Popup({ maxWidth: '260px' })
    .setLngLat(lngLat)
    .setHTML(`${html}<br><a href="https://www.openstreetmap.org/node/${esc(p.osm_id)}" target="_blank" rel="noopener">OSM-Objekt</a>`)
    .addTo(map);
}

map.on('click', (e) => {
  // Aktives Paket (z. B. Wetter) bekommt den Klick zuerst.
  const pkg = PACKAGES.find((p) => p.id === activePane);
  if (pkg?.onMapClick?.(e.lngLat)) return;
  // ±10 px Toleranz: dünne Linien sind sonst mit dem Finger kaum zu treffen.
  const { x, y } = e.point;
  const box = [[x - 10, y - 10], [x + 10, y + 10]];
  const layers = (ids) => ids.filter((l) => map.getLayer(l));
  const pt = map.queryRenderedFeatures(box, { layers: layers(['peaks', 'huts']) })[0];
  if (pt) return pointPopup(pt, e.lngLat);
  const hit = map.queryRenderedFeatures(box, { layers: layers(['ways', 'lifts']) })[0];
  if (!hit) return;
  // Klick-Features sind gekachelt/vereinfacht – Originalgeometrie aus dem geladenen Datensatz holen.
  const feature = state.data.ways.features.find((f) => f.properties.osm_id === hit.properties.osm_id);
  if (feature) selectWay(feature);
});

let selectionToken = 0;
let current = null;
const cursorMarker = new maplibregl.Marker({ color: '#00e5ff', scale: 0.6 });

async function selectWay(feature) {
  const token = ++selectionToken;
  state.data.selected = feature;
  map.getSource('selected')?.setData(feature);
  showSelection(feature);
  const result = await profileWay(feature, sampler);
  if (token !== selectionToken) return;
  current = { feature, ...result };
  renderProfile(result);
}

function showSelection(f) {
  const p = f.properties;
  const fallback = p.aerialway ? `Lift ${p.osm_id}` : p.ref ? `Weg ${p.ref}` : `Weg ${p.osm_id}`;
  openPane('way', p.name || fallback);
  const tagKeys = ['highway', 'aerialway', 'sac_scale', 'mtb:scale', 'trail_visibility', 'surface', 'tracktype', 'incline', 'access', 'foot', 'bicycle'];
  const sac = p.sac_scale && SAC_SCALE[p.sac_scale] ? ` – ${SAC_SCALE[p.sac_scale].label}` : '';
  $('sel-tags').innerHTML =
    tagKeys.filter((k) => p[k]).map((k) => `<code>${esc(k)}=${esc(p[k])}</code>`).join('') + esc(sac) +
    `<br>Version ${esc(p.version ?? '–')}, zuletzt bearbeitet ${p.timestamp ? esc(new Date(p.timestamp).toLocaleDateString('de-DE')) : '–'}`;
  $('sel-osm').href = `https://www.openstreetmap.org/way/${p.osm_id}`;
  $('profile').innerHTML = '<text x="150" y="58" text-anchor="middle">Profil wird aus dem DEM berechnet …</text>';
  $('sel-stats').innerHTML = '';
  $('sel-findings').innerHTML = '';
}

function renderProfile({ profile, stats, findings }) {
  const svg = $('profile');
  const pts = profile.filter((p) => p.ele != null);
  if (pts.length < 2) {
    svg.innerHTML = '<text x="150" y="58" text-anchor="middle">Keine Höhendaten verfügbar</text>';
  } else {
    const W = 300;
    const H = 110;
    const pad = 12;
    const dMax = pts[pts.length - 1].dist || 1;
    // Mindestens 50 m vertikale Spanne, damit flache Wege nicht dramatisch wirken.
    const span = Math.max(50, stats.max - stats.min);
    const lo = (stats.max + stats.min) / 2 - span / 2;
    const x = (d) => (d / dMax) * W;
    const y = (e) => H - pad - ((e - lo) / span) * (H - 2 * pad);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.dist).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
    svg.innerHTML = `<path class="area" d="${line}L${W},${H}L0,${H}Z"/><path class="line" d="${line}"/>
      <text x="3" y="10">${Math.round(stats.max)} m</text><text x="3" y="${H - 2}">${Math.round(stats.min)} m</text>
      <line class="cursor" x1="-10" x2="-10" y1="0" y2="${H}"/>`;
  }
  const rows = [
    ['Länge', fmtKm(stats.length)],
    ['Aufstieg / Abstieg', `${fmtM(stats.up)} / ${fmtM(stats.down)}`],
    ['Höhe min / max', `${fmtM(stats.min)} / ${fmtM(stats.max)}`],
    ['Max. Steigung (50 m)', `${stats.maxGrade.toFixed(0)} %`]
  ];
  $('sel-stats').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('sel-findings').innerHTML = findings.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('');
}

function profileCursor(ev) {
  if (!current) return;
  const rect = $('profile').getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
  const prof = current.profile;
  const target = t * prof[prof.length - 1].dist;
  const p = prof.reduce((best, q) => (Math.abs(q.dist - target) < Math.abs(best.dist - target) ? q : best), prof[0]);
  cursorMarker.setLngLat(p.coord).addTo(map);
  const line = $('profile').querySelector('line.cursor');
  if (line) {
    line.setAttribute('x1', t * 300);
    line.setAttribute('x2', t * 300);
  }
}
$('profile').addEventListener('pointermove', profileCursor);
$('profile').addEventListener('pointerdown', profileCursor);
$('profile').addEventListener('pointerleave', () => cursorMarker.remove());

$('sel-gpx').addEventListener('click', async () => {
  if (!current) return;
  const { feature } = current;
  const coords = feature.geometry.coordinates;
  const eles = await sampler.elevations(coords);
  const name = feature.properties.name || `OSM way ${feature.properties.osm_id}`;
  const trkpts = coords
    .map(([lon, lat], i) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${eles[i] != null ? `<ele>${eles[i].toFixed(1)}</ele>` : ''}</trkpt>`)
    .join('\n      ');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Allgäu Tourenatlas 3D" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(name)}</name>
    <desc>Geometrie: OpenStreetMap way ${feature.properties.osm_id} (Version ${feature.properties.version ?? '?'}). Höhen: Terrain Tiles DEM, Zoom ${VALIDATION.demZoom}.</desc>
    <copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>
    <link href="https://www.openstreetmap.org/way/${feature.properties.osm_id}"/>
  </metadata>
  <trk><name>${esc(name)}</name><trkseg>
      ${trkpts}
  </trkseg></trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `tourenatlas-way-${feature.properties.osm_id}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Steuerung ----------
const LAYER_GROUPS = { hillshade: ['hillshade'], bikeroutes: ['bikeroutes', 'bikeroute-labels'], ways: ['ways-casing', 'ways', 'selected'], lifts: ['lifts'], peaks: ['peaks', 'huts', 'peak-labels', 'peak-labels-overview'] };

document.querySelectorAll('input[data-layer]').forEach((cb) => {
  cb.addEventListener('change', () => {
    state.visibility[cb.dataset.layer] = cb.checked;
    for (const id of LAYER_GROUPS[cb.dataset.layer]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', cb.checked ? 'visible' : 'none');
    }
  });
});

document.querySelectorAll('input[name="base"]').forEach((r) => {
  r.addEventListener('change', () => {
    if (!r.checked) return;
    state.base = r.value;
    applyStyle();
  });
});

$('terrain').addEventListener('change', (e) => setTerrain(e.target.checked));

function applyEco(on) {
  ecoMode = on;
  try {
    localStorage.setItem('ta.eco', on ? '1' : '0');
  } catch {}
  map.setPixelRatio(pixelRatio());
  state.visibility.hillshade = !on;
  $('eco').checked = on;
  document.querySelector('input[data-layer="hillshade"]').checked = !on;
  if (map.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', on ? 'none' : 'visible');
}
$('eco').addEventListener('change', (e) => {
  applyEco(e.target.checked);
  toast(e.target.checked ? 'Energiesparmodus: geringere Pixeldichte, ohne Schummerung, weniger Nachladen' : 'Energiesparmodus aus');
});
if (ecoMode) applyEco(true);

$('exaggeration').addEventListener('input', (e) => {
  state.exaggeration = Number(e.target.value);
  $('exaggeration-val').textContent = `${state.exaggeration.toFixed(1)}×`;
  if (state.terrain && map.getTerrain()) map.setTerrain({ source: 'terrain', exaggeration: state.exaggeration });
});

$('region').addEventListener('click', () => {
  closeSheet();
  map.fitBounds(REGION.bbox, { pitch: 0, bearing: 0, padding: 20 });
});

// ---------- Offline: Protomaps PMTiles ----------
async function usePmtiles(input, label) {
  $('pm-findings').innerHTML = `<li class="info">Prüfe ${esc(label)} …</li>`;
  try {
    const res = await openPmtiles(input);
    $('pm-findings').innerHTML =
      `<li class="ok">${esc(label)} · ${esc(res.info)}</li>` + res.findings.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('');
    if (!res.usable) {
      setSourceState('protomaps', 'err', 'Datei nicht nutzbar (siehe Offline-Prüfung)');
      return;
    }
    state.pmtilesUrl = res.url;
    const radio = document.querySelector('input[name="base"][value="protomaps"]');
    radio.disabled = false;
    radio.checked = true;
    state.base = 'protomaps';
    applyStyle();
  } catch (err) {
    $('pm-findings').innerHTML = `<li class="warn">${esc(err.message)}</li>`;
    setSourceState('protomaps', 'err', err.message);
  }
}

$('pm-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) usePmtiles(file, file.name);
});

$('pm-url-go').addEventListener('click', () => {
  const url = $('pm-url').value.trim();
  if (/^https:\/\/\S+\.pmtiles$/i.test(url)) usePmtiles(url, new URL(url).pathname.split('/').pop());
  else $('pm-findings').innerHTML = '<li class="warn">Bitte eine https-Adresse auf eine .pmtiles-Datei angeben</li>';
});

$('pm-cmd').textContent =
  `pmtiles extract https://build.protomaps.com/JJJJMMTT.pmtiles allgaeu.pmtiles --bbox=${REGION.bbox.join(',')} --maxzoom=15`;
$('pm-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('pm-cmd').textContent);
    $('pm-copy').textContent = 'Kopiert';
  } catch {
    $('pm-copy').textContent = 'Bitte manuell kopieren';
  }
});

$('legend').innerHTML =
  Object.values(SAC_SCALE).map((s) => `<li><i style="background:${s.color}"></i>${esc(s.label)}</li>`).join('') +
  '<li><i style="background:#ffffff;outline:1px solid #999"></i>Pfad ohne SAC</li>' +
  '<li><i style="background:#c8a27a"></i>Fahrweg (track)</li>' +
  '<li><i style="background:#7cb342"></i>Radweg</li>' +
  '<li><i style="background:#1e5fd0;opacity:.5;height:7px"></i>Radroute national</li>' +
  '<li><i style="background:#7b3fb5;opacity:.5;height:7px"></i>Radroute regional</li>' +
  '<li><i style="background:#16a39a;opacity:.5;height:7px"></i>Radroute lokal</li>' +
  '<li><i style="background:#c0661b;opacity:.5;height:7px"></i>MTB-Route</li>' +
  '<li><i style="background:#8e24aa"></i>Klettersteig</li>' +
  '<li><i style="background:repeating-linear-gradient(90deg,#111 0 8px,transparent 8px 10px)"></i>Seilbahn/Lift</li>' +
  '<li><i class="dot" style="background:#8d4e1f"></i>Hütte</li>' +
  '<li><i class="dot" style="background:#1e8e3e"></i>Gipfel OSM≈DEM</li>' +
  '<li><i class="dot" style="background:#e3b341"></i>Gipfel Δ erklärbar</li>' +
  '<li><i class="dot" style="background:#e53935"></i>Gipfel Δ auffällig</li>';

// ---------- Offline ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline-Modus nicht verfügbar:', err));
}
window.addEventListener('offline', () => toast('Offline – gespeicherte Karten und Touren bleiben nutzbar; Suche, Routing und Wetter brauchen Netz', { ttl: 7000 }));
window.addEventListener('online', () => toast('Wieder online'));

const MAX_OFFLINE_TILES = 4000;

/**
 * Gebiet offline speichern: Vektorkarte (Zoom 8–14), Höhenmodell (8–13), Schriften, Bergwege/Radrouten (Overpass-Zellen).
 * Die Antworten speichert der Service Worker; hier wird nur gezielt vorab geladen.
 */
async function saveOffline(bbox, label) {
  if (!navigator.serviceWorker?.controller) {
    return toast('Offline-Speicher noch nicht bereit – Seite einmal neu laden und erneut versuchen', { error: true, ttl: 7000 });
  }
  const area = padBbox(bbox, 1);
  const urls = [];
  try {
    const style = map.getStyle();
    const omt = style.sources?.openmaptiles;
    if (omt?.url) {
      const tj = await (await fetch(omt.url)).json();
      if (tj.tiles?.[0]) urls.push(...tilesForBbox(area, 8, Math.min(14, tj.maxzoom ?? 14)).map((t) => tileUrl(tj.tiles[0], t)));
    }
    urls.push(...tilesForBbox(area, 8, SOURCES.terrain.maxzoom).map((t) => tileUrl(SOURCES.terrain.tiles[0], t)));
    if (style.glyphs) {
      for (const font of ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']) {
        for (const range of ['0-255', '256-511', '8192-8447']) urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', range));
      }
    }
  } catch (err) {
    return toast(`Offline-Speichern nicht möglich: ${err.message}`, { error: true, ttl: 7000 });
  }
  if (urls.length > MAX_OFFLINE_TILES) {
    return toast(`Gebiet zu gross (${urls.length} Kacheln, max. ${MAX_OFFLINE_TILES}) – näher heranzoomen oder Tour kürzer wählen`, { error: true, ttl: 8000 });
  }
  try {
    await navigator.storage?.persist?.();
  } catch {}
  toast(`Speichere ${label} offline … 0/${urls.length}`, { busy: true, ttl: 0 });
  const r = await prefetch(urls, { onProgress: (d, n) => d % 25 === 0 && toast(`Speichere ${label} offline … ${d}/${n}`, { busy: true, ttl: 0 }) });
  // Bergwege und Radrouten der Zellen im Gebiet
  const t = SOURCES.trails;
  const keys = [];
  for (let x = Math.floor(area[0] / t.cellDeg[0]); x <= Math.floor(area[2] / t.cellDeg[0]); x++) {
    for (let y = Math.floor(area[1] / t.cellDeg[1]); y <= Math.floor(area[3] / t.cellDeg[1]); y++) keys.push(`${x}:${y}`);
  }
  let cellsOk = 0;
  for (const [i, key] of keys.slice(0, 80).entries()) {
    toast(`Speichere Bergwege offline … ${i + 1}/${Math.min(keys.length, 80)}`, { busy: true, ttl: 0 });
    try {
      const res = await fetchCell(key);
      if (!cells.has(key) || cells.get(key) === 'pending') cells.set(key, { ways: res.ways, peaks: res.peaks, routes: res.routes });
      cellsOk++;
    } catch {}
  }
  rebuildData();
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const mb = est?.usage ? ` · belegt ${(est.usage / 1e6).toFixed(0)} MB` : '';
  toast(`${label} offline: ${r.ok} Kacheln, ${cellsOk}/${Math.min(keys.length, 80)} Wege-Bereiche${r.failed ? `, ${r.failed} fehlgeschlagen` : ''}${mb}`, { error: r.failed > 0, ttl: 9000 });
}

/** Ganze Region: alle Wege-Zellen + Karte/Höhen bis Zoom 12 (Übersicht). Details je Tour: "Tour offline speichern". */
async function saveRegionOffline() {
  await regionReady;
  if (!region) return toast('Regionsdaten noch nicht verfügbar – bitte später erneut versuchen', { error: true, ttl: 6000 });
  if (!navigator.serviceWorker?.controller) return toast('Offline-Speicher noch nicht bereit – Seite einmal neu laden', { error: true, ttl: 6000 });
  try {
    await navigator.storage?.persist?.();
  } catch {}
  const urls = region.cells.map((k) => region.url(k));
  const style = map.getStyle();
  try {
    const omt = style.sources?.openmaptiles;
    if (omt?.url) {
      const tj = await (await fetch(omt.url)).json();
      if (tj.tiles?.[0]) urls.push(...tilesForBbox(region.bbox, 6, 12).map((t) => tileUrl(tj.tiles[0], t)));
    }
  } catch {}
  urls.push(...tilesForBbox(region.bbox, 6, 12).map((t) => tileUrl(SOURCES.terrain.tiles[0], t)));
  toast(`Speichere Region offline … 0/${urls.length}`, { busy: true, ttl: 0 });
  const r = await prefetch(urls, { concurrency: 8, onProgress: (d, n) => d % 50 === 0 && toast(`Speichere Region offline … ${d}/${n}`, { busy: true, ttl: 0 }) });
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  toast(`Region offline: ${r.ok} Dateien${r.failed ? `, ${r.failed} fehlgeschlagen` : ''}${est?.usage ? ` · belegt ${(est.usage / 1e6).toFixed(0)} MB` : ''}`, { error: r.failed > 0, ttl: 9000 });
}
$('offline-region').addEventListener('click', saveRegionOffline);

$('offline-view').addEventListener('click', () => {
  const b = map.getBounds();
  saveOffline([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], 'Ausschnitt');
});

renderSources();
