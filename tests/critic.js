const { launch, newPage } = require('./lib'); const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DIR = path.join(__dirname, 'out', 'critic'); fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
(async () => {
  const browser = await launch();
  for (const [vp, w, h, mobile] of [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['desktop', 1920, 1080, false]]) {
    const page = await newPage(browser, { width: w, height: h, mobile, dpr: mobile ? 2 : 1 });
    const shot = (n) => page.screenshot({ path: path.join(DIR, `${vp}-${n}.png`) });
    await shot('empty');
    for (const th of ['modern', 'vintage']) { await page.evaluate((th) => { FT.loadExample(); FT.setTheme(th); FT.fitAll(0); }, th); await sleep(300); await shot(`example-${th}-fit`);
      await page.evaluate(() => { FT.select(FT.state().persons[0].id); FT.centerOn(FT.state().persons[0].id, 0, 1); }); await sleep(200); await shot(`example-${th}-zoom1-selected`); }
    await page.evaluate(() => { FT.setTheme('modern'); FT.openAdd(FT.state().persons[0].id); }); await sleep(200); await shot('add-form'); await page.keyboard.press('Escape');
    await page.evaluate(() => { FT.generate(5000, 7); FT.fitAll(0); }); await sleep(300); await shot('big-zoomed-out');
    await page.evaluate(() => { const b = FT.layout().bbox; const c = document.getElementById('tree').getBoundingClientRect(); FT.setView({ k: 0.25, x: c.width / 2 - (b.x + b.w / 2) * 0.25, y: 50 - b.y * 0.25 }); }); await sleep(200); await shot('big-mid');
    await page.evaluate(() => FT.centerOn(FT.state().persons[40].id, 0, 1)); await sleep(200); await shot('big-zoomed-in');
    await page.close();
  }
  await browser.close();
  // exports: downscaled views + 100% crops (PNG direct, PDF rasterised by macOS at 300 dpi)
  const EX = path.join(__dirname, 'out', 'exports');
  for (const th of ['modern', 'vintage']) {
    const png = path.join(EX, `example-${th}-A1-300.png`), pdfpng = path.join(EX, `example-${th}-A1-300-pdf.png`);
    execSync(`sips -s format png -z 7016 9933 "${path.join(EX, `example-${th}-A1-300.pdf`)}" --out "${pdfpng}" >/dev/null`);
    for (const [src, tag] of [[png, 'png'], [pdfpng, 'pdf']]) {
      execSync(`sips -Z 1800 "${src}" --out "${path.join(DIR, `export-${th}-${tag}-overview.png`)}" >/dev/null`);
      // crops: a card with photo (near Jean at top-left area), text+lines region, union node region
      for (const [name, x, y] of [['crop-photo-card', 900, 2900], ['crop-lines-children', 2600, 3200], ['crop-title', 3700, 150], ['crop-adopted-dashed', 5500, 5200]]) execSync(`sips -c 900 1400 --cropOffset ${y} ${x} "${src}" --out "${path.join(DIR, `export-${th}-${tag}-${name}.png`)}" >/dev/null`);
    }
  }
  console.log(fs.readdirSync(DIR).length, 'files');
})();
