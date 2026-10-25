import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock-Nominatim: "Memmingen" liegt weit weg (wie im echten Fehlerfall), "Alt Mummen" fehlt, "Mummen" passt.
const PLACES = {
  Sonthofen: [[10.2833, 47.5167]],
  Immenstadt: [[10.2194, 47.5598]],
  Memmingen: [[10.1811, 47.9837]],
  Mummen: [[10.24, 47.55]],
  Gunzesried: [[10.2486, 47.5025]]
};
function mock() {
  const server = createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q');
    const hits = (PLACES[q] || []).map(([lon, lat], i) => ({ lon: String(lon), lat: String(lat), display_name: `${q} ${i}`, category: 'place', type: 'village', osm_type: 'node', osm_id: i + 1 }));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(hits));
  });
  return new Promise((r) => server.listen(0, () => r({ server, url: `http://127.0.0.1:${server.address().port}/search` })));
}

test('resolve-tours: Abstandsprüfung, Alternativen, fehlende Stationen, keine Doppelstation', async () => {
  const m = await mock();
  const dir = mkdtempSync(join(tmpdir(), 'ta-tours-'));
  writeFileSync(join(dir, 'q.json'), JSON.stringify({
    viewbox: [10.05, 47.4, 10.45, 47.62],
    maxStepKm: 10,
    segments: {
      a: [{ name: 'Sonthofen', q: ['Sonthofen'] }, { name: 'Immenstadt', q: ['Immenstadt'] }, { name: 'Weit weg', q: ['Memmingen'] }, { name: 'Altmummen', q: ['Alt Mummen', 'Mummen'] }],
      b: [{ name: 'Unbekannt', q: ['Gibtsnicht'], optional: true }, { name: 'Gunzesried', q: ['Gunzesried'] }, { name: 'Gunzesried', q: ['Gunzesried'] }]
    },
    tours: [{ id: 't1', version: 1, name: 'T', segments: ['a', 'b'] }]
  }));
  try {
    await new Promise((resolve, reject) =>
      execFile('node', ['tools/resolve-tours.mjs', join(dir, 'q.json'), join(dir, 'out', 't.json')], { env: { ...process.env, NOMINATIM_URL: m.url, PAUSE_MS: '0' } }, (e, so, se) => (e ? reject(new Error(se)) : resolve(so)))
    );
    const [t] = JSON.parse(readFileSync(join(dir, 'out', 't.json'), 'utf8'));
    assert.deepEqual(t.stations.map((s) => s.name), ['Sonthofen', 'Immenstadt', 'Altmummen', 'Gunzesried']);
    assert.equal(t.stations[2].source.query, 'Mummen');
    assert.deepEqual(t.missing.map((x) => x.split(' (')[0]), ['Weit weg', 'Unbekannt']);
    assert.ok(!t.segments);
  } finally {
    m.server.close();
  }
});
