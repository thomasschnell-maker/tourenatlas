// Lesbarkeit: Beschriftungen fremder Kartenstile (OpenFreeMap, Protomaps) gleichmässig vergrössern
// und den Schriftrand verstärken. Zoom-Ausdrücke müssen dabei oberste Ebene bleiben – darum werden
// bei interpolate/step die Ausgabewerte skaliert, nicht der ganze Ausdruck.

function scaleValue(v, f) {
  return typeof v === 'number' ? Math.round(v * f * 10) / 10 : ['*', v, f];
}

/** Skaliert einen text-size-Wert (Zahl, Legacy-stops oder Ausdruck) um den Faktor f. */
export function scaleTextSize(size, f) {
  if (size == null) return Math.round(16 * f * 10) / 10; // MapLibre-Standard 16 px
  if (typeof size === 'number') return scaleValue(size, f);
  if (Array.isArray(size)) {
    const [op] = size;
    if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') {
      // [op, interpolation, input, stop1, out1, stop2, out2, …]
      return size.map((x, i) => (i >= 3 && (i - 3) % 2 === 1 ? scaleValue(x, f) : x));
    }
    if (op === 'step') {
      // ['step', input, out0, stop1, out1, …]
      return size.map((x, i) => (i === 2 || (i > 2 && (i - 2) % 2 === 0) ? scaleValue(x, f) : x));
    }
    return ['*', size, f];
  }
  if (typeof size === 'object' && Array.isArray(size.stops)) {
    return { ...size, stops: size.stops.map(([z, v]) => [z, typeof v === 'number' ? Math.round(v * f * 10) / 10 : v]) };
  }
  return size;
}

/** Alle Symbol-Ebenen eines Stils lesbarer machen (verändert die Ebenen-Objekte). */
export function boostLabels(layers, f, minHalo = 1.5) {
  for (const l of layers) {
    if (l.type !== 'symbol' || !l.layout?.['text-field']) continue;
    l.layout = { ...l.layout, 'text-size': scaleTextSize(l.layout['text-size'], f) };
    const halo = l.paint?.['text-halo-width'];
    if (halo == null || (typeof halo === 'number' && halo < minHalo)) l.paint = { ...l.paint, 'text-halo-width': minHalo };
  }
  return layers;
}

// Ortsnamen der OpenFreeMap-Grundkarte: Original bleibt ab Zoom 11 klein (Weiler nur 10 px).
// Eigene Stufen, die beim Hineinzoomen weiter wachsen – je [Zoom, px, …].
export const PLACE_SIZES = {
  label_city: [4, 11, 8, 14, 11, 18, 14, 22],
  label_city_capital: [4, 12, 8, 15, 11, 20, 14, 24],
  label_town: [6, 11, 9, 13, 11, 15, 14, 19, 16, 21],
  label_village: [9, 11, 12, 14, 14, 17, 16, 19],
  label_other: [8, 9.5, 12, 12, 14, 15, 16, 17],
  water_name_point_label: [0, 10, 8, 13, 12, 15, 15, 18]
};

/** Setzt für bekannte Orts-Ebenen eine mit dem Zoom wachsende Schriftgrösse (verändert die Ebenen). */
export function growPlaceLabels(layers) {
  for (const l of layers) {
    const stops = PLACE_SIZES[l.id];
    if (l.type === 'symbol' && stops && l.layout) l.layout = { ...l.layout, 'text-size': ['interpolate', ['linear'], ['zoom'], ...stops] };
  }
  return layers;
}
