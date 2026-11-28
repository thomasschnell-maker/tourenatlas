// Minimaler EXIF-Leser für JPEG (ohne Abhängigkeiten): GPS-Position, Blickrichtung, Aufnahmezeit.
// Liest nur, was das Touren-Paket braucht; unbekannte oder kaputte Daten ergeben null statt Fehler.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIfd(view, tiff, offset, little) {
  const out = {};
  if (offset + 2 > view.byteLength) return out;
  const n = view.getUint16(offset, little);
  for (let i = 0; i < n; i++) {
    const e = offset + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    const tag = view.getUint16(e, little);
    const type = view.getUint16(e + 2, little);
    const count = view.getUint32(e + 4, little);
    const size = (TYPE_SIZE[type] || 1) * count;
    const at = size > 4 ? tiff + view.getUint32(e + 8, little) : e + 8;
    if (at + size > view.byteLength) continue;
    out[tag] = readValue(view, at, type, count, little);
  }
  return out;
}

function readValue(view, at, type, count, little) {
  const vals = [];
  for (let i = 0; i < count; i++) {
    if (type === 2) {
      const c = view.getUint8(at + i);
      if (c === 0) break;
      vals.push(String.fromCharCode(c));
    } else if (type === 3) vals.push(view.getUint16(at + i * 2, little));
    else if (type === 4) vals.push(view.getUint32(at + i * 4, little));
    else if (type === 9) vals.push(view.getInt32(at + i * 4, little));
    else if (type === 5 || type === 10) {
      const num = type === 5 ? view.getUint32(at + i * 8, little) : view.getInt32(at + i * 8, little);
      const den = type === 5 ? view.getUint32(at + i * 8 + 4, little) : view.getInt32(at + i * 8 + 4, little);
      vals.push(den ? num / den : null);
    } else vals.push(view.getUint8(at + i));
  }
  return type === 2 ? vals.join('') : count === 1 ? vals[0] : vals;
}

const dms = (v) => (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x)) ? v[0] + v[1] / 60 + v[2] / 3600 : null);

/** ArrayBuffer eines JPEG → { lngLat: [lon, lat] | null, direction: Grad | null, takenAt: 'YYYY-MM-DDTHH:MM:SS' | null } */
export function readExif(buffer) {
  const none = { lngLat: null, direction: null, takenAt: null };
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return none;
    let off = 2;
    while (off + 4 <= view.byteLength) {
      const marker = view.getUint16(off);
      const len = view.getUint16(off + 2);
      if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) {
        // "Exif\0\0" → TIFF-Header
        const tiff = off + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd0 = readIfd(view, tiff, tiff + view.getUint32(tiff + 4, little), little);
        const exif = ifd0[0x8769] != null ? readIfd(view, tiff, tiff + ifd0[0x8769], little) : {};
        const gps = ifd0[0x8825] != null ? readIfd(view, tiff, tiff + ifd0[0x8825], little) : {};
        let lat = dms(gps[2]);
        let lon = dms(gps[4]);
        if (lat != null && gps[1] === 'S') lat = -lat;
        if (lon != null && gps[3] === 'W') lon = -lon;
        const valid = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
        const dir = Number.isFinite(gps[0x11]) ? ((gps[0x11] % 360) + 360) % 360 : null;
        const dt = typeof exif[0x9003] === 'string' ? exif[0x9003].trim() : null;
        const m = dt && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(dt);
        return { lngLat: valid ? [lon, lat] : null, direction: dir, takenAt: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null };
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // Bilddaten beginnen
      off += 2 + len;
    }
  } catch {
    // kaputte EXIF-Daten: wie "keine Angaben" behandeln
  }
  return none;
}
