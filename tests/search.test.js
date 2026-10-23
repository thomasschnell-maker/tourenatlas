import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoords, parseResults, searchUrl } from '../js/search.js';

test('parseCoords: gängige Schreibweisen', () => {
  assert.deepEqual(parseCoords('47.4214, 10.3433'), [10.3433, 47.4214]);
  assert.deepEqual(parseCoords('47,4214 10,3433'), [10.3433, 47.4214]);
  assert.deepEqual(parseCoords('N 47.4214 E 10.3433'), [10.3433, 47.4214]);
  assert.equal(parseCoords('Nebelhorn'), null);
  assert.equal(parseCoords('99.1, 10.2'), null);
});

test('searchUrl: Region bevorzugt, nicht exklusiv; Nachbarländer', () => {
  const u = new URL(searchUrl('Hochvogel'));
  assert.equal(u.searchParams.get('q'), 'Hochvogel');
  assert.equal(u.searchParams.get('bounded'), '0');
  assert.equal(u.searchParams.get('viewbox'), '9.55,47.98,11,47.22');
  assert.match(u.searchParams.get('countrycodes'), /at/);
});

test('parseResults: Region zuerst, Typ übersetzt, Bounds umgestellt, Müll verworfen', () => {
  const r = parseResults([
    { lat: '52.5', lon: '13.4', name: 'Hochvogelweg', display_name: 'Hochvogelweg, Berlin, Deutschland', type: 'residential' },
    { lat: '47.3794', lon: '10.4378', name: 'Hochvogel', display_name: 'Hochvogel, Hinterstein, Bad Hindelang, Bayern', type: 'peak', osm_type: 'node', osm_id: 1, boundingbox: ['47.37', '47.38', '10.43', '10.44'] },
    { lat: 'x', lon: '1' }
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].name, 'Hochvogel');
  assert.equal(r[0].type, 'Gipfel');
  assert.equal(r[0].inRegion, true);
  assert.deepEqual(r[0].bounds, [10.43, 47.37, 10.44, 47.38]);
  assert.equal(r[0].osm, 'https://www.openstreetmap.org/node/1');
  assert.throws(() => parseResults({}), /ungültige/);
});

test('splitPlaces: Komma-Liste, Semikolon, einzelne Koordinate bleibt zusammen', async () => {
  const { splitPlaces } = await import('../js/search.js');
  assert.deepEqual(splitPlaces('Sonthofen, Burgberg ,Immenstadt'), ['Sonthofen', 'Burgberg', 'Immenstadt']);
  assert.deepEqual(splitPlaces('Oberstdorf; 47.42, 10.34'), ['Oberstdorf', '47.42, 10.34']);
  assert.deepEqual(splitPlaces('47.42, 10.34'), ['47.42, 10.34']);
  assert.deepEqual(splitPlaces('  '), []);
  assert.deepEqual(splitPlaces('Bad Hindelang, , Hinterstein'), ['Bad Hindelang', 'Hinterstein']);
});
