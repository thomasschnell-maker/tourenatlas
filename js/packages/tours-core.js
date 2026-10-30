// Touren-Paket: reine Logik (ohne DOM, in Node testbar).

import { ascentDescent, densify, haversine, lineLength } from '../geo.js';

export const ROUTER = {
  // BRouter: Open-Source-Routing mit Bergweg-Profil (SAC-Skala, Steigung). Öffentlicher Server.
  url: 'https://brouter.de/brouter',
  attribution: 'Routing: <a href="https://brouter.de" target="_blank" rel="noopener">BRouter</a> auf © OpenStreetMap-Daten'
};

export function brouterUrl(a, b, profile = 'hiking-mountain') {
  return brouterUrlMulti([a, b], profile);
}

/** Ganze Tour in einer Anfrage (BRouter routet über alle Stationen) – statt einer Anfrage je Abschnitt. */
export function brouterUrlMulti(points, profile = 'hiking-mountain') {
  const ll = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  return `${ROUTER.url}?lonlats=${points.map(ll).join('|')}&profile=${profile}&alternativeidx=0&format=geojson`;
}

/**
 * Gesamtroute an den Stationen in Abschnitte teilen. BRouter führt die Route durch die (auf den Weg
 * gezogenen) Stationen; gesucht ist je Station ein Routenpunkt, in Reihenfolge streng aufsteigend, mit
 * kleinster Summe der Abstände (dynamische Programmierung). So landen mehrfach besuchte Orte (Hin- und
 * Rückweg) und dicht beieinander liegende Stationen richtig. Liefert null, wenn eine Station weiter als
 * toleranceM von der Route entfernt liegt.
 */
export function splitRoute(line, points, toleranceM = 500) {
  const m = line.length;
  const n = points.length;
  if (n < 2 || m < n) return null;
  if (haversine(line[0], points[0]) > toleranceM || haversine(line[m - 1], points[n - 1]) > toleranceM) return null;
  // best[i]: kleinste Abstandssumme, wenn Station k auf Punkt i liegt; back: Vorgänger für die Rückverfolgung
  let best = new Float64Array(m).fill(Infinity);
  best[0] = 0;
  const backs = [];
  for (let k = 1; k < n; k++) {
    const next = new Float64Array(m).fill(Infinity);
    const back = new Int32Array(m).fill(-1);
    let runMin = Infinity;
    let runArg = -1;
    const last = k === n - 1;
    for (let i = 1; i < m; i++) {
      if (best[i - 1] < runMin) {
        runMin = best[i - 1];
        runArg = i - 1;
      }
      if (last && i !== m - 1) continue; // Ziel liegt am Routenende
      if (runArg < 0 || i > m - (n - k)) continue; // Platz für die restlichen Stationen lassen
      next[i] = runMin + haversine(line[i], points[k]);
      back[i] = runArg;
    }
    backs.push(back);
    best = next;
  }
  if (!Number.isFinite(best[m - 1])) return null;
  const cuts = [m - 1];
  for (let k = n - 1; k >= 1; k--) cuts.unshift(backs[k - 1][cuts[0]]);
  if (cuts.some((c, k) => haversine(line[c], points[k]) > toleranceM)) return null;
  return cuts.slice(1).map((c, k) => line.slice(cuts[k], c + 1));
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
export function batteryWh(lengthM, up, { assist = 'tour', factor = 1 } = {}) {
  const a = ACTIVITIES.ebike;
  return ((lengthM / 1000) * a.whPerKm + up * a.whPerHm) * (ASSIST[assist]?.f ?? 1) * factor;
}

/**
 * Unterstützungsstufen als Verbrauchsfaktor relativ zu "Tour" (Faustregel aus Reichweitenangaben
 * der Hersteller: Eco ~1,6× Reichweite, Turbo ~0,6× Reichweite gegenüber Tour).
 */
export const ASSIST = {
  eco: { label: 'Eco', f: 0.62 },
  tour: { label: 'Tour', f: 1 },
  sport: { label: 'Sport', f: 1.3 },
  turbo: { label: 'Turbo', f: 1.65 }
};

/**
 * Persönlicher Faktor aus echten Fahrten: Median von (tatsächlich verbraucht / geschätzt) über alle
 * E-Bike-Touren mit Eintrag. Robust gegen Ausreisser (Median), begrenzt auf 0,4–2,5.
 */
export function calibrateEbike(tours) {
  const ratios = tours
    .filter((t) => t.activity === 'ebike' && t.actualBatteries > 0 && t.summary?.length > 0)
    .map((t) => (t.actualBatteries * (t.batteryCapacityWh || 625)) / batteryWh(t.summary.length, t.summary.up, { assist: t.assist || 'tour' }))
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (!ratios.length) return { factor: 1, n: 0 };
  const m = Math.floor(ratios.length / 2);
  const med = ratios.length % 2 ? ratios[m] : (ratios[m - 1] + ratios[m]) / 2;
  return { factor: Math.min(2.5, Math.max(0.4, med)), n: ratios.length };
}

/** Höhenmeter je km: über diesen Werten liegt wahrscheinlich eine Luftlinie über Gelände. */
export function implausibleClimb(lengthM, up, activity) {
  if (lengthM < 1000) return false;
  const perKm = up / (lengthM / 1000);
  return activity === 'hike' ? perKm > 300 : perKm > 90;
}

/**
 * Akkuverlauf entlang des Profils: Verbrauch nach Strecke + Aufstieg (mit 5-m-Hysterese wie die Hm-Summe),
 * Restladung des jeweils eingesetzten Akkus in %, Wechselpunkte (km) wenn ein Akku leer ist.
 */
export function batteryCurve(profile, capacityWh, threshold = 5, scale = 1) {
  const a = ACTIVITIES.ebike;
  let up = 0;
  let ref = null;
  const swaps = [];
  const points = profile.map((p) => {
    if (p.ele != null) {
      if (ref == null) ref = p.ele;
      else if (p.ele - ref >= threshold) {
        up += p.ele - ref;
        ref = p.ele;
      } else if (ref - p.ele >= threshold) ref = p.ele;
    }
    const wh = ((p.dist / 1000) * a.whPerKm + up * a.whPerHm) * scale;
    const used = Math.floor(wh / capacityWh);
    if (used > swaps.length) swaps.push(p.dist);
    return { dist: p.dist, wh, pct: 100 - ((wh - used * capacityWh) / capacityWh) * 100 };
  });
  const total = points.length ? points[points.length - 1].wh : 0;
  return { points, swaps, total, batteries: total / capacityWh };
}

/** Kumulierte Distanz jeder Station entlang des Profils (nächster Profilpunkt, in Reihenfolge). */
export function stationDistances(stations, profile) {
  let from = 0;
  return stations.map((s) => {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < profile.length; i++) {
      const d = haversine(s.lngLat, profile[i].coord);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    from = best; // Rundtouren: Ziel = Start, darum nur vorwärts suchen
    return profile[best]?.dist ?? 0;
  });
}

/** Punkt in Entfernung m und Richtung (Grad) von [lon, lat] (Kugel, für Kamerablick ausreichend). */
export function destination([lon, lat], bearingDeg, m) {
  const R = 6371008.8;
  const d = m / R;
  const b = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(l2 * 180) / Math.PI, (p2 * 180) / Math.PI];
}

