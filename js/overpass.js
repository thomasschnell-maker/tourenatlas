// OSM-Wege und Gipfel über die Overpass API – mit Validierung der Antwort.
// Wichtig: Overpass liefert bei Timeouts/Speicherlimits HTTP 200 mit einem
// "remark"-Feld und unvollständigen Daten. Das wird hier als Fehler behandelt.

import { WAY_HIGHWAYS } from './config.js';

export function buildQuery([w, s, e, n]) {
  const bbox = [s, w, n, e].map((v) => v.toFixed(5)).join(',');
  const hw = WAY_HIGHWAYS.join('|');
  return `[out:json][timeout:25][bbox:${bbox}];
(
  way["highway"~"^(${hw})$"];
  way["highway"]["sac_scale"];
  way["aerialway"~"^(cable_car|gondola|mixed_lift|chair_lift|drag_lift|t-bar|j-bar|platter|rope_tow|magic_carpet|zip_line)$"];
);
out meta geom qt;
(
  node["natural"~"^(peak|saddle)$"];
  node["tourism"~"^(alpine_hut|wilderness_hut)$"];
);
out meta qt;`;
}

const WAY_TAGS = ['highway', 'aerialway', 'sac_scale', 'mtb:scale', 'trail_visibility', 'name', 'surface', 'tracktype', 'incline', 'ref', 'access', 'foot', 'bicycle'];

/** Wandelt eine Overpass-JSON-Antwort in zwei GeoJSON-Collections und Metadaten um. */
export function parseOverpass(json) {
  if (!json || !Array.isArray(json.elements)) throw new Error('Ungültige Overpass-Antwort: elements fehlt');
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) {
    throw new Error(`Overpass unvollständig: ${json.remark.trim()}`);
  }
  const ways = [];
  const peaks = [];
  let dropped = 0;
  const seen = new Set();

  for (const el of json.elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue; // die zwei Way-Teilabfragen überlappen
    seen.add(key);
    const tags = el.tags || {};
    if (el.type === 'way') {
      const coords = (el.geometry || [])
        .filter((p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))
        .map((p) => [p.lon, p.lat]);
      if (coords.length < 2) {
        dropped++;
        continue;
      }
      const props = { osm_id: el.id, osm_type: 'way', version: el.version ?? null, timestamp: el.timestamp ?? null };
      for (const t of WAY_TAGS) if (tags[t] != null) props[t] = tags[t];
      ways.push({ type: 'Feature', id: el.id, geometry: { type: 'LineString', coordinates: coords }, properties: props });
    } else if (el.type === 'node' && Number.isFinite(el.lon) && Number.isFinite(el.lat)) {
      const ele = parseEle(tags.ele);
      peaks.push({
        type: 'Feature',
        id: el.id,
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
        properties: {
          osm_id: el.id,
          osm_type: 'node',
          kind: tags.natural ?? tags.tourism,
          name: tags.name ?? null,
          ele_osm: ele,
          ele_raw: tags.ele ?? null,
          timestamp: el.timestamp ?? null
        }
      });
    }
  }
  return {
    ways: { type: 'FeatureCollection', features: ways },
    peaks: { type: 'FeatureCollection', features: peaks },
    meta: { osmBase: json.osm3s?.timestamp_osm_base ?? null, dropped }
  };
}

/** OSM-"ele" ist Freitext. Akzeptiert "4158", "4158.2", "4158 m"; Fuss und Unsinn → null. */
export function parseEle(raw) {
  if (raw == null) return null;
  const m = String(raw).trim().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*(m)?$/i);
  if (!m) return null;
  const v = Number(m[1]);
  return v > -500 && v < 9000 ? v : null;
}

/** Fragt die Endpunkte der Reihe nach ab (Failover), mit Abbruch-Signal. */
export async function fetchOverpass(bbox, endpoints, signal, timeoutMs = 30000) {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  let lastErr;
  for (const url of endpoints) {
    // Eigenes Zeitlimit je Server, ohne das äussere Abbruchsignal zu verlieren.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('Zeitlimit')), timeoutMs);
    const relay = () => ctl.abort(signal.reason);
    signal?.addEventListener('abort', relay, { once: true });
    try {
      const res = await fetch(url, { method: 'POST', body, signal: ctl.signal });
      if (res.status === 429 || res.status === 504) throw new Error(`${new URL(url).host}: überlastet (${res.status})`);
      if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
      return { ...parseOverpass(await res.json()), endpoint: new URL(url).host };
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = ctl.signal.aborted ? new Error(`${new URL(url).host}: Zeitlimit`) : err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  }
  throw lastErr ?? new Error('Kein Overpass-Endpunkt erreichbar');
}
