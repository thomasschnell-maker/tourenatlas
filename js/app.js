/* global maplibregl */
import { REGION, SOURCES, SAC_SCALE, START_VIEW, VALIDATION } from './config.js';
import { DemSampler } from './dem.js';
import { fetchOverpass } from './overpass.js';
import { bboxAreaKm2 } from './geo.js';
import { profileWay, qualitySummary, validatePeaks } from './validate.js';
import { aerialStyle, openFreeMapStyle, protomapsStyle } from './styles.js';
import { openPmtiles } from './offline.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtM = (v) => (v == null ? '–' : `${Math.round(v).toLocaleString('de-DE')} m`);
const fmtKm = (v) => `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km`;
const EMPTY = { type: 'FeatureCollection', features: [] };

const sampler = new DemSampler({ template: SOURCES.terrain.tiles[0], zoom: VALIDATION.demZoom });

// Zustand, der einen Stilwechsel überleben muss.
const state = {
  base: 'openfreemap',
  pmtilesUrl: null,
  terrain: true,
  exaggeration: 1.3,
  visibility: { hillshade: true, ways: true, lifts: true, peaks: true },
  data: { ways: EMPTY, points: EMPTY, selected: EMPTY }
};
const sourceState = { openfreemap: 'idle', protomaps: 'idle', terrain: 'idle', trails: 'idle', imagery: 'idle' };

// ---------- Karte ----------
if (!window.maplibregl) throw new Error('MapLibre GL konnte nicht geladen werden');

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dde3e6' } }] },
  ...START_VIEW,
  maxPitch: 85,
  hash: true,
  attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-left');

async function applyStyle() {
  const opts = { terrain: state.terrain, exaggeration: state.exaggeration, visibility: state.visibility };
  try {
    let style;
    if (state.base === 'protomaps') style = protomapsStyle(state.pmtilesUrl, state.data, opts);
    else if (state.base === 'aerial') style = await aerialStyle(state.data, opts);
    else style = await openFreeMapStyle(state.data, opts);
    map.setStyle(style, { diff: false });
    if (state.base !== 'aerial') setSourceState(state.base, 'idle');
  } catch (err) {
    const id = state.base === 'protomaps' ? 'protomaps' : 'openfreemap';
    setSourceState(id, 'err', err.message);
    setStatus(`Grundkarte konnte nicht geladen werden: ${err.message}`, true);
  }
}

applyStyle();
map.once('style.load', scheduleLoad);

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

// ---------- OSM-Wege live (Overpass) ----------
let loadedBbox = null;
let loadTimer = null;
let inflight = null;

map.on('moveend', scheduleLoad);

function scheduleLoad() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(loadWays, 600);
}

/** Abfragefläche: sichtbarer Bereich, bei steiler Neigung auf maxAreaKm2 um die Kartenmitte begrenzt. */
function queryBbox() {
  const b = map.getBounds();
  let bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const max = SOURCES.trails.maxAreaKm2;
  if (bboxAreaKm2(bbox) > max) {
    const c = map.getCenter();
    const halfKm = Math.sqrt(max) / 2;
    const dLat = halfKm / 111.32;
    const dLon = halfKm / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    bbox = [c.lng - dLon, c.lat - dLat, c.lng + dLon, c.lat + dLat];
  }
  return bbox;
}

const contains = (outer, inner) => outer && inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

