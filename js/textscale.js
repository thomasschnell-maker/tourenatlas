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
