/* global basemaps */
// Baut für jede Grundkarte einen vollständigen MapLibre-Stil:
// Grundkarte (OpenFreeMap | Luftbild | Protomaps) + 3D-Gelände + eigene Overlays.
// Overlays liegen unter den Beschriftungen der Grundkarte, damit Ortsnamen lesbar bleiben.

import { SOURCES, SAC_SCALE } from './config.js';

const SKY = {
  'sky-color': '#7fb2e5',
  'horizon-color': '#dfe9f2',
  'fog-color': '#e8eef3',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.3
};

let ofmCache = null;

/** Lädt den OpenFreeMap-Stil "Liberty" einmal und hält ihn im Speicher. */
export async function loadOfmStyle() {
  if (!ofmCache) {
    ofmCache = fetch(SOURCES.openfreemap.styleUrl).then((r) => {
      if (!r.ok) throw new Error(`OpenFreeMap-Stil: HTTP ${r.status}`);
      return r.json();
    });
    ofmCache.catch(() => (ofmCache = null));
  }
  return structuredClone(await ofmCache);
}

function overlaySources(data) {
  const dem = {
    type: 'raster-dem',
    tiles: SOURCES.terrain.tiles,
    encoding: SOURCES.terrain.encoding,
    tileSize: SOURCES.terrain.tileSize,
    maxzoom: SOURCES.terrain.maxzoom
  };
  return {
    // Getrennte DEM-Quellen für Terrain und Schummerung (von MapLibre empfohlen).
    terrain: { ...dem, attribution: SOURCES.terrain.attribution },
    hillshade: dem,
    ways: { type: 'geojson', data: data.ways, attribution: SOURCES.trails.attribution },
    points: { type: 'geojson', data: data.points },
    selected: { type: 'geojson', data: data.selected }
  };
}

function overlayLayers({ hillshade, visibility }) {
  const vis = (id) => ({ visibility: visibility[id] === false ? 'none' : 'visible' });
  const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 12, a, 16, b];
  const layers = [];
  if (hillshade) {
    layers.push({
      id: 'hillshade',
      type: 'hillshade',
      source: 'hillshade',
      layout: vis('hillshade'),
      paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#24323b', 'hillshade-highlight-color': '#ffffff' }
    });
  }
  const isLift = ['has', 'aerialway'];
  layers.push(
    {
      id: 'ways-casing',
      type: 'line',
      source: 'ways',
      filter: ['!', isLift],
      layout: { 'line-join': 'round', 'line-cap': 'round', ...vis('ways') },
      paint: { 'line-color': '#000000', 'line-opacity': 0.4, 'line-width': width(2.5, 6) }
    },
    {
      id: 'ways',
      type: 'line',
      source: 'ways',
      filter: ['!', isLift],
      layout: { 'line-join': 'round', 'line-cap': 'round', ...vis('ways') },
      paint: {
        'line-color': [
          'case',
          ['has', 'sac_scale'],
          ['match', ['get', 'sac_scale'], ...Object.entries(SAC_SCALE).flatMap(([k, v]) => [k, v.color]), '#9e9e9e'],
          ['==', ['get', 'highway'], 'cycleway'], '#7cb342',
          ['==', ['get', 'highway'], 'track'], '#c8a27a',
          ['==', ['get', 'highway'], 'via_ferrata'], '#8e24aa',
          '#ffffff'
        ],
        'line-width': width(1.2, 3.5),
        // Schlecht sichtbare Spuren gestrichelt – Unsicherheit soll sichtbar sein.
        'line-dasharray': [
          'case',
          ['in', ['get', 'trail_visibility'], ['literal', ['bad', 'horrible', 'no']]], ['literal', [1, 1.5]],
          ['==', ['get', 'highway'], 'track'], ['literal', [3, 1.5]],
          ['literal', [1, 0]]
        ]
      }
    },
    {
      id: 'lifts',
      type: 'line',
      source: 'ways',
      filter: isLift,
      layout: { 'line-cap': 'butt', ...vis('lifts') },
      paint: { 'line-color': '#111111', 'line-width': width(1.5, 3), 'line-dasharray': [4, 1] }
    },
    {
      id: 'selected',
      type: 'line',
      source: 'selected',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#00e5ff', 'line-width': width(4, 8), 'line-opacity': 0.85 }
    },
    {
      id: 'huts',
      type: 'circle',
      source: 'points',
      filter: ['in', ['get', 'kind'], ['literal', ['alpine_hut', 'wilderness_hut']]],
      layout: vis('peaks'),
      paint: {
        'circle-radius': width(3, 6),
        'circle-color': '#8d4e1f',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-pitch-alignment': 'viewport'
      }
    },
    {
      id: 'peaks',
      type: 'circle',
      source: 'points',
      filter: ['==', ['get', 'kind'], 'peak'],
      layout: vis('peaks'),
      paint: {
        'circle-radius': width(3.5, 7),
        'circle-color': ['match', ['get', 'check'], 'ok', '#1e8e3e', 'info', '#e3b341', 'warn', '#e53935', '#9e9e9e'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-pitch-alignment': 'viewport'
      }
    }
  );
  return layers;
}

