import test from 'node:test';
import assert from 'node:assert/strict';
import { cellInBbox, splitIntoCells } from '../js/region.js';
import { cellKey } from '../js/cells.js';

const SIZE = [0.04, 0.03];
const line = (id, coords, props = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { osm_id: id, ...props } });

test('splitIntoCells: Weg über Zellgrenze in beiden Zellen, Punkte in ihrer Zelle, Koordinaten gerundet', () => {
  const parsed = {
    ways: { features: [line(1, [[10.301, 47.401], [10.339, 47.402]]), line(2, [[10.3399999, 47.41], [10.3412345678, 47.411]])] },
    peaks: { features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [10.3433, 47.4214] }, properties: { osm_id: 9, kind: 'peak' } }] },
    routes: { features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[10.31, 47.41], [10.5, 47.41]], [[10.45, 47.5], [10.46, 47.5]]] }, properties: { osm_id: 77 } }] }
  };
  const cells = splitIntoCells(parsed, SIZE);
  // Weg 1 kreuzt die Zellgrenze bei 10,32° → in beiden Zellen
  const a = cellKey(10.301, 47.401, SIZE);
  const b = cellKey(10.339, 47.402, SIZE);
  assert.notEqual(a, b);
  assert.ok(cells.get(a).ways.features.some((f) => f.properties.osm_id === 1));
  assert.ok(cells.get(b).ways.features.some((f) => f.properties.osm_id === 1));
  const w2 = cells.get(cellKey(10.341, 47.411, SIZE)).ways.features.find((f) => f.properties.osm_id === 2);
  assert.deepEqual(w2.geometry.coordinates[1], [10.34123, 47.411]);
  assert.equal(cells.get(cellKey(10.3433, 47.4214, SIZE)).peaks.features.length, 1);
  // Route: je Teilstück in der Zelle seines Anfangs, kein Doppel
  const routeCells = [...cells.values()].filter((c) => c.routes.features.length);
  assert.equal(routeCells.length, 2);
  assert.equal(routeCells.reduce((s, c) => s + c.routes.features[0].geometry.coordinates.length, 0), 2);
});

test('cellInBbox', () => {
  assert.equal(cellInBbox(cellKey(10.3, 47.4, SIZE), SIZE, [9.55, 47.22, 11, 47.98]), true);
  assert.equal(cellInBbox(cellKey(12.0, 47.4, SIZE), SIZE, [9.55, 47.22, 11, 47.98]), false);
});
