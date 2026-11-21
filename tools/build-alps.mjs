// Alpen, Almen und Hütten der Region als beschriftete Punkte (eine Overpass-Abfrage) → data/alpen.json.
// Die Grundkarte zeigt viele Alpen gar nicht: Sie sind als Gebäude, Gaststätte oder Ortsteil erfasst
// („Bärenmoosalpe“, „Alpe Gund“), nicht als Hütte. Diese Datei sammelt alles mit Alp-/Alm-/Hütten-Namen.
// Aufruf: node tools/build-alps.mjs <Ziel.json> [<Cache.json>]
// Scheitert die Abfrage, bleibt der letzte Stand aus dem Cache (wöchentlich aufgefrischt).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { REGION, SOURCES } from '../js/config.js';

const [out = 'site-data/alpen.json', cacheFile = 'site-data/chunks/alpen.json'] = process.argv.slice(2);
const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : SOURCES.trails.endpoints;
const MAX_AGE_MS = 7 * 86400000;
const FORMAT = 3; // erhöhen, wenn sich Abfrage/Filter ändern: Cache wird dann sofort neu geholt
const sleep = (ms) => new Promise((r) => setTimeout(r, process.env.PAUSE_MS ? 0 : ms));

// Filter laufen hier lokal, nicht in Overpass: viele Tag-Ausschlüsse machen die Abfrage über die ganze
// Region so teuer, dass alle Server in den Timeout laufen.
// Strassen („Alpenstraße“), Haltestellen („Alpe Eck“), Weiden, Gipfel, Parkplätze, Spielplätze,
// Wasserversorgung, Pisten und Infotafeln („Trauerschnäpper/Zilpzalp“) tragen oft Alp-Namen – keine Alpen.
const EXCLUDE_KEYS = ['highway', 'public_transport', 'railway', 'landuse', 'natural', 'boundary', 'waterway', 'route', 'leisure', 'man_made', 'piste:type', 'power', 'barrier', 'emergency'];
const EXCLUDE_AMENITY = /^(parking|parking_entrance|bicycle_parking|toilets|shelter|bench|waste_basket|drinking_water|recycling|fountain)$/;
const EXCLUDE_TOURISM = /^(information|artwork|viewpoint|picnic_site|camp_site|attraction)$/;
const isSideObject = (t) =>
  EXCLUDE_KEYS.some((k) => t[k] != null) || EXCLUDE_AMENITY.test(t.amenity || '') || EXCLUDE_TOURISM.test(t.tourism || '') || /^(region|county|municipality)$/.test(t.place || '');
// Namen von Nebenobjekten einer Hütte („Terrasse der Hochalphütte“, „Parkplatz Vilsalm“, Haltestellen)
const SIDE_NAME = /(straße|strasse|parkplatz|nebengebäude|terrasse|spielplatz|wasserversorgung|pumpstation|skitour|haltestelle|toilette|zufahrt|lift\b)/i;

export function alpQuery([w, s, e, n]) {
  const bbox = [s, w, n, e].map((v) => v.toFixed(5)).join(',');
  return `[out:json][timeout:180][bbox:${bbox}];
(
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"];
  nwr["name"~"(alpe|alp|alm|hütte|huette)$",i];
  nwr["name"~"^(alpe|alp|alm) ",i];
);
out tags center qt;`;
}

const RANK = { huette: 3, einkehr: 2, alpe: 1 };

/** Art: bewirtschaftete/unbewirtschaftete Hütte, Einkehr (Gaststätte mit Alp-Namen) oder sonstige Alpe. */
function kindOf(tags) {
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut') return 'huette';
  if (/^(restaurant|cafe|biergarten|pub|fast_food)$/.test(tags.amenity || '') || tags.tourism === 'guest_house' || tags.tourism === 'hotel') return 'einkehr';
  return 'alpe';
}

/** Overpass-Antwort → GeoJSON-Punkte {name, kind, ele, osm}; gleicher Name im Umkreis ~300 m nur einmal (wichtigste Art zählt). */
export function parseAlps(json) {
  if (!json || !Array.isArray(json.elements)) throw new Error('Ungültige Overpass-Antwort');
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark.slice(0, 80));
  const byKey = new Map();
  for (const el of json.elements) {
    const name = el.tags?.['name:de'] || el.tags?.name;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kind = kindOf(el.tags);
    if (kind !== 'huette' && (isSideObject(el.tags) || SIDE_NAME.test(name))) continue;
    const ele = Number.parseFloat(String(el.tags.ele ?? '').replace(',', '.'));
    const f = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] },
      properties: { name, kind, ...(Number.isFinite(ele) ? { ele: Math.round(ele) } : {}), osm: `${el.type}/${el.id}` }
    };
    const key = `${name.toLowerCase()}|${Math.round(lat * 300)}|${Math.round(lon * 200)}`;
    const old = byKey.get(key);
    if (!old || RANK[kind] > RANK[old.properties.kind]) byKey.set(key, f);
  }
  const features = [...byKey.values()].sort((a, b) => RANK[b.properties.kind] - RANK[a.properties.kind] || a.properties.name.localeCompare(b.properties.name, 'de'));
  return { type: 'FeatureCollection', osmBase: json.osm3s?.timestamp_osm_base ?? null, features };
}

async function fetchAlps() {
  const body = new URLSearchParams({ data: alpQuery(REGION.bbox) });
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body,
          headers: { 'User-Agent': 'tourenatlas-alps-build (github.com/thomasschnell-maker/tourenatlas)' },
          signal: AbortSignal.timeout(200000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = parseAlps(await res.json());
        // Leere Antwort trotz HTTP 200 (überlasteter Server): nicht als neuen Stand übernehmen
        if (data.features.length < 50) throw new Error(`nur ${data.features.length} Treffer – unplausibel`);
        return data;
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
  if (!old || old.format !== FORMAT || Date.now() - Date.parse(old.fetched || 0) > MAX_AGE_MS) {
    try {
      data = { ...(await fetchAlps()), format: FORMAT, fetched: new Date().toISOString() };
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(data));
    } catch (err) {
      if (!old) throw err;
      console.warn(`Alpen: Abfrage gescheitert (${err.message}) → letzter Stand bleibt`);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data));
  const n = (k) => data.features.filter((f) => f.properties.kind === k).length;
  console.log(`Alpen: ${data.features.length} (Hütten ${n('huette')}, Einkehr ${n('einkehr')}, Alpen ${n('alpe')}) → ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error(`Alpen: ${err.message}`);
  process.exit(1);
});
