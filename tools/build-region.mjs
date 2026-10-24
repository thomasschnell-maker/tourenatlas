#!/usr/bin/env node
// Erzeugt die Regionsdaten (Bergwege, Radrouten, Gipfel, Hütten) für die ganze Region als Zellen-Dateien.
// Läuft in GitHub Actions (wöchentlich). Aufruf: node tools/build-region.mjs <Zielordner>
// Nutzt dieselbe Abfrage und denselben Parser wie die App → identische Daten, nur vorab.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGION, SOURCES } from '../js/config.js';
import { buildQuery, parseOverpass } from '../js/overpass.js';
import { splitIntoCells } from '../js/region.js';

const out = process.argv[2] || 'site-data/cells';
// Für Tests: OVERPASS_URL (eigener Server) und PAUSE_MS (Pause zwischen Abfragen) überschreibbar.
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : SOURCES.trails.endpoints;
const PAUSE = Number(process.env.PAUSE_MS ?? 2000);
const CHUNK = [0.2, 0.15]; // ~15 × 17 km je Abfrage
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(bbox) {
  const body = new URLSearchParams({ data: buildQuery(bbox, 180) });
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { 'User-Agent': 'tourenatlas-region-build (github.com/thomasschnell-maker/tourenatlas)' } });
      if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
      return parseOverpass(await res.json());
    } catch (err) {
      last = err;
      console.warn(`  Versuch ${attempt + 1} fehlgeschlagen: ${err.message}`);
      await sleep((process.env.PAUSE_MS ? 50 : 10000) * (attempt + 1));
    }
  }
  throw last;
}

const [W, S, E, N] = REGION.bbox;
const merged = { ways: new Map(), peaks: new Map(), routes: new Map(), osmBase: null };
const chunks = [];
for (let x = W; x < E; x += CHUNK[0]) for (let y = S; y < N; y += CHUNK[1]) chunks.push([x, y, Math.min(E, x + CHUNK[0]), Math.min(N, y + CHUNK[1])]);
console.log(`Region ${REGION.name}: ${chunks.length} Abfragen`);

for (const [i, bbox] of chunks.entries()) {
  const t0 = Date.now();
  const r = await fetchChunk(bbox);
  for (const f of r.ways.features) merged.ways.set(f.properties.osm_id, f);
  for (const f of r.peaks.features) merged.peaks.set(f.properties.osm_id, f);
  // Radrouten sind je Abfrage beschnitten → Teilstücke je Abfrage sammeln (Schlüssel inkl. Abfrage)
  r.routes.features.forEach((f, k) => merged.routes.set(`${i}/${f.properties.osm_id}/${k}`, f));
  merged.osmBase = r.meta.osmBase || merged.osmBase;
  console.log(`  ${i + 1}/${chunks.length}: ${r.ways.features.length} Wege, ${r.peaks.features.length} Punkte, ${r.routes.features.length} Routen (${Date.now() - t0} ms)`);
  await sleep(PAUSE); // fair gegenüber dem öffentlichen Server
}

const cells = splitIntoCells(
  {
    ways: { features: [...merged.ways.values()] },
    peaks: { features: [...merged.peaks.values()] },
    routes: { features: [...merged.routes.values()] }
  },
  SOURCES.trails.cellDeg
);

const gen = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13); // z. B. 20261024T0317
// Erst in einen Zwischenordner schreiben und nur bei vollständigem Erfolg umbenennen –
// so landen nie halbe Daten im Cache oder auf der Seite.
const tmp = `${out}.tmp`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(tmp, gen), { recursive: true });
let bytes = 0;
for (const [key, data] of cells) {
  const json = JSON.stringify(data);
  bytes += json.length;
  writeFileSync(join(tmp, gen, `${key.replace(':', '_')}.json`), json);
}
const index = {
  gen,
  generated: new Date().toISOString(),
  osmBase: merged.osmBase,
  bbox: REGION.bbox,
  cellDeg: SOURCES.trails.cellDeg,
  cells: [...cells.keys()].sort(),
  counts: { ways: merged.ways.size, points: merged.peaks.size, cells: cells.size },
  bytes
};
writeFileSync(join(tmp, 'index.json'), JSON.stringify(index));
rmSync(out, { recursive: true, force: true });
renameSync(tmp, out);
console.log(`Fertig: ${cells.size} Zellen, ${merged.ways.size} Wege, ${(bytes / 1e6).toFixed(1)} MB, OSM-Stand ${merged.osmBase}`);
