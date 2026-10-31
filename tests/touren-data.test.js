import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_COLORS, nextColor } from '../js/packages/tours-core.js';

test('nextColor verteilt Farben gleichmässig', () => {
  const tours = [];
  for (let i = 0; i < TOUR_COLORS.length; i++) tours.push({ color: nextColor(tours) });
  assert.equal(new Set(tours.map((t) => t.color)).size, TOUR_COLORS.length);
  assert.equal(nextColor(tours), TOUR_COLORS[0]);
});
