/* global maplibregl */
// Ortssuche über Nominatim (OpenStreetMap). Nutzungsregeln: max. 1 Anfrage/s, keine Suche je
// Tastendruck – deshalb nur beim Absenden. Koordinaten werden lokal erkannt (keine Anfrage).

import { REGION } from './config.js';

export const SEARCH = {
  url: 'https://nominatim.openstreetmap.org/search',
  attribution: 'Suche: <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> · © OpenStreetMap-Mitwirkende'
};

/** "47.42, 10.34" / "47,42 10,34" / "N 47.42 E 10.34" → [lon, lat] oder null. */
export function parseCoords(q) {
  const m = String(q).trim().replace(/[NE]/gi, ' ').match(/^\s*(-?\d{1,2}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

export function searchUrl(q, bbox = REGION.bbox) {
  const [w, s, e, n] = bbox;
  const p = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '8',
    'accept-language': 'de',
    countrycodes: 'de,at,ch,li',
    viewbox: `${w},${n},${e},${s}`, // Region bevorzugen, aber nicht ausschliessen
    bounded: '0'
  });
  return `${SEARCH.url}?${p}`;
}

const TYPE_LABEL = {
  peak: 'Gipfel', saddle: 'Sattel', alpine_hut: 'Berghütte', wilderness_hut: 'Hütte', village: 'Dorf', town: 'Stadt',
  city: 'Stadt', hamlet: 'Weiler', isolated_dwelling: 'Einzelhof', lake: 'See', water: 'Gewässer', aerialway: 'Bergbahn',
  station: 'Station', parking: 'Parkplatz', viewpoint: 'Aussichtspunkt', guest_house: 'Gasthaus', hotel: 'Hotel',
  restaurant: 'Gasthaus', administrative: 'Gemeinde', suburb: 'Ortsteil', locality: 'Flur'
};

/** Prüft und vereinfacht die Antwort; Treffer in der Region zuerst. */
export function parseResults(json, bbox = REGION.bbox) {
  if (!Array.isArray(json)) throw new Error('Suche: ungültige Antwort');
  const [w, s, e, n] = bbox;
  return json
    .map((r) => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const bb = (r.boundingbox || []).map(Number); // [s, n, w, e]
      return {
        name: r.name || String(r.display_name || '').split(',')[0],
        detail: String(r.display_name || '').split(',').slice(1, 3).join(',').trim(),
        type: TYPE_LABEL[r.type] || TYPE_LABEL[r.category] || r.type || '',
        lngLat: [lon, lat],
        bounds: bb.length === 4 && bb.every(Number.isFinite) ? [bb[2], bb[0], bb[3], bb[1]] : null,
        inRegion: lon >= w && lon <= e && lat >= s && lat <= n,
        osm: r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.inRegion) - Number(a.inRegion));
}

/**
 * Mehrere Orte aus einer Eingabe: "Sonthofen, Burgberg; Immenstadt". Eine einzelne Koordinate
 * ("47.42, 10.34") bleibt zusammen; Koordinaten in Listen mit ";" trennen.
 */
export function splitPlaces(q) {
  const t = String(q).trim();
  if (!t) return [];
  if (parseCoords(t)) return [t];
  const parts = t.includes(';') || t.includes('\n') ? t.split(/[;\n]+/) : t.split(',');
  return parts.map((x) => x.trim()).filter(Boolean);
}

// Nominatim-Regel: höchstens eine Anfrage pro Sekunde – gilt für alle Suchen der App gemeinsam.
let lastRequest = 0;

/** Ort suchen (Koordinaten lokal, sonst Nominatim). Liefert geprüfte Treffer, Region zuerst. */
export async function geocode(q) {
  const c = parseCoords(q);
  if (c) return [{ name: q.trim(), detail: 'Koordinate', type: '', lngLat: c, bounds: null, inRegion: true, osm: null }];
  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(searchUrl(q), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  return parseResults(await res.json());
}

/**
 * Plausibelsten Treffer für eine Tourstation wählen: in der Region und höchstens maxKm von der
 * vorherigen Station (gleichnamige Orte gibt es oft mehrfach, z. B. Rohrmoos, Tiefenbach).
 * Liefert { hit, reason } – hit null, wenn kein Treffer plausibel ist.
 */
export function pickCandidate(results, prev, maxKm = 25) {
  const R = 6371;
  const km = (a, b) => {
    const r = Math.PI / 180;
    const x = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  const inRegion = results.filter((r) => r.inRegion);
  if (!inRegion.length) return { hit: null, reason: 'nur Treffer ausserhalb der Region' };
  if (!prev) return { hit: inRegion[0], reason: null };
  const near = inRegion.map((r) => ({ r, d: km(prev, r.lngLat) })).filter((x) => x.d <= maxKm).sort((a, b) => a.d - b.d);
  // Reihenfolge der Suche (Relevanz) respektieren, solange nah genug; sonst den nächstgelegenen.
  const firstNear = inRegion.find((r) => km(prev, r.lngLat) <= maxKm);
  if (firstNear) return { hit: firstNear, reason: null };
  return near.length ? { hit: near[0].r, reason: null } : { hit: null, reason: `nächster Treffer ${Math.round(km(prev, inRegion[0].lngLat))} km von der vorherigen Station` };
}

/** Treffer als Station an die Touren übergeben (Touren-Paket hört auf dieses Ereignis). */
export function pinAsStation(r) {
  window.dispatchEvent(new CustomEvent('ta:pin', { detail: { name: r.name, lngLat: r.lngLat } }));
}

/** Suchfeld oben links verdrahten. */
export function initSearch({ map, toast, esc }) {
  const form = document.getElementById('search');
  const input = form.querySelector('input');
  const list = document.getElementById('search-results');
  let marker = null;

  const close = () => {
    list.hidden = true;
    list.innerHTML = '';
  };

  const go = (r) => {
    close();
    input.blur();
    marker = marker || new maplibregl.Marker({ color: '#0f6e5a' });
    marker.setLngLat(r.lngLat).addTo(map);
    const small = !r.bounds || (r.bounds[2] - r.bounds[0] < 0.02 && r.bounds[3] - r.bounds[1] < 0.02);
    if (small) map.flyTo({ center: r.lngLat, zoom: 14.5, pitch: 60, duration: 2200, essential: true });
    else map.fitBounds(r.bounds, { padding: 40, pitch: 45, maxZoom: 14.5, duration: 2200 });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return close();
    toast('Suche …', { busy: true });
    try {
      const results = await geocode(q);
      toast('');
      if (results.length === 1 && !results[0].osm) return go(results[0]); // Koordinate
      if (!results.length) {
        list.innerHTML = '<li class="muted">Nichts gefunden</li>';
        list.hidden = false;
        return;
      }
      list.innerHTML = results
        .map(
          (r, i) => `<li class="hit"><button type="button" data-i="${i}"><b>${esc(r.name)}</b><small>${esc([r.type, r.detail].filter(Boolean).join(' · '))}</small></button>
            <button type="button" class="pin" data-pin="${i}" title="Als Station zur Tour hinzufügen">+ Station</button></li>`
        )
        .join('') + `<li class="muted attr">${SEARCH.attribution}</li>`;
      list.hidden = false;
      list.onclick = (ev) => {
        const pin = ev.target.closest('button[data-pin]')?.dataset.pin;
        if (pin != null) {
          pinAsStation(results[Number(pin)]);
          close();
          return;
        }
        const i = ev.target.closest('button[data-i]')?.dataset.i;
        if (i != null) go(results[Number(i)]);
      };
    } catch (err) {
      toast(`Suche fehlgeschlagen: ${err.message}`, { error: true, ttl: 6000 });
    }
  });

  input.addEventListener('input', () => !input.value && close());
  map.on('movestart', (e) => e.originalEvent && close());
}
