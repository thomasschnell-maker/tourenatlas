import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { padBbox, tileUrl, tilesForBbox } from '../js/offline-area.js';

test('tilesForBbox: Anzahl je Zoom, Oberstdorf-Kachel enthalten', () => {
  const bbox = [10.25, 47.38, 10.35, 47.43];
  const t = tilesForBbox(bbox, 10, 12);
  assert.ok(t.some(([z, x, y]) => z === 10 && x === 541 && y === 358));
  const z12 = t.filter(([z]) => z === 12).length;
  assert.ok(z12 >= 2 && z12 <= 6, `z12 ${z12}`);
  assert.equal(tileUrl('https://h/{z}/{x}/{y}.png', [12, 2165, 1433]), 'https://h/12/2165/1433.png');
});

test('Offline-Umfang einer typischen E-Bike-Tour bleibt unter dem Limit', () => {
  // Sonthofen–Oberjoch–Grüntensee: ca. 0,25° × 0,12°, 1 km Puffer
  const area = padBbox([10.27, 47.5, 10.45, 47.62], 1);
  const vec = tilesForBbox(area, 8, 14).length;
  const dem = tilesForBbox(area, 8, 13).length;
  assert.ok(vec + dem < 4000, `${vec + dem} Kacheln`);
});

test('Service Worker: App-Schale enthält alle Dateien der App', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const shell = new Set([...sw.matchAll(/^\s*'([^']+)',?$/gm)].map((m) => m[1]));
  const root = new URL('..', import.meta.url).pathname;
  const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => (statSync(join(root, dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const needed = [...walk('js'), ...walk('css'), ...walk('vendor').filter((f) => /\.(js|css)$/.test(f)), 'index.html', 'data/touren.json'];
  const missing = needed.filter((f) => !shell.has(f));
  assert.deepEqual(missing, []);
});
