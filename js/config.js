// Zentrale Quellen-Konfiguration. Jede Quelle trägt Lizenz, Pflicht-Attribution
// und bekannte Genauigkeitsgrenzen, damit Validierung und Quellenpanel darauf zugreifen.
//
// Die drei gewählten Kernbausteine:
//   1. MapLibre GL JS  – Open-Source-Kartenengine (2D/3D, Gelände)       → vendor/maplibre-gl
//   2. OpenFreeMap     – kostenlose OSM-Vektorkarte online, ohne Schlüssel → SOURCES.openfreemap
//   3. Protomaps       – OSM als PMTiles-Datei, offline/ohne Server        → SOURCES.protomaps
// Ergänzt um Höhenmodell (3D), Overpass (Wege-Details mit SAC-Skala) und amtliche Luftbilder.

export const REGION = {
  name: 'Allgäu, Tirol, Vorarlberg, Bodensee',
  bbox: [9.55, 47.22, 11.0, 47.98] // [W, S, E, N]
};

export const SOURCES = {
  openfreemap: {
    id: 'openfreemap',
    name: 'OpenFreeMap (Vektorkarte)',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    license: 'Kartendaten ODbL, Stil/Dienst frei',
    licenseUrl: 'https://openfreemap.org/',
    attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>'
  },
  protomaps: {
    id: 'protomaps',
    name: 'Protomaps (PMTiles, offline)',
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    // Tagesaktueller Planet-Build für den Ausschnitt per `pmtiles extract` (siehe README).
    buildsUrl: 'https://maps.protomaps.com/builds/',
    license: 'Daten ODbL, Software BSD-3',
    licenseUrl: 'https://protomaps.com/',
    attribution: '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>'
  },
  terrain: {
    id: 'terrain',
    name: 'Terrain Tiles (Höhenmodell)',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    // Quelldaten ~25–30 m: ab Zoom 13 (~13 m/px) bringt mehr nur Interpolation, aber mehr Datenvolumen
    // und Lücken im Offline-Betrieb. Darüber vergrössert MapLibre die Zoom-13-Kacheln.
    maxzoom: 13,
    license: 'Offene Daten, Attribution erforderlich',
    licenseUrl: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
    attribution:
      'Höhen: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> ' +
      '(<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">EU-DEM/Copernicus, SRTM u.a.</a>)',
    // Im Allgäu stammt das Modell aus EU-DEM (~25–30 m Raster, vertikale RMSE ~ ±7 m).
    // Gipfel werden durch das Raster systematisch geglättet (DEM zu tief).
    accuracy: { horizontalM: 30, verticalRmseM: 7 }
  },
  trails: {
    id: 'trails',
    name: 'OpenStreetMap (Regionsdaten wöchentlich, sonst live)',
    endpoints: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ],
    license: 'ODbL 1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>',
    minZoom: 12,
    // Nachladen in festen Zellen (~3 × 3,3 km im Allgäu): kleine Abfragen bleiben unter den Zeitlimits.
    cellDeg: [0.04, 0.03],
    radiusKm: 7,          // nur Zellen bis zu diesem Abstand von der Bildmitte
    maxCells: 16,         // pro Kartenbewegung
    concurrency: 2,       // gleichzeitige Abfragen (Fairness gegenüber öffentlichen Servern)
    timeoutMs: 30000
  },
  imagery: {
    id: 'imagery',
    name: 'Luftbild (Bayern, basemap.at, Sentinel-2)',
    layers: [
      {
        // Fallback ausserhalb BY/AT, z. B. Wangen, Isny (Baden-Württemberg). Nur Jahrgang 2016 ist CC BY 4.0.
        id: 'imagery-s2',
        tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
        maxzoom: 15,
        attribution: 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Copernicus Sentinel-Daten 2016), CC BY 4.0'
      },
      {
        // Österreich: Orthofoto 30 cm, CC BY 4.0.
        id: 'imagery-at',
        tiles: ['https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg'],
        maxzoom: 19,
        bounds: [9.5, 46.37, 17.17, 49.03],
        attribution: 'Orthofoto: <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a>, CC BY 4.0'
      },
      {
        // Bayern: Digitales Orthophoto 40 cm (WMS, Open Data), CC BY 4.0.
        id: 'imagery-by',
        tiles: [
          'https://geoservices.bayern.de/od/wms/dop/v1/dop40?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=by_dop40c&STYLES=' +
            '&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'
        ],
        maxzoom: 19,
        bounds: [8.97, 47.27, 13.84, 50.57],
        attribution: 'Luftbild: <a href="https://geodaten.bayern.de/opengeodata/" target="_blank" rel="noopener">Bayerische Vermessungsverwaltung</a>, CC BY 4.0'
      }
    ],
    license: 'CC BY 4.0 (alle drei Ebenen)',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
  }
};

// Weg-Typen, die als "Weg" gelten. Bewusst breit: alles, was zu Fuss oder per Rad begehbar ist.
export const WAY_HIGHWAYS = ['path', 'footway', 'track', 'bridleway', 'steps', 'via_ferrata', 'cycleway', 'pedestrian'];

// SAC-Wanderskala (OSM-Tag sac_scale) → Anzeige.
export const SAC_SCALE = {
  hiking: { label: 'T1 Wandern', color: '#f4d03f' },
  mountain_hiking: { label: 'T2 Bergwandern', color: '#e74c3c' },
  demanding_mountain_hiking: { label: 'T3 anspr. Bergwandern', color: '#c0392b' },
  alpine_hiking: { label: 'T4 Alpinwandern', color: '#3498db' },
  demanding_alpine_hiking: { label: 'T5 anspr. Alpinwandern', color: '#1f5fa8' },
  difficult_alpine_hiking: { label: 'T6 schw. Alpinwandern', color: '#0b2e59' }
};

export const START_VIEW = {
  // Oberstdorf – Nebelhorn – Höfats: dichtes, gut gepflegtes OSM-Bergwegenetz.
  center: [10.33, 47.405],
  zoom: 12.6,
  pitch: 62,
  bearing: 160
};

// Schwellwerte der Quellen-Kreuzvalidierung.
export const VALIDATION = {
  // Gipfel-Check: OSM-ele gegen DEM-Maximum im Umkreis peakRadiusM.
  // Kalibriert an Allgäuer Gipfeln (README): korrekt verortet Δ ≈ 8–20 m, spitze Gipfel bis ~80 m
  // (Raster kappt die Spitze → OSM höher). OSM tiefer als DEM ist physikalisch kaum erklärbar.
  peakRadiusM: 45,
  peakDeltaOkM: 25,      // |Δ| darunter: konsistent
  peakSmoothMaxM: 80,    // 0 < Δ ≤ dies: durch Rasterglättung erklärbar
  peakBelowWarnM: 40,    // Δ < −dies: OSM deutlich tiefer als Gelände → Fehler wahrscheinlich
  ascentHysteresisM: 5,  // Rauschfilter für Auf-/Abstieg aus dem DEM
  sampleSpacingM: 20,    // Abtastabstand für Höhenprofile
  demZoom: 13            // Zoomstufe, aus der Höhen gelesen werden (~13 m/px im Allgäu)
};