async function loadWays() {
  if (map.getZoom() < SOURCES.trails.minZoom) {
    setStatus(`Für Wege-Details (SAC-Skala, Lifte, Hütten) näher heranzoomen (Zoom ≥ ${SOURCES.trails.minZoom}).`);
    return;
  }
  const view = queryBbox();
  if (contains(loadedBbox, view)) return;
  // 20 % Puffer, damit kleine Verschiebungen keine neue Abfrage auslösen.
  const padX = (view[2] - view[0]) * 0.2;
  const padY = (view[3] - view[1]) * 0.2;
  const bbox = [view[0] - padX, view[1] - padY, view[2] + padX, view[3] + padY];

  inflight?.abort();
  inflight = new AbortController();
  setStatus('Lade OSM-Wege …');
  setSourceState('trails', 'idle');
  try {
    const res = await fetchOverpass(bbox, SOURCES.trails.endpoints, inflight.signal);
    loadedBbox = bbox;
    state.data.ways = res.ways;
    state.data.points = res.peaks;
    map.getSource('ways')?.setData(res.ways);
    map.getSource('points')?.setData(res.peaks);
    setSourceState('trails', 'ok', `Server: ${res.endpoint}`);
    const base = res.meta.osmBase ? new Date(res.meta.osmBase).toLocaleString('de-DE') : 'unbekannt';
    setStatus(`OSM-Stand ${base}` + (res.meta.dropped ? ` · ${res.meta.dropped} defekte Geometrien verworfen` : ''));
    renderQuality();
    await validatePeaks(res.peaks, sampler);
    if (state.data.points === res.peaks) {
      map.getSource('points')?.setData(res.peaks);
      renderQuality();
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    setSourceState('trails', 'err', err.message);
    setStatus(`Wege konnten nicht geladen werden: ${err.message}`, true);
  }
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
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

// ---------- Interaktion ----------
for (const layer of ['ways', 'lifts', 'peaks', 'huts']) {
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
}

const prop = (v) => (v == null || v === 'null' ? null : v);

map.on('click', 'peaks', (e) => {
  const p = e.features[0].properties;
  new maplibregl.Popup({ maxWidth: '260px' })
    .setLngLat(e.lngLat)
    .setHTML(`<b>${esc(prop(p.name) ?? 'Gipfel ohne Namen')}</b><br>
      OSM: ${prop(p.ele_raw) ? esc(p.ele_raw) + ' m' : '–'} · DEM: ${prop(p.ele_dem) != null ? esc(p.ele_dem) + ' m' : '–'}<br>
      <small>${esc(prop(p.check_text) ?? 'Prüfung läuft …')}</small><br>
      <a href="https://www.openstreetmap.org/node/${esc(p.osm_id)}" target="_blank" rel="noopener">OSM-Objekt</a>`)
    .addTo(map);
});

map.on('click', 'huts', (e) => {
  const p = e.features[0].properties;
  const kind = p.kind === 'alpine_hut' ? 'Berghütte (bewirtschaftet)' : 'Unbewirtschaftete Hütte';
  new maplibregl.Popup({ maxWidth: '260px' })
    .setLngLat(e.lngLat)
    .setHTML(`<b>${esc(prop(p.name) ?? kind)}</b><br>${esc(kind)}${prop(p.ele_raw) ? ` · ${esc(p.ele_raw)} m` : ''}<br>
      <a href="https://www.openstreetmap.org/node/${esc(p.osm_id)}" target="_blank" rel="noopener">OSM-Objekt</a>`)
    .addTo(map);
});

let selectionToken = 0;
let current = null;
const cursorMarker = new maplibregl.Marker({ color: '#00e5ff', scale: 0.6 });

map.on('click', (e) => {
  // Klick-Features sind gekachelt/vereinfacht – Originalgeometrie aus dem geladenen Datensatz holen.
  // ±8 px Toleranz: dünne Linien sind sonst mit dem Finger kaum zu treffen.
  const { x, y } = e.point;
  const box = [[x - 8, y - 8], [x + 8, y + 8]];
  const hit = map.queryRenderedFeatures(box, { layers: ['ways', 'lifts'].filter((l) => map.getLayer(l)) })[0];
  if (!hit) return;
  const feature = state.data.ways.features.find((f) => f.properties.osm_id === hit.properties.osm_id);
  if (feature) selectWay(feature);
});

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
  $('selection').hidden = false;
  const fallback = p.aerialway ? `Lift ${p.osm_id}` : p.ref ? `Weg ${p.ref}` : `Weg ${p.osm_id}`;
  $('sel-title').textContent = p.name || fallback;
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

$('profile').addEventListener('mousemove', (ev) => {
  if (!current) return;
  const rect = ev.currentTarget.getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
  const prof = current.profile;
  const target = t * prof[prof.length - 1].dist;
  const p = prof.reduce((best, q) => (Math.abs(q.dist - target) < Math.abs(best.dist - target) ? q : best), prof[0]);
  cursorMarker.setLngLat(p.coord).addTo(map);
  const line = ev.currentTarget.querySelector('line.cursor');
  if (line) {
    line.setAttribute('x1', t * 300);
    line.setAttribute('x2', t * 300);
  }
});
$('profile').addEventListener('mouseleave', () => cursorMarker.remove());

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
const LAYER_GROUPS = { hillshade: ['hillshade'], ways: ['ways-casing', 'ways', 'selected'], lifts: ['lifts'], peaks: ['peaks', 'huts'] };

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

$('terrain').addEventListener('change', (e) => {
  state.terrain = e.target.checked;
  map.setTerrain(state.terrain ? { source: 'terrain', exaggeration: state.exaggeration } : null);
  if (state.terrain && map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 800 });
});

$('exaggeration').addEventListener('input', (e) => {
  state.exaggeration = Number(e.target.value);
  $('exaggeration-val').textContent = `${state.exaggeration.toFixed(1)}×`;
  if (state.terrain && map.getTerrain()) map.setTerrain({ source: 'terrain', exaggeration: state.exaggeration });
});

$('region').addEventListener('click', () => {
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

$('panel-toggle').addEventListener('click', () => {
  const panel = $('panel');
  const collapsed = panel.classList.toggle('collapsed');
  $('panel-toggle').textContent = collapsed ? '+' : '–';
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
});

$('legend').innerHTML =
  Object.values(SAC_SCALE).map((s) => `<li><i style="background:${s.color}"></i>${esc(s.label)}</li>`).join('') +
  '<li><i style="background:#ffffff;outline:1px solid #999"></i>Pfad ohne SAC</li>' +
  '<li><i style="background:#c8a27a"></i>Fahrweg (track)</li>' +
  '<li><i style="background:#7cb342"></i>Radweg</li>' +
  '<li><i style="background:#8e24aa"></i>Klettersteig</li>' +
  '<li><i style="background:repeating-linear-gradient(90deg,#111 0 8px,transparent 8px 10px)"></i>Seilbahn/Lift</li>' +
  '<li><i class="dot" style="background:#8d4e1f"></i>Hütte</li>' +
  '<li><i class="dot" style="background:#1e8e3e"></i>Gipfel OSM≈DEM</li>' +
  '<li><i class="dot" style="background:#e3b341"></i>Gipfel Δ erklärbar</li>' +
  '<li><i class="dot" style="background:#e53935"></i>Gipfel Δ auffällig</li>';

renderSources();
