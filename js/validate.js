// Kreuzvalidierung der Quellen: OSM-Attribute gegen das Höhenmodell, plus
// Plausibilitäts- und Aktualitätsprüfungen. Ergebnis sind Befunde mit Stufe
// ok | info | warn – keine stillen Korrekturen der Originaldaten.

import { REGION, VALIDATION, SOURCES } from './config.js';
import { ascentDescent, densify, lineLength, maxGrade, median } from './geo.js';

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function ageYears(timestamp, now = Date.now()) {
  const t = Date.parse(timestamp);
  return Number.isFinite(t) ? (now - t) / YEAR_MS : null;
}

/** Bewertet die Abweichung OSM-Höhenangabe vs. DEM-Maximum im Umkreis für einen Gipfel. */
export function classifyPeakDelta(eleOsm, eleDem, cfg = VALIDATION) {
  if (eleOsm == null) return { level: 'info', text: 'Keine Höhenangabe in OSM (ele fehlt)' };
  if (eleDem == null) return { level: 'info', text: 'DEM-Höhe nicht verfügbar' };
  const delta = eleOsm - eleDem;
  if (Math.abs(delta) <= cfg.peakDeltaOkM) return { level: 'ok', delta, text: `Δ ${fmtSigned(delta)} m – konsistent` };
  if (delta > 0 && delta <= cfg.peakSmoothMaxM) {
    return { level: 'info', delta, text: `Δ ${fmtSigned(delta)} m – typisch für Rasterglättung an spitzen Gipfeln` };
  }
  if (delta < 0 && delta >= -cfg.peakBelowWarnM) {
    return { level: 'info', delta, text: `Δ ${fmtSigned(delta)} m – OSM tiefer als Gelände, Höhe prüfen` };
  }
  return { level: 'warn', delta, text: `Δ ${fmtSigned(delta)} m – wahrscheinlich Höhen- oder Positionsfehler in OSM` };
}

/** Prüft Gipfel (natural=peak); Hütten und Sättel werden nicht bewertet. */
export async function validatePeaks(points, sampler) {
  const peaks = points.features.filter((f) => f.properties.kind === 'peak');
  const dems = await Promise.all(peaks.map((f) => sampler.maxAround(f.geometry.coordinates, VALIDATION.peakRadiusM)));
  peaks.forEach((f, i) => {
    const dem = dems[i];
    const res = classifyPeakDelta(f.properties.ele_osm, dem);
    f.properties.ele_dem = dem == null ? null : Math.round(dem);
    f.properties.check = res.level;
    f.properties.check_text = res.text;
    f.properties.delta = res.delta == null ? null : Math.round(res.delta);
  });
  return points;
}

/** Höhenprofil + Befunde für einen Weg. */
export async function profileWay(feature, sampler, now = Date.now()) {
  const coords = feature.geometry.coordinates;
  const pts = densify(coords, VALIDATION.sampleSpacingM);
  const eles = await sampler.elevations(pts.map((p) => p.coord));
  const profile = pts.map((p, i) => ({ dist: p.dist, ele: eles[i], coord: p.coord }));
  const valid = eles.filter((e) => e != null);
  const length = lineLength(coords);
  const { up, down } = ascentDescent(eles, VALIDATION.ascentHysteresisM);
  const grade = maxGrade(profile, 50);
  const findings = wayFindings(feature.properties, { length, grade, up, down, coverage: valid.length / eles.length }, now);
  return {
    profile,
    stats: {
      length,
      up,
      down,
      min: valid.length ? Math.min(...valid) : null,
      max: valid.length ? Math.max(...valid) : null,
      maxGrade: grade
    },
    findings
  };
}

