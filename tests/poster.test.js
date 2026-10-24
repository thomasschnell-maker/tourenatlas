import test from 'node:test';
import assert from 'node:assert/strict';
import { metersPerCssPx, planPoster, posterZoom, roundScale, scaleBar, scaleDenominator } from '../js/packages/poster-core.js';

test('planPoster: A1 hoch – Pixel-Obergrenze und WebGL-Grenze bestimmen die dpi', () => {
  const p = planPoster('A1', false, { maxPixels: 16e6, maxGlDim: 16384 });
  assert.ok(p.px.w * p.px.h <= 16e6, `${p.px.w}×${p.px.h}`);
  assert.ok(p.dpi >= 140 && p.dpi <= 145, `dpi ${p.dpi}`);
  assert.equal(p.mm.w, 594);
  assert.ok(Math.abs(p.aspect - p.mapMm.w / p.mapMm.h) < 1e-9);
  assert.match(p.quality, /gut/);
});

test('planPoster: kleine WebGL-Grenze begrenzt die Kartengrösse', () => {
  const p = planPoster('A0', false, { maxPixels: 64e6, maxGlDim: 4096 });
  assert.ok(Math.max(p.mapPx.w, p.mapPx.h) <= 4096);
});

test('planPoster: A4 quer bei 300 dpi ohne Begrenzung', () => {
  const p = planPoster('A4', true, { maxPixels: 64e6, maxGlDim: 16384 });
  assert.equal(p.dpi, 300);
  assert.equal(p.px.w, 3508);
  assert.equal(p.px.h, 2480);
});

test('posterZoom: doppelte Breite = +1 Zoomstufe', () => {
  assert.equal(posterZoom(13, 300, 600), 14);
});

test('Massstab: Breite 47°, Zoom 14 → ca. 1:13 000', () => {
  const m = metersPerCssPx(47, 14);
  assert.ok(Math.abs(m - 3.258) < 0.01, `m ${m}`);
  const n = scaleDenominator(47, 14);
  assert.ok(Math.abs(n - 13032) < 10, `n ${n}`);
  assert.equal(roundScale(24731), 25000);
  assert.equal(roundScale(13032), 12500);
});

test('scaleBar: schöne Länge, passt in maxMm', () => {
  const b = scaleBar(25000, 60); // 60 mm = 1500 m → 1 km
  assert.equal(b.meters, 1000);
  assert.equal(b.mm, 40);
  assert.equal(b.label, '1 km');
});
