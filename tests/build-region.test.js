import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellInHole } from '../js/region.js';
import { cellKey } from '../js/cells.js';

// Mock-Overpass: Abfragen um (10.3, 47.4) sind erst ab 1/16 Fläche klein genug, um (10.85, 47.9) scheitert alles.
function mockOverpass() {
  let requests = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests++;
      const q = new URLSearchParams(body).get('data');
      const [s, w, n, e] = q.match(/\[bbox:([^\]]+)\]/)[1].split(',').map(Number);
      const has = (x, y) => w <= x && x < e && s <= y && y < n;
      const area = (e - w) * (n - s);
      if ((has(10.3, 47.4) && area > 0.1 * 0.075 / 10) || has(10.85, 47.9)) {
        res.writeHead(504);
        return res.end();
      }
      const id = Math.round(w * 1e4) * 1e6 + Math.round(s * 1e4);
      const [cx, cy] = [(w + e) / 2, (s + n) / 2];
      res.end(JSON.stringify({
        osm3s: { timestamp_osm_base: '2026-10-24T12:00:00Z' },
        elements: [{ type: 'way', id, tags: { highway: 'path' }, geometry: [{ lat: cy, lon: cx }, { lat: cy + 0.001, lon: cx + 0.001 }] }]
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/`, count: () => requests })));
}

const run = (args, env) =>
  new Promise((resolve, reject) =>
    execFile('node', ['tools/build-region.mjs', ...args], { env: { ...process.env, ...env } }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  );

test('build-region: viertelt überlastete Teilabfragen, meldet Lücken, setzt aus dem Cache fort', { timeout: 60000 }, async () => {
  const mock = await mockOverpass();
  const dir = mkdtempSync(join(tmpdir(), 'ta-region-'));
  const env = { OVERPASS_URL: mock.url, PAUSE_MS: '0' };
  try {
    await run([join(dir, 'cells'), join(dir, 'chunks')], env);
    const idx = JSON.parse(readFileSync(join(dir, 'cells', 'index.json'), 'utf8'));
    // Ganze Region bis auf das immer scheiternde Gebiet: genau ein 1/16-Stück fehlt
    assert.equal(idx.holes.length, 1);
    const [hw, hs, he, hn] = idx.holes[0];
    assert.ok(hw <= 10.85 && 10.85 < he && hs <= 47.9 && 47.9 < hn);
    assert.ok(Math.abs((he - hw) * (hn - hs) - (0.1 * 0.075) / 16) < 1e-6);
    assert.equal(idx.osmBase, '2026-10-24T12:00:00Z');
    assert.equal(readdirSync(join(dir, 'cells', idx.gen)).length, idx.cells.length);
    // 163 normale Teile + 3 + 4 Stücke um (10.3, 47.4) + 3 + 3 um (10.85, 47.9) – je ein Weg
    assert.equal(idx.counts.ways, 163 + 7 + 6);
    assert.equal(cellInHole(cellKey(10.85, 47.9, idx.cellDeg), idx.cellDeg, idx.holes), true);
    assert.equal(cellInHole(cellKey(10.3, 47.4, idx.cellDeg), idx.cellDeg, idx.holes), false);
    // Zweiter Lauf: nur das fehlende Gebiet wird erneut versucht, gleiche Daten → gleiche Generation
    const before = mock.count();
    await run([join(dir, 'cells'), join(dir, 'chunks')], env);
    const idx2 = JSON.parse(readFileSync(join(dir, 'cells', 'index.json'), 'utf8'));
    assert.equal(mock.count() - before, 3); // nur das Loch selbst, 3 Versuche – geteilte Gebiete nicht erneut im Ganzen
    assert.equal(idx2.gen, idx.gen);
  } finally {
    mock.server.close();
  }
});
