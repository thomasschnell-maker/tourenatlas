import test from 'node:test';
import assert from 'node:assert/strict';
import { boostLabels, scaleTextSize } from '../js/textscale.js';

test('scaleTextSize: Zahl, Standard, Legacy-stops', () => {
  assert.equal(scaleTextSize(12, 1.3), 15.6);
  assert.equal(scaleTextSize(undefined, 1.25), 20);
  assert.deepEqual(scaleTextSize({ base: 1.2, stops: [[10, 10], [14, 14]] }, 1.5), { base: 1.2, stops: [[10, 15], [14, 21]] });
});

test('scaleTextSize: interpolate/step bleiben oberste Ebene, nur Ausgaben skaliert', () => {
  const interp = ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 13.5];
  assert.deepEqual(scaleTextSize(interp, 2), ['interpolate', ['linear'], ['zoom'], 9, 22, 14, 27]);
  const step = ['step', ['zoom'], 10, 12, 14];
  assert.deepEqual(scaleTextSize(step, 2), ['step', ['zoom'], 20, 12, 28]);
  const nested = ['interpolate', ['linear'], ['zoom'], 8, ['get', 's'], 14, 16];
  assert.deepEqual(scaleTextSize(nested, 2)[4], ['*', ['get', 's'], 2]);
  assert.deepEqual(scaleTextSize(['get', 'size'], 2), ['*', ['get', 'size'], 2]);
});

test('boostLabels: nur Text-Ebenen, Halo mindestens 1.5', () => {
  const layers = [
    { id: 'a', type: 'symbol', layout: { 'text-field': '{name}', 'text-size': 10 }, paint: { 'text-halo-width': 0.5 } },
    { id: 'b', type: 'symbol', layout: { 'icon-image': 'x' } },
    { id: 'c', type: 'line', paint: {} },
    { id: 'd', type: 'symbol', layout: { 'text-field': '{name}' }, paint: { 'text-halo-width': 2 } }
  ];
  boostLabels(layers, 1.3);
  assert.equal(layers[0].layout['text-size'], 13);
  assert.equal(layers[0].paint['text-halo-width'], 1.5);
  assert.equal(layers[1].layout['text-size'], undefined);
  assert.equal(layers[3].layout['text-size'], 20.8);
  assert.equal(layers[3].paint['text-halo-width'], 2);
});

test('growPlaceLabels: Ortsnamen wachsen mit dem Zoom weiter, fremde Ebenen unverändert', async () => {
  const { growPlaceLabels, PLACE_SIZES } = await import('../js/textscale.js');
  const layers = [
    { id: 'label_village', type: 'symbol', layout: { 'text-field': '{name}', 'text-size': ['interpolate', ['exponential', 1.2], ['zoom'], 7, 10, 11, 12] } },
    { id: 'label_other', type: 'symbol', layout: { 'text-field': '{name}' } },
    { id: 'road', type: 'line', layout: {} }
  ];
  growPlaceLabels(layers);
  for (const l of layers.slice(0, 2)) {
    const size = l.layout['text-size'];
    assert.equal(size[0], 'interpolate');
    const out = size.slice(3).filter((_, i) => i % 2 === 1);
    assert.ok(out.every((v, i) => i === 0 || v > out[i - 1]), `${l.id} wächst`);
    assert.ok(out.at(-1) >= 15, `${l.id} gross genug`);
  }
  assert.deepEqual(layers[2].layout, {});
  assert.ok(PLACE_SIZES.label_town.at(-1) > PLACE_SIZES.label_village.at(-1));
});

test('parseLakes: Seen mit Namen, Fläche aus der Umrandung, Doppelte zusammengefasst', async () => {
  const { parseLakes, lakeQuery } = await import('../tools/build-lakes.mjs');
  assert.match(lakeQuery([10, 47, 10.5, 47.5]), /\[bbox:47\.00000,10\.00000,47\.50000,10\.50000\]/);
  const json = {
    osm3s: { timestamp_osm_base: '2026-11-01T00:00:00Z' },
    elements: [
      { type: 'relation', id: 1, tags: { name: 'Großer Alpsee' }, bounds: { minlat: 47.555, minlon: 10.14, maxlat: 47.57, maxlon: 10.19 } },
      { type: 'way', id: 2, tags: { name: 'Großer Alpsee' }, bounds: { minlat: 47.555, minlon: 10.14, maxlat: 47.56, maxlon: 10.15 } },
      { type: 'way', id: 3, tags: { name: 'Schrecksee' }, bounds: { minlat: 47.4085, minlon: 10.4565, maxlat: 47.411, maxlon: 10.4605 } },
      { type: 'way', id: 4, tags: {}, bounds: { minlat: 47, minlon: 10, maxlat: 47.1, maxlon: 10.1 } }
    ]
  };
  const r = parseLakes(json);
  assert.equal(r.osmBase, '2026-11-01T00:00:00Z');
  assert.deepEqual(r.features.map((f) => f.properties.name), ['Großer Alpsee', 'Schrecksee']);
  assert.equal(r.features[0].properties.osm, 'relation/1');
  assert.ok(r.features[0].properties.km2 > 1 && r.features[0].properties.km2 < 5);
  assert.ok(r.features[1].properties.km2 < 0.1);
  assert.throws(() => parseLakes({ remark: 'runtime error: timed out', elements: [] }));
});
