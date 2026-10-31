// Live-Prüfung der veröffentlichten App wie auf einem iPhone (Playwright, gedrosselt auf mobiles Netz/CPU).
// Misst Ladezeiten und Anfragen, wartet auf das automatische Eintragen der Touren und schreibt Bericht + Screenshots.
// Aufruf: node tools/live-check.cjs <URL> <Ausgabeordner>
const { chromium, devices } = require('playwright');
const fs = require('fs');

const [url = 'https://thomasschnell-maker.github.io/tourenatlas/', out = 'live-check'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { url, started: new Date().toISOString(), runs: [], toasts: [], console: [], errors: [] };
const save = () => fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));

// Nur lesen: die Datenbank nie selbst anlegen (sonst fehlen der App später ihre Tabellen)
async function dumpTours(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'tourenatlas')) return [];
    return new Promise((res) => {
      const req = indexedDB.open('tourenatlas');
      req.onerror = () => res([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tours')) return db.close(), res([]);
        const g = db.transaction('tours').objectStore('tours').getAll();
        g.onsuccess = () => {
          db.close();
          res(
            g.result.map((t) => ({
              name: t.name,
              templateId: t.templateId,
              templateVersion: t.templateVersion,
              stations: t.stations.map((s) => `${s.name} [${s.lngLat.map((v) => v.toFixed(4)).join(',')}]`),
              segments: (t.segments || []).map((s) => (s ? (s.error ? `FEHLER: ${s.error}` : s.coords ? `${s.coords.length} Pkt` : 'Luftlinie') : 'fehlt')),
              summary: t.summary
            }))
          );
        };
      };
    });
  });
}

const toastText = (page) => page.evaluate(() => {
  const t = document.getElementById('toast');
  return t && !t.hidden ? t.innerText : '';
});

async function main() {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(90000);
    const cdp = await ctx.newCDPSession(page);
    // Typisches LTE unterwegs: 9 Mbit/s, 70 ms; iPhone-CPU grob 2× langsamer als der Runner
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 70, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });

    let reqs = [];
    page.on('console', (m) => m.type() !== 'warning' && report.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => report.errors.push(e.message));
    const owner = new WeakMap(); // Anfrage → Liste des Besuchs, in dem sie gestartet wurde
    page.on('request', (r) => owner.set(r, reqs));
    page.on('requestfinished', async (r) => {
      const list = owner.get(r) || reqs;
      const resp = await r.response().catch(() => null);
      const size = await r.sizes().then((s) => s.responseBodySize).catch(() => 0);
      list.push({ url: r.url(), ms: Math.round(r.timing().responseEnd), size, sw: !!resp?.fromServiceWorker() });
    });
    page.on('requestfailed', (r) => (owner.get(r) || reqs).push({ url: r.url(), failed: r.failure()?.errorText }));

    const expected = await (await fetch(new URL('data/touren.json', url))).json().then((l) => l.length).catch(() => 0);
    report.expectedTemplates = expected;

    for (const visit of ['erster Besuch', 'zweiter Besuch']) {
      reqs = [];
      const t0 = Date.now();
      if (visit === 'erster Besuch') await page.goto(url, { waitUntil: 'domcontentloaded' });
      else await page.reload({ waitUntil: 'domcontentloaded' });
      const dcl = Date.now() - t0;
      await page.waitForSelector('#map canvas', { timeout: 60000 }).catch(() => {});
      const canvas = Date.now() - t0;
      for (const s of [3, 8, 15]) {
        await sleep(Math.max(0, s * 1000 - (Date.now() - t0)));
        await page.screenshot({ path: `${out}/${visit.replace(' ', '-')}-${s}s.png` });
        report.toasts.push(`${visit} ${s}s: ${await toastText(page)}`);
      }
      // Auf das Eintragen der Touren warten (max. 3 min)
      let tours = [];
      for (let i = 0; i < 36; i++) {
        tours = await dumpTours(page).catch(() => []);
        const tpl = tours.filter((t) => t.templateId);
        report.toasts.push(`${visit} ${Math.round((Date.now() - t0) / 1000)}s: ${await toastText(page)}`);
        if (tpl.length >= expected && tpl.every((t) => t.segments.length === t.stations.length - 1 && !t.segments.includes('fehlt'))) break;
        await sleep(5000);
      }
      const byHost = {};
      for (const r of reqs) {
        const h = new URL(r.url).host;
        byHost[h] ||= { n: 0, kb: 0, failed: 0, ausSW: 0 };
        byHost[h].n++;
        byHost[h].kb += Math.round(Math.max(0, r.size || 0) / 1024);
        if (r.failed) byHost[h].failed++;
        if (r.sw) byHost[h].ausSW++;
      }
      report.runs.push({
        visit,
        ms: { domcontentloaded: dcl, mapCanvas: canvas, toursDone: Date.now() - t0 },
        requests: reqs.length,
        byHost,
        slowest: reqs.filter((r) => r.ms).sort((a, b) => b.ms - a.ms).slice(0, 12).map((r) => `${r.ms} ms ${r.url.slice(0, 140)}`),
        failed: reqs.filter((r) => r.failed).slice(0, 20),
        tours
      });
      save();
    }

    // Regionsdaten erreichbar?
    report.regionIndex = await page
      .evaluate(async () => {
        const r = await fetch('data/cells/index.json', { cache: 'no-store' });
        if (!r.ok) return `HTTP ${r.status}`;
        const j = await r.json();
        const k = j.cells[Math.floor(j.cells.length / 2)];
        const c = k ? await fetch(`data/cells/${j.gen}/${k.replace(':', '_')}.json`, { cache: 'no-store' }) : null;
        return { gen: j.gen, cells: j.cells.length, holes: j.holes?.length, osmBase: j.osmBase, osmLatest: j.osmLatest, sample: c?.status };
      })
      .catch((e) => String(e));
    save();

    // Touren-Ansicht und jede Tour einzeln (Blatt eingeklappt, damit die Strecke sichtbar ist)
    await page.click('#tabbar button[data-tab="tours"]').catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: `${out}/touren-liste.png` });
    const n = await page.locator('.tour-list button').count();
    for (let i = 0; i < n; i++) {
      try {
        await page.locator('.tour-list button').nth(i).click({ timeout: 10000 });
        await sleep(5000);
        await page.evaluate(() => document.getElementById('sheet').classList.add('peek'));
        await sleep(2500);
        await page.screenshot({ path: `${out}/tour-${i + 1}.png` });
        await page.evaluate(() => document.getElementById('sheet').classList.remove('peek'));
        await page.click('[data-t="back"]', { timeout: 10000 });
        await sleep(1000);
      } catch (e) {
        report.errors.push(`Tour ${i + 1}: ${e.message.split('\n')[0]}`);
      }
    }
  } catch (e) {
    report.errors.push(`Abbruch: ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
  } finally {
    save();
    console.log(JSON.stringify(report, null, 1));
    await browser.close();
  }
}

main();
