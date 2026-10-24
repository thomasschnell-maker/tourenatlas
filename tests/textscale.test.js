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
