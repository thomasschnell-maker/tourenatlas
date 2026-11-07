/* global maplibregl */
// Wetter-Paket. Schnittstelle aller Pakete (siehe packages/index.js):
//   { id, title, icon, mount(ctx), onStyle(map), onActivate(), onDeactivate(), onMapClick(lngLat) }
// ctx = { map, pane, sampler, setStatus, esc }

import { WEATHER_SOURCE, buildForecastUrl, hourLabel, parseForecast, summarize, wmo } from './weather-core.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5a3.75 3.75 0 0 1 .25 7.49L17 17H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 20.5l-1 1.5M13 20.5l-1 1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let ctx = null;
let point = null;
let marker = null;
let radarOn = false;
let token = 0;

function radarLayer(map) {
  if (!radarOn || map.getSource('wx-radar')) return;
  map.addSource('wx-radar', { type: 'raster', tiles: WEATHER_SOURCE.radar.tiles, tileSize: 256, attribution: WEATHER_SOURCE.radar.attribution });
  // Unter den eigenen Weg-Ebenen, damit Wege lesbar bleiben.
  const before = map.getLayer('ways-casing') ? 'ways-casing' : undefined;
  map.addLayer({ id: 'wx-radar', type: 'raster', source: 'wx-radar', paint: { 'raster-opacity': 0.65 } }, before);
}

function removeRadar(map) {
  if (map.getLayer('wx-radar')) map.removeLayer('wx-radar');
  if (map.getSource('wx-radar')) map.removeSource('wx-radar');
}

async function query(lngLat) {
  const { map, pane, sampler, esc } = ctx;
  point = [lngLat.lng, lngLat.lat];
  marker = marker || new maplibregl.Marker({ color: '#2a7fff', scale: 0.7 });
  marker.setLngLat(point).addTo(map);
  const my = ++token;
  const out = pane.querySelector('[data-wx="out"]');
  out.innerHTML = '<p class="muted">Lade Vorhersage …</p>';
  const ele = await sampler.elevation(point);
  try {
    const res = await fetch(buildForecastUrl(point, ele, Number(pane.querySelector('[data-wx="hours"]').value)));
    if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
    const { rows, elevation } = parseForecast(await res.json());
    if (my !== token) return;
    const s = summarize(rows, ele);
    const n = (v, d = 0) => (v == null ? '–' : v.toFixed(d));
    const step = rows.length > 12 ? 3 : 1;
    const table = rows
      .filter((_, i) => i % step === 0)
      .map((r) => {
        const w = wmo(r.weather_code);
        return `<tr><td>${esc(hourLabel(r.time))}</td><td title="${esc(w.text)}">${w.icon}</td><td>${n(r.temperature_2m)}°</td>
          <td>${n(r.precipitation, 1)}</td><td>${n(r.wind_speed_10m)}/${n(r.wind_gusts_10m)}</td></tr>`;
      })
      .join('');
    out.innerHTML = `
      <dl class="stats">
        <dt>Ort</dt><dd>${point[1].toFixed(4)}, ${point[0].toFixed(4)} · ${ele == null ? '–' : Math.round(ele) + ' m'}</dd>
        <dt>Temperatur</dt><dd>${n(s.tMin)} bis ${n(s.tMax)} °C</dd>
        <dt>0-°C-Grenze</dt><dd>ab ${s.freezingMin == null ? '–' : Math.round(s.freezingMin) + ' m'}</dd>
        <dt>Böen max.</dt><dd>${n(s.gustMax)} km/h</dd>
        <dt>Niederschlag</dt><dd>${s.rain.toFixed(1)} mm</dd>
      </dl>
      <ul class="findings">${s.findings.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join('')}</ul>
      <table class="wx"><thead><tr><th>h</th><th></th><th>°C</th><th>mm</th><th>Wind/Böe</th></tr></thead><tbody>${table}</tbody></table>
      <p class="muted">${WEATHER_SOURCE.attribution} · ${esc(WEATHER_SOURCE.modelLabel)} · abgerufen ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        ${elevation != null && ele != null && Math.abs(elevation - ele) > 1 ? ` · Höhe ${Math.round(elevation)} m verwendet` : ele != null ? ' · auf Geländehöhe umgerechnet' : ''}</p>`;
  } catch (err) {
    if (my === token) out.innerHTML = `<ul class="findings"><li class="warn">${esc(err.message)}</li></ul>`;
  }
}

export default {
  id: 'weather',
  title: 'Wetter',
  icon: ICON,

  mount(c) {
    ctx = c;
    c.pane.innerHTML = `
      <p class="muted">Punktvorhersage für Kartenmitte oder angetippten Ort, auf die Geländehöhe umgerechnet.</p>
      <div class="row">
        <button type="button" class="btn" data-wx="center">Kartenmitte</button>
        <select data-wx="hours" aria-label="Zeitraum"><option value="12">12 h</option><option value="24" selected>24 h</option><option value="48">48 h</option></select>
      </div>
      <label class="switch"><input type="checkbox" data-wx="radar"><span>Regenradar (DWD)</span></label>
      <div data-wx="out"></div>
      <p class="muted">Faustregeln, kein Ersatz für den Bergwetterbericht (z. B. DAV/ZAMG).</p>`;
    c.pane.querySelector('[data-wx="center"]').addEventListener('click', () => query(c.map.getCenter()));
    c.pane.querySelector('[data-wx="hours"]').addEventListener('change', () => point && query({ lng: point[0], lat: point[1] }));
    c.pane.querySelector('[data-wx="radar"]').addEventListener('change', (e) => {
      radarOn = e.target.checked;
      if (radarOn) radarLayer(c.map);
      else removeRadar(c.map);
    });
  },

  onStyle(map) {
    radarLayer(map);
  },

  onActivate() {
    if (!point) query(ctx.map.getCenter());
  },

  onDeactivate() {
    marker?.remove();
    point = null;
  },

  onMapClick(lngLat) {
    query(lngLat);
    return true; // Klick verbraucht – keine Wegauswahl
  }
};