/**
 * 3D-Blick aus Fotodaten: mit Blickrichtung vom Standort in Fotorichtung (Kamera "steht" am Aufnahmeort),
 * sonst Aufsicht schräg auf den Aufnahmeort.
 */
export function viewFromPhoto({ lngLat, direction }) {
  if (!lngLat) return null;
  if (direction == null) return { center: lngLat, zoom: 15, pitch: 55, bearing: 0 };
  return { center: destination(lngLat, direction, 700), zoom: 15, pitch: 72, bearing: direction };
}

/**
 * Fotos Stationen zuordnen: mit GPS → nächste Station (max. maxM), ohne GPS → Station des zeitlich
 * nächsten Fotos mit GPS; sonst fallbackIndex. Liefert je Foto { station, reason }.
 */
export function assignPhotos(photos, stations, { maxM = 5000, fallbackIndex = 0 } = {}) {
  const near = (ll) => {
    let best = -1;
    let bestD = Infinity;
    stations.forEach((s, i) => {
      const d = haversine(ll, s.lngLat);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD <= maxM ? { station: best, dist: bestD } : null;
  };
  const first = photos.map((p) => {
    if (!p.lngLat) return null;
    const n = near(p.lngLat);
    return n ? { station: n.station, reason: `Aufnahmeort, ${Math.round(n.dist)} m von der Station` } : { station: null, reason: 'Aufnahmeort weit weg von allen Stationen' };
  });
  const timed = photos.map((p, i) => ({ t: Date.parse(p.takenAt || ''), r: first[i] })).filter((x) => Number.isFinite(x.t) && x.r?.station != null);
  return photos.map((p, i) => {
    if (first[i]?.station != null) return first[i];
    const t = Date.parse(p.takenAt || '');
    if (Number.isFinite(t) && timed.length) {
      const m = timed.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
      return { station: m.r.station, reason: `Aufnahmezeit (${Math.round(Math.abs(m.t - t) / 60000)} min neben Foto mit Ort)` };
    }
    return { station: fallbackIndex, reason: first[i]?.reason || 'keine Orts- oder Zeitangabe – gewählte Station' };
  });
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

// Unterscheidbare Tourfarben (gut sichtbar auf Karte und Luftbild, nicht in der SAC-Farbskala).
export const TOUR_COLORS = ['#d6007e', '#0a6cff', '#ff7a00', '#00a86b', '#8e44ff', '#e4002b', '#00a3b5', '#9a6b00'];

/** Nächste freie Farbe: die am seltensten verwendete der Palette. */
export function nextColor(tours) {
  const used = new Map(TOUR_COLORS.map((c) => [c, 0]));
  for (const t of tours) if (used.has(t.color)) used.set(t.color, used.get(t.color) + 1);
  return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
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
