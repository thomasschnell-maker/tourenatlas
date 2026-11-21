import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLine, classifyWay, indexWays, sample } from '../tools/audit-tours.mjs';

const way = (id, coords, props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { osm_id: id, ...props } });

test('classifyWay: Rad – Stufen, Radverbot, Bergweg T3+, MTB S3 warnen; T2 und Fussweg sind Hinweise', () => {
  const k = (p, a = 'ebike') => classifyWay(p, a)?.key ?? null;
  assert.equal(k({ highway: 'steps' }), 'stufen');
  assert.equal(k({ highway: 'track', bicycle: 'no' }), 'radverbot');
  assert.equal(k({ highway: 'track', access: 'private' }), 'gesperrt');
  assert.equal(k({ highway: 'track', access: 'no', bicycle: 'yes' }), null); // ausdrücklich erlaubt
  assert.equal(k({ highway: 'path', sac_scale: 'demanding_mountain_hiking' }), 'bergweg-schwer');
  assert.equal(k({ highway: 'path', 'mtb:scale': '3' }), 'mtb-schwer');
  assert.equal(classifyWay({ highway: 'path', sac_scale: 'mountain_hiking' }, 'bike').level, 'info');
  assert.equal(k({ highway: 'footway' }), 'fussweg');
  assert.equal(k({ highway: 'footway', bicycle: 'yes' }), null);
  assert.equal(k({ highway: 'track', tracktype: 'grade2' }), null);
  assert.equal(k({ highway: 'cycleway' }), null);
});

test('classifyWay: Wandern – T4+ und Klettersteig warnen, T3 Hinweis, T1/T2 unbedenklich', () => {
  const c = (p) => classifyWay(p, 'hike');
  assert.equal(c({ highway: 'path', sac_scale: 'alpine_hiking' }).level, 'warn');
  assert.equal(c({ highway: 'via_ferrata' }).key, 'klettersteig');
  assert.equal(c({ highway: 'path', sac_scale: 'demanding_mountain_hiking' }).level, 'info');
  assert.equal(c({ highway: 'path', sac_scale: 'mountain_hiking' }), null);
  assert.equal(c({ highway: 'path', trail_visibility: 'bad' }).key, 'spur');
  assert.equal(c({ highway: 'track', foot: 'no' }).key, 'gesperrt');
  assert.equal(c({ highway: 'steps' }), null); // Stufen sind zu Fuss kein Problem
});

test('sample: gleichmässige Punkte entlang der Linie', () => {
  const pts = sample([[10, 47], [10, 47.001]], 20); // ~111 m
  assert.equal(pts.length, 6);
});

test('auditLine: Bergweg-Abschnitt auf E-Bike-Route wird mit Länge und Ort gemeldet, Kreuzung nicht', () => {
  // Route 1,1 km nach Norden; mittlere 400 m auf einem T3-Pfad, dazu ein kurzer Querweg mit Stufen (Kreuzung)
  const route = [[10.3, 47.5], [10.3, 47.51]];
  const ways = [
    way(1, [[10.3, 47.503], [10.3, 47.5066]], { highway: 'path', sac_scale: 'demanding_mountain_hiking', name: 'Gratweg' }),
    way(2, [[10.2999, 47.5085], [10.3001, 47.5085]], { highway: 'steps' })
  ];
  const r = auditLine(route, indexWays(ways), 'ebike');
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.key, 'bergweg-schwer');
  assert.equal(f.level, 'warn');
  assert.ok(f.m >= 360 && f.m <= 420, `Länge ${f.m}`);
  assert.deepEqual(f.names, ['Gratweg']);
  assert.equal(f.osm, 'way/1');
  // Gleiche Route zu Fuss: T3 nur Hinweis
  assert.equal(auditLine(route, indexWays(ways), 'hike').findings[0].level, 'info');
  // Ohne Wege (Strasse): nichts zu melden
  assert.deepEqual(auditLine(route, indexWays([]), 'ebike').findings, []);
});
