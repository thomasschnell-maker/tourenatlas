import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, parseEle, parseOverpass } from '../js/overpass.js';

test('buildQuery: Overpass erwartet S,W,N,E', () => {
  const q = buildQuery([10.1, 47.3, 10.4, 47.5]);
  assert.match(q, /\[bbox:47\.30000,10\.10000,47\.50000,10\.40000\]/);
  assert.match(q, /aerialway/);
  assert.match(q, /alpine_hut/);
});

test('parseOverpass: Wege, Dubletten, defekte Geometrie, Gipfel', () => {
  const json = {
    osm3s: { timestamp_osm_base: '2026-10-23T12:00:00Z' },
    elements: [
      { type: 'way', id: 1, version: 3, timestamp: '2024-05-01T00:00:00Z', tags: { highway: 'path', sac_scale: 'mountain_hiking', name: 'Weg' },
        geometry: [{ lat: 47.4, lon: 10.3 }, { lat: 47.41, lon: 10.31 }] },
      { type: 'way', id: 1, tags: { highway: 'path' }, geometry: [{ lat: 47.4, lon: 10.3 }, { lat: 47.41, lon: 10.31 }] },
      { type: 'way', id: 2, tags: { highway: 'path' }, geometry: [{ lat: 47.4, lon: 10.3 }] },
      { type: 'node', id: 9, lat: 47.42, lon: 10.34, tags: { natural: 'peak', name: 'Nebelhorn', ele: '2224' } },
      { type: 'node', id: 10, lat: 47.43, lon: 10.35, tags: { tourism: 'alpine_hut', name: 'Hütte' } }
    ]
  };
  const r = parseOverpass(json);
  assert.equal(r.ways.features.length, 1);
  assert.equal(r.ways.features[0].properties.sac_scale, 'mountain_hiking');
  assert.equal(r.meta.dropped, 1);
  assert.equal(r.peaks.features.length, 2);
  assert.equal(r.peaks.features[0].properties.ele_osm, 2224);
  assert.equal(r.peaks.features[1].properties.kind, 'alpine_hut');
  assert.equal(r.meta.osmBase, '2026-10-23T12:00:00Z');
});

test('parseOverpass: Timeout-Remark ist ein Fehler, keine stillen Teil-Daten', () => {
  assert.throws(() => parseOverpass({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3' }), /unvollständig/);
  assert.throws(() => parseOverpass({}), /elements fehlt/);
});

test('parseEle akzeptiert nur Meterangaben', () => {
  assert.equal(parseEle('2224'), 2224);
  assert.equal(parseEle('2224.5 m'), 2224.5);
  assert.equal(parseEle('2224,5'), 2224.5);
  assert.equal(parseEle('7300 ft'), null);
  assert.equal(parseEle('ca. 2000'), null);
  assert.equal(parseEle('99999'), null);
  assert.equal(parseEle(undefined), null);
});