/**
 * Bergnamen mit Höhe. Bis Zoom 12 aus der Grundkarte (Vektorkacheln), ab Zoom 12 aus den
 * Live-OSM-Gipfeln – dort neben dem farbigen Prüfpunkt, damit Name und Validierung zusammenstehen.
 */
function peakLabels(base, { visibility, dark = false }) {
  const vis = { visibility: visibility.peaks === false ? 'none' : 'visible' };
  const name = ['coalesce', ['get', 'name:de'], ['get', 'name']];
  const withEle = (ele) => [
    'case',
    ['to-boolean', ele],
    ['format', name, {}, '\n', {}, ['concat', ['to-string', ele], ' m'], { 'font-scale': 0.82 }],
    ['format', name, {}]
  ];
  const paint = dark
    ? { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.5 }
    : { 'text-color': '#4a2f17', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.5 };
  const layout = { 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 13.5], 'text-max-width': 8, ...vis };
  const overview =
    base === 'protomaps'
      ? { source: 'protomaps', 'source-layer': 'pois', filter: ['==', ['get', 'kind'], 'peak'], ele: ['get', 'elevation'] }
      : { source: 'openmaptiles', 'source-layer': 'mountain_peak', filter: ['in', ['get', 'class'], ['literal', ['peak', 'volcano']]], ele: ['get', 'ele'] };
  return [
    {
      id: 'peak-labels-overview',
      type: 'symbol',
      source: overview.source,
      'source-layer': overview['source-layer'],
      minzoom: 9,
      maxzoom: 12,
      filter: ['all', overview.filter, ['has', 'name']],
      layout: { ...layout, 'text-field': withEle(overview.ele), 'symbol-sort-key': ['-', 0, ['coalesce', overview.ele, 0]] },
      paint
    },
    {
      id: 'peak-labels',
      type: 'symbol',
      source: 'points',
      minzoom: 12,
      filter: ['all', ['==', ['get', 'kind'], 'peak'], ['to-boolean', ['get', 'name']]],
      layout: {
        ...layout,
        'text-field': withEle(['get', 'ele_raw']),
        'text-anchor': 'left',
        'text-offset': [0.9, 0],
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'ele_osm'], 0]]
      },
      paint
    }
  ];
}

/** Fügt Overlays vor der ersten Beschriftungsebene ein. */
function insertBeforeLabels(layers, extra) {
  const i = layers.findIndex((l) => l.type === 'symbol');
  return i < 0 ? [...layers, ...extra] : [...layers.slice(0, i), ...extra, ...layers.slice(i)];
}

function finish(style, data, opts) {
  style.sources = { ...style.sources, ...overlaySources(data) };
  if (opts.terrain) style.terrain = { source: 'terrain', exaggeration: opts.exaggeration };
  else delete style.terrain;
  style.sky = SKY;
  return style;
}

export async function openFreeMapStyle(data, opts) {
  const style = await loadOfmStyle();
  style.layers = [
    ...insertBeforeLabels(style.layers, overlayLayers({ hillshade: true, visibility: opts.visibility })),
    ...peakLabels('openfreemap', opts)
  ];
  return finish(style, data, opts);
}

/** Luftbild-Mosaik (BY > AT > Sentinel-2) mit den OpenFreeMap-Beschriftungen in Weiss. */
export async function aerialStyle(data, opts) {
  const ofm = await loadOfmStyle();
  const sources = {};
  const rasterLayers = [];
  for (const l of SOURCES.imagery.layers) {
    sources[l.id] = { type: 'raster', tiles: l.tiles, tileSize: 256, maxzoom: l.maxzoom, attribution: l.attribution, ...(l.bounds ? { bounds: l.bounds } : {}) };
    rasterLayers.push({ id: l.id, type: 'raster', source: l.id, paint: { 'raster-fade-duration': 150 } });
  }
  const labelSources = new Set();
  const labels = ofm.layers
    .filter((l) => l.type === 'symbol')
    .map((l) => {
      labelSources.add(l.source);
      return { ...l, paint: { ...l.paint, 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 } };
    });
  for (const s of labelSources) sources[s] = ofm.sources[s];
  const style = {
    version: 8,
    glyphs: ofm.glyphs,
    sprite: ofm.sprite,
    sources,
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#2b3238' } },
      ...rasterLayers,
      ...overlayLayers({ hillshade: false, visibility: opts.visibility }),
      ...labels,
      ...peakLabels('aerial', { ...opts, dark: true })
    ]
  };
  return finish(style, data, opts);
}

/** Protomaps-Grundkarte aus einer PMTiles-Datei (Protokoll muss registriert sein). */
export function protomapsStyle(pmtilesUrl, data, opts) {
  const base = basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'de' });
  const style = {
    version: 8,
    glyphs: SOURCES.protomaps.glyphs,
    sprite: SOURCES.protomaps.sprite,
    sources: {
      protomaps: {
        type: 'vector',
        url: pmtilesUrl,
        attribution: `${SOURCES.protomaps.attribution} · ${SOURCES.trails.attribution}`
      }
    },
    layers: [...insertBeforeLabels(base, overlayLayers({ hillshade: true, visibility: opts.visibility })), ...peakLabels('protomaps', opts)]
  };
  return finish(style, data, opts);
}
