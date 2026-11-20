const { launch, newPage, shot } = require('./lib');
(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  await page.evaluate(() => FT.loadExample());
  await new Promise(r => setTimeout(r, 300));
  const info = await page.evaluate(() => { const l = FT.layout(); return { persons: FT.state().persons.length, nodes: l.nodes.size, edges: l.edges.length, bbox: l.bbox, layoutMs: FT.layoutMs() }; });
  console.log(JSON.stringify(info));
  await shot(page, 'smoke-modern');
  await page.evaluate(() => FT.setTheme('vintage')); await new Promise(r => setTimeout(r, 200));
  await shot(page, 'smoke-vintage');
  console.log('errors:', page._errors); console.log('requests:', page._requests);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
