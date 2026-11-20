const { launch, newPage } = require('./lib'); const fs = require('fs'); const path = require('path');
(async () => {
  const browser = await launch(); const page = await newPage(browser);
  const which = process.argv[2] || 'example'; const theme = process.argv[3] || 'modern'; const outDir = path.join(__dirname, 'out', 'exports'); fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate((w, th) => { if (w === 'example') FT.loadExample(); else FT.generate(parseInt(w), 7); FT.setTheme(th); }, which, theme);
  for (const f of ['png', 'pdf', 'svg']) {
    const b64 = await page.evaluate(async (f) => { const r = await FT.exportTree(f, { paper: 'A1', dpi: 300 }); const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return btoa(s); }, f);
    const file = path.join(outDir, `${which}-${theme}-A1-300.${f}`); fs.writeFileSync(file, Buffer.from(b64, 'base64')); console.log(file, fs.statSync(file).size);
  }
  await browser.close();
})();
