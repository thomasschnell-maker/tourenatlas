// Vorab berechnete Regionsdaten: Bergwege, Radrouten, Gipfel, Hütten je Zelle als statische Dateien.
// Erzeugt wöchentlich von tools/build-region.mjs (GitHub Actions), ausgeliefert mit der App.
// Vorteil: sofort statt 3–30 s je Overpass-Abfrage, offline speicherbar, schont die öffentlichen Server.

import { cellKey } from './cells.js';

/**
 * Zerlegt eine Overpass-Auswertung (parseOverpass) in Zellen.
 * Wege landen in jeder Zelle, die ihre Ausdehnung berührt (die App entfernt Dubletten);
 * Gipfel/Hütten in ihrer Zelle; Radrouten-Teilstücke in der Zelle ihres Anfangspunkts.
 */
export function splitIntoCells(parsed, size, round = 5) {
  const f = 10 ** round;
  const r = (c) => [Math.round(c[0] * f) / f, Math.round(c[1] * f) / f];
  const cells = new Map();
  const cell = (k) => {
    if (!cells.has(k)) cells.set(k, { ways: new Map(), peaks: new Map(), routes: new Map() });
    return cells.get(k);
  };
  for (const w of parsed.ways.features) {
    const coords = w.geometry.coordinates.map(r);
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const [i0, j0] = cellKey(Math.min(...xs), Math.min(...ys), size).split(':').map(Number);
    const [i1, j1] = cellKey(Math.max(...xs), Math.max(...ys), size).split(':').map(Number);
    const feat = { ...w, geometry: { type: 'LineString', coordinates: coords } };
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cell(`${i}:${j}`).ways.set(w.properties.osm_id, feat);
  }
  for (const p of parsed.peaks.features) {
    const c = r(p.geometry.coordinates);
    cell(cellKey(c[0], c[1], size)).peaks.set(p.properties.osm_id, { ...p, geometry: { type: 'Point', coordinates: c } });
  }
  for (const rt of parsed.routes.features) {
    for (const line of rt.geometry.coordinates) {
      const l = line.map(r);
      const target = cell(cellKey(l[0][0], l[0][1], size)).routes;
      const id = rt.properties.osm_id;
      if (!target.has(id)) target.set(id, { ...rt, geometry: { type: 'MultiLineString', coordinates: [] } });
      target.get(id).geometry.coordinates.push(l);
    }
  }
  const fc = (m) => ({ type: 'FeatureCollection', features: [...m.values()] });
  return new Map([...cells].map(([k, c]) => [k, { ways: fc(c.ways), peaks: fc(c.peaks), routes: fc(c.routes) }]));
}

/** Liegt die Zelle im Gebiet der Regionsdaten? (dann gibt es sie dort – oder sie ist leer) */
export function cellInBbox(key, size, [w, s, e, n]) {
  const [i, j] = key.split(':').map(Number);
  const cx = (i + 0.5) * size[0];
  const cy = (j + 0.5) * size[1];
  return cx >= w && cx <= e && cy >= s && cy <= n;
}

/** Berührt die Zelle eine Lücke der Regionsdaten (Teilabfrage, die beim Bau scheiterte)? Dann live laden. */
export function cellInHole(key, size, holes = []) {
  const [i, j] = key.split(':').map(Number);
  const [w, s, e, n] = [i * size[0], j * size[1], (i + 1) * size[0], (j + 1) * size[1]];
  return holes.some(([hw, hs, he, hn]) => w < he && e > hw && s < hn && n > hs);
}

/** Index der Regionsdaten laden; null, wenn (noch) keine vorhanden sind. */
export async function loadRegionIndex(base = 'data/cells/') {
  try {
    const res = await fetch(`${base}index.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const idx = await res.json();
    if (!idx?.gen || !Array.isArray(idx.cells) || !Array.isArray(idx.cellDeg)) return null;
    return { ...idx, set: new Set(idx.cells), url: (k) => `${base}${idx.gen}/${k.replace(':', '_')}.json` };
  } catch {
    return null;
  }
}