export function wayFindings(props, { length, grade, up, down, coverage }, now = Date.now()) {
  const f = [];
  const res = SOURCES.terrain.accuracy.horizontalM;
  if (coverage < 1) f.push({ level: 'warn', text: `Nur ${Math.round(coverage * 100)} % des Profils mit DEM-Daten` });
  if (length < res * 3) {
    f.push({ level: 'info', text: `Weg kürzer als 3 DEM-Rasterzellen (${Math.round(length)} m) – Profil nicht belastbar` });
  }
  if (['path', 'footway'].includes(props.highway) && !props.sac_scale) {
    f.push({ level: 'info', text: 'Keine SAC-Schwierigkeit (sac_scale) erfasst' });
  }
  const incline = parseIncline(props.incline);
  if (incline != null && length >= res * 3) {
    const avg = ((up + down) / length) * 100;
    if (Math.abs(Math.abs(incline) - avg) > 15) {
      f.push({ level: 'warn', text: `incline=${props.incline} weicht vom DEM ab (Ø ${avg.toFixed(0)} %)` });
    } else {
      f.push({ level: 'ok', text: `incline=${props.incline} passt zum DEM (Ø ${avg.toFixed(0)} %)` });
    }
  }
  if (props.sac_scale === 'hiking' && grade > 45 && length >= res * 3) {
    f.push({ level: 'info', text: `T1 (hiking), aber DEM-Steigung bis ${grade.toFixed(0)} % – Einstufung prüfen` });
  }
  if (props.trail_visibility && ['bad', 'horrible', 'no'].includes(props.trail_visibility)) {
    f.push({ level: 'warn', text: `Wegspur schlecht sichtbar (trail_visibility=${props.trail_visibility})` });
  }
  const age = ageYears(props.timestamp, now);
  if (age != null && age > 5) f.push({ level: 'info', text: `Seit ${age.toFixed(1)} Jahren nicht bearbeitet` });
  if (!f.some((x) => x.level !== 'ok')) f.push({ level: 'ok', text: 'Keine Auffälligkeiten' });
  return f;
}

/** "incline" kann "12%", "-8 %", "up", "down" sein – nur Zahlen sind vergleichbar. */
export function parseIncline(raw) {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  return m ? Number(m[1]) : null;
}

/** Qualitätskennzahlen über alle geladenen Daten. */
export function qualitySummary(ways, peaks, now = Date.now()) {
  const wf = ways.features.filter((w) => !w.properties.aerialway);
  const paths = wf.filter((w) => ['path', 'footway'].includes(w.properties.highway));
  const ages = wf.map((w) => ageYears(w.properties.timestamp, now)).filter((a) => a != null);
  const summits = peaks.features.filter((p) => p.properties.kind === 'peak');
  const checked = summits.filter((p) => p.properties.delta != null);
  return {
    ways: wf.length,
    km: wf.reduce((s, w) => s + lineLength(w.geometry.coordinates), 0) / 1000,
    sacShare: paths.length ? paths.filter((w) => w.properties.sac_scale).length / paths.length : null,
    medianAgeYears: median(ages),
    peaks: summits.length,
    huts: peaks.features.filter((p) => /hut$/.test(p.properties.kind)).length,
    lifts: ways.features.length - wf.length,
    peaksChecked: checked.length,
    peaksWarn: summits.filter((p) => p.properties.check === 'warn').length,
    peakMedianAbsDelta: median(checked.map((p) => Math.abs(p.properties.delta)))
  };
}

function fmtSigned(v) {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : `${r}`;
}

/** Prüft einen PMTiles-Header gegen die Anforderungen der App. */
export function checkPmtilesHeader(header, vectorLayers, region = REGION.bbox) {
  const findings = [];
  if (header.tileType !== 1) {
    findings.push({ level: 'warn', text: 'Keine Vektorkacheln (MVT) – als Grundkarte ungeeignet' });
  }
  const [w, s, e, n] = region;
  const overlapW = Math.max(w, header.minLon);
  const overlapE = Math.min(e, header.maxLon);
  const overlapS = Math.max(s, header.minLat);
  const overlapN = Math.min(n, header.maxLat);
  const cover = overlapE > overlapW && overlapN > overlapS ? ((overlapE - overlapW) * (overlapN - overlapS)) / ((e - w) * (n - s)) : 0;
  if (cover === 0) findings.push({ level: 'warn', text: 'Datei deckt die Allgäu-Region nicht ab' });
  else if (cover < 0.95) findings.push({ level: 'info', text: `Datei deckt ${Math.round(cover * 100)} % der Region ab` });
  else findings.push({ level: 'ok', text: 'Region vollständig abgedeckt' });
  if (header.maxZoom < 14) findings.push({ level: 'info', text: `Max. Zoom ${header.maxZoom} – Wege im Detail erst ab 14 vollständig` });
  const required = ['roads', 'places', 'earth'];
  const missing = required.filter((l) => !vectorLayers.includes(l));
  if (missing.length) {
    findings.push({ level: 'warn', text: `Kein Protomaps-Schema (fehlt: ${missing.join(', ')}) – Stil passt nicht` });
  }
  return { findings, cover, usable: header.tileType === 1 && cover > 0 && !missing.length };
}
