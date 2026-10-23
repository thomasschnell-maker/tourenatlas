import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastUrl, parseForecast, summarize, wmo } from '../js/packages/weather-core.js';

test('buildForecastUrl: Modell, Höhe, Variablen', () => {
  const u = new URL(buildForecastUrl([10.3433, 47.4214], 2170.4, 24));
  assert.equal(u.searchParams.get('latitude'), '47.4214');
  assert.equal(u.searchParams.get('longitude'), '10.3433');
  assert.equal(u.searchParams.get('elevation'), '2170');
  assert.equal(u.searchParams.get('models'), 'icon_seamless');
  assert.match(u.searchParams.get('hourly'), /freezing_level_height/);
  assert.equal(new URL(buildForecastUrl([10, 47], null)).searchParams.has('elevation'), false);
});

test('parseForecast: Fehler und null-Werte', () => {
  assert.throws(() => parseForecast({ error: true, reason: 'Parameter falsch' }), /Parameter falsch/);
  assert.throws(() => parseForecast({ hourly: { time: [] } }), /keine Stundenwerte/);
  const r = parseForecast({ elevation: 2170, hourly: { time: ['2026-10-24T10:00'], temperature_2m: [1.5], cape: [null] } });
  assert.equal(r.rows[0].temperature_2m, 1.5);
  assert.equal(r.rows[0].cape, null);
  assert.equal(r.rows[0].wind_gusts_10m, null);
  assert.equal(r.elevation, 2170);
});

const row = (time, o) => ({ time, temperature_2m: 5, precipitation: 0, weather_code: 1, wind_speed_10m: 10, wind_gusts_10m: 20, freezing_level_height: 3000, cape: 0, ...o });

test('summarize: ruhiges Wetter → ok', () => {
  const s = summarize([row('2026-10-24T10:00'), row('2026-10-24T11:00')], 2000);
  assert.deepEqual(s.findings.map((f) => f.level), ['ok']);
});

test('summarize: Böen, Gewitter, Frostgrenze unter Punkt', () => {
  const rows = [
    row('2026-10-24T12:00', { wind_gusts_10m: 75 }),
    row('2026-10-24T15:00', { cape: 1400, precipitation: 2.5 }),
    row('2026-10-24T18:00', { freezing_level_height: 1800 })
  ];
  const s = summarize(rows, 2200);
  const t = s.findings.map((f) => `${f.level}:${f.text}`).join('\n');
  assert.match(t, /warn:Sturmböen bis 75/);
  assert.match(t, /warn:Gewitterrisiko ab 15 Uhr/);
  assert.match(t, /warn:0-°C-Grenze bis 1800 m/);
  assert.match(t, /info:Niederschlag 2\.5 mm/);
});

test('summarize: CAPE ohne Niederschlag ist nur Hinweis', () => {
  const s = summarize([row('2026-10-24T14:00', { cape: 1500 })], 1000);
  assert.ok(s.findings.some((f) => f.level === 'info' && /Labile/.test(f.text)));
  assert.ok(!s.findings.some((f) => /Gewitterrisiko/.test(f.text)));
});

test('wmo-Codes', () => {
  assert.equal(wmo(0).text, 'klar');
  assert.equal(wmo(95).text, 'Gewitter');
  assert.equal(wmo(1234).text, 'unbekannt');
});
