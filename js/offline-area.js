// Gebiet offline speichern: alle Kacheln eines Ausschnitts vorab laden, damit der Service Worker
// sie zwischenspeichert. Reine Kachelmathematik ist ohne DOM testbar.

import { lonLatToTile } from './geo.js';

/** Kachel-Koordinaten [z, x, y] für bbox [W, S, E, N] über Zoomstufen zmin..zmax. */
export function tilesForBbox([w, s, e, n], zmin, zmax) {
  const out = [];
  for (let z = zmin; z <= zmax; z++) {
    const a = lonLatToTile([w, n], z);
    const b = lonLatToTile([e, s], z);
    for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) {
      for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++) out.push([z, x, y]);
    }
  }
  return out;
}

export const tileUrl = (template, [z, x, y]) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** bbox um Puffer (km) erweitern – damit auch der Rand der Tour offline sichtbar bleibt. */
export function padBbox([w, s, e, n], km) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/** Lädt URLs mit begrenzter Parallelität; meldet Fortschritt. Liefert { ok, failed }. */
export async function prefetch(urls, { concurrency = 6, onProgress } = {}) {
  let i = 0;
  let ok = 0;
  let failed = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
      onProgress?.(ok + failed, urls.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ok, failed };
}
