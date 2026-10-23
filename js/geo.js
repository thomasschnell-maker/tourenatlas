// Reine Geo-Funktionen ohne DOM-Abhängigkeit (in Node testbar).

const R_EARTH = 6371008.8; // mittlerer Erdradius (IUGG), Meter

const toRad = (d) => (d * Math.PI) / 180;

/** Grosskreis-Distanz zweier [lon, lat]-Punkte in Metern. */
export function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Länge einer Linie ([lon, lat][]) in Metern. */
export function lineLength(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversine(coords[i - 1], coords[i]);
  return len;
}

/**
 * Verdichtet eine Linie auf Punkte im Abstand ≤ spacing (Meter).
 * Liefert [{ coord, dist }] mit kumulierter Distanz; Originalstützpunkte bleiben erhalten.
 */
export function densify(coords, spacing) {
  if (coords.length === 0) return [];
  const out = [{ coord: coords[0], dist: 0 }];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = haversine(a, b);
    const n = Math.max(1, Math.ceil(seg / spacing));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ coord: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dist: total + seg * t });
    }
    total += seg;
  }
  return out;
}

/**
 * Auf- und Abstieg mit Hysterese: Höhenänderungen werden erst gezählt, wenn sie
 * den Schwellwert überschreiten. Verhindert, dass DEM-Rauschen den Aufstieg aufbläht.
 */
export function ascentDescent(elevations, threshold = 5) {
  let up = 0;
  let down = 0;
  let ref = null;
  for (const e of elevations) {
    if (e == null || Number.isNaN(e)) continue;
    if (ref == null) {
      ref = e;
      continue;
    }
    const d = e - ref;
    if (d >= threshold) {
      up += d;
      ref = e;
    } else if (d <= -threshold) {
      down -= d;
      ref = e;
    }
  }
  return { up, down };
}

/** Maximale Steigung in Prozent über ein gleitendes Fenster (Meter), robust gegen Einzelpixel. */
export function maxGrade(profile, window = 50) {
  let max = 0;
  let j = 0;
  for (let i = 0; i < profile.length; i++) {
    while (j < profile.length && profile[j].dist - profile[i].dist < window) j++;
    if (j >= profile.length) break;
    const run = profile[j].dist - profile[i].dist;
    if (run <= 0 || profile[i].ele == null || profile[j].ele == null) continue;
    max = Math.max(max, (Math.abs(profile[j].ele - profile[i].ele) / run) * 100);
  }
  return max;
}

/** Dekodiert ein Terrarium-Pixel zu Metern über Meer. */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/** Web-Mercator: [lon, lat] → fraktionale Tile-Koordinaten bei Zoom z. */
export function lonLatToTile([lon, lat], z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latR = toRad(Math.max(-85.0511, Math.min(85.0511, lat)));
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Fläche einer Bounding-Box [w, s, e, n] in km² (Näherung, für Lastbegrenzung ausreichend). */
export function bboxAreaKm2([w, s, e, n]) {
  const width = haversine([w, (s + n) / 2], [e, (s + n) / 2]);
  const height = haversine([w, s], [w, n]);
  return (width * height) / 1e6;
}

/** Median einer Zahlenliste (null bei leerer Liste). */
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
