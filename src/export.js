// ---------------------------------------------------------------------------
// Export: paper fitting, PDF writer (vector), streaming tiled PNG encoder, SVG
// ---------------------------------------------------------------------------
const PAPERS = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
const PX_PER_MM = 96 / 25.4;

// --- binary helpers --------------------------------------------------------------
function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function dataUrlBytes(url) { const i = url.indexOf(','); return { mime: url.slice(5, url.indexOf(';')), bytes: b64ToBytes(url.slice(i + 1)) }; }
function jpegSize(b) { // parse SOF marker
  let i = 2; while (i < b.length) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }; i += 2 + ((b[i + 2] << 8) | b[i + 3]); } return null; }
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf, crc = -1) { for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8); return crc; }
async function deflateBytes(chunks) { // chunks: Uint8Array[] -> zlib-wrapped deflate, or null if unsupported
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate'); const w = cs.writable.getWriter(); const out = []; let total = 0;
  const rd = (async () => { const r = cs.readable.getReader(); for (;;) { const { value, done } = await r.read(); if (done) break; out.push(value); total += value.length; } })();
  for (const c of chunks) await w.write(c); await w.close(); await rd;
  const res = new Uint8Array(total); let o = 0; for (const c of out) { res.set(c, o); o += c.length; } return res;
}

