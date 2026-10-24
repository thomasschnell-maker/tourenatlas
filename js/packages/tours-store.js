// Lokaler Speicher für Touren und Fotos (IndexedDB, nur auf diesem Gerät).
// Hinweis: Safari löscht Website-Daten nach 7 Tagen ohne Besuch – ausser die App liegt auf dem
// Home-Bildschirm. Deshalb: persist() anfragen und Backup-Export anbieten.

const DB = 'tourenatlas';
const VERSION = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tours')) db.createObjectStore('tours', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('tourId', 'tourId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Speichern abgebrochen (Speicher voll?)'));
  });
}

export const store = {
  allTours: () => tx('tours', 'readonly', (s) => s.getAll()),
  putTour: (tour) => tx('tours', 'readwrite', (s) => s.put({ ...tour, updated: new Date().toISOString() })),
  deleteTour: async (id) => {
    const photos = await store.photosOfTour(id);
    await tx('photos', 'readwrite', (s) => photos.forEach((p) => s.delete(p.id)));
    return tx('tours', 'readwrite', (s) => s.delete(id));
  },
  putPhoto: (photo) => tx('photos', 'readwrite', (s) => s.put(photo)),
  getPhoto: (id) => tx('photos', 'readonly', (s) => s.get(id)),
  deletePhoto: (id) => tx('photos', 'readwrite', (s) => s.delete(id)),
  photosOfTour: (tourId) => tx('photos', 'readonly', (s) => s.index('tourId').getAll(tourId))
};

/** Bittet den Browser, die Daten nicht automatisch zu löschen. Liefert true/false/null (unbekannt). */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

/** Foto verkleinern (lange Kante max), EXIF-Drehung übernehmen, als JPEG. */
export async function compressImage(file, maxEdge = 1600, quality = 0.85) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return { blob, w, h };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}
