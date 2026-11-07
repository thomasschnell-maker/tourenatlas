import test from 'node:test';
import assert from 'node:assert/strict';
import { ageYears, checkPmtilesHeader, classifyPeakDelta, parseIncline, qualitySummary, wayFindings } from '../js/validate.js';

const NOW = Date.parse('2026-10-23T00:00:00Z');

test('classifyPeakDelta: asymmetrische Stufen', () => {
  assert.equal(classifyPeakDelta(2962, 2952).level, 'ok'); // Zugspitze, kalibriert
  const smooth = classifyPeakDelta(2592, 2519); // Hochvogel: spitzer Gipfel
  assert.equal(smooth.level, 'info');
  assert.match(smooth.text, /Rasterglättung/);
  assert.equal(classifyPeakDelta(2180, 2214).level, 'info');
  assert.match(classifyPeakDelta(2180, 2214).text, /tiefer/);
  assert.equal(classifyPeakDelta(2100, 2200).level, 'warn'); // OSM 100 m unter Gelände
  assert.equal(classifyPeakDelta(1738, 926).level, 'warn'); // falsche Position
  assert.equal(classifyPeakDelta(null, 2000).level, 'info');
  assert.equal(classifyPeakDelta(2000, null).level, 'info');
});

test('parseIncline nur numerische Prozentwerte', () => {
  assert.equal(parseIncline('12%'), 12);
  assert.equal(parseIncline('-8 %'), -8);
  assert.equal(parseIncline('up'), null);
  assert.equal(parseIncline('10°'), null);
});

test('wayFindings: fehlende SAC, schlechte Spur, alte Daten, incline-Abgleich', () => {
  const f = wayFindings(
    { highway: 'path', trail_visibility: 'bad', timestamp: '2018-01-01T00:00:00Z', incline: '10%' },
    { length: 1000, grade: 40, up: 300, down: 0, coverage: 1 },
    NOW
  );
  const texts = f.map((x) => `${x.level}:${x.text}`).join('\n');
  assert.match(texts, /info:Keine SAC/);
  assert.match(texts, /warn:Wegspur schlecht/);
  assert.match(texts, /info:Seit 8\.\d Jahren/);
  assert.match(texts, /warn:incline=10% weicht/); // DEM: Ø 30 %
});

test('wayFindings: kurzer Weg → Profil nicht belastbar, kein incline-Urteil', () => {
  const f = wayFindings({ highway: 'path', sac_scale: 'hiking', incline: '50%' }, { length: 40, grade: 80, up: 0, down: 0, coverage: 1 }, NOW);
  assert.ok(f.some((x) => /nicht belastbar/.test(x.text)));
  assert.ok(!f.some((x) => /incline/.test(x.text)));
  assert.ok(!f.some((x) => /T1/.test(x.text)));
});

test('wayFindings: sauberer Weg → ok', () => {
  const f = wayFindings({ highway: 'path', sac_scale: 'mountain_hiking', timestamp: '2026-01-01T00:00:00Z' }, { length: 2000, grade: 30, up: 200, down: 0, coverage: 1 }, NOW);
  assert.deepEqual(f.map((x) => x.level), ['ok']);
});

test('ageYears', () => {
  assert.ok(Math.abs(ageYears('2025-10-23T00:00:00Z', NOW) - 1) < 0.01);
  assert.equal(ageYears(null, NOW), null);
});

test('qualitySummary trennt Wege, Lifte, Gipfel, Hütten', () => {
  const line = (props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[10, 47], [10.01, 47]] }, properties: props });
  const pt = (props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 47] }, properties: props });
  const q = qualitySummary(
    { features: [line({ highway: 'path', sac_scale: 'hiking' }), line({ highway: 'path' }), line({ aerialway: 'gondola' })] },
    { features: [pt({ kind: 'peak', delta: 10, check: 'ok' }), pt({ kind: 'peak', delta: -80, check: 'warn' }), pt({ kind: 'alpine_hut' })] },
    NOW
  );
  assert.equal(q.ways, 2);
  assert.equal(q.lifts, 1);
  assert.equal(q.huts, 1);
  assert.equal(q.sacShare, 0.5);
  assert.equal(q.peaksChecked, 2);
  assert.equal(q.peaksWarn, 1);
  assert.equal(q.peakMedianAbsDelta, 45);
});

test('checkPmtilesHeader: Abdeckung, Typ, Schema', () => {
  const full = { tileType: 1, minLon: 5, minLat: 45, maxLon: 15, maxLat: 50, minZoom: 0, maxZoom: 15 };
  assert.equal(checkPmtilesHeader(full, ['earth', 'roads', 'places']).usable, true);
  const partial = checkPmtilesHeader({ ...full, maxLon: 10.275 }, ['earth', 'roads', 'places']);
  assert.ok(partial.cover > 0.45 && partial.cover < 0.55);
  assert.ok(partial.findings.some((f) => /deckt 50 %/.test(f.text)));
  assert.equal(checkPmtilesHeader({ ...full, minLon: 20, maxLon: 25 }, ['earth', 'roads', 'places']).usable, false);
  assert.equal(checkPmtilesHeader({ ...full, tileType: 2 }, ['earth', 'roads', 'places']).usable, false);
  const omt = checkPmtilesHeader(full, ['transportation', 'place']);
  assert.equal(omt.usable, false);
  assert.ok(omt.findings.some((f) => /Protomaps-Schema/.test(f.text)));
});
