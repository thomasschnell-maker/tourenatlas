import test from 'node:test';
import assert from 'node:assert/strict';
import { readExif } from '../js/packages/exif.js';
import { assignPhotos, destination, viewFromPhoto } from '../js/packages/tours-core.js';

/** Baut ein minimales JPEG mit EXIF (Big Endian): GPS N/E + Richtung, DateTimeOriginal. */
function jpegWithExif({ lat, lon, dir, dt, little = false }) {
  const parts = [];
  const tiff = [];
  const u16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const rat = (x, den = 10000) => [...u32(Math.round(x * den)), ...u32(den)];
  const dmsR = (x) => { const d = Math.floor(x); const m = Math.floor((x - d) * 60); const s = (x - d - m / 60) * 3600; return [...rat(d, 1), ...rat(m, 1), ...rat(s, 10000)]; };
  // Layout: header(8) | IFD0 @8 (2 Einträge) | ExifIFD @38 (1 Eintrag) | GPS IFD @56 (6 Einträge) | Daten @134
  const IFD0 = 8, EXIF = 38, GPS = 56, DATA = 134;
  const dtBytes = [...Buffer.from(dt + '\0', 'latin1')];
  const latB = dmsR(lat), lonB = dmsR(lon), dirB = rat(dir, 100);
  const entry = (tag, type, count, valueOrOffset4) => [...u16(tag), ...u16(type), ...u32(count), ...valueOrOffset4];
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(IFD0));
  tiff.push(...u16(2), ...entry(0x8769, 4, 1, u32(EXIF)), ...entry(0x8825, 4, 1, u32(GPS)), ...u32(0));
  tiff.push(...u16(1), ...entry(0x9003, 2, dtBytes.length, u32(DATA)), ...u32(0));
  const d2 = DATA + dtBytes.length, d4 = d2 + 24, d11 = d4 + 24;
  const ascii1 = (c) => [c.charCodeAt(0), 0, 0, 0];
  tiff.push(...u16(6), ...entry(1, 2, 2, ascii1('N')), ...entry(2, 5, 3, u32(d2)), ...entry(3, 2, 2, ascii1('E')), ...entry(4, 5, 3, u32(d4)), ...entry(0x10, 2, 2, ascii1('T')), ...entry(0x11, 5, 1, u32(d11)), ...u32(0));
  tiff.push(...dtBytes, ...latB, ...lonB, ...dirB);
  const app1 = [...Buffer.from('Exif\0\0', 'latin1'), ...tiff];
  parts.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9);
  return new Uint8Array(parts).buffer;
}

test('readExif: GPS, Richtung, Aufnahmezeit (Big und Little Endian)', () => {
  for (const little of [false, true]) {
    const r = readExif(jpegWithExif({ lat: 47.4214, lon: 10.3433, dir: 212.5, dt: '2026:07:12 10:31:05', little }));
    assert.ok(Math.abs(r.lngLat[1] - 47.4214) < 1e-5 && Math.abs(r.lngLat[0] - 10.3433) < 1e-5, JSON.stringify(r));
    assert.equal(r.direction, 212.5);
    assert.equal(r.takenAt, '2026-07-12T10:31:05');
  }
});

test('readExif: kein JPEG / kein EXIF → leere Angaben, kein Fehler', () => {
  assert.deepEqual(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), { lngLat: null, direction: null, takenAt: null });
  assert.deepEqual(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), { lngLat: null, direction: null, takenAt: null });
});

test('destination / viewFromPhoto: Kamera am Aufnahmeort, Blick in Fotorichtung', () => {
  const p = destination([10, 47], 90, 1000);
  assert.ok(Math.abs(p[1] - 47) < 1e-4 && p[0] > 10.013 && p[0] < 10.0135);
  const v = viewFromPhoto({ lngLat: [10, 47], direction: 90 });
  assert.equal(v.bearing, 90);
  assert.ok(v.center[0] > 10);
  assert.equal(viewFromPhoto({ lngLat: null }), null);
});

test('assignPhotos: Ort → nächste Station, ohne Ort → über Aufnahmezeit, sonst Rückfallstation', () => {
  const st = [{ lngLat: [10.28, 47.51] }, { lngLat: [10.37, 47.51] }, { lngLat: [10.42, 47.62] }];
  const photos = [
    { lngLat: [10.369, 47.509], takenAt: '2026-07-12T10:00:00' },
    { lngLat: null, takenAt: '2026-07-12T10:05:00' },
    { lngLat: [11.5, 48.1], takenAt: null },
    { lngLat: null, takenAt: null }
  ];
  const r = assignPhotos(photos, st, { fallbackIndex: 2 });
  assert.equal(r[0].station, 1);
  assert.match(r[0].reason, /Aufnahmeort/);
  assert.equal(r[1].station, 1);
  assert.match(r[1].reason, /Aufnahmezeit \(5 min/);
  assert.equal(r[2].station, 2);
  assert.equal(r[3].station, 2);
});
