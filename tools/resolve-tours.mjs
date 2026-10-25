#!/usr/bin/env node
// Vorgegebene Touren: Ortsnamen → Koordinaten, einmal beim Veröffentlichen statt auf dem Handy.
// Aufruf: node tools/resolve-tours.mjs data/touren-quelle.json <Ziel touren.json>
// Prüfungen je Station: nur Treffer im Gebiet (viewbox, bounded) und höchstens maxStepKm von der vorherigen
// Station. Nicht auflösbare Stationen fallen weg und stehen in `missing` (die App zeigt das an).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [src = 'data/touren-quelle.json', out = 'data/touren.json'] = process.argv.slice(2);
const SEARCH = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const PAUSE = Number(process.env.PAUSE_MS ?? 1100); // Nutzungsregel Nominatim: max. 1 Anfrage/s
const cfg = JSON.parse(readFileSync(src, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const km = (a, b) => {
  const r = Math.PI / 180;
  const x = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};

const cache = new Map();
async function search(q) {
  if (cache.has(q)) return cache.get(q);
  const [w, s, e, n] = cfg.viewbox;
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '5', 'accept-language': 'de', countrycodes: 'de,at', viewbox: `${w},${n},${e},${s}`, bounded: '1' });
  await sleep(PAUSE);
  const res = await fetch(`${SEARCH}?${p}`, { headers: { 'User-Agent': 'tourenatlas-build (github.com/thomasschnell-maker/tourenatlas)' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const hits = (await res.json()).map((h) => ({ lngLat: [Number(h.lon), Number(h.lat)], display: h.display_name, type: `${h.category}/${h.type}`, osm: `${h.osm_type}/${h.osm_id}` }));
  cache.set(q, hits);
  return hits;
}

/** Station auflösen: Suchbegriffe der Reihe nach, erster Treffer nah genug an der vorherigen Station. */
async function resolve(st, prev) {
  const tried = [];
  for (const q of st.q) {
    // Bevorzugte Kategorie zuerst (z. B. place: Ortsmitte statt Mittelpunkt der Gemeindefläche)
    const hits = (await search(q)).slice().sort((a, b) => (st.prefer ? !a.type.startsWith(st.prefer) - !b.type.startsWith(st.prefer) : 0));
    const ok = hits.find((h) => !prev || km(prev, h.lngLat) <= (cfg.maxStepKm || 10));
    if (ok) return { ...ok, query: q };
    tried.push(`${q}: ${hits.length ? `${hits.length} Treffer, alle > ${cfg.maxStepKm} km` : 'kein Treffer'}`);
  }
  return { error: tried.join('; ') };
}

const resolved = new Map(); // gleiche Station (Segment + Index) nur einmal suchen
const result = [];
let failures = 0;
for (const t of cfg.tours) {
  const stations = [];
  const missing = [];
  const landmarks = [];
  for (const seg of t.segments) {
    for (const [i, st] of cfg.segments[seg].entries()) {
      const prev = stations.at(-1)?.lngLat;
      const key = `${seg}/${i}/${prev?.join(',')}`;
      const r = resolved.get(key) || (await resolve(st, prev));
      resolved.set(key, r);
      if (r.error) {
        missing.push(`${st.name} (${r.error})`);
        if (!st.optional) failures++;
        console.log(`  ✗ ${t.id} · ${st.name}: ${r.error}`);
        continue;
      }
      if (st.landmark) {
        // Orientierungspunkt (z. B. Abzweigung): nur prüfen und merken, die Strecke führt nicht dorthin
        landmarks.push({ name: st.name, lngLat: r.lngLat, display: r.display });
        console.log(`  · ${t.id} · Orientierung ${st.name} ← „${r.query}“ ${r.type} ${r.lngLat.map((v) => v.toFixed(4)).join(', ')} (${km(prev, r.lngLat).toFixed(1)} km von ${stations.at(-1).name}) · ${r.display}`);
        continue;
      }
      // Gleiche Station wie die vorherige (z. B. Ende Hinweg = Start Rückweg) nicht doppelt
      if (prev && km(prev, r.lngLat) < 0.05) continue;
      stations.push({ name: st.name, lngLat: r.lngLat.map((v) => Math.round(v * 1e5) / 1e5), source: { query: r.query, osm: r.osm, type: r.type, display: r.display } });
      console.log(`  ✓ ${t.id} · ${st.name} ← „${r.query}“ ${r.type} ${r.lngLat.map((v) => v.toFixed(4)).join(', ')}${prev ? ` (${km(prev, r.lngLat).toFixed(1)} km)` : ''} · ${r.display}`);
    }
  }
  const { segments, ...meta } = t;
  result.push({ ...meta, stations, missing, landmarks });
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`Fertig: ${result.length} Touren, ${result.reduce((s, t) => s + t.stations.length, 0)} Stationen, ${failures} nicht auflösbar → ${out}`);
