// Wetter-Paket: reine Logik (ohne DOM, in Node testbar).
// Quelle: Open-Meteo (https://open-meteo.com), Daten CC BY 4.0, Modell DWD ICON (D2 2 km → EU 7 km → global).

export const WEATHER_SOURCE = {
  api: 'https://api.open-meteo.com/v1/forecast',
  model: 'icon_seamless',
  modelLabel: 'DWD ICON (D2 2 km, nahtlos)',
  license: 'CC BY 4.0',
  licenseUrl: 'https://open-meteo.com/en/license',
  attribution: 'Wetter: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo.com</a> (DWD ICON), CC BY 4.0',
  // Kostenlos für nicht-kommerzielle Nutzung (< 10 000 Abfragen/Tag). Kommerziell: API-Abo nötig.
  terms: 'nicht-kommerziell frei',
  radar: {
    // DWD-Geoserver, Open Data (GeoNutzV), Namensnennung "Deutscher Wetterdienst".
    // Ebenenname aus der DWD-Dokumentation, nicht live geprüft.
    tiles: [
      'https://maps.dwd.de/geoserver/dwd/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=dwd:Niederschlagsradar&STYLES=' +
        '&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'
    ],
    attribution: 'Radar: <a href="https://www.dwd.de" target="_blank" rel="noopener">Deutscher Wetterdienst</a>'
  }
};

export const HOURLY = [
  'temperature_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'freezing_level_height',
  'cape'
];

// Faustregeln für Bergtouren. Bewusst konservativ; ersetzen keinen Bergwetterbericht.
export const WEATHER_RULES = {
  gustWarnKmh: 60,      // ab hier am Grat gefährlich
  gustInfoKmh: 40,
  capeStormJkg: 1000,   // labile Schichtung: mit Niederschlag → Gewitterrisiko
  capeInfoJkg: 400,
  rainInfoMm: 1         // Summe im Zeitfenster
};

/** Abfrage-URL. elevation = Geländehöhe aus unserem DEM → Open-Meteo rechnet die Temperatur darauf um. */
export function buildForecastUrl([lon, lat], elevation, hours = 24) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY.join(','),
    models: WEATHER_SOURCE.model,
    timezone: 'Europe/Berlin',
    forecast_hours: String(hours),
    wind_speed_unit: 'kmh'
  });
  if (Number.isFinite(elevation)) p.set('elevation', String(Math.round(elevation)));
  return `${WEATHER_SOURCE.api}?${p}`;
}

/** Prüft die Antwort und wandelt sie in Stundenzeilen um. Fehlende Werte bleiben null. */
export function parseForecast(json) {
  if (json?.error) throw new Error(`Open-Meteo: ${json.reason || 'Fehler'}`);
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) throw new Error('Open-Meteo: keine Stundenwerte');
  const rows = h.time.map((time, i) => {
    const row = { time };
    for (const k of HOURLY) {
      const v = h[k]?.[i];
      row[k] = Number.isFinite(v) ? v : null;
    }
    return row;
  });
  return { rows, elevation: Number.isFinite(json.elevation) ? json.elevation : null };
}

const max = (rows, k) => rows.reduce((m, r) => (r[k] != null && (m == null || r[k] > m) ? r[k] : m), null);
const min = (rows, k) => rows.reduce((m, r) => (r[k] != null && (m == null || r[k] < m) ? r[k] : m), null);
const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);

/** Kennzahlen + Befunde für den Zeitraum. pointEle = Geländehöhe des Abfragepunkts. */
export function summarize(rows, pointEle, rules = WEATHER_RULES) {
  const s = {
    tMin: min(rows, 'temperature_2m'),
    tMax: max(rows, 'temperature_2m'),
    rain: sum(rows, 'precipitation'),
    gustMax: max(rows, 'wind_gusts_10m'),
    capeMax: max(rows, 'cape'),
    freezingMin: min(rows, 'freezing_level_height')
  };
  const f = [];
  if (s.gustMax != null && s.gustMax >= rules.gustWarnKmh) f.push({ level: 'warn', text: `Sturmböen bis ${Math.round(s.gustMax)} km/h – Grate und Seilbahnen meiden` });
  else if (s.gustMax != null && s.gustMax >= rules.gustInfoKmh) f.push({ level: 'info', text: `Böen bis ${Math.round(s.gustMax)} km/h` });
  const stormHour = rows.find((r) => r.cape != null && r.cape >= rules.capeStormJkg && (r.precipitation ?? 0) > 0);
  if (stormHour) f.push({ level: 'warn', text: `Gewitterrisiko ab ${hourLabel(stormHour.time)} Uhr (CAPE ${Math.round(stormHour.cape)} J/kg)` });
  else if (s.capeMax != null && s.capeMax >= rules.capeInfoJkg) f.push({ level: 'info', text: 'Labile Luftschichtung – Quellbewölkung beobachten' });
  if (s.freezingMin != null && pointEle != null && s.freezingMin < pointEle) {
    f.push({ level: 'warn', text: `0-°C-Grenze bis ${Math.round(s.freezingMin)} m – am Punkt (${Math.round(pointEle)} m) Frost, Schnee oder Eis möglich` });
  }
  if (s.rain >= rules.rainInfoMm) f.push({ level: 'info', text: `Niederschlag ${s.rain.toFixed(1)} mm im Zeitraum` });
  if (!f.length) f.push({ level: 'ok', text: 'Keine Wetter-Warnsignale im Zeitraum' });
  return { ...s, findings: f };
}

export function hourLabel(isoLocal) {
  return isoLocal.slice(11, 13);
}

// WMO-Wettercodes (Open-Meteo) → kurzes Symbol + Text.
const WMO = [
  [[0], '☀️', 'klar'],
  [[1, 2], '🌤️', 'teils bewölkt'],
  [[3], '☁️', 'bedeckt'],
  [[45, 48], '🌫️', 'Nebel'],
  [[51, 53, 55, 56, 57], '🌦️', 'Niesel'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Regen'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Schnee'],
  [[95, 96, 99], '⛈️', 'Gewitter']
];

export function wmo(code) {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? { icon: hit[1], text: hit[2] } : { icon: '·', text: 'unbekannt' };
}