// --- PDF backend -------------------------------------------------------------------
const WINANSI = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
function pdfStr(s) { let out = ''; for (const ch of s) { let c = ch.codePointAt(0); if (c > 255) c = WINANSI[ch] ?? 63; if (c === 40 || c === 41 || c === 92) out += '\\' + ch; else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0'); else out += ch; } return '(' + out + ')'; }
const pn = (v) => (Math.round(v * 1000) / 1000).toString();
class PdfG {
  constructor(opts) { this.c = []; this.photos = opts.photos; this.pdfFont = opts.pdfFont; this.images = new Map(); this.fonts = new Set(); }
  _style(o) { let s = ''; if (o.fill) s += this._col(o.fill, 'rg'); if (o.stroke) s += this._col(o.stroke, 'RG') + ` ${pn(o.lw || 1)} w ` + (o.dash ? `[${o.dash.join(' ')}] 0 d ` : '[] 0 d '); return s; }
  _col(hex, op) { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; return `${pn(r)} ${pn(g)} ${pn(b)} ${op} `; }
  _paint(o) { return o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S'; }
  _roundRect(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); const k = 0.5523 * r; return `${pn(x + r)} ${pn(y)} m ${pn(x + w - r)} ${pn(y)} l ${pn(x + w - r + k)} ${pn(y)} ${pn(x + w)} ${pn(y + r - k)} ${pn(x + w)} ${pn(y + r)} c ${pn(x + w)} ${pn(y + h - r)} l ${pn(x + w)} ${pn(y + h - r + k)} ${pn(x + w - r + k)} ${pn(y + h)} ${pn(x + w - r)} ${pn(y + h)} c ${pn(x + r)} ${pn(y + h)} l ${pn(x + r - k)} ${pn(y + h)} ${pn(x)} ${pn(y + h - r + k)} ${pn(x)} ${pn(y + h - r)} c ${pn(x)} ${pn(y + r)} l ${pn(x)} ${pn(y + r - k)} ${pn(x + r - k)} ${pn(y)} ${pn(x + r)} ${pn(y)} c h `; }
  _circle(cx, cy, r) { const k = 0.5523 * r; return `${pn(cx + r)} ${pn(cy)} m ${pn(cx + r)} ${pn(cy + k)} ${pn(cx + k)} ${pn(cy + r)} ${pn(cx)} ${pn(cy + r)} c ${pn(cx - k)} ${pn(cy + r)} ${pn(cx - r)} ${pn(cy + k)} ${pn(cx - r)} ${pn(cy)} c ${pn(cx - r)} ${pn(cy - k)} ${pn(cx - k)} ${pn(cy - r)} ${pn(cx)} ${pn(cy - r)} c ${pn(cx + k)} ${pn(cy - r)} ${pn(cx + r)} ${pn(cy - k)} ${pn(cx + r)} ${pn(cy)} c h `; }
  rect(x, y, w, h, o) { this.c.push('q ' + this._style(o) + (o.r ? this._roundRect(x, y, w, h, o.r) : `${pn(x)} ${pn(y)} ${pn(w)} ${pn(h)} re `) + this._paint(o) + ' Q'); }
  circle(x, y, r, o) { this.c.push('q ' + this._style(o) + this._circle(x, y, r) + this._paint(o) + ' Q'); }
  path(pts, o) { this.c.push('q 1 J 1 j ' + this._style(o) + `${pn(pts[0][0])} ${pn(pts[0][1])} m ` + pts.slice(1).map(p => `${pn(p[0])} ${pn(p[1])} l `).join('') + 'S Q'); }
  flush() {}
  text(str, x, y, o) { const f = o.font; const name = (f.bold ? 'B' : '') + (f.italic ? 'I' : '') || 'R'; this.fonts.add(name);
    let dx = 0; if (o.align === 'center') dx = -measure(str, f) / 2; else if (o.align === 'right') dx = -measure(str, f);
    this.c.push(`BT ${this._col(o.color, 'rg')}/F${name} ${pn(f.size)} Tf 1 0 0 -1 ${pn(x + dx)} ${pn(y)} Tm ${pdfStr(str)} Tj ET`); }
  _topRound(x, y, w, h, r) { r = Math.min(r || 0, w / 2, h / 2); const k = 0.5523 * r; return `${pn(x)} ${pn(y + h)} m ${pn(x)} ${pn(y + r)} l ${pn(x)} ${pn(y + r - k)} ${pn(x + r - k)} ${pn(y)} ${pn(x + r)} ${pn(y)} c ${pn(x + w - r)} ${pn(y)} l ${pn(x + w - r + k)} ${pn(y)} ${pn(x + w)} ${pn(y + r - k)} ${pn(x + w)} ${pn(y + r)} c ${pn(x + w)} ${pn(y + h)} l h `; }
  image(id, x, y, w, h, shape, r) { let im = this.images.get(id); if (!im) { im = { n: this.images.size + 1 }; this.images.set(id, im); }
    this.c.push('q ' + (shape === 'top' ? this._topRound(x, y, w, h, r) : shape === 'square' ? this._roundRect(x, y, w, h, 4) : this._circle(x + w / 2, y + h / 2, w / 2)) + `W n ${pn(w)} 0 0 ${pn(-h)} ${pn(x)} ${pn(y + h)} cm /Im${im.n} Do Q`); }
  async build(wPx, hPx) {
    const Wpt = wPx * 0.75, Hpt = hPx * 0.75;
    const objs = []; const add = (body) => { objs.push(body); return objs.length; };
    const fontNames = { Helvetica: { R: 'Helvetica', B: 'Helvetica-Bold', I: 'Helvetica-Oblique', BI: 'Helvetica-BoldOblique' }, Times: { R: 'Times-Roman', B: 'Times-Bold', I: 'Times-Italic', BI: 'Times-BoldItalic' } }[this.pdfFont];
    const fontRefs = []; for (const k of ['R', 'B', 'I', 'BI']) fontRefs.push(`/F${k} ${add(`<< /Type /Font /Subtype /Type1 /BaseFont /${fontNames[k]} /Encoding /WinAnsiEncoding >>`)} 0 R`);
    const imgRefs = [];
    for (const [id, im] of this.images) { const { bytes } = dataUrlBytes(this.photos[id]); const sz = jpegSize(bytes) || { w: 1, h: 1 };
      imgRefs.push(`/Im${im.n} ${add({ dict: `<< /Type /XObject /Subtype /Image /Width ${sz.w} /Height ${sz.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, stream: bytes })} 0 R`); }
    const content = `0.75 0 0 -0.75 0 ${pn(Hpt)} cm\n` + this.c.join('\n');
    const raw = new TextEncoder().encode(content); const comp = await deflateBytes([raw]);
    const cObj = add({ dict: `<< /Length ${(comp || raw).length}${comp ? ' /Filter /FlateDecode' : ''} >>`, stream: comp || raw });
    const resObj = add(`<< /Font << ${fontRefs.join(' ')} >> /XObject << ${imgRefs.join(' ')} >> >>`);
    const pagesN = objs.length + 2;
    const pageObj = add(`<< /Type /Page /Parent ${pagesN} 0 R /MediaBox [0 0 ${pn(Wpt)} ${pn(Hpt)}] /Resources ${resObj} 0 R /Contents ${cObj} 0 R >>`);
    add(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesN} 0 R >>`);
    const enc = new TextEncoder(); const parts = []; let off = 0; const offsets = [];
    const push = (u8) => { parts.push(u8); off += u8.length; };
    push(enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    objs.forEach((o, i) => { offsets.push(off); push(enc.encode(`${i + 1} 0 obj\n`)); if (typeof o === 'string') push(enc.encode(o + '\n')); else { push(enc.encode(o.dict + '\nstream\n')); push(o.stream); push(enc.encode('\nendstream\n')); } push(enc.encode('endobj\n')); });
    const xref = off; let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const o of offsets) x += String(o).padStart(10, '0') + ' 00000 n \n';
    x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`; push(enc.encode(x));
    return new Blob(parts, { type: 'application/pdf' });
  }
}

// --- PNG streaming encoder --------------------------------------------------------
function pngChunk(type, data) { const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer); dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8); dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ -1) >>> 0); return out; }
// drawTile(ctx, x, y, w, h) must paint device pixels [x,x+w)x[y,y+h) into ctx at (0,0)
async function encodePNG(width, height, drawTile, onProgress) {
  const TW = Math.min(width, 4096), BH = Math.max(16, Math.min(256, Math.floor(4e6 / TW)));
  const tile = document.createElement('canvas'); tile.width = TW; tile.height = BH; const tctx = tile.getContext('2d', { willReadFrequently: true });
  const rowLen = 1 + width * 4; const hasCS = typeof CompressionStream !== 'undefined';
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6; parts.push(pngChunk('IHDR', ihdr));
  let cs, writer, readDone; const idats = [];
  if (hasCS) { cs = new CompressionStream('deflate'); writer = cs.writable.getWriter(); readDone = (async () => { const r = cs.readable.getReader(); for (;;) { const { value, done } = await r.read(); if (done) break; idats.push(value); } })(); }
  let a = 1, b = 0; // adler for stored fallback
  const stored = []; if (!hasCS) stored.push(new Uint8Array([0x78, 0x01]));
  for (let y0 = 0; y0 < height; y0 += BH) {
    const bh = Math.min(BH, height - y0); const band = new Uint8Array(rowLen * bh);
    for (let x0 = 0; x0 < width; x0 += TW) {
      const tw = Math.min(TW, width - x0); tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, TW, BH);
      drawTile(tctx, x0, y0, tw, bh); const d = tctx.getImageData(0, 0, tw, bh).data;
      for (let r = 0; r < bh; r++) { band.set(d.subarray(r * tw * 4, (r + 1) * tw * 4), r * rowLen + 1 + x0 * 4); }
    }
    if (hasCS) await writer.write(band);
    else { for (let o = 0; o < band.length; o += 65535) { const n = Math.min(65535, band.length - o); const blk = new Uint8Array(5 + n); blk[0] = (o + n >= band.length && y0 + bh >= height) ? 1 : 0; blk[1] = n & 255; blk[2] = n >> 8; blk[3] = ~n & 255; blk[4] = (~n >> 8) & 255; blk.set(band.subarray(o, o + n), 5); stored.push(blk); }
      for (let i = 0; i < band.length; i++) { a = (a + band[i]) % 65521; b = (b + a) % 65521; } }
    if (onProgress) { onProgress(Math.min(1, (y0 + bh) / height)); await new Promise(r => setTimeout(r, 0)); }
  }
  if (hasCS) { await writer.close(); await readDone; for (const c of idats) parts.push(pngChunk('IDAT', c)); }
  else { const ad = new Uint8Array(4); new DataView(ad.buffer).setUint32(0, ((b << 16) | a) >>> 0); stored.push(ad); let tot = 0; for (const s of stored) tot += s.length; const all = new Uint8Array(tot); let o = 0; for (const s of stored) { all.set(s, o); o += s.length; } parts.push(pngChunk('IDAT', all)); }
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}

// --- page computation --------------------------------------------------------------
function isMobileDevice() { return navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900; }
function rasterLimits() { const mobile = isMobileDevice(); return { maxDim: mobile ? 16000 : 30000, maxPixels: mobile ? 60e6 : 320e6 }; }
// opts: {paper, customW, customH, orientation, dpi, margin, title, subtitle, withTitle}
function computePage(lay, opts) {
  let [wmm, hmm] = opts.paper === 'custom' ? [Math.max(50, opts.customW || 210), Math.max(50, opts.customH || 297)] : PAPERS[opts.paper] || PAPERS.A4;
  const bw = Math.max(lay.bbox.w, 1), bh = Math.max(lay.bbox.h, 1);
  if (opts.orientation === 'landscape' || (opts.orientation === 'auto' && bw / bh > 1.05)) [wmm, hmm] = [Math.max(wmm, hmm), Math.min(wmm, hmm)]; else [wmm, hmm] = [Math.min(wmm, hmm), Math.max(wmm, hmm)];
  const w = wmm * PX_PER_MM, h = hmm * PX_PER_MM, m = Math.max(0, opts.margin ?? 10) * PX_PER_MM;
  const title = opts.withTitle ? (opts.title || '') : '', subtitle = opts.withTitle ? (opts.subtitle || '') : '';
  const T = THEMES[opts.theme] || THEMES.modern;
  let top = m + (title ? T.titleSize * 1.4 + (T.frame ? 10 : 0) : 0) + (subtitle ? T.subtitleSize * 1.5 : 0);
  const cw = w - 2 * m, ch = h - top - m; const k = Math.min(cw / bw, ch / bh);
  const ox = m + (cw - bw * k) / 2 - lay.bbox.x * k, oy = top + (ch - bh * k) / 2 - lay.bbox.y * k;
  const cardMm = k * LY.W / PX_PER_MM;
  // raster size
  const reqDpi = opts.dpi || 300; let dpi = reqDpi; const lim = rasterLimits();
  const pxW = (d) => Math.round(wmm * d / 25.4), pxH = (d) => Math.round(hmm * d / 25.4);
  while (dpi > 36 && (pxW(dpi) > lim.maxDim || pxH(dpi) > lim.maxDim || pxW(dpi) * pxH(dpi) > lim.maxPixels)) dpi = Math.floor(dpi * 0.9);
  return { wmm, hmm, w, h, m, k, ox, oy, title, subtitle, T, cardMm, dpi, reqDpi, capped: dpi < reqDpi, pxW: pxW(dpi), pxH: pxH(dpi) };
}

function drawExportPage(G, page, lay, st, idx, settings) {
  G.rect(0, 0, page.w, page.h, { fill: page.T.exportBg });
  drawPage(G, page.T, page, page.title, page.subtitle);
}
// Render whole page into a canvas context, with transform already set to page px -> device px.
function renderPageTo(ctx, page, lay, st, idx, settings, cullRect) {
  const G = new CanvasG(ctx, { hiRes: true, photos: st.photos });
  drawExportPage(G, page, lay, st, idx, settings);
  ctx.save(); ctx.transform(page.k, 0, 0, page.k, page.ox, page.oy);
  const rect = cullRect ? { x: (cullRect.x - page.ox) / page.k, y: (cullRect.y - page.oy) / page.k, w: cullRect.w / page.k, h: cullRect.h / page.k } : null;
  drawScene(G, lay, st, idx, { theme: page.T, settings, lod: 2, rect, screen: false });
  ctx.restore();
}

async function ensureJpegPhotos(st) { // convert any non-JPEG photo to JPEG for the PDF writer
  for (const id in st.photos) { if (st.photos[id].startsWith('data:image/jpeg')) continue;
    const e = getPhoto(st.photos, id); if (!e.ready) await new Promise(r => { const t0 = e.img.onload; e.img.onload = () => { if (t0) t0(); r(); }; e.img.onerror = r; });
    if (!e.ready) continue; const c = document.createElement('canvas'); c.width = e.img.naturalWidth; c.height = e.img.naturalHeight; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(e.img, 0, 0); st.photos[id] = c.toDataURL('image/jpeg', 0.9); photoCache.delete(id); }
}
async function waitPhotos(st) { const ids = new Set(); for (const p of st.persons) if (p.photo && st.photos[p.photo]) ids.add(p.photo);
  await Promise.all([...ids].map(id => { const e = getPhoto(st.photos, id); return e.ready ? null : new Promise(r => { const t0 = e.img.onload; e.img.onload = () => { if (t0) t0(); r(); }; e.img.onerror = r; }); })); }

async function exportTree(format, page, lay, st, idx, settings, onProgress) {
  await waitPhotos(st);
  const fname = (st.settings.title || 'arbre-familial').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'arbre';
  if (format === 'png') {
    const s = page.dpi / 96;
    const blob = await encodePNG(page.pxW, page.pxH, (ctx, x, y, w, h) => { ctx.setTransform(s, 0, 0, s, -x, -y); renderPageTo(ctx, page, lay, st, idx, settings, { x: x / s, y: y / s, w: w / s, h: h / s }); }, onProgress);
    return { blob, name: fname + '.png' };
  }
  if (format === 'svg') {
    const G = new SvgG({ photos: st.photos }); drawExportPage(G, page, lay, st, idx, settings);
    G.out.push(`<g transform="translate(${nf(page.ox)} ${nf(page.oy)}) scale(${nf(page.k)})">`); drawScene(G, lay, st, idx, { theme: page.T, settings, lod: 2, screen: false }); G.out.push('</g>');
    const svg = G.toString(page.w, page.h, page.T.exportBg).replace('<svg ', `<svg data-size-mm="${page.wmm}x${page.hmm}" `);
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), name: fname + '.svg' };
  }
  await ensureJpegPhotos(st);
  const G = new PdfG({ photos: st.photos, pdfFont: page.T.pdfFont }); drawExportPage(G, page, lay, st, idx, settings);
  G.c.push(`q ${pn(page.k)} 0 0 ${pn(page.k)} ${pn(page.ox)} ${pn(page.oy)} cm`); drawScene(G, lay, st, idx, { theme: page.T, settings, lod: 2, screen: false }); G.c.push('Q');
  return { blob: await G.build(page.w, page.h), name: fname + '.pdf' };
}

async function saveBlob(blob, name) {
  if (navigator.maxTouchPoints > 1 && navigator.canShare) { try { const f = new File([blob], name, { type: blob.type }); if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return 'share'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); return 'download';
}
