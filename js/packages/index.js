// Registrierte Pakete. Ein neues Paket = Datei anlegen + hier eintragen.
// Jedes Paket bekommt einen eigenen Tab und ein eigenes Blatt im Menü.
// Einzeln und fehlertolerant geladen: Liefert der Server eine Datei kurz nicht aus (GitHub Pages
// antwortete im Live-Check einmal mit 503), fehlt nur dieses Paket statt der ganzen App.
const NAMES = ['tours', 'poster', 'weather'];

async function load(name) {
  for (let i = 0; i < 3; i++) {
    try {
      // Eine fehlgeschlagene Modul-URL merkt sich der Browser – Wiederholung darum mit eigener URL
      return (await import(`./${name}.js${i ? `?retry=${i}` : ''}`)).default;
    } catch (err) {
      console.warn(`Paket ${name}: Versuch ${i + 1} fehlgeschlagen`, err);
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return null;
}

export const PACKAGES = (await Promise.all(NAMES.map(load))).filter(Boolean);
export const MISSING = NAMES.filter((n) => !PACKAGES.some((p) => p.id === n));
