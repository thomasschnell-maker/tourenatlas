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

test('batteryCurve: Verbrauch, Restladung, Wechselpunkt', async () => {
  const { batteryCurve } = await import('../js/packages/tours-core.js');
  // 60 km flach in 1-km-Schritten, dann 30 km mit +40 Hm/km: 60·6 = 360 Wh, dann +30·(6+10) = 480 → 840 Wh
  const profile = [];
  for (let k = 0; k <= 60; k++) profile.push({ dist: k * 1000, ele: 700 });
  for (let k = 1; k <= 30; k++) profile.push({ dist: (60 + k) * 1000, ele: 700 + k * 40 });
  const c = batteryCurve(profile, 500);
  assert.equal(Math.round(c.total), 840);
  assert.ok(Math.abs(c.batteries - 1.68) < 1e-9);
  assert.equal(c.swaps.length, 1);
  // 500 Wh erreicht: 360 flach + 140 Wh bei 16 Wh/km → 8,75 km nach km 60 → Wechsel bei km 69 (1-km-Raster)
  assert.equal(c.swaps[0], 69000);
  assert.equal(c.points[0].pct, 100);
  assert.ok(c.points.at(-1).pct > 31 && c.points.at(-1).pct < 33);
});

test('stationDistances: vorwärts entlang des Profils, Rundtour', async () => {
  const { stationDistances } = await import('../js/packages/tours-core.js');
  const profile = [[10, 47], [10.01, 47], [10.02, 47], [10.01, 47.001], [10, 47]].map((c, i) => ({ dist: i * 1000, coord: c }));
  const st = [{ lngLat: [10, 47] }, { lngLat: [10.02, 47] }, { lngLat: [10, 47] }];
  assert.deepEqual(stationDistances(st, profile), [0, 2000, 4000]);
});

test('Akku: Unterstützungsstufe, persönliche Kalibrierung, Plausibilität', async () => {
  const { batteryWh, calibrateEbike, implausibleClimb, batteryCurve } = await import('../js/packages/tours-core.js');
  assert.equal(batteryWh(80000, 1300), 805);
  assert.ok(Math.abs(batteryWh(80000, 1300, { assist: 'eco' }) - 805 * 0.62) < 1e-9);
  // Tour 1: geschätzt 805 Wh (Tour-Modus), tatsächlich 2 Akkus à 625 = 1250 Wh → Faktor 1,55
  const tours = [
    { activity: 'ebike', actualBatteries: 2, batteryCapacityWh: 625, summary: { length: 80000, up: 1300 } },
    { activity: 'ebike', actualBatteries: 1, batteryCapacityWh: 625, summary: { length: 40000, up: 650 } }, // 402,5 → 1,55
    { activity: 'ebike', actualBatteries: 0.2, batteryCapacityWh: 625, summary: { length: 80000, up: 1300 } }, // Ausreisser 0,155
    { activity: 'hike', actualBatteries: 5, summary: { length: 1, up: 1 } }
  ];
  const c = calibrateEbike(tours);
  assert.equal(c.n, 3);
  assert.ok(Math.abs(c.factor - 1250 / 805) < 1e-9, `factor ${c.factor}`);
  assert.deepEqual(calibrateEbike([]), { factor: 1, n: 0 });
  assert.equal(implausibleClimb(128500, 23851, 'ebike'), true);
  assert.equal(implausibleClimb(80000, 1300, 'ebike'), false);
  assert.equal(implausibleClimb(10000, 1500, 'hike'), false);
  const prof = [{ dist: 0, ele: 0 }, { dist: 100000, ele: 0 }];
  assert.equal(Math.round(batteryCurve(prof, 625, 5, 2).total), 1200);
});

