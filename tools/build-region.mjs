#!/usr/bin/env node
// Erzeugt die Regionsdaten (Bergwege, Radrouten, Gipfel, Hütten) für die ganze Region als Zellen-Dateien.
// Läuft in GitHub Actions. Aufruf: node tools/build-region.mjs <Zielordner> [<Teilabfragen-Ordner>]
// Nutzt dieselbe Abfrage und denselben Parser wie die App → identische Daten, nur vorab.
//
// Robust gegen überlastete öffentliche Overpass-Server:
//  - kleine Teilabfragen; scheitert eine, wird sie geviertelt und erneut versucht
//  - jede erfolgreiche Teilabfrage wird gespeichert (Actions-Cache) → der nächste Lauf macht dort weiter
//  - Zeitbudget: danach werden die vorhandenen Daten trotzdem ausgeliefert, fehlende Gebiete
//    stehen als `holes` im Index und werden von der App dort live abgefragt

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { REGION, SOURCES } from '../js/config.js';
import { buildQuery, parseOverpass } from '../js/overpass.js';
import { splitIntoCells } from '../js/region.js';

const out = process.argv[2] || 'site-data/cells';
const chunkDir = process.argv[3] || 'site-data/chunks';
// Für Tests: OVERPASS_URL (eigener Server), PAUSE_MS (Pause zwischen Abfragen), BUDGET_MIN (Zeitbudget).
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : SOURCES.trails.endpoints;
const PAUSE = Number(process.env.PAUSE_MS ?? 2000);
const BUDGET_MS = Number(process.env.BUDGET_MIN ?? 40) * 60000;
const CHUNK = [0.1, 0.075]; // ~7,5 × 8,3 km je Abfrage; bei Fehlern bis auf 1/16 davon geteilt
const MAX_DEPTH = 2;
const TRIES = 3; // je Teilabfrage und Ebene – danach lieber teilen als warten
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const bboxName = (b) => b.map((v) => r5(v).toFixed(5)).join('_');
let endpointTurn = 0;

async function query(bbox) {
  const body = new URLSearchParams({ data: buildQuery(bbox, 120) });
  let last;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const url = ENDPOINTS[endpointTurn++ % ENDPOINTS.length]; // reihum, damit kein Server allein trägt
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'User-Agent': 'tourenatlas-region-build (github.com/thomasschnell-maker/tourenatlas)' },
        signal: AbortSignal.timeout(150000)
      });
      if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(`${new URL(url).host}: ${json.remark.slice(0, 80)}`);
      return parseOverpass(json);
    } catch (err) {
      last = err;
      console.warn(`    Versuch ${attempt + 1} fehlgeschlagen: ${err.message}`);
      await sleep((process.env.PAUSE_MS ? 20 : 5000) * (attempt + 1));
    }
  }
  throw last;
}

const quarters = ([w, s, e, n]) => {
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  return [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]];
};

const fileFor = (bbox) => join(chunkDir, `${bboxName(bbox)}.json`);
const cached = (bbox, depth) => existsSync(fileFor(bbox)) || (depth < MAX_DEPTH && quarters(bbox).some((q) => cached(q, depth + 1)));

/** Liefert die geladenen Teilgebiete; Gebiete, die nicht geladen werden konnten, landen in `holes`. */
async function load(bbox, depth, results, holes) {
  const file = fileFor(bbox);
  if (existsSync(file)) return results.push({ ...JSON.parse(readFileSync(file, 'utf8')), file });
  if (Date.now() - started > BUDGET_MS) return holes.push(bbox.map(r5));
  // Schon einmal geteilt (Teilstücke im Cache) → nicht erneut das ganze Gebiet probieren
  if (depth < MAX_DEPTH && quarters(bbox).some((q) => cached(q, depth + 1))) {
    for (const q of quarters(bbox)) await load(q, depth + 1, results, holes);
    return;
  }
  try {
    const t0 = Date.now();
    const r = await query(bbox);
    writeFileSync(file, JSON.stringify(r));
    results.push({ ...r, file });
    console.log(`  ${bboxName(bbox)}: ${r.ways.features.length} Wege, ${r.peaks.features.length} Punkte, ${r.routes.features.length} Routen (${Date.now() - t0} ms)`);
    await sleep(PAUSE); // fair gegenüber dem öffentlichen Server
  } catch (err) {
    if (depth >= MAX_DEPTH) {
      console.warn(`  ${bboxName(bbox)}: aufgegeben (${err.message}) → Lücke, App lädt dort live`);
      return holes.push(bbox.map(r5));
    }
    console.warn(`  ${bboxName(bbox)}: zu gross/überlastet → vierteln`);
    for (const q of quarters(bbox)) await load(q, depth + 1, results, holes);
  }
}

mkdirSync(chunkDir, { recursive: true });
const [W, S, E, N] = REGION.bbox;
const chunks = [];
for (let x = W; x < E - 1e-9; x += CHUNK[0]) for (let y = S; y < N - 1e-9; y += CHUNK[1]) chunks.push([x, y, Math.min(E, x + CHUNK[0]), Math.min(N, y + CHUNK[1])].map(r5));
console.log(`Region ${REGION.name}: ${chunks.length} Teilabfragen, Zeitbudget ${BUDGET_MS / 60000} min`);

const results = [];
const holes = [];
for (const [i, bbox] of chunks.entries()) {
  console.log(`${i + 1}/${chunks.length}`);
  await load(bbox, 0, results, holes);
}

if (!results.length) {
  console.error('Keine Teilabfrage erfolgreich – keine Regionsdaten.');
  process.exit(1);
}

const merged = { ways: new Map(), peaks: new Map(), routes: new Map(), osmBase: null };
results.forEach((r, i) => {
  for (const f of r.ways.features) merged.ways.set(f.properties.osm_id, f);
  for (const f of r.peaks.features) merged.peaks.set(f.properties.osm_id, f);
  // Radrouten sind je Abfrage beschnitten → Teilstücke je Abfrage sammeln (Schlüssel inkl. Abfrage)
  r.routes.features.forEach((f, k) => merged.routes.set(`${i}/${f.properties.osm_id}/${k}`, f));
  if (r.meta?.osmBase && (!merged.osmBase || r.meta.osmBase < merged.osmBase)) merged.osmBase = r.meta.osmBase; // ältester Stand zählt
});

const cells = splitIntoCells(
  {
    ways: { features: [...merged.ways.values()] },
    peaks: { features: [...merged.peaks.values()] },
    routes: { features: [...merged.routes.values()] }
  },
  SOURCES.trails.cellDeg
);

// Generation aus dem Inhalt: gleiche Teilabfragen → gleiche Dateinamen → Geräte behalten ihren Offline-Speicher.
const gen = createHash('sha1').update(JSON.stringify([results.map((r) => r.file).sort(), holes, merged.osmBase])).digest('hex').slice(0, 12);
// Erst in einen Zwischenordner schreiben und nur bei Erfolg umbenennen – nie halbe Dateien auf der Seite.
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
  holes,
  counts: { ways: merged.ways.size, points: merged.peaks.size, cells: cells.size },
  bytes
};
writeFileSync(join(tmp, 'index.json'), JSON.stringify(index));
rmSync(out, { recursive: true, force: true });
renameSync(tmp, out);
console.log(`Fertig: ${cells.size} Zellen, ${merged.ways.size} Wege, ${(bytes / 1e6).toFixed(1)} MB, OSM-Stand ${merged.osmBase}, Lücken ${holes.length}`);
if (holes.length) console.log(`::warning::${holes.length} Teilgebiete fehlen noch – nächster Lauf macht dort weiter`);
