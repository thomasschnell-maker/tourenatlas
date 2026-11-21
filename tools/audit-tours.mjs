#!/usr/bin/env node
// Wegeprüfung der vorgegebenen Touren: jede Tour wird wie in der App geroutet (BRouter, Profil je Aktivität)
// und Abschnitt für Abschnitt mit den OSM-Wegen der Regionsdaten abgeglichen. Gemeldet wird, was am Berg zählt:
// Rad auf Bergwegen/Stufen/mit Radverbot, Wandern auf alpinen Steigen, schlecht sichtbare Spuren, Sperrungen.
// Aufruf: node tools/audit-tours.mjs <Seiten-URL> <Zielordner>
// Ergebnis: <Ziel>/wegepruefung.json und <Ziel>/wegepruefung.md
// Grenzen: Regionsdaten enthalten Pfade, Wege, Fahrwege, Stufen – keine Strassen. Abschnitte auf Strassen
// erscheinen als „ohne Pfad-Zuordnung“ (unbedenklich); ausserhalb der Region (z. B. Aalen) wird nichts geprüft.

import { mkdirSync, writeFileSync } from 'node:fs';
import { ACTIVITIES, brouterUrlMulti } from '../js/packages/tours-core.js';
import { haversine } from '../js/geo.js';

const SAC = ['hiking', 'mountain_hiking', 'demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'];
const SAC_T = (s) => SAC.indexOf(s) + 1; // T1 … T6, 0 = unbekannt
const STEP_M = 20; // Abtastung entlang der Route
const MATCH_M = 12; // max. Abstand Route ↔ Weg
const MIN_RUN_M = 60; // kürzere Treffer sind meist Kreuzungen

/** Einstufung eines Weges für eine Aktivität → { level: 'warn'|'info', key, text } oder null (unbedenklich). */
export function classifyWay(p, activity) {
  const bike = activity !== 'hike';
  const t = SAC_T(p.sac_scale);
  const mtb = Number.parseFloat(p['mtb:scale']);
  const closed = /^(no|private)$/.test(p.access || '');
  if (bike) {
    if (p.highway === 'via_ferrata') return { level: 'warn', key: 'klettersteig', text: 'Klettersteig – mit Rad unmöglich' };
    if (p.highway === 'steps') return { level: 'warn', key: 'stufen', text: 'Treppe/Stufen – Rad tragen' };
    if (p.bicycle === 'no') return { level: 'warn', key: 'radverbot', text: 'Radfahren verboten (bicycle=no)' };
    if (closed && !/^(yes|designated|permissive)$/.test(p.bicycle || '')) return { level: 'warn', key: 'gesperrt', text: `Zufahrt gesperrt (access=${p.access})` };
    if (t >= 3) return { level: 'warn', key: 'bergweg-schwer', text: `Bergweg T${t} – mit Rad nicht fahrbar` };
    if (mtb >= 3) return { level: 'warn', key: 'mtb-schwer', text: `MTB-Skala S${mtb} – für Touren-/E-Bike zu schwer` };
    if (p.bicycle === 'dismount') return { level: 'info', key: 'absteigen', text: 'Absteigen und schieben (bicycle=dismount)' };
    if (t === 2) return { level: 'info', key: 'bergweg', text: 'Bergweg T2 – mit Rad meist schieben' };
    if (mtb === 2) return { level: 'info', key: 'mtb', text: 'MTB-Skala S2 – grobes Gelände' };
    if (/^(footway|pedestrian)$/.test(p.highway) && !/^(yes|designated|permissive)$/.test(p.bicycle || '')) return { level: 'info', key: 'fussweg', text: 'Fussweg – Radfahren nicht ausdrücklich erlaubt' };
    if (p.highway === 'path' && /^(bad|horrible|no)$/.test(p.trail_visibility || '')) return { level: 'warn', key: 'spur', text: 'Pfad kaum sichtbar' };
    return null;
  }
  if (p.highway === 'via_ferrata') return { level: 'warn', key: 'klettersteig', text: 'Klettersteig – Ausrüstung nötig' };
  if (closed || p.foot === 'no') return { level: 'warn', key: 'gesperrt', text: `Weg gesperrt (${p.foot === 'no' ? 'foot=no' : `access=${p.access}`})` };
  if (t >= 4) return { level: 'warn', key: 'alpin', text: `Alpiner Steig T${t} – Trittsicherheit, evtl. Kletterstellen` };
  if (/^(bad|horrible|no)$/.test(p.trail_visibility || '')) return { level: 'warn', key: 'spur', text: 'Spur kaum sichtbar – Orientierung schwierig' };
  if (t === 3) return { level: 'info', key: 'anspruchsvoll', text: 'Anspruchsvoller Bergweg T3 – trittsicher, schwindelfrei' };
  return null;
}

