/* global pmtiles, maplibregl */
// Protomaps/PMTiles: Grundkarte aus einer einzigen Datei – lokal (offline) oder per URL.
// Vor dem Einbinden wird der Header geprüft (validate.js: checkPmtilesHeader).

import { checkPmtilesHeader } from './validate.js';

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

/** Registriert eine lokale Datei oder URL und liefert { url, findings, usable, info }. */
export async function openPmtiles(input) {
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
