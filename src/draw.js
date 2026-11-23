// ---------------------------------------------------------------------------
// Themes + backend-agnostic scene drawing (canvas on screen, SVG/PDF on export)
// ---------------------------------------------------------------------------
const THEMES = {
  modern: { name: 'modern', bg: '#f4f5f7', exportBg: '#ffffff', card: '#ffffff', cardBorder: '#b9c0cb', text: '#161a22', text2: '#4b5563', line: '#5b6572', lineW: 1.6,
    accent: '#1d4ed8', selectedBg: '#e8efff', font: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif', pdfFont: 'Helvetica', radius: 10, nodeFill: '#ffffff', photoBg: '#dfe3ea', frame: false, titleSize: 34, subtitleSize: 18, plus: '#1d4ed8' },
  vintage: { name: 'vintage', bg: '#e9dcbd', exportBg: '#f1e6cc', card: '#faf3e0', cardBorder: '#6e4b22', text: '#2b1a0a', text2: '#5a3e1f', line: '#5c3d18', lineW: 1.6,
    accent: '#8a2a1b', selectedBg: '#f3dfb6', font: 'Georgia, "Times New Roman", Times, serif', pdfFont: 'Times', radius: 3, nodeFill: '#faf3e0', photoBg: '#e3d3ab', frame: true, titleSize: 40, subtitleSize: 20, plus: '#8a2a1b' },
};
const PHOTO_D = 120; // photo size on card: full card width (= LY.W), square
const FONT_NAME = 13, FONT_SMALL = 11;

// --- text measuring (shared by all backends) ---------------------------------
const _mc = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const _mcache = new Map();
function fontStr(f) { return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.family}`; }
function measure(str, f) {
  const key = fontStr(f) + '|' + str; let w = _mcache.get(key);
  if (w == null) { _mc.font = fontStr(f); w = _mc.measureText(str).width; if (_mcache.size > 20000) _mcache.clear(); _mcache.set(key, w); }
  return w;
}
function ellipsize(str, f, maxW) {
  if (measure(str, f) <= maxW) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(str.slice(0, mid) + '…', f) <= maxW) lo = mid; else hi = mid - 1; }
  return lo ? str.slice(0, lo).replace(/\s+$/, '') + '…' : '…';
}

// --- photo cache ---------------------------------------------------------------
const photoCache = new Map(); // id -> {img, ready, small}
let onPhotoReady = null;
function getPhoto(photos, id) {
  let e = photoCache.get(id);
  if (!e) {
    e = { img: new Image(), ready: false, small: null }; photoCache.set(id, e);
    e.img.onload = () => { e.ready = true; if (onPhotoReady) onPhotoReady(); };
    e.img.src = photos[id];
  }
  return e;
}
function smallPhoto(e) { // pre-rendered 2x version for screen drawing
  if (!e.small) { const s = PHOTO_D * 3; const c = document.createElement('canvas'); c.width = s; c.height = s; const g = c.getContext('2d'); g.drawImage(e.img, 0, 0, s, s); e.small = c; }
  return e.small;
}

// --- Canvas backend ------------------------------------------------------------
class CanvasG {
  constructor(ctx, opts = {}) { this.ctx = ctx; this.hiRes = !!opts.hiRes; this.photos = opts.photos || {}; this.batches = new Map(); }
  rect(x, y, w, h, o) { const c = this.ctx; c.beginPath(); if (o.r) c.roundRect(x, y, w, h, o.r); else c.rect(x, y, w, h);
    if (o.fill) { c.fillStyle = o.fill; c.fill(); } if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lw || 1; c.setLineDash(o.dash || []); c.stroke(); c.setLineDash([]); } }
  circle(x, y, r, o) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (o.fill) { c.fillStyle = o.fill; c.fill(); } if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lw || 1; c.stroke(); } }
  path(pts, o) { // batched by style
    const key = `${o.stroke}|${o.lw}|${(o.dash || []).join(',')}`; let b = this.batches.get(key); if (!b) { b = { o, p: new Path2D() }; this.batches.set(key, b); }
    b.p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) b.p.lineTo(pts[i][0], pts[i][1]);
  }
  flush() { const c = this.ctx; c.lineCap = 'round'; c.lineJoin = 'round'; for (const b of this.batches.values()) { c.strokeStyle = b.o.stroke; c.lineWidth = b.o.lw; c.setLineDash(b.o.dash || []); c.stroke(b.p); } c.setLineDash([]); this.batches.clear(); }
  text(str, x, y, o) { const c = this.ctx; c.font = fontStr(o.font); c.fillStyle = o.color; c.textAlign = o.align || 'left'; c.textBaseline = 'alphabetic'; c.fillText(str, x, y); }
  image(id, x, y, w, h, shape, r) {
    const e = getPhoto(this.photos, id); const c = this.ctx;
    c.save(); c.beginPath(); if (shape === 'top') c.roundRect(x, y, w, h, [r || 0, r || 0, 0, 0]); else if (shape === 'square') c.roundRect(x, y, w, h, 4); else c.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); c.clip();
    if (e.ready) { if (this.hiRes) c.drawImage(e.img, x, y, w, h); else c.drawImage(smallPhoto(e), x, y, w, h); } else { c.fillStyle = '#d4d8de'; c.fillRect(x, y, w, h); }
    c.restore();
  }
}

// --- SVG backend ---------------------------------------------------------------
function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
const nf = (v) => Math.round(v * 100) / 100;
class SvgG {
  constructor(opts = {}) { this.out = []; this.defs = []; this.photos = opts.photos || {}; this.clipN = 0; }
  rect(x, y, w, h, o) { this.out.push(`<rect x="${nf(x)}" y="${nf(y)}" width="${nf(w)}" height="${nf(h)}" rx="${o.r || 0}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${o.lw || 1}"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`); }
  circle(x, y, r, o) { this.out.push(`<circle cx="${nf(x)}" cy="${nf(y)}" r="${nf(r)}" fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${o.lw || 1}"/>`); }
  path(pts, o) { this.out.push(`<polyline points="${pts.map(p => nf(p[0]) + ',' + nf(p[1])).join(' ')}" fill="none" stroke="${o.stroke}" stroke-width="${o.lw}" stroke-linecap="round" stroke-linejoin="round"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`); }
  flush() {}
  text(str, x, y, o) { const f = o.font; const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
    this.out.push(`<text x="${nf(x)}" y="${nf(y)}" font-family="${esc(f.family)}" font-size="${f.size}"${f.bold ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''} fill="${o.color}" text-anchor="${anchor}">${esc(str)}</text>`); }
  image(id, x, y, w, h, shape, r) { const cid = 'c' + (++this.clipN); r = r || 0;
    this.defs.push(`<clipPath id="${cid}">${shape === 'top' ? `<path d="M${nf(x)},${nf(y + h)} L${nf(x)},${nf(y + r)} Q${nf(x)},${nf(y)} ${nf(x + r)},${nf(y)} L${nf(x + w - r)},${nf(y)} Q${nf(x + w)},${nf(y)} ${nf(x + w)},${nf(y + r)} L${nf(x + w)},${nf(y + h)} Z"/>` : shape === 'square' ? `<rect x="${nf(x)}" y="${nf(y)}" width="${nf(w)}" height="${nf(h)}" rx="4"/>` : `<circle cx="${nf(x + w / 2)}" cy="${nf(y + h / 2)}" r="${nf(w / 2)}"/>`}</clipPath>`);
    this.out.push(`<image x="${nf(x)}" y="${nf(y)}" width="${nf(w)}" height="${nf(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})" href="${this.photos[id]}"/>`); }
  toString(w, h, bg) { return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${nf(w)}" height="${nf(h)}" viewBox="0 0 ${nf(w)} ${nf(h)}">\n<defs>${this.defs.join('')}</defs>\n<rect width="100%" height="100%" fill="${bg}"/>\n${this.out.join('\n')}\n</svg>`; }
}

// --- scene ---------------------------------------------------------------------
function cardLines(p, s) {
  const lines = [];
  lines.push({ t: p.first || '?', bold: true });
  if (s.showLastName && p.last) lines.push({ t: p.last, caps: true });
  if (s.showDates) { const b = p.birth ? String(dateYear(p.birth)) : '', d = p.death ? String(dateYear(p.death)) : ''; const t = b && d ? `${b} – ${d}` : b ? `${b}` : d ? `† ${d}` : ''; if (t) lines.push({ t }); }
  if (s.showPlace && p.place) lines.push({ t: p.place, italic: true });
  return lines;
}

function drawScene(G, lay, st, idx, o) {
  const T = o.theme, s = o.settings, lod = o.lod ?? 2, W = LY.W, H = LY.H;
  const vr = o.rect; const vis = (x, y, w, h) => !vr || (x + w >= vr.x && x <= vr.x + vr.w && y + h >= vr.y && y <= vr.y + vr.h);
  const dash = [4, 4], farDash = [2, 5];
  // edges first (under cards)
  for (const e of lay.edges) {
    if (e.kind === 'node') continue;
    const xs = e.pts.map(p => p[0]), ys = e.pts.map(p => p[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys);
    if (!vis(x0 - 4, y0 - 4, Math.max(...xs) - x0 + 8, Math.max(...ys) - y0 + 8)) continue;
    G.path(e.pts, { stroke: T.line, lw: T.lineW, dash: e.dashed ? dash : e.kind === 'far' ? farDash : null });
  }
  G.flush();
  if (lod >= 1) for (const e of lay.edges) if (e.kind === 'node' && vis(e.x - 5, e.y - 5, 10, 10)) G.circle(e.x, e.y, 4, { fill: T.nodeFill, stroke: T.line, lw: T.lineW });
  // cards
  const fName = { size: FONT_NAME, bold: true, family: T.font }, fSmall = { size: FONT_SMALL, family: T.font }, fSmallI = { size: FONT_SMALL, italic: true, family: T.font };
  const fCaps = { size: FONT_SMALL, family: T.font, bold: T.name === 'vintage' };
  for (const n of lay.nodes.values()) {
    if (!vis(n.x, n.y - 2, W, H + 22)) continue;
    const p = idx.byId.get(n.id); if (!p) continue;
    const sel = n.id === o.selectedId, foc = n.id === o.focusId;
    const fill = sel ? T.selectedBg : T.card;
    if (lod === 0) { G.rect(n.x, n.y, W, H, { fill: T.cardBorder, r: T.radius }); continue; }
    G.rect(n.x, n.y, W, H, { fill, stroke: sel ? T.accent : T.cardBorder, lw: sel ? 2.5 : 1, r: T.radius });
    if (T.frame && lod >= 2) { G.rect(n.x + 3, n.y + 3, W - 6, H - 6, { stroke: T.cardBorder, lw: 0.5, r: 1 });
      const c = 7; for (const [cx, cy, dx, dy] of [[n.x + 3, n.y + 3, 1, 1], [n.x + W - 3, n.y + 3, -1, 1], [n.x + 3, n.y + H - 3, 1, -1], [n.x + W - 3, n.y + H - 3, -1, -1]]) G.path([[cx, cy + dy * c], [cx + dx * c, cy]], { stroke: T.cardBorder, lw: 0.6 }); }
    if (foc && o.screen) G.rect(n.x - 4, n.y - 4, W + 8, H + 8, { stroke: T.accent, lw: 2, dash: [5, 3], r: T.radius + 3 });
    if (lod === 1) { const f = { size: 16, bold: true, family: T.font }; G.text(ellipsize([p.first, s.showLastName ? p.last : ''].filter(Boolean).join(' '), f, W - 16), n.cx, n.cy + 6, { font: f, color: T.text, align: 'center' }); continue; }
    const lines = cardLines(p, s); const lh = 13; const total = lines.length * lh - 2; let y;
    const tw = W - 6;
    if (s.showPhoto) { const d = W, R = T.radius;
      if (p.photo && st.photos[p.photo]) G.image(p.photo, n.x, n.y, d, d, 'top', R);
      else { G.rect(n.x, n.y, d, d, { fill: T.photoBg, r: R }); G.rect(n.x, n.y + R, d, d - R, { fill: T.photoBg }); const f = { size: 44, bold: true, family: T.font }; G.text(((p.first[0] || '') + (p.last[0] || '')).toUpperCase(), n.cx, n.y + d / 2 + 15, { font: f, color: T.text2, align: 'center' }); }
      G.path([[n.x, n.y + d], [n.x + W, n.y + d]], { stroke: T.cardBorder, lw: T.frame ? 0.8 : 0.6 });
      G.rect(n.x, n.y, W, H, { stroke: sel ? T.accent : T.cardBorder, lw: sel ? 2.5 : 1, r: R });
      y = n.y + d + 4 + 11 + Math.max(0, (H - d - 4 - 5 - total) / 2);
    } else y = n.y + (H - total) / 2 + 11;
    for (const ln of lines) { const f = ln.bold ? fName : ln.italic ? fSmallI : ln.caps ? fCaps : fSmall; const txt = ln.caps && T.name === 'vintage' ? ln.t.toUpperCase() : ln.t;
      G.text(ellipsize(txt, f, tw), n.cx, y, { font: f, color: ln.bold ? T.text : T.text2, align: 'center' }); y += lh; }
    const col = lay.collapsed.get(n.id);
    if (col) { const f = { size: 10, bold: true, family: T.font }; const txt = `▸ ${t('hiddenCount', col)}`; const w = measure(txt, f) + 14; G.rect(n.cx - w / 2, n.y + H - 1, w, 16, { fill: T.card, stroke: T.cardBorder, lw: 1, r: 8 }); G.text(txt, n.cx, n.y + H + 11, { font: f, color: T.text2, align: 'center' }); }
    if (o.screen && sel && s.showPlus !== false && o.plusVisible) { const r = 13, cx = n.x + W + 3, cy = n.y - 3; G.circle(cx, cy, r, { fill: T.plus, stroke: T.bg, lw: 2 }); G.path([[cx - 6, cy], [cx + 6, cy]], { stroke: '#fff', lw: 2.2 }); G.path([[cx, cy - 6], [cx, cy + 6]], { stroke: '#fff', lw: 2.2 }); G.flush(); }
  }
  G.flush();
}

// Decorative page furniture for exports (frame, title)
function drawPage(G, T, page, title, subtitle) {
  const { w, h, m } = page;
  if (T.frame) { G.rect(m * 0.5, m * 0.5, w - m, h - m, { stroke: T.cardBorder, lw: 2.5 }); G.rect(m * 0.5 + 8, m * 0.5 + 8, w - m - 16, h - m - 16, { stroke: T.cardBorder, lw: 0.8 });
    const c = 26; for (const [x, y, dx, dy] of [[m * 0.5 + 8, m * 0.5 + 8, 1, 1], [w - m * 0.5 - 8, m * 0.5 + 8, -1, 1], [m * 0.5 + 8, h - m * 0.5 - 8, 1, -1], [w - m * 0.5 - 8, h - m * 0.5 - 8, -1, -1]]) { G.path([[x, y + dy * c], [x + dx * c, y]], { stroke: T.cardBorder, lw: 1 }); G.circle(x + dx * c * 0.5, y + dy * c * 0.5, 2.5, { fill: T.cardBorder }); } G.flush(); }
  let top = m;
  if (title) { const f = { size: T.titleSize, bold: true, family: T.font }; G.text(title, w / 2, top + T.titleSize, { font: f, color: T.text, align: 'center' }); top += T.titleSize * 1.4;
    if (T.frame) { G.path([[w / 2 - 120, top + 6], [w / 2 + 120, top + 6]], { stroke: T.cardBorder, lw: 1 }); G.flush(); top += 10; } }
  if (subtitle) { const f = { size: T.subtitleSize, italic: true, family: T.font }; G.text(subtitle, w / 2, top + T.subtitleSize, { font: f, color: T.text2, align: 'center' }); top += T.subtitleSize * 1.5; }
  return top; // content top
}