// Lokale Meter-Projektion um einen Bezugspunkt (genau genug für Abstände < 1 km)
function projector(lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return ([lon, lat]) => [lon * kx, lat * 110540];
}
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Wege → einfacher Rasterindex (≈ 200 m) für schnelle Nachbarsuche. */
export function indexWays(features) {
  const G = 0.002;
  const grid = new Map();
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const keys = new Set();
    for (const [lon, lat] of c) keys.add(`${Math.floor(lon / G)}:${Math.floor(lat / G)}`);
    for (const k of keys) (grid.get(k) || grid.set(k, []).get(k)).push(f);
  }
  return (lon, lat) => {
    const i = Math.floor(lon / G);
    const j = Math.floor(lat / G);
    const out = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const f of grid.get(`${i + a}:${j + b}`) || []) out.add(f);
    return out;
  };
}

/** Punkte alle STEP_M Meter entlang der Linie. */
export function sample(line, step = STEP_M) {
  const out = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const d = haversine(a, b);
    let pos = step - carry;
    while (pos <= d) {
      const t = pos / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      pos += step;
    }
    carry = d - (pos - step);
  }
  return out;
}

/**
 * Route gegen Wege abgleichen → Befunde (zusammenhängende Strecken gleicher Art, ab MIN_RUN_M) und Anteile.
 * near(lon, lat) liefert Kandidaten-Wege (indexWays).
 */
export function auditLine(line, near, activity) {
  const pts = sample(line);
  const proj = projector(line[0][1]);
  const hits = pts.map(([lon, lat]) => {
    const p = proj([lon, lat]);
    let best = null;
    let bestD = MATCH_M;
    for (const f of near(lon, lat)) {
      const c = f.geometry.coordinates;
      for (let k = 1; k < c.length; k++) {
        const d = segDist(p, proj(c[k - 1]), proj(c[k]));
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
    }
    return best;
  });
  const findings = [];
  let run = null;
  const close = () => {
    if (run && run.m >= MIN_RUN_M) findings.push(run);
    run = null;
  };
  let onPath = 0;
  hits.forEach((f, i) => {
    if (f) onPath++;
    const c = f ? classifyWay(f.properties, activity) : null;
    if (!c) return close();
    if (run && run.key === c.key) {
      run.m += STEP_M;
      if (f.properties.name) run.names.add(f.properties.name);
      return;
    }
    close();
    run = { ...c, m: 0, at: pts[i].map((v) => Math.round(v * 1e5) / 1e5), osm: `way/${f.properties.osm_id}`, names: new Set(f.properties.name ? [f.properties.name] : []) };
  });
  close();
  return {
    km: Math.round(((pts.length - 1) * STEP_M) / 100) / 10,
    pathShare: pts.length ? Math.round((onPath / pts.length) * 100) : 0,
    findings: findings.map((x) => ({ level: x.level, key: x.key, text: x.text, m: x.m, at: x.at, osm: x.osm, names: [...x.names].slice(0, 3) }))
  };
}

const inRegion = (bbox, [lon, lat]) => lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];

