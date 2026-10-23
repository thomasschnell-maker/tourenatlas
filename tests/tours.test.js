import test from 'node:test';
import assert from 'node:assert/strict';
import { brouterUrl, formatDuration, newStation, newTour, parseBrouter, tourGpx, tourLine, tourStats, walkingTimeH } from '../js/packages/tours-core.js';

test('walkingTimeH: DIN 33466 (DAV-Formel)', () => {
  // 12 km, 900 Hm auf, 900 Hm ab: horizontal 3 h, vertikal 3 + 1.8 = 4.8 h → 4.8 + 1.5 = 6.3 h
  assert.ok(Math.abs(walkingTimeH(12000, 900, 900) - 6.3) < 1e-9);
  // flach 8 km: 2 h horizontal, 0 vertikal → 2 h
  assert.equal(walkingTimeH(8000, 0, 0), 2);
  assert.equal(formatDuration(6.3), '6:20 h');
  assert.equal(formatDuration(2), '2:00 h');
});

test('brouterUrl: lon,lat|lon,lat und Bergprofil', () => {
  const u = brouterUrl([10.27, 47.4], [10.34, 47.42]);
  assert.match(u, /lonlats=10\.270000,47\.400000\|10\.340000,47\.420000/);
  assert.match(u, /profile=hiking-mountain/);
  assert.match(u, /format=geojson/);
});

test('parseBrouter: übernimmt Linie, verwirft weit entfernte Routen', () => {
  const a = [10.27, 47.4];
  const b = [10.34, 47.42];
  const ok = { features: [{ geometry: { type: 'LineString', coordinates: [[10.2701, 47.4001, 800], [10.3, 47.41, 1200], [10.3399, 47.4199, 2000]] } }] };
  assert.deepEqual(parseBrouter(ok, a, b)[1], [10.3, 47.41]);
  const far = { features: [{ geometry: { type: 'LineString', coordinates: [[10.2, 47.4], [10.34, 47.42]] } }] };
  assert.throws(() => parseBrouter(far, a, b), /entfernt/);
  assert.throws(() => parseBrouter({}, a, b), /keine Route/);
});

test('tourLine: Route und Luftlinie gemischt, ohne doppelte Stützpunkte', () => {
  const st = [newStation([10, 47], 1), newStation([10.1, 47], 2), newStation([10.2, 47.1], 3)];
  const segs = [{ coords: [[10, 47], [10.05, 47.01], [10.1, 47]] }, { coords: null }];
  assert.deepEqual(tourLine(st, segs), [[10, 47], [10.05, 47.01], [10.1, 47], [10.2, 47.1]]);
  assert.deepEqual(tourLine(st.slice(0, 1), []), []);
});

test('tourStats mit Stub-Höhen', async () => {
  const sampler = { elevations: async (cs) => cs.map((c) => 1000 + (c[0] - 10) * 10000) }; // +10 m je 0.001°
  const s = await tourStats([[10, 47], [10.01, 47]], sampler);
  assert.ok(s.up > 95 && s.up <= 100, `up ${s.up}`); // Hysterese 5 m verwirft den letzten Rest
  assert.equal(s.down, 0);
  assert.ok(s.length > 750 && s.length < 770);
  assert.equal(await tourStats([[10, 47]], sampler), null);
});

test('tourGpx: Wegpunkte, Track, XML-Escaping', () => {
  const t = newTour('Nebelhorn & Daumen');
  t.stations = [newStation([10.3, 47.4], 1), newStation([10.34, 47.42], 2)];
  t.stations[1].name = 'Gipfel <Nebelhorn>';
  const g = tourGpx(t, [[10.3, 47.4], [10.34, 47.42]], [800, 2224]);
  assert.match(g, /<name>Nebelhorn &amp; Daumen<\/name>/);
  assert.match(g, /<name>Gipfel &lt;Nebelhorn&gt;<\/name>/);
  assert.equal((g.match(/<wpt /g) || []).length, 2);
  assert.match(g, /<ele>2224\.0<\/ele><\/trkpt>/);
});

test('Rad/E-Bike-Zeit und Akku-Faustregel', async () => {
  const { rideTimeH, tourTimeH, batteryWh } = await import('../js/packages/tours-core.js');
  // E-Bike: 80 km, 1300 Hm → 80/20 + 1300/900 = 4 + 1.44 h
  assert.ok(Math.abs(rideTimeH(80000, 1300, 'ebike') - (4 + 1300 / 900)) < 1e-9);
  assert.ok(Math.abs(tourTimeH(32000, 450, 450, 'bike') - 3) < 1e-9);
  assert.equal(tourTimeH(8000, 0, 0, 'hike'), 2);
  // 80 km · 6 Wh + 1300 Hm · 0,25 Wh = 480 + 325 = 805 Wh → bei 625 Wh: knapp 1,3 Akkus
  assert.equal(batteryWh(80000, 1300), 805);
});

test('parseGpx: Track, Name, Zeit; Route als Ersatz; Fehler', async () => {
  const { parseGpx } = await import('../js/packages/tours-core.js');
  const gpx = `<?xml version="1.0"?><gpx version="1.1"><metadata><name><![CDATA[Grüntensee-Runde]]></name><time>2026-07-12T08:00:00Z</time></metadata>
    <trk><trkseg><trkpt lat="47.514" lon="10.281"><ele>742</ele></trkpt><trkpt lat="47.52" lon="10.29"/><trkpt lon="10.30" lat="47.53"></trkpt></trkseg></trk></gpx>`;
  const r = parseGpx(gpx);
  assert.equal(r.name, 'Grüntensee-Runde');
  assert.equal(r.time, '2026-07-12T08:00:00Z');
  assert.deepEqual(r.coords, [[10.281, 47.514], [10.29, 47.52], [10.3, 47.53]]);
  const rte = parseGpx('<gpx><rte><rtept lat="47" lon="10"/><rtept lat="47.1" lon="10.1"/></rte></gpx>');
  assert.equal(rte.coords.length, 2);
  assert.throws(() => parseGpx('<kml></kml>'), /Keine GPX/);
  assert.throws(() => parseGpx('<gpx><trk></trk></gpx>'), /keinen Track/);
});

test('stationsFromTrack: Start, Ziel, ~alle 10 km', async () => {
  const { stationsFromTrack } = await import('../js/packages/tours-core.js');
  // 0.01° lon bei 47° ≈ 759 m → 60 Punkte ≈ 44.8 km → Zwischenstationen bei ~10/20/30/40 km
  const coords = Array.from({ length: 60 }, (_, i) => [10 + i * 0.01, 47]);
  const idx = stationsFromTrack(coords, 10);
  assert.equal(idx[0], 0);
  assert.equal(idx.at(-1), 59);
  assert.equal(idx.length, 6);
});
