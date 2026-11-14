import test from 'node:test';
import assert from 'node:assert/strict';
import { ascentDescent, bboxAreaKm2, decodeTerrarium, densify, haversine, lineLength, lonLatToTile, maxGrade, median } from '../js/geo.js';

test('haversine: Oberstdorf → Kempten ≈ 34 km', () => {
  const d = haversine([10.2793, 47.4097], [10.3157, 47.7267]);
  assert.ok(Math.abs(d - 35300) < 500, `got ${d}`);
});

test('haversine: 1° Breite ≈ 111.2 km', () => {
  assert.ok(Math.abs(haversine([10, 47], [10, 48]) - 111195) < 50);
});

test('densify hält Abstand ein und endet auf Gesamtlänge', () => {
  const line = [[10, 47], [10.01, 47], [10.01, 47.01]];
  const pts = densify(line, 20);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].dist - pts[i - 1].dist <= 20.0001);
  assert.ok(Math.abs(pts.at(-1).dist - lineLength(line)) < 1e-6);
  assert.deepEqual(pts.at(-1).coord, [10.01, 47.01]);
});

test('ascentDescent: Hysterese filtert Rauschen', () => {
  const noisy = [1000, 1002, 999, 1001, 1000, 1003, 998];
  assert.deepEqual(ascentDescent(noisy, 5), { up: 0, down: 0 });
  const climb = [1000, 1010, 1020, 1015, 1030, 1000];
  const r = ascentDescent(climb, 5);
  assert.equal(r.up, 35); // 1000→1010→1020, 1015 (−5) zählt, 1030 (+15)
  assert.equal(r.down, 35);
});

test('ascentDescent ignoriert null', () => {
  assert.deepEqual(ascentDescent([null, 1000, null, 1100], 5), { up: 100, down: 0 });
});

test('maxGrade über 50-m-Fenster', () => {
  const profile = [0, 25, 50, 75, 100].map((d) => ({ dist: d, ele: d * 0.3 }));
  assert.ok(Math.abs(maxGrade(profile, 50) - 30) < 1e-9);
});

test('decodeTerrarium: Meeresspiegel und Zugspitze', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  // 2962 m: 32768 + 2962 = 35730 = 139*256 + 146
  assert.equal(decodeTerrarium(139, 146, 0), 2962);
  assert.equal(decodeTerrarium(128, 0, 128), 0.5);
});

test('lonLatToTile: bekannte Kachel (z10, Oberstdorf)', () => {
  const { x, y } = lonLatToTile([10.2793, 47.4097], 10);
  assert.equal(Math.floor(x), 541);
  assert.equal(Math.floor(y), 358); // (1 − asinh(tan φ)/π)/2 · 1024 = 358.15
});

test('bboxAreaKm2: 0.1° × 0.1° bei 47° N ≈ 84 km²', () => {
  const a = bboxAreaKm2([10, 47, 10.1, 47.1]);
  assert.ok(a > 80 && a < 88, `got ${a}`);
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});