async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'tourenatlas-audit (github.com/thomasschnell-maker/tourenatlas)' }, signal: AbortSignal.timeout(90000) });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 3000 * 2 ** i));
  }
  throw last;
}

async function main() {
  const [site = 'https://thomasschnell-maker.github.io/tourenatlas/', outDir = 'live-check'] = process.argv.slice(2);
  const tours = await getJson(new URL('data/touren.json', site));
  const index = await getJson(new URL('data/cells/index.json', site));
  const have = new Set(index.cells);
  const [dLon, dLat] = index.cellDeg;
  const cellCache = new Map();
  const report = [];
  for (const t of tours) {
    const activity = t.activity || 'hike';
    const entry = { id: t.id, name: t.name, group: t.group, activity, stations: t.stations.length, missing: t.missing || [] };
    report.push(entry);
    try {
      const json = await getJson(brouterUrlMulti(t.stations.map((s) => s.lngLat), ACTIVITIES[activity].profile));
      const line = json.features[0].geometry.coordinates.map((c) => [c[0], c[1]]);
      // Benötigte Zellen laden (nur Teile der Route in der Region)
      const keys = new Set();
      for (const p of line) if (inRegion(index.bbox, p)) keys.add(`${Math.floor(p[0] / dLon)}:${Math.floor(p[1] / dLat)}`);
      const ways = [];
      for (const k of keys) {
        if (!have.has(k)) continue;
        if (!cellCache.has(k)) cellCache.set(k, (await getJson(new URL(`data/cells/${index.gen}/${k.replace(':', '_')}.json`, site))).ways.features);
        ways.push(...cellCache.get(k));
      }
      const regionShare = Math.round((line.filter((p) => inRegion(index.bbox, p)).length / line.length) * 100);
      Object.assign(entry, auditLine(line, indexWays(ways), activity), { regionShare });
      await new Promise((r) => setTimeout(r, 1500)); // öffentlichen BRouter schonen
    } catch (err) {
      entry.error = `Routing/Prüfung gescheitert: ${err.message}`;
    }
    const w = (entry.findings || []).filter((f) => f.level === 'warn').length;
    console.log(`${w ? '⚠' : '✓'} ${t.name}: ${entry.km ?? '?'} km, ${entry.pathShare ?? '?'} % auf Pfaden/Wegen, ${w} Warnungen${entry.error ? ` – ${entry.error}` : ''}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/wegepruefung.json`, JSON.stringify({ checked: new Date().toISOString(), osmBase: index.osmBase, tours: report }, null, 1));
  const md = [`# Wegeprüfung ${new Date().toISOString().slice(0, 10)} (OSM-Stand ${index.osmBase})`, ''];
  for (const e of report) {
    md.push(`## ${e.name} (${ACTIVITIES[e.activity]?.label ?? e.activity})`);
    if (e.error) md.push(`- ❌ ${e.error}`);
    else md.push(`- ${e.km} km · ${e.pathShare} % auf Pfaden/Wegen · ${e.regionShare} % in der Region`);
    for (const m of e.missing) md.push(`- ❌ Station fehlt: ${m}`);
    for (const f of e.findings || []) md.push(`- ${f.level === 'warn' ? '⚠️' : 'ℹ️'} ${f.text}: ${f.m} m${f.names.length ? ` (${f.names.join(', ')})` : ''} bei ${f.at[1]}, ${f.at[0]} – ${f.osm}`);
    md.push('');
  }
  writeFileSync(`${outDir}/wegepruefung.md`, md.join('\n'));
  // Rot nur bei technischem Scheitern; Befunde sind Hinweise zur Prüfung, kein Fehler der Seite
  if (report.some((e) => e.error)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => {
  console.error(`Wegeprüfung: ${err.message}`);
  process.exit(1);
});
