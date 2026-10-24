import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITIES, TOUR_COLORS, nextColor } from '../js/packages/tours-core.js';

const list = JSON.parse(readFileSync(new URL('../data/touren.json', import.meta.url), 'utf8'));

test('data/touren.json: Struktur und Plausibilität', () => {
  assert.ok(list.length >= 1);
  assert.equal(new Set(list.map((t) => t.id)).size, list.length, 'IDs eindeutig');
  for (const t of list) {
    assert.ok(ACTIVITIES[t.activity], `${t.id}: Aktivität`);
    assert.ok(Number.isInteger(t.version) && t.version >= 1, `${t.id}: version`);
    assert.ok(t.places.length >= 3, `${t.id}: mind. 3 Orte`);
    assert.ok(t.places.every((p) => p.split('|').every((a) => a.trim().length > 1)), `${t.id}: leere Ortsangabe`);
    // Rundtour: Ziel liegt im Startort (z. B. "Richard-Wagner-Straße, Sonthofen" bei Start "Sonthofen").
    assert.ok(t.places.at(-1).includes(t.places[0].split('|')[0]), `${t.id}: Rundtour Start = Ziel`);
    for (let i = 1; i < t.places.length; i++) assert.notEqual(t.places[i], t.places[i - 1], `${t.id}: doppelte Station hintereinander`);
  }
  // Varianten einer Gruppe müssen sich im Variantentext unterscheiden.
  const byGroup = Map.groupBy(list, (t) => t.group);
  for (const [g, ts] of byGroup) assert.equal(new Set(ts.map((t) => t.variant)).size, ts.length, `${g}: Varianten unterscheidbar`);
});

test('nextColor verteilt Farben gleichmässig', () => {
  const tours = [];
  for (let i = 0; i < TOUR_COLORS.length; i++) tours.push({ color: nextColor(tours) });
  assert.equal(new Set(tours.map((t) => t.color)).size, TOUR_COLORS.length);
  assert.equal(nextColor(tours), TOUR_COLORS[0]);
});
