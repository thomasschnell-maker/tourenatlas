// Touren-Paket: reine Logik (ohne DOM, in Node testbar).

import { ascentDescent, densify, haversine, lineLength } from '../geo.js';

export const ROUTER = {
  // BRouter: Open-Source-Routing mit Bergweg-Profil (SAC-Skala, Steigung). Öffentlicher Server.
  url: 'https://brouter.de/brouter',
  profiles: { hike: 'hiking-mountain', bike: 'trekking' },
  attribution: 'Routing: <a href="https://brouter.de" target="_blank" rel="noopener">BRouter</a> auf © OpenStreetMap-Daten'
};

export function brouterUrl(a, b, profile = ROUTER.profiles.hike) {
  const ll = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  return `${ROUTER.url}?lonlats=${ll(a)}|${ll(b)}&profile=${profile}&alternativeidx=0&format=geojson`;
}

/** BRouter-GeoJSON → [[lon, lat], …]. Prüft, dass die Route an den Stationen beginnt/endet. */
export function parseBrouter(json, a, b, toleranceM = 300) {
  const f = json?.features?.[0];
  const coords = f?.geometry?.type === 'LineString' ? f.geometry.coordinates : null;
  if (!coords || coords.length < 2) throw new Error('BRouter: keine Route');
  const line = coords.map((c) => [c[0], c[1]]);
  // Plausibilität: Route muss nahe an Start- und Zielstation liegen (sonst Weg weit entfernt).
  const d0 = haversine(line[0], a);
  const d1 = haversine(line[line.length - 1], b);
  if (d0 > toleranceM || d1 > toleranceM) {
    throw new Error(`BRouter: nächster Weg ${Math.round(Math.max(d0, d1))} m von der Station entfernt`);
  }
  return line;
}

/** Gesamtlinie der Tour aus Segmenten; Luftlinie für Segmente ohne Route. */
export function tourLine(stations, segments) {
  const out = [];
  for (let i = 1; i < stations.length; i++) {
    const seg = segments[i - 1];
    const part = seg?.coords?.length >= 2 ? seg.coords : [stations[i - 1].lngLat, stations[i].lngLat];
    out.push(...(out.length ? part.slice(1) : part));
  }
  return out;
}

/**
 * Gehzeit nach DIN 33466 (Alpenvereins-Formel): 4 km/h horizontal, 300 Hm/h Aufstieg, 500 Hm/h Abstieg;
 * Gesamtzeit = grösserer Wert + halber kleinerer Wert. Ergebnis in Stunden.
 */
export function walkingTimeH(lengthM, up, down) {
  const horiz = lengthM / 1000 / 4;
  const vert = up / 300 + down / 500;
  return Math.max(horiz, vert) + Math.min(horiz, vert) / 2;
}

export function formatDuration(h) {
  const total = Math.round(h * 12) * 5; // auf 5 Minuten
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${hh}:${String(mm).padStart(2, '0')} h`;
}

/** Kennzahlen einer Tour aus Linie + Höhenabfrage (sampler.elevations). */
export async function tourStats(line, sampler, spacing = 25) {
  if (line.length < 2) return null;
  const pts = densify(line, spacing);
  const eles = await sampler.elevations(pts.map((p) => p.coord));
  const { up, down } = ascentDescent(eles, 5);
  const length = lineLength(line);
  const valid = eles.filter((e) => e != null);
  return {
    length,
    up,
    down,
    min: valid.length ? Math.min(...valid) : null,
    max: valid.length ? Math.max(...valid) : null,
    timeH: walkingTimeH(length, up, down),
    profile: pts.map((p, i) => ({ dist: p.dist, ele: eles[i], coord: p.coord }))
  };
}

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** GPX 1.1 mit Stationen als Wegpunkte und der Linie als Track. */
export function tourGpx(tour, line, eles = []) {
  const wpts = tour.stations
    .map(
      (s, i) =>
        `  <wpt lat="${s.lngLat[1].toFixed(7)}" lon="${s.lngLat[0].toFixed(7)}">${s.ele != null ? `<ele>${s.ele.toFixed(1)}</ele>` : ''}<name>${xml(s.name || `Station ${i + 1}`)}</name>${s.note ? `<desc>${xml(s.note)}</desc>` : ''}</wpt>`
    )
    .join('\n');
  const trkpts = line
    .map(([lon, lat], i) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${eles[i] != null ? `<ele>${eles[i].toFixed(1)}</ele>` : ''}</trkpt>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Allgäu Tourenatlas 3D" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${xml(tour.name)}</name>
    ${tour.date ? `<time>${xml(tour.date)}T00:00:00Z</time>` : ''}
    <desc>Wege: © OpenStreetMap-Mitwirkende (ODbL), Routing BRouter, Höhen: Terrain Tiles DEM.</desc>
  </metadata>
${wpts}
  <trk><name>${xml(tour.name)}</name><trkseg>
      ${trkpts}
  </trkseg></trk>
</gpx>`;
}

export function newTour(name = 'Neue Tour') {
  const now = new Date().toISOString();
  return { id: uid(), name, date: now.slice(0, 10), mode: 'route', created: now, updated: now, stations: [], segments: [] };
}

export function newStation(lngLat, n) {
  return { id: uid(), name: `Station ${n}`, lngLat, ele: null, view: null, note: '', photos: [] };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Kartenansicht (Kamera) als speicherbares Objekt. */
export function captureView(map) {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
}
