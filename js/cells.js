// Raster aus festen Zellen für das Nachladen der OSM-Wege.
// Kleine, wiederverwendbare Abfragen statt einer grossen: bleibt unter den Overpass-Zeitlimits,
// jede Zelle wird nur einmal geladen, und die Mitte des Bildes kommt zuerst.

import { haversine } from './geo.js';

export function cellKey(lon, lat, [dLon, dLat]) {
  return `${Math.floor(lon / dLon)}:${Math.floor(lat / dLat)}`;
}

export function cellBbox(key, [dLon, dLat]) {
  const [i, j] = key.split(':').map(Number);
  return [i * dLon, j * dLat, (i + 1) * dLon, (j + 1) * dLat];
}

/**
 * Zellen, deren Mittelpunkt im Sichtbereich und höchstens radiusKm von der Bildmitte entfernt liegt,
 * sortiert nach Abstand zur Mitte, höchstens maxCells.
 */
export function cellsForView(center, [w, s, e, n], size, radiusKm, maxCells) {
  const [dLon, dLat] = size;
  const out = [];
  for (let i = Math.floor(w / dLon); i <= Math.floor(e / dLon); i++) {
    for (let j = Math.floor(s / dLat); j <= Math.floor(n / dLat); j++) {
      const c = [(i + 0.5) * dLon, (j + 0.5) * dLat];
      const d = haversine(center, c);
      if (d <= radiusKm * 1000) out.push({ key: `${i}:${j}`, d });
    }
  }
  // Mitte immer laden, auch wenn sie bei steiler Neigung ausserhalb der Bounds-Berechnung liegt.
  const own = cellKey(center[0], center[1], size);
  if (!out.some((c) => c.key === own)) out.push({ key: own, d: 0 });
  return out.sort((a, b) => a.d - b.d).slice(0, maxCells).map((c) => c.key);
}