test('splitRoute: Gesamtroute an Stationen teilen, auch bei Hin- und Rückweg über denselben Ort', async () => {
  const { splitRoute, brouterUrlMulti } = await import('../js/packages/tours-core.js');
  // A(0) → B(0.01) → C(0.02) → B → A, Punkte alle ~0.0025° (~190 m)
  const xs = [0, 0.0025, 0.005, 0.0075, 0.01, 0.0125, 0.015, 0.0175, 0.02, 0.0175, 0.015, 0.0125, 0.01, 0.0075, 0.005, 0.0025, 0];
  const line = xs.map((x) => [10 + x, 47.5]);
  const P = (x) => [10 + x, 47.5003];
  const parts = splitRoute(line, [P(0), P(0.01), P(0.02), P(0.01), P(0)]);
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.map((p) => p.length), [5, 5, 5, 5]);
  assert.deepEqual(parts[1][0], line[4]);
  assert.deepEqual(parts[3].at(-1), line.at(-1));
  // Station abseits der Route → null (Rückfall auf Abschnitts-Routing)
  assert.equal(splitRoute(line, [P(0), [10.01, 47.6], P(0)]), null);
  assert.match(brouterUrlMulti([[10, 47], [10.1, 47.1], [10.2, 47.2]], 'trekking'), /lonlats=10\.000000,47\.000000\|10\.100000,47\.100000\|10\.200000,47\.200000&profile=trekking/);
});

test('splitRoute: dicht beieinander liegende Stationen und Route, die sich erst entfernt', async () => {
  const { splitRoute } = await import('../js/packages/tours-core.js');
  // Start 0, Weg geht erst nach Westen (weg von Station 1), dann nach Osten; Station 1 liegt 300 m östlich
  const xs = [0, -0.002, -0.004, -0.002, 0, 0.002, 0.004, 0.006, 0.008, 0.01];
  const line = xs.map((x) => [10 + x, 47.5]);
  const P = (x) => [10 + x, 47.5];
  const parts = splitRoute(line, [P(0), P(0.004), P(0.01)]);
  // Station 1 gehört auf Index 6 (x = 0.004), nicht auf den ersten nahen Punkt am Anfang
  assert.equal(parts[0].length, 7);
  assert.deepEqual(parts[0].at(-1), line[6]);
  assert.ok(parts.every((p) => p.length >= 2));
});

test('nearestSegment: Tipp nahe der Linie findet den richtigen Abschnitt', async () => {
  const { nearestSegment } = await import('../js/packages/tours-core.js');
  const st = [{ lngLat: [10, 47.5] }, { lngLat: [10.02, 47.5] }, { lngLat: [10.02, 47.52] }];
  // Abschnitt 0 gerouted mit Umweg nach Süden, Abschnitt 1 Luftlinie
  const segs = [{ coords: [[10, 47.5], [10.01, 47.49], [10.02, 47.5]] }, null];
  const a = nearestSegment(st, segs, [10.01, 47.4905]);
  assert.equal(a.index, 0);
  assert.ok(a.distM < 60);
  const b = nearestSegment(st, segs, [10.0205, 47.51]);
  assert.equal(b.index, 1);
  assert.ok(b.distM < 50);
  assert.equal(nearestSegment([st[0]], [], [10, 47.5]), null);
});

test('progressOnTour: Position, Rest, Höhenmeter, nächste Station, Abweichung, Hin-/Rückweg', async () => {
  const { progressOnTour } = await import('../js/packages/tours-core.js');
  // Hin (0→1000 m, steigend) und zurück auf derselben Linie
  const profile = [];
  for (let i = 0; i <= 20; i++) {
    const back = i > 10;
    const x = (back ? 20 - i : i) * 0.0013; // ~100 m je Schritt
    profile.push({ dist: i * 100, ele: 500 + (back ? 20 - i : i) * 10, coord: [10 + x, 47.5] });
  }
  const st = [0, 1000, 2000];
  const a = progressOnTour(profile, st, [10 + 3 * 0.0013, 47.5001], 0);
  assert.equal(a.dist, 300);
  assert.equal(a.remaining, 1700);
  assert.equal(a.upRemaining, 70);
  assert.deepEqual(a.next, { index: 1, inM: 700 });
  assert.ok(a.offM < 20);
  // Auf dem Rückweg am selben Ort: bleibt auf dem Rückweg (vorwärts suchen)
  const b = progressOnTour(profile, st, [10 + 3 * 0.0013, 47.5001], 1600);
  assert.equal(b.dist, 1700);
  assert.equal(b.next.index, 2);
  // Abseits
  const c = progressOnTour(profile, st, [10 + 3 * 0.0013, 47.503], 0);
  assert.ok(c.offM > 300);
});
