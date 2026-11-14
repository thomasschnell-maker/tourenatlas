import test from 'node:test';
import assert from 'node:assert/strict';
import { cellBbox, cellKey, cellsForView } from '../js/cells.js';

const SIZE = [0.04, 0.03];

test('cellKey/cellBbox sind konsistent', () => {
  const k = cellKey(10.33, 47.405, SIZE);
  const [w, s, e, n] = cellBbox(k, SIZE);
  assert.ok(w <= 10.33 && 10.33 < e && s <= 47.405 && 47.405 < n);
  assert.ok(Math.abs(e - w - 0.04) < 1e-9 && Math.abs(n - s - 0.03) < 1e-9);
});

test('cellsForView: Mitte zuerst, Radius und Obergrenze', () => {
  const c = [10.33, 47.405];
  const keys = cellsForView(c, [10.0, 47.2, 10.7, 47.6], SIZE, 7, 16);
  assert.equal(keys.length, 16);
  assert.equal(keys[0], cellKey(c[0], c[1], SIZE));
  assert.equal(new Set(keys).size, keys.length);
});

test('cellsForView: Mittelzelle auch bei degenerierten Bounds', () => {
  const c = [10.33, 47.405];
  const keys = cellsForView(c, [10.5, 47.5, 10.6, 47.6], SIZE, 1, 16);
  assert.deepEqual(keys, [cellKey(c[0], c[1], SIZE)]);
});

test('Zelle ~3 × 3,3 km im Allgäu (kleine Overpass-Abfragen)', async () => {
  const { bboxAreaKm2 } = await import('../js/geo.js');
  const a = bboxAreaKm2(cellBbox(cellKey(10.33, 47.405, SIZE), SIZE));
  assert.ok(a > 8 && a < 12, `got ${a}`);
});
