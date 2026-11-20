const { launch, newPage, shot } = require('./lib');
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await launch(); const report = { sizes: {}, exports: {} };
  const page = await newPage(browser, { width: 1920, height: 1080 });
  const measure = async (n) => {
    const gen = await page.evaluate((n) => { const t0 = performance.now(); FT.generate(n, 7); const t1 = performance.now(); const l = FT.layout(); return { persons: FT.state().persons.length, nodes: l.nodes.size, edges: l.edges.length, genAndLayoutMs: Math.round(t1 - t0), layoutMs: Math.round(FT.layoutMs()), bbox: l.bbox }; }, n);
    const frames = {};
    for (const mode of ['fit', 'zoom0.3', 'zoom1', 'zoom2']) {
      frames[mode] = await page.evaluate(async (mode) => {
        const c = document.getElementById('tree'); const rect = c.getBoundingClientRect(); const b = FT.layout().bbox;
        let k; if (mode === 'fit') k = Math.min((rect.width - 40) / b.w, (rect.height - 60) / b.h); else k = parseFloat(mode.slice(4));
        FT.setView({ k, x: rect.width / 2 - (b.x + b.w / 2) * k, y: rect.height / 2 - (b.y + b.h / 2) * k });
        const times = []; let last = null;
        await new Promise(res => { let i = 0; const step = (now) => { if (last != null) times.push(now - last); last = now; const v = FT.getView(); FT.setView({ x: v.x - 12, y: v.y + (i % 2 ? 3 : -3) }); if (++i < 90) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
        const ft = FT.frameTimes().slice(-80).sort((a, b) => a - b); const sorted = times.slice().sort((a, b) => a - b);
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        return { k: +k.toFixed(3), fps: +(1000 / avg(times)).toFixed(1), frameIntervalP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), renderMsAvg: +avg(ft).toFixed(2), renderMsP95: +ft[Math.floor(ft.length * 0.95)].toFixed(2), renderMsMax: +ft[ft.length - 1].toFixed(2) };
      }, mode);
    }
    return { ...gen, frames };
  };
  for (const n of [1000, 5000, 10000, 20000]) { report.sizes[n] = await measure(n); console.log(n, 'layout', report.sizes[n].layoutMs, 'ms', JSON.stringify(report.sizes[n].frames)); }
  await page.evaluate(() => FT.generate(5000, 7)); await sleep(100);
  await page.evaluate(() => FT.fitAll(0)); await sleep(100); await shot(page, 'big-zoomed-out');
  await page.evaluate(() => { const b = FT.layout().bbox; const c = document.getElementById('tree').getBoundingClientRect(); FT.setView({ k: 0.3, x: c.width / 2 - (b.x + b.w / 2) * 0.3, y: 60 - b.y * 0.3 }); }); await sleep(100); await shot(page, 'big-mid');
  await page.evaluate(() => { const id = FT.state().persons[40].id; FT.centerOn(id, 0, 1); }); await sleep(100); await shot(page, 'big-zoomed-in');
  for (const [label, prep] of [['tree5000', () => FT.generate(5000, 7)], ['example', () => FT.loadExample()]]) {
    await page.evaluate(prep); await sleep(100);
    const r = await page.evaluate(async () => { const out = {}; for (const f of ['png', 'pdf', 'svg']) { const t0 = performance.now(); const r = await FT.exportTree(f, { paper: 'A1', dpi: 300 }); out[f] = { ms: Math.round(performance.now() - t0), bytes: r.blob.size, px: [r.page.pxW, r.page.pxH], capped: r.page.capped, dpi: r.page.dpi, cardMm: +r.page.cardMm.toFixed(1) }; } return out; });
    report.exports[label] = r; console.log(label, JSON.stringify(r));
  }
  const mp = await newPage(browser, { width: 390, height: 844, mobile: true, dpr: 3 });
  const client = await mp.createCDPSession(); await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const mres = {};
  await mp.evaluate(() => FT.generate(5000, 7));
  for (const mode of ['fit', 'zoom0.3', 'zoom1']) {
    mres[mode] = await mp.evaluate(async (mode) => { const c = document.getElementById('tree'); const rect = c.getBoundingClientRect(); const b = FT.layout().bbox; let k; if (mode === 'fit') k = Math.min((rect.width - 40) / b.w, (rect.height - 60) / b.h); else k = parseFloat(mode.slice(4));
      FT.setView({ k, x: rect.width / 2 - (b.x + b.w / 2) * k, y: rect.height / 2 - (b.y + b.h / 2) * k }); const times = []; let last = null;
      await new Promise(res => { let i = 0; const step = (now) => { if (last != null) times.push(now - last); last = now; const v = FT.getView(); FT.setView({ x: v.x - 8 }); if (++i < 60) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
      const ft = FT.frameTimes().slice(-50).sort((a, b) => a - b); const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length; const s = times.slice().sort((a, b) => a - b);
      return { k: +k.toFixed(3), fps: +(1000 / avg(times)).toFixed(1), frameIntervalP95: +s[Math.floor(s.length * 0.95)].toFixed(1), renderMsAvg: +avg(ft).toFixed(2), renderMsP95: +ft[Math.floor(ft.length * 0.95)].toFixed(2) }; }, mode);
  }
  report.mobileThrottled4x_5000 = mres; console.log('mobile 4x throttled', JSON.stringify(mres));
  fs.writeFileSync(path.join(__dirname, 'out', 'perf-results.json'), JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
