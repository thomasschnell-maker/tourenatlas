// Touren-Paket: reine Logik (ohne DOM, in Node testbar).

import { ascentDescent, densify, haversine, lineLength } from '../geo.js';

export const ROUTER = {
  // BRouter: Open-Source-Routing mit Bergweg-Profil (SAC-Skala, Steigung). Öffentlicher Server.
  url: 'https://brouter.de/brouter',
  attribution: 'Routing: <a href="https://brouter.de" target="_blank" rel="noopener">BRouter</a> auf © OpenStreetMap-Daten'
};

export function brouterUrl(a, b, profile = 'hiking-mountain') {
  const ll = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  return `${ROUTER.url}?lonlats=${ll(a)}|${ll(b)}&profile=${profile}&alternativeidx=0&format=geojson`;
}

/** BRouter-GeoJSON → [[lon, lat], …]. Prüft, dass die Route an den Stationen beginnt/endet. */
// 500 m: Orte, Seen und Gipfel werden als Mittelpunkt gefunden, der nächste Weg liegt oft einige hundert Meter daneben.
export function parseBrouter(json, a, b, toleranceM = 500) {
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
 * Aktivitäten: Routing-Profil (BRouter) und Zeit-/Akku-Modell.
 * Rad/E-Bike-Werte sind Faustregeln für Touren im Voralpenland, keine Messwerte (±30 %).
 */
export const ACTIVITIES = {
  hike: { label: 'Wandern', profile: 'hiking-mountain' },
  bike: { label: 'Rad', profile: 'trekking', kmh: 16, hmPerH: 450 },
  ebike: { label: 'E-Bike', profile: 'trekking', kmh: 20, hmPerH: 900, whPerKm: 6, whPerHm: 0.25 }
};

/** Fahrzeit Rad/E-Bike: Strecke mit Reisetempo + Aufstieg mit Steigleistung (Abfahrt ohne Zeitgewinn gerechnet). */
export function rideTimeH(lengthM, up, activity) {
  const a = ACTIVITIES[activity];
  return lengthM / 1000 / a.kmh + up / a.hmPerH;
}

export function tourTimeH(lengthM, up, down, activity = 'hike') {
  return activity === 'hike' ? walkingTimeH(lengthM, up, down) : rideTimeH(lengthM, up, activity);
}

/**
 * Akku-Bedarf E-Bike (Tour-Modus): ~6 Wh/km Grundlast + ~0,25 Wh je Höhenmeter
 * (100 kg System: 0,27 Wh/Hm potenzielle Energie, Motoranteil ~65 %, Wirkungsgrad ~75 %).
 */
export function batteryWh(lengthM, up) {
  const a = ACTIVITIES.ebike;
  return (lengthM / 1000) * a.whPerKm + up * a.whPerHm;
}

/** GPX-Datei → { name, coords: [[lon, lat]], time } (Tracks, sonst Route). Ohne DOM, damit testbar. */
export function parseGpx(text) {
  const src = String(text);
  if (!/<gpx[\s>]/i.test(src)) throw new Error('Keine GPX-Datei');
  const pick = (tag) => [...src.matchAll(new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'gi'))];
  const pts = (tag) =>
    pick(tag)
      .map((m) => {
        const lat = Number(/lat="([^"]+)"/.exec(m[1])?.[1]);
        const lon = Number(/lon="([^"]+)"/.exec(m[1])?.[1]);
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
      })
      .filter(Boolean);
  let coords = pts('trkpt');
  if (coords.length < 2) coords = pts('rtept');
  if (coords.length < 2) throw new Error('GPX enthält keinen Track');
  const name = /<name>\s*(?:<!\[CDATA\[)?([^<\]]+)/i.exec(src)?.[1]?.trim() || 'GPX-Tour';
  const time = /<time>([^<]+)<\/time>/i.exec(src)?.[1] || null;
  return { name, coords, time };
}

/** Spur auf wenige Stationen ausdünnen: Start, Ziel und etwa alle stepKm einen Zwischenpunkt. */
export function stationsFromTrack(coords, stepKm = 10) {
  const idx = [0];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversine(coords[i - 1], coords[i]);
    if (acc >= stepKm * 1000 && i < coords.length - 1) {
      idx.push(i);
      acc = 0;
    }
  }
  idx.push(coords.length - 1);
  return idx;
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
export async function tourStats(line, sampler, spacing = 25, activity = 'hike') {
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
    timeH: tourTimeH(length, up, down, activity),
    batteryWh: activity === 'ebike' ? batteryWh(length, up) : null,
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
  return { id: uid(), name, date: now.slice(0, 10), mode: 'route', activity: 'hike', batteryCapacityWh: 625, note: '', created: now, updated: now, stations: [], segments: [] };
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
