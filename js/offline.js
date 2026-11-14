/* global pmtiles, maplibregl */
// Protomaps/PMTiles: Grundkarte aus einer einzigen Datei – lokal (offline) oder per URL.
// Vor dem Einbinden wird der Header geprüft (validate.js: checkPmtilesHeader).

import { checkPmtilesHeader } from './validate.js';

// Ladezeit: PMTiles + Protomaps-Stil (~75 kB) erst laden, wenn eine Offline-Datei geöffnet wird.
let protocol = null;
const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`${src} nicht ladbar`));
    document.head.appendChild(el);
  });

async function ensureLibs() {
  if (protocol) return;
  await Promise.all([loadScript('vendor/pmtiles/pmtiles.js'), loadScript('vendor/protomaps-basemaps/basemaps.js')]);
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
}

/** Registriert eine lokale Datei oder URL und liefert { url, findings, usable, info }. */
export async function openPmtiles(input) {
  await ensureLibs();
  const archive = typeof input === 'string' ? new pmtiles.PMTiles(input) : new pmtiles.PMTiles(new pmtiles.FileSource(input));
  const header = await archive.getHeader();
  const meta = await archive.getMetadata().catch(() => ({}));
  const vectorLayers = (meta?.vector_layers || []).map((l) => l.id);
  protocol.add(archive);
  const result = checkPmtilesHeader(header, vectorLayers);
  const built = meta?.['planetiler:osm:osmosisreplicationtime'] || meta?.description || null;
  return {
    ...result,
    url: `pmtiles://${archive.source.getKey()}`,
    info: `Zoom ${header.minZoom}–${header.maxZoom}${built ? ` · ${built}` : ''}`
  };
}
