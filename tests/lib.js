const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT || path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
async function launch(opts = {}) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu-vsync', '--enable-unsafe-swiftshader', ...(opts.args || [])] });
  return browser;
}
async function newPage(browser, { width = 1920, height = 1080, mobile = false, dpr = 1, blockNetwork = true } = {}) {
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.setRequestInterception(true);
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) { requests.push(u); if (blockNetwork) return r.abort(); } r.continue(); });
  if (mobile) await page.emulate({ viewport: { width, height, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  else await page.setViewport({ width, height, deviceScaleFactor: dpr });
  await page.evaluateOnNewDocument(() => { localStorage.clear(); });
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForFunction(() => window.FT && window.FT.layout());
  page._errors = errors; page._requests = requests;
  return page;
}
async function shot(page, name, opts = {}) { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f, ...opts }); return f; }
module.exports = { launch, newPage, shot, OUT, INDEX };
