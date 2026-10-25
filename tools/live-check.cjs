// Live-Prüfung der veröffentlichten App wie auf einem iPhone (Playwright, gedrosselt auf mobiles Netz/CPU).
// Misst Ladezeiten und Anfragen, wartet auf das automatische Eintragen der Touren und schreibt Bericht + Screenshots.
// Aufruf: node tools/live-check.cjs <URL> <Ausgabeordner>
const { chromium, devices } = require('playwright');
const fs = require('fs');

const [url = 'https://thomasschnell-maker.github.io/tourenatlas/', out = 'live-check'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url, started: new Date().toISOString(), runs: [] };

async function dumpTours(page) {
  return page.evaluate(
    () =>
      new Promise((res) => {
        const req = indexedDB.open('tourenatlas');
        req.onerror = () => res({ error: 'kein IndexedDB' });
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('tours')) return res([]);
          const g = db.transaction('tours').objectStore('tours').getAll();
          g.onsuccess = () =>
            res(
              g.result.map((t) => ({
                name: t.name,
                templateId: t.templateId,
                templateVersion: t.templateVersion,
                activity: t.activity,
                mode: t.mode,
                stations: t.stations.map((s) => `${s.name} [${s.lngLat.map((v) => v.toFixed(4)).join(',')}]`),
                segments: (t.segments || []).map((s) => (s ? (s.error ? `FEHLER: ${s.error}` : s.coords ? `${s.coords.length} Pkt` : 'Luftlinie') : 'fehlt')),
                summary: t.summary
              }))
            );
        };
      })
  );
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  // Typisches LTE unterwegs: 9 Mbit/s, 70 ms; iPhone-CPU grob 2× langsamer als der Runner
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 70, downloadThroughput: (9e6 / 8), uploadThroughput: (3e6 / 8) });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });

  const reqs = [];
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('requestfinished', async (r) => {
    const t = r.timing();
    let size = 0;
    try { size = (await r.sizes()).responseBodySize; } catch {}
    reqs.push({ url: r.url(), ms: Math.round(t.responseEnd), size, from: r.frame() ? 'page' : 'sw' });
  });
  page.on('requestfailed', (r) => reqs.push({ url: r.url(), failed: r.failure()?.errorText }));
  const toasts = [];

  for (const visit of ['erster Besuch', 'zweiter Besuch']) {
    reqs.length = 0;
    const t0 = Date.now();
    if (visit === 'erster Besuch') await page.goto(url, { waitUntil: 'domcontentloaded' });
    else await page.reload({ waitUntil: 'domcontentloaded' });
    const dcl = Date.now() - t0;
    await page.waitForSelector('#map canvas', { timeout: 60000 }).catch(() => {});
    const canvas = Date.now() - t0;
    const shots = [];
    for (const s of [3, 8, 15]) {
      await sleep(Math.max(0, s * 1000 - (Date.now() - t0)));
      const p = `${out}/${visit.replace(' ', '-')}-${s}s.png`;
      await page.screenshot({ path: p });
      shots.push(p);
      toasts.push(`${visit} ${s}s: ${await page.locator('#toast').innerText().catch(() => '')}`);
    }
    // Auf das Eintragen der Touren warten (max. 3 min)
    let tours = [];
    for (let i = 0; i < 36; i++) {
      tours = await dumpTours(page).catch(() => []);
      const tpl = Array.isArray(tours) ? tours.filter((t) => t.templateId) : [];
      toasts.push(`${visit} ${Math.round((Date.now() - t0) / 1000)}s: ${await page.locator('#toast').innerText().catch(() => '')}`);
      if (tpl.length >= 3 && tpl.every((t) => t.segments.length === t.stations.length - 1 && !t.segments.includes('fehlt'))) break;
      await sleep(5000);
    }
    const toursDone = Date.now() - t0;
    const byHost = {};
    for (const r of reqs) {
      const h = new URL(r.url).host;
      byHost[h] = byHost[h] || { n: 0, kb: 0, failed: 0 };
      byHost[h].n++;
      byHost[h].kb += Math.round((r.size || 0) / 1024);
      if (r.failed) byHost[h].failed++;
    }
    report.runs.push({
      visit,
      ms: { domcontentloaded: dcl, mapCanvas: canvas, toursDone },
      requests: reqs.length,
      byHost,
      slowest: reqs.filter((r) => r.ms).sort((a, b) => b.ms - a.ms).slice(0, 15).map((r) => `${r.ms} ms ${Math.round((r.size || 0) / 1024)} kB ${r.url.slice(0, 140)}`),
      failed: reqs.filter((r) => r.failed).slice(0, 20),
      tours
    });
  }
  // Touren-Ansicht und jede Vorlage einzeln
  await page.click('#tabbar button[data-tab="tours"]').catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: `${out}/touren-liste.png` });
  const n = await page.locator('.tour-list button').count();
  for (let i = 0; i < n; i++) {
    await page.locator('.tour-list button').nth(i).click();
    await sleep(6000);
    await page.screenshot({ path: `${out}/tour-${i + 1}.png` });
    await page.click('[data-t="back"]').catch(() => {});
    await sleep(1000);
  }
  report.toasts = toasts;
  report.console = logs.slice(0, 80);
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})();
