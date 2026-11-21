/* global maplibregl */
// Plakat-Paket: Ausschnitt im Papierformat wählen, in Druckauflösung neu rendern, mit Titel,
// Legende, Massstab, Nordpfeil und Pflicht-Quellenangaben als JPEG speichern.

import { SAC_SCALE } from '../config.js';
import { PAPER, metersPerCssPx, planPoster, posterZoom, roundScale, scaleBar, scaleDenominator } from './poster-core.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7.5 15 3-4 2.5 3 1.5-2 2 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

let ctx = null;
let frame = null;
let active = false;
let busy = false;
let maxGl = null;

const settings = { paper: 'A2', landscape: false, title: 'Allgäu', subtitle: '' };

/** Grösste Kantenlänge, die WebGL auf diesem Gerät rendern kann. */
function glLimit() {
  if (maxGl) return maxGl;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    // Obergrenze 8192: grössere Puffer scheitern in der Praxis oft am Grafikspeicher.
    maxGl = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), vp[0], vp[1]);
  } catch {
    maxGl = 4096;
  }
  return maxGl;
}

// iOS begrenzt Canvas-Flächen auf ~16,7 MP; Desktop-Browser vertragen mehr.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MAX_PIXELS = isIOS ? 16e6 : 48e6;

const plan = () => planPoster(settings.paper, settings.landscape, { maxPixels: MAX_PIXELS, maxGlDim: glLimit() });

// ---------- Rahmen auf der Karte ----------
function placeFrame() {
  if (!frame) return;
  frame.hidden = !active;
  if (!active) return;
  const mapEl = ctx.map.getContainer();
  const sheet = document.getElementById('sheet');
  const tab = document.getElementById('tabbar');
  const top = 70;
  const wide = window.innerWidth >= 900;
  const bottomEdge = !sheet.hidden && !wide ? sheet.getBoundingClientRect().top : tab.getBoundingClientRect().top;
  const left = wide && !sheet.hidden ? sheet.getBoundingClientRect().right + 16 : 12;
  const right = 60;
  const availW = mapEl.clientWidth - left - right;
  const availH = Math.max(80, bottomEdge - top - 12);
  const a = plan().aspect;
  let w = availW;
  let h = w / a;
  if (h > availH) {
    h = availH;
    w = h * a;
  }
  Object.assign(frame.style, { width: `${w}px`, height: `${h}px`, left: `${left + (availW - w) / 2}px`, top: `${top + (availH - h) / 2}px` });
}

