// Plakat-Paket: reine Logik (ohne DOM, in Node testbar).

export const PAPER = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189]
};

// Kartenschrift auf Papier: 1 CSS-Pixel der Karte = 0,25 mm → 13-px-Beschriftung ≈ 3,3 mm (≈ 9 pt).
export const MM_PER_CSS_PX = 0.25;

// Ränder in Anteilen der kurzen Papierkante: oben Titel, unten Legende/Massstab/Quellen.
export const LAYOUT = { side: 0.04, top: 0.1, bottom: 0.13 };

/**
 * Plant das Plakat: Papier in px bei der höchsten dpi, die Pixelobergrenze (iOS ~16,7 MP für Canvas)
 * und maximale WebGL-Grösse zulassen – höchstens targetDpi.
 */
export function planPoster(paper, landscape, { targetDpi = 300, maxPixels = 16e6, maxGlDim = 4096 } = {}) {
  let [wMm, hMm] = PAPER[paper];
  if (landscape) [wMm, hMm] = [hMm, wMm];
  const short = Math.min(wMm, hMm);
  const mapMm = {
    x: LAYOUT.side * short,
    y: LAYOUT.top * short,
    w: wMm - 2 * LAYOUT.side * short,
    h: hMm - (LAYOUT.top + LAYOUT.bottom) * short
  };
  const inch = 25.4;
  const dpiByPixels = Math.sqrt(maxPixels / ((wMm / inch) * (hMm / inch)));
  const dpiByGl = maxGlDim / (Math.max(mapMm.w, mapMm.h) / inch);
  const dpi = Math.floor(Math.min(targetDpi, dpiByPixels, dpiByGl));
  const px = (mm) => Math.round((mm / inch) * dpi);
  const mapCss = { w: Math.round(mapMm.w / MM_PER_CSS_PX), h: Math.round(mapMm.h / MM_PER_CSS_PX) };
  return {
    paper,
    landscape,
    mm: { w: wMm, h: hMm },
    mapMm,
    dpi,
    px: { w: px(wMm), h: px(hMm) },
    mapPx: { x: px(mapMm.x), y: px(mapMm.y), w: px(mapMm.w), h: px(mapMm.h) },
    mapCss,
    pixelRatio: px(mapMm.w) / mapCss.w,
    aspect: mapMm.w / mapMm.h,
    quality: dpi >= 200 ? 'sehr gut' : dpi >= 120 ? 'gut für Plakate (Betrachtung ab ~1 m)' : dpi >= 80 ? 'grob – eher kleineres Format wählen' : 'zu grob'
  };
}

/** Zoom für das Plakat: gleiche Fläche wie im Bildschirmrahmen, aber mehr CSS-Pixel. */
export function posterZoom(screenZoom, frameCssWidth, mapCssWidth) {
  return screenZoom + Math.log2(mapCssWidth / frameCssWidth);
}

/** Meter pro CSS-Pixel (MapLibre: 512-px-Kacheln, Web Mercator). */
export function metersPerCssPx(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Massstabszahl 1:N auf dem Papier (nur gültig für Draufsicht). */
export function scaleDenominator(lat, zoom) {
  return metersPerCssPx(lat, zoom) / (MM_PER_CSS_PX / 1000);
}

/** Runde Massstabsangabe für die Beschriftung, z. B. 24 731 → 25 000. */
export function roundScale(n) {
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.round(steps.reduce((best, s) => (Math.abs(s * mag - n) < Math.abs(best * mag - n) ? s : best), 1) * mag);
}

/** Massstabsbalken: "schöne" Länge in Metern, die höchstens maxMm auf dem Papier einnimmt. */
export function scaleBar(denominator, maxMm) {
  const maxM = (maxMm / 1000) * denominator;
  const mag = 10 ** Math.floor(Math.log10(maxM));
  const nice = [5, 2, 1].map((s) => s * mag).find((v) => v <= maxM) ?? mag;
  return { meters: nice, mm: (nice / denominator) * 1000, label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
}
