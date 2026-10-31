// Service Worker: App offline nutzbar machen.
// - App-Dateien: Netz zuerst (immer aktuell), aber nach 1,5 s die gespeicherte Fassung; vendor/: Cache zuerst.
// - Karten-/Höhen-/Bildkacheln, Schriften: Cache zuerst (ändern sich praktisch nicht), Grössenlimit.
// - Overpass-Antworten (Bergwege, Radrouten): Netz zuerst, offline die zuletzt geladene Antwort.
// Ortssuche, Routing und Wetter werden bewusst nicht gecacht (veralten, Nutzungsregeln der Dienste).

const APP = 'ta-app-v3'; // bei neuer MapLibre-/PMTiles-Version erhöhen (vendor/ wird sonst nicht neu geladen)
const TILES = 'ta-tiles-v1';
const DATA = 'ta-data-v1';
const CELLS = 'ta-cells-v1'; // Regionsdaten je Generation (alte löscht die App)
const MAX_TILES = 6000;

// App-Schale – muss alle Dateien enthalten, die index.html lädt (Test prüft das).
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'vendor/maplibre-gl/maplibre-gl.js',
  'vendor/maplibre-gl/maplibre-gl.css',
  'vendor/pmtiles/pmtiles.js',
  'vendor/protomaps-basemaps/basemaps.js',
  'js/app.js',
  'js/cells.js',
  'js/config.js',
  'js/dem.js',
  'js/geo.js',
  'js/offline.js',
  'js/offline-area.js',
  'js/overpass.js',
  'js/region.js',
  'js/search.js',
  'js/styles.js',
  'js/textscale.js',
  'js/validate.js',
  'js/packages/index.js',
  'js/packages/exif.js',
  'js/packages/poster-core.js',
  'js/packages/poster.js',
  'js/packages/tours-core.js',
  'js/packages/tours-store.js',
  'js/packages/tours.js',
  'js/packages/weather-core.js',
  'js/packages/weather.js'
];

const TILE_HOSTS = [
  'tiles.openfreemap.org',
  's3.amazonaws.com',
  'tiles.maps.eox.at',
  'mapsneu.wien.gv.at',
  'geoservices.bayern.de',
  'protomaps.github.io'
];
const DATA_HOSTS = ['overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  const keep = [APP, TILES, DATA, CELLS];
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Netz zuerst – aber höchstens waitMs warten, wenn eine gespeicherte Fassung da ist. Langsames Netz
 * (Funkloch, Berg) blockiert so den Start nicht; die frische Antwort landet trotzdem im Cache.
 */
async function networkFirst(req, cacheName, waitMs = 0) {
  const cache = await caches.open(cacheName);
  // Server-Aussetzer (5xx) wie Netzfehler behandeln: gespeicherte Fassung nehmen, sonst einmal wiederholen
  const get = () => fetch(req).then((res) => {
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const net = get().catch(() => new Promise((r) => setTimeout(r, 800)).then(get));
  const hit = await cache.match(req, { ignoreSearch: cacheName === APP });
  if (!hit) return net;
  if (!waitMs) return net.catch(() => hit);
  const late = new Promise((r) => setTimeout(() => r(hit), waitMs));
  return Promise.race([net.catch(() => hit), late]);
}

// Bibliotheken unter vendor/ ändern sich nur mit neuer Version (dann neuer Cache-Name) → Cache zuerst.
async function vendorFirst(req) {
  const cache = await caches.open(APP);
  return (await cache.match(req)) || fetch(req).then((res) => (res.ok && cache.put(req, res.clone()), res));
}

let putsSinceTrim = 0;
async function cacheFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Nur erfolgreiche Antworten; opaque (no-cors) Antworten haben status 0 und werden nicht gespeichert.
  if (res.ok) {
    cache.put(req, res.clone());
    if (++putsSinceTrim >= 200) {
      putsSinceTrim = 0;
      trim(cache);
    }
  }
  return res;
}

/** Älteste Einträge entfernen, wenn das Limit überschritten ist (Cache-Reihenfolge = Einfügereihenfolge). */
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.includes('/data/cells/') && !url.pathname.endsWith('index.json')) {
    // Zellen-Dateien sind je Generation unveränderlich → Cache zuerst (schnell, offline).
    e.respondWith(caches.open(CELLS).then(async (c) => (await c.match(req)) || fetch(req).then((res) => (res.ok && c.put(req, res.clone()), res))));
  } else if (url.origin === self.location.origin && url.pathname.includes('/vendor/')) {
    e.respondWith(vendorFirst(req));
  } else if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, APP, 1500));
  } else if (TILE_HOSTS.includes(url.hostname)) {
    // Stil (/styles/…) und TileJSON (/planet) von OpenFreeMap haben keine Dateiendung und ändern sich → Netz zuerst.
    const isMeta = url.hostname === 'tiles.openfreemap.org' && !/\.\w+$/.test(url.pathname);
    e.respondWith(isMeta ? networkFirst(req, DATA, 2000) : cacheFirst(req));
  } else if (DATA_HOSTS.includes(url.hostname)) {
    e.respondWith(networkFirst(req, DATA));
  }
});
