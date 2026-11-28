// Höhenabfrage direkt aus den Terrarium-Kacheln – unabhängig davon, welche
// Kacheln die 3D-Ansicht gerade geladen hat. Dadurch sind Profile und
// Validierungswerte reproduzierbar (immer gleiche Zoomstufe, gleiche Quelle).

import { decodeTerrarium, lonLatToTile } from './geo.js';

/** Bilineare Interpolation im RGBA-Pixelpuffer einer Terrarium-Kachel. */
export function sampleTile(data, size, px, py) {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(px - 0.5)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(py - 0.5)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, px - 0.5 - x0));
  const fy = Math.max(0, Math.min(1, py - 0.5 - y0));
  const at = (x, y) => {
    const i = (y * size + x) * 4;
    return decodeTerrarium(data[i], data[i + 1], data[i + 2]);
  };
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Lädt eine Kachel als RGBA-Puffer (Browser). */
async function loadTileBrowser(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`DEM-Kachel ${res.status}: ${url}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, size: bmp.width };
}

export class DemSampler {
  constructor({ template, zoom, loadTile = loadTileBrowser, maxCache = 256 }) {
    this.template = template;
    this.zoom = zoom;
    this.loadTile = loadTile;
    this.maxCache = maxCache;
    this.cache = new Map();
  }

  tile(x, y) {
    const key = `${x}/${y}`;
    let p = this.cache.get(key);
    if (!p) {
      const url = this.template.replace('{z}', this.zoom).replace('{x}', x).replace('{y}', y);
      p = this.loadTile(url).catch((err) => {
        this.cache.delete(key); // Fehlschlag nicht cachen
        throw err;
      });
      this.cache.set(key, p);
      if (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value);
    }
    return p;
  }

  /** Höhe in Metern an [lon, lat]; null, wenn die Kachel nicht geladen werden kann. */
  async elevation(coord) {
    const { x, y } = lonLatToTile(coord, this.zoom);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    try {
      const { data, size } = await this.tile(tx, ty);
      return sampleTile(data, size, (x - tx) * size, (y - ty) * size);
    } catch {
      return null;
    }
  }

  elevations(coords) {
    return Promise.all(coords.map((c) => this.elevation(c)));
  }

  /**
   * Höchster DEM-Wert im Quadrat ±radius (Meter) um coord. Ein Gipfel ist ein lokales Maximum;
   * so werden Positionsungenauigkeit des OSM-Punkts und Rasterversatz abgefangen.
   */
  async maxAround([lon, lat], radius = 45, step = 15) {
    const n = Math.round(radius / step);
    const dLon = step / (111320 * Math.cos((lat * Math.PI) / 180));
    const dLat = step / 110540;
    const pts = [];
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) pts.push([lon + i * dLon, lat + j * dLat]);
    const vals = (await this.elevations(pts)).filter((v) => v != null);
    return vals.length ? Math.max(...vals) : null;
  }
}
