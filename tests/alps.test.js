import test from 'node:test';
import assert from 'node:assert/strict';
import { alpQuery, parseAlps } from '../tools/build-alps.mjs';
import { alpLayers } from '../js/styles.js';

test('alpQuery: Hütten und Alp-Namen, Strassen/Haltestellen/Weiden ausgeschlossen', () => {
  const q = alpQuery([10, 47, 10.5, 47.5]);
  assert.match(q, /\[bbox:47\.00000,10\.00000,47\.50000,10\.50000\]/);
  assert.match(q, /alpine_hut\|wilderness_hut/);
  assert.match(q, /\(alpe\|alp\|alm\|hütte\|huette\)\$",i\]/);
  for (const k of ['highway', 'public_transport', 'landuse', 'leisure', 'man_made']) assert.ok(q.includes(`["${k}"!~"."]`), k);
  assert.match(q, /out tags center qt;/);
});

test('parseAlps: Gebäude/Gaststätten mit Alp-Namen, Mittelpunkt bei Flächen, Doppelte zusammengefasst', () => {
  const r = parseAlps({
    osm3s: { timestamp_osm_base: '2026-11-09T00:00:00Z' },
    elements: [
      // Bärenmoosalpe: als Gaststätte (Knoten) und als Gebäude (Fläche) erfasst → einmal, als Einkehr
      { type: 'way', id: 1, center: { lat: 47.5574, lon: 10.49688 }, tags: { building: 'farm', name: 'Bärenmoosalpe' } },
      { type: 'node', id: 2, lat: 47.5575, lon: 10.4969, tags: { amenity: 'restaurant', name: 'Bärenmoosalpe', ele: '1185' } },
      { type: 'node', id: 3, lat: 47.5487, lon: 10.55137, tags: { tourism: 'alpine_hut', name: 'Ostlerhütte', ele: '1838,5' } },
      { type: 'way', id: 4, center: { lat: 47.6, lon: 10.4 }, tags: { building: 'yes', name: 'Alpe Gund' } },
      // gleicher Name weit weg: eigene Alpe
      { type: 'node', id: 5, lat: 47.3, lon: 10.1, tags: { name: 'Alpe Gund' } },
      { type: 'node', id: 6, lat: 47.3, lon: 10.1, tags: {} }, // ohne Namen
      { type: 'way', id: 7, tags: { name: 'Ohne Lage-Alpe' } }, // ohne Mittelpunkt
      { type: 'node', id: 8, lat: 47.52, lon: 10.55, tags: { name: 'Terrasse der Hochalphütte' } }, // Nebenobjekt
      { type: 'node', id: 9, lat: 47.53, lon: 10.56, tags: { name: 'Parkplatz Vilsalm' } },
      { type: 'node', id: 10, lat: 47.54, lon: 10.52, tags: { name: 'Achtal Achtalstraße Bärenmoosalpe' } }
    ]
  });
  assert.equal(r.osmBase, '2026-11-09T00:00:00Z');
  const by = Object.fromEntries(r.features.map((f) => [`${f.properties.name}@${f.geometry.coordinates[1]}`, f.properties]));
  assert.equal(r.features.length, 4);
  assert.equal(by['Bärenmoosalpe@47.5575'].kind, 'einkehr');
  assert.equal(by['Bärenmoosalpe@47.5575'].ele, 1185);
  assert.equal(by['Ostlerhütte@47.5487'].kind, 'huette');
  assert.equal(by['Ostlerhütte@47.5487'].ele, 1839);
  assert.equal(by['Alpe Gund@47.6'].kind, 'alpe');
  assert.equal(by['Alpe Gund@47.6'].osm, 'way/4');
  assert.equal(r.features[0].properties.kind, 'huette'); // Hütten zuerst
  assert.throws(() => parseAlps({ remark: 'runtime error: timed out', elements: [] }));
});

test('alpLayers: Punkte und Namen, folgen dem Schalter „Gipfel & Hütten“', () => {
  const on = alpLayers({ visibility: { peaks: true } });
  assert.deepEqual(on.map((l) => l.id), ['alp-points', 'alp-labels']);
  assert.ok(on.every((l) => l.source === 'alps' && l.layout.visibility === 'visible'));
  assert.ok(alpLayers({ visibility: { peaks: false } }).every((l) => l.layout.visibility === 'none'));
  assert.equal(alpLayers({ visibility: {}, dark: true })[1].paint['text-color'], '#ffe0c2');
});
