import test from 'node:test';
import assert from 'node:assert/strict';
import { DemSampler, sampleTile } from '../js/dem.js';

/** Synthetische Terrarium-Kachel: Höhe = 1000 + x (Meter), linear in x. */
function rampTile(size = 256) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 32768 + 1000 + x;
      const i = (y * size + x) * 4;
      data[i] = Math.floor(v / 256);
      data[i + 1] = v % 256;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

test('sampleTile interpoliert bilinear zwischen Pixelzentren', () => {
  const { data, size } = rampTile();
  assert.equal(sampleTile(data, size, 10.5, 10.5), 1010); // Pixelzentrum
  assert.equal(sampleTile(data, size, 11, 10.5), 1010.5); // zwischen 10 und 11
  assert.equal(sampleTile(data, size, 0, 0), 1000); // Rand geklemmt
});

test('DemSampler cached Kacheln und liefert null bei Ladefehler', async () => {
  let loads = 0;
  const ok = new DemSampler({ template: 't/{z}/{x}/{y}', zoom: 13, loadTile: async () => (loads++, rampTile()) });
  const [a, b] = await ok.elevations([[10.3, 47.4], [10.3001, 47.4]]);
  assert.ok(a >= 1000 && a <= 1255 && b >= a);
  assert.equal(loads, 1);
  const bad = new DemSampler({ template: 't/{z}/{x}/{y}', zoom: 13, loadTile: async () => { throw new Error('404'); } });
  assert.equal(await bad.elevation([10.3, 47.4]), null);
  assert.equal(bad.cache.size, 0, 'Fehlschläge werden nicht gecacht');
});

test('maxAround findet das lokale Maximum im Umkreis', async () => {
  const s = new DemSampler({ template: 't/{z}/{x}/{y}', zoom: 13, loadTile: async () => rampTile() });
  const c = [10.3, 47.4];
  const center = await s.elevation(c);
  const max = await s.maxAround(c, 45, 15);
  // Rampe steigt nach Osten: Maximum liegt ~45 m östlich, bei ~13 m/px ≈ 3.4 px höher.
  assert.ok(max > center + 3 && max < center + 4, `center ${center}, max ${max}`);
});