// ---------- Rendern ----------
function waitIdle(map, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    map.once('idle', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function attributionText(style) {
  const parts = new Set();
  for (const src of Object.values(style.sources || {})) if (src.attribution) parts.add(stripHtml(src.attribution));
  return [...parts].join(' · ');
}

async function renderPoster() {
  if (busy) return;
  busy = true;
  const p = plan();
  const map = ctx.map;
  const status = ctx.pane.querySelector('[data-p="status"]');
  status.textContent = `Rendere ${p.paper} mit ${p.dpi} dpi (${p.px.w} × ${p.px.h} px) …`;
  ctx.toast('Plakat wird berechnet – das kann bis zu einer Minute dauern', { busy: true, ttl: 0 });

  // Kamera: Mitte des Rahmens, gleiche Fläche wie im Rahmen.
  const fr = frame.getBoundingClientRect();
  const mr = map.getContainer().getBoundingClientRect();
  const center = map.unproject([fr.left - mr.left + fr.width / 2, fr.top - mr.top + fr.height / 2]);
  const zoom = posterZoom(map.getZoom(), fr.width, p.mapCss.w);
  const pitch = map.getPitch();
  const bearing = map.getBearing();
  const style = map.getStyle();

  const holder = document.createElement('div');
  Object.assign(holder.style, { position: 'fixed', left: '-100000px', top: '0', width: `${p.mapCss.w}px`, height: `${p.mapCss.h}px` });
  document.body.appendChild(holder);
  let off = null;
  try {
    off = new maplibregl.Map({
      container: holder,
      style,
      center,
      zoom,
      pitch,
      bearing,
      maxPitch: 85,
      pixelRatio: p.pixelRatio,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      // MapLibre kappt sonst bei 4096 px und senkt still die Auflösung.
      maxCanvasSize: [glLimit(), glLimit()],
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true }
    });
    const complete = await waitIdle(off, 90000);
    const glCanvas = off.getCanvas();
    // Liefert das Gerät weniger Pixel als geplant, trotzdem erzeugen – aber die echte Auflösung nennen.
    const effDpi = Math.round(p.dpi * Math.min(1, glCanvas.width / p.mapPx.w));

    const c = document.createElement('canvas');
    c.width = p.px.w;
    c.height = p.px.h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(glCanvas, p.mapPx.x, p.mapPx.y, p.mapPx.w, p.mapPx.h);
    drawFrame(g, p, { lat: center.lat, zoom, pitch, bearing, attribution: attributionText(style), effDpi });

    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Bild konnte nicht erzeugt werden (Speichergrenze des Geräts)');
    const name = `plakat-${settings.paper}-${(settings.title || 'allgaeu').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}.jpg`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    const mb = (blob.size / 1e6).toFixed(1);
    const dpiNote = effDpi < p.dpi * 0.98 ? ` – Karte effektiv nur ${effDpi} dpi (Grafikgrenze des Geräts)` : '';
    status.innerHTML = `Fertig: ${ctx.esc(name)} (${mb} MB, ${p.dpi} dpi)${ctx.esc(dpiNote)}${complete ? '' : ' – <b>Achtung:</b> nicht alle Kacheln geladen, Plakat prüfen'}`;
    ctx.toast(complete ? 'Plakat gespeichert' : 'Plakat gespeichert – einige Kacheln fehlten', { error: !complete, ttl: 6000 });
  } catch (err) {
    status.textContent = `Fehler: ${err.message}`;
    ctx.toast(`Plakat fehlgeschlagen: ${err.message}`, { error: true, ttl: 8000 });
  } finally {
    off?.remove();
    holder.remove();
    busy = false;
  }
}

/** Titel, Legende, Massstab, Nordpfeil und Quellen in die Ränder zeichnen. */
function drawFrame(g, p, { lat, zoom, pitch, bearing, attribution, effDpi }) {
  const u = p.dpi / 25.4; // Pixel pro mm
  const short = Math.min(p.mm.w, p.mm.h);
  const x0 = p.mapPx.x;
  const W = p.mapPx.w;
  const font = (mm, weight = 400) => `${weight} ${Math.round(mm * u)}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  g.strokeStyle = '#1d2329';
  g.lineWidth = Math.max(1, 0.35 * u);
  g.strokeRect(p.mapPx.x, p.mapPx.y, p.mapPx.w, p.mapPx.h);

  // Titel
  g.fillStyle = '#1d2329';
  g.textBaseline = 'alphabetic';
  g.font = font(short * 0.04, 700);
  g.fillText(settings.title || 'Allgäu', x0, p.mapPx.y - short * 0.035 * u);
  if (settings.subtitle) {
    g.font = font(short * 0.017);
    g.fillStyle = '#5b6670';
    g.fillText(settings.subtitle, x0, p.mapPx.y - short * 0.012 * u);
  }

  // Unterer Rand
  const yTop = p.mapPx.y + p.mapPx.h + short * 0.02 * u;
  const fs = short * 0.0125;
  g.font = font(fs);
  g.fillStyle = '#1d2329';

  // Legende
  const items = [['Tour', '#d6007e', 1.2], ...Object.values(SAC_SCALE).map((s) => [s.label, s.color, 0.6])];
  const colW = W * 0.18;
  items.forEach(([label, color, thick], i) => {
    const cx = x0 + Math.floor(i / 4) * colW;
    const cy = yTop + (i % 4) * fs * 1.7 * u;
    g.fillStyle = color;
    g.fillRect(cx, cy - fs * 0.45 * u, fs * 2.2 * u, thick * u);
    g.fillStyle = '#1d2329';
    g.fillText(label, cx + fs * 2.8 * u, cy);
  });

  // Massstab (nur Draufsicht) und Nordpfeil
  const sx = x0 + W * 0.6;
  if (pitch < 1) {
    const n = scaleDenominator(lat, zoom);
    const bar = scaleBar(n, W / u * 0.2);
    const bw = bar.mm * u;
    g.fillRect(sx, yTop, bw, 0.8 * u);
    g.fillRect(sx, yTop - 1.5 * u, 0.5 * u, 2.3 * u);
    g.fillRect(sx + bw - 0.5 * u, yTop - 1.5 * u, 0.5 * u, 2.3 * u);
    g.fillText(bar.label, sx + bw + 2 * u, yTop + 0.8 * u);
    g.fillText(`Massstab ca. 1 : ${roundScale(n).toLocaleString('de-DE')} (in Bildmitte)`, sx, yTop + fs * 2 * u);
  } else {
    g.fillText('3D-Ansicht – kein einheitlicher Massstab', sx, yTop);
    g.fillText(`Bodenauflösung Bildmitte ca. ${metersPerCssPx(lat, zoom).toFixed(1)} m je Kartenpunkt`, sx, yTop + fs * 1.7 * u);
  }
  const ax = x0 + W - short * 0.02 * u;
  const ay = yTop + short * 0.015 * u;
  const r = short * 0.012 * u;
  g.save();
  g.translate(ax, ay);
  g.rotate((-bearing * Math.PI) / 180);
  g.beginPath();
  g.moveTo(0, -r);
  g.lineTo(r * 0.55, r);
  g.lineTo(0, r * 0.55);
  g.lineTo(-r * 0.55, r);
  g.closePath();
  g.fill();
  g.font = font(fs, 700);
  g.textAlign = 'center';
  g.fillText('N', 0, -r * 1.25);
  g.restore();
  g.textAlign = 'left';

  // Quellen (Pflicht) + Erstellungsdatum
  g.font = font(fs * 0.75);
  g.fillStyle = '#5b6670';
  const yBottom = p.px.h - short * 0.012 * u;
  const meta = `Erstellt ${new Date().toLocaleDateString('de-DE')} mit Allgäu Tourenatlas 3D · ${p.paper} · Karte ${effDpi} dpi`;
  g.fillText(meta, x0, yBottom - fs * 1.1 * u);
  g.fillText(fitText(g, attribution, W), x0, yBottom);
}

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 10 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -4);
  return `${t}…`;
}

// ---------- Ansicht ----------
function render() {
  const p = plan();
  const { esc } = ctx;
  ctx.pane.innerHTML = `
    <div class="cards cards-5">${Object.keys(PAPER)
      .map((k) => `<label class="card mini"><input type="radio" name="paper" value="${k}" ${k === settings.paper ? 'checked' : ''}><b>${k}</b><small>${PAPER[k][0]}×${PAPER[k][1]}</small></label>`)
      .join('')}</div>
    <div class="seg" role="radiogroup" aria-label="Ausrichtung">
      <label><input type="radio" name="orient" value="portrait" ${settings.landscape ? '' : 'checked'}><span>Hochformat</span></label>
      <label><input type="radio" name="orient" value="landscape" ${settings.landscape ? 'checked' : ''}><span>Querformat</span></label>
    </div>
    <div class="row"><input data-p="title" value="${esc(settings.title)}" placeholder="Titel" aria-label="Titel"></div>
    <div class="row"><input data-p="subtitle" value="${esc(settings.subtitle)}" placeholder="Untertitel, z. B. Touren 2026" aria-label="Untertitel"></div>
    <dl class="stats"><dt>Auflösung</dt><dd>${p.dpi} dpi – ${esc(p.quality)}</dd><dt>Bild</dt><dd>${p.px.w} × ${p.px.h} px</dd></dl>
    <p class="muted">Ausschnitt und 3D-Blick im Rahmen einstellen; Touren und Stationen werden mitgedruckt. Massstab nur in der Draufsicht (3D aus).</p>
    <button type="button" class="btn primary wide" data-p="go">Plakat erstellen</button>
    <p class="muted" data-p="status"></p>`;
  placeFrame();
}

export default {
  id: 'poster',
  title: 'Plakat',
  icon: ICON,

  mount(c) {
    ctx = c;
    frame = document.createElement('div');
    frame.id = 'poster-frame';
    frame.hidden = true;
    c.map.getContainer().appendChild(frame);
    c.pane.addEventListener('change', (e) => {
      const el = e.target;
      if (el.name === 'paper') settings.paper = el.value;
      if (el.name === 'orient') settings.landscape = el.value === 'landscape';
      if (el.dataset.p === 'title') settings.title = el.value.trim();
      if (el.dataset.p === 'subtitle') settings.subtitle = el.value.trim();
      if (el.name === 'paper' || el.name === 'orient') render();
    });
    c.pane.addEventListener('click', (e) => {
      if (e.target.closest('[data-p="go"]')) renderPoster();
    });
    new ResizeObserver(placeFrame).observe(document.getElementById('sheet'));
    window.addEventListener('resize', placeFrame);
    render();
  },

  onActivate() {
    active = true;
    render();
  },

  onDeactivate() {
    active = false;
    placeFrame();
  }
};
