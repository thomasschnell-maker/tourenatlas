// Seen der Region als Beschriftungspunkte (eine Overpass-Abfrage) → data/seen.json.
// Die Grundkarte beschriftet kleine Bergseen erst sehr spät oder gar nicht; diese Datei füllt das.
// Aufruf: node tools/build-lakes.mjs <Ziel.json> [<Cache.json>]
// Scheitert die Abfrage, bleibt der letzte Stand aus dem Cache (wöchentlich aufgefrischt).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { REGION, SOURCES } from '../js/config.js';

const [out = 'site-data/seen.json', cacheFile = 'site-data/chunks/seen.json'] = process.argv.slice(2);
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : SOURCES.trails.endpoints;
const MAX_AGE_MS = 7 * 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, process.env.PAUSE_MS ? 0 : ms));

// Fliessgewässer und technische Becken sind keine Seen
const NOT_LAKE = '^(river|canal|stream|ditch|drain|wastewater|basin|moat|fish_pass|lock|stream_pool)$';

export function lakeQuery([w, s, e, n]) {
  const bbox = [s, w, n, e].map((v) => v.toFixed(5)).join(',');
  return `[out:json][timeout:180][bbox:${bbox}];
(
  way["natural"="water"]["name"]["water"!~"${NOT_LAKE}"];
  relation["natural"="water"]["name"]["water"!~"${NOT_LAKE}"];
  way["landuse"="reservoir"]["name"];
  relation["landuse"="reservoir"]["name"];
);
out tags bb qt;`;
}

const kmX = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Overpass-Antwort → GeoJSON-Punkte mit Fläche (grob aus der Umrandung) für Grösse und Zoomstufe. */
export function parseLakes(json) {
  if (!json || !Array.isArray(json.elements)) throw new Error('Ungültige Overpass-Antwort');
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark.slice(0, 80));
  const byName = new Map();
  for (const el of json.elements) {
    const b = el.bounds;
    const name = el.tags?.['name:de'] || el.tags?.name;
    if (!b || !name) continue;
    const lat = (b.minlat + b.maxlat) / 2;
    const lon = (b.minlon + b.maxlon) / 2;
    // Umrandung überschätzt; ~0,6 entspricht einer typischen Seeform
    const km2 = Math.round((b.maxlat - b.minlat) * 111.32 * (b.maxlon - b.minlon) * kmX(lat) * 0.6 * 1000) / 1000;
    const f = { type: 'Feature', geometry: { type: 'Point', coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] }, properties: { name, km2, osm: `${el.type}/${el.id}` } };
    // Seen aus mehreren Teilflächen mit gleichem Namen: grösste Fläche zählt
    const key = `${name}|${Math.round(lat * 20)}|${Math.round(lon * 20)}`;
    if (!byName.has(key) || byName.get(key).properties.km2 < km2) byName.set(key, f);
  }
  const features = [...byName.values()].sort((a, b) => b.properties.km2 - a.properties.km2);
  return { type: 'FeatureCollection', osmBase: json.osm3s?.timestamp_osm_base ?? null, features };
}

async function fetchLakes() {
  const body = new URLSearchParams({ data: lakeQuery(REGION.bbox) });
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body,
          headers: { 'User-Agent': 'tourenatlas-lakes-build (github.com/thomasschnell-maker/tourenatlas)' },
          signal: AbortSignal.timeout(200000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseLakes(await res.json());
      } catch (err) {
        last = new Error(`${new URL(url).host}: ${err.message}`);
        console.warn(`  ${last.message}`);
        await sleep(5000);
      }
    }
  }
  throw last;
}

async function main() {
  const old = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
  let data = old;
  if (!old || Date.now() - Date.parse(old.fetched || 0) > MAX_AGE_MS) {
    try {
      data = { ...(await fetchLakes()), fetched: new Date().toISOString() };
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(data));
    } catch (err) {
      if (!old) throw err;
      console.warn(`Seen: Abfrage gescheitert (${err.message}) → letzter Stand bleibt`);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data));
  console.log(`Seen: ${data.features.length} (grösste: ${data.features.slice(0, 5).map((f) => f.properties.name).join(', ')}) → ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error(`Seen: ${err.message}`);
  process.exit(1);
});
