// ---------------------------------------------------------------------------
// App: state, undo/redo, view (pan/zoom), interaction, dialogs, persistence
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'familyTree.draft.v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const App = {
  st: emptyState(), idx: null, lay: null, undo: [], redo: [],
  view: { x: 0, y: 0, k: 1 }, selected: null, focus: null, dpr: 1, canvas: null, ctx: null, needRender: false,
  frameTimes: [], layoutMs: 0, exportPage: null,
};

function reindex() { LY.H = App.st.settings.showPhoto ? LY.Hphoto : LY.Hnophoto; App.idx = buildIndex(App.st); const t0 = performance.now(); App.lay = computeLayout(App.st, App.idx); App.layoutMs = performance.now() - t0; }
function snapshot() { return { persons: structuredClone(App.st.persons), unions: structuredClone(App.st.unions), settings: structuredClone(App.st.settings) }; }
function restore(s) { App.st.persons = s.persons; App.st.unions = s.unions; App.st.settings = s.settings; }
function commit(fn) {
  const snap = snapshot();
  try { fn(App.st, App.idx); } catch (e) { restore(snap); throw e; }
  App.undo.push(snap); if (App.undo.length > 100) App.undo.shift(); App.redo.length = 0;
  afterChange();
}
function afterChange() { reindex(); if (App.selected && !App.idx.byId.has(App.selected)) App.selected = null; if (App.focus && !App.idx.byId.has(App.focus)) App.focus = null; updateChrome(); scheduleAutosave(); requestRender(); }
function doUndo() { if (!App.undo.length) return; App.redo.push(snapshot()); restore(App.undo.pop()); afterChange(); }
function doRedo() { if (!App.redo.length) return; App.undo.push(snapshot()); restore(App.redo.pop()); afterChange(); }
function setState(st) { App.st = st; App.undo.length = 0; App.redo.length = 0; App.selected = null; App.focus = null; photoCache.clear(); afterChange(); }

// --- persistence -----------------------------------------------------------------
let autosaveTimer = null;
function scheduleAutosave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => {
  try { localStorage.setItem(DRAFT_KEY, toJSON(App.st)); $('autosave').textContent = t('autosaveNotice'); } catch (e) { $('autosave').textContent = t('autosaveFailed'); } }, 800); }
function loadDraft() { try { const s = localStorage.getItem(DRAFT_KEY); if (!s) return false; const st = fromJSON(s); if (!st.persons.length) return false; App.st = st; return true; } catch (e) { return false; } }

// --- view ------------------------------------------------------------------------
function requestRender() { if (App.needRender) return; App.needRender = true; requestAnimationFrame(render); }
function lodFor(k) { return k < 0.13 ? 0 : k < 0.42 ? 1 : 2; }
function render() {
  App.needRender = false; const t0 = performance.now();
  const { canvas, ctx, view, lay, st, idx } = App; const T = THEMES[st.settings.theme] || THEMES.modern;
  const cw = canvas.width / App.dpr, ch = canvas.height / App.dpr;
  ctx.setTransform(App.dpr, 0, 0, App.dpr, 0, 0); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, cw, ch);
  ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
  const rect = { x: -view.x / view.k, y: -view.y / view.k, w: cw / view.k, h: ch / view.k };
  const G = new CanvasG(ctx, { photos: st.photos });
  drawScene(G, lay, st, idx, { theme: T, settings: st.settings, lod: lodFor(view.k), rect, screen: true, selectedId: App.selected, focusId: App.focus, plusVisible: view.k >= 0.55 });
  App.frameTimes.push(performance.now() - t0); if (App.frameTimes.length > 240) App.frameTimes.shift();
  positionCardBar();
}
function resizeCanvas() { const c = App.canvas; App.dpr = Math.min(window.devicePixelRatio || 1, 3); const r = c.getBoundingClientRect(); c.width = Math.round(r.width * App.dpr); c.height = Math.round(r.height * App.dpr); requestRender(); }
function toScene(px, py) { return { x: (px - App.view.x) / App.view.k, y: (py - App.view.y) / App.view.k }; }
function zoomAt(px, py, factor) { const v = App.view; const k = Math.max(0.002, Math.min(4, v.k * factor)); const f = k / v.k; v.x = px - (px - v.x) * f; v.y = py - (py - v.y) * f; v.k = k; requestRender(); }
let anim = null;
function animateView(target, ms = 320) {
  if (anim) cancelAnimationFrame(anim);
  if (reducedMotion || ms === 0) { Object.assign(App.view, target); requestRender(); return; }
  const from = { ...App.view }, t0 = performance.now();
  const step = (now) => { const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3); App.view.x = from.x + (target.x - from.x) * e; App.view.y = from.y + (target.y - from.y) * e; App.view.k = from.k + (target.k - from.k) * e; requestRender(); if (p < 1) anim = requestAnimationFrame(step); else anim = null; };
  anim = requestAnimationFrame(step);
}
function fitAll(ms) { const b = App.lay.bbox; const r = App.canvas.getBoundingClientRect(); if (!b.w) { animateView({ x: r.width / 2, y: r.height / 3, k: 1 }, 0); return; }
  const k = Math.max(0.002, Math.min(1.5, Math.min((r.width - 40) / b.w, (r.height - 60) / b.h))); animateView({ k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k + 8 }, ms); }
function initialView() { const b = App.lay.bbox; const r = App.canvas.getBoundingClientRect(); if (!b.w) { fitAll(0); return; }
  const fit = Math.min((r.width - 40) / b.w, (r.height - 60) / b.h); const k = Math.max(0.04, Math.min(1.5, Math.max(fit, r.width < 700 ? 0.5 : 0.35)));
  if (k <= fit + 1e-6) { fitAll(0); return; } const first = App.st.persons[0] && App.lay.nodes.get(App.st.persons[0].id); const cx = first ? first.cx : b.x + b.w / 2; animateView({ k, x: r.width / 2 - cx * k, y: 40 - b.y * k }, 0); }
function centerOn(id, ms = 320, minK = 1) { const n = App.lay.nodes.get(id); if (!n) return; const r = App.canvas.getBoundingClientRect(); const k = Math.max(App.view.k, minK); animateView({ k, x: r.width / 2 - n.cx * k, y: r.height / 2 - n.cy * k }, ms); }

// --- hit testing ---------------------------------------------------------------------
function hitTest(px, py) {
  const p = toScene(px, py); const k = App.view.k; const pad = Math.max(0, (22 / k) - 10); // touch slack when zoomed out
  const sel = App.selected && App.lay.nodes.get(App.selected);
  if (sel && App.st.settings.showPlus !== false && k >= 0.55) { const cx = sel.x + sel.w + 3, cy = sel.y - 3; if (Math.hypot(p.x - cx, p.y - cy) <= Math.max(13, 22 / k)) return { id: sel.id, plus: true }; }
  for (const n of App.lay.nodes.values()) {
    if (p.x >= n.x - pad && p.x <= n.x + n.w + pad && p.y >= n.y - pad && p.y <= n.y + n.h + pad) return { id: n.id, plus: false };
  }
  return null;
}

// --- pointer interaction -----------------------------------------------------------------
function setupPointer() {
  const c = App.canvas; const pts = new Map(); let drag = null, pinch = null, moved = false, lastTap = 0;
  c.addEventListener('pointerdown', (e) => { try { c.setPointerCapture(e.pointerId); } catch (_) {} pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = false;
    if (pts.size === 1) drag = { x: e.offsetX, y: e.offsetY, vx: App.view.x, vy: App.view.y };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, k: App.view.k, vx: App.view.x, vy: App.view.y }; drag = null; }
    if (anim) { cancelAnimationFrame(anim); anim = null; } });
  c.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; const k = Math.max(0.002, Math.min(4, pinch.k * d / pinch.d)); const f = k / pinch.k;
      App.view.k = k; App.view.x = cx - (pinch.cx - pinch.vx) * f; App.view.y = cy - (pinch.cy - pinch.vy) * f; moved = true; requestRender(); return; }
    if (drag) { const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; if (Math.hypot(dx, dy) > 4) moved = true; if (moved) { App.view.x = drag.vx + dx; App.view.y = drag.vy + dy; requestRender(); } } });
  const up = (e) => { const had = pts.has(e.pointerId); pts.delete(e.pointerId);
    if (pinch && pts.size < 2) { pinch = null; drag = null; return; }
    if (had && drag && !moved && e.type === 'pointerup') { const h = hitTest(e.offsetX, e.offsetY); const now = performance.now();
      if (h && h.plus) openAdd(h.id); else if (h) { const dbl = h.id === App.selected && now - lastTap < 350; select(h.id); if (dbl) openEdit(h.id); } else select(null);
      lastTap = now; }
    if (pts.size === 0) drag = null; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', (e) => { e.preventDefault(); const f = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : Math.exp(-e.deltaY * 0.0015); zoomAt(e.offsetX, e.offsetY, f); }, { passive: false });
  c.addEventListener('keydown', onCanvasKey);
}
function onCanvasKey(e) {
  const nodes = App.lay.nodes; if (!nodes.size) return;
  const cur = nodes.get(App.focus || App.selected);
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[e.key]) { e.preventDefault(); if (!cur) { setFocus(nodes.keys().next().value); return; }
    const [dx, dy] = dirs[e.key]; let best = null, bd = Infinity;
    for (const n of nodes.values()) { if (n === cur) continue; const ex = n.cx - cur.cx, ey = n.cy - cur.cy; const along = ex * dx + ey * dy; if (along <= 0) continue; const perp = Math.abs(ex * dy) + Math.abs(ey * dx); const d = along + perp * 2.5; if (d < bd) { bd = d; best = n; } }
    if (best) setFocus(best.id); return; }
  if (e.key === 'Enter' && cur) { e.preventDefault(); openEdit(cur.id); }
  else if ((e.key === '+' || e.key === '=') && cur) { e.preventDefault(); openAdd(cur.id); }
  else if (e.key === 'Escape') { select(null); App.focus = null; requestRender(); }
  else if (e.key === ' ' && cur) { e.preventDefault(); select(cur.id); }
}
function setFocus(id) { App.focus = id; App.selected = id; const p = App.idx.byId.get(id); $('live').textContent = p ? fullName(p) : ''; const n = App.lay.nodes.get(id); const r = App.canvas.getBoundingClientRect();
  const sx = n.cx * App.view.k + App.view.x, sy = n.cy * App.view.k + App.view.y; if (sx < 60 || sy < 60 || sx > r.width - 60 || sy > r.height - 120) centerOn(id, 200, 0.6); updateChrome(); requestRender(); }
function select(id) { App.selected = id; updateChrome(); requestRender(); }

// --- chrome ------------------------------------------------------------------------
function updateChrome() {
  const n = App.st.persons.length; $('count').textContent = t('personCount', n); $('count').className = 'count'; $('empty').hidden = n > 0;
  $('btnUndo').disabled = !App.undo.length; $('btnRedo').disabled = !App.redo.length;
  const bar = $('cardBar'); const p = App.selected && App.idx.byId.get(App.selected);
  bar.hidden = !p; if (p) { $('cardBarName').textContent = fullName(p); const hasKids = (App.idx.unionsOf.get(p.id) || []).some(u => u.children.length); $('cbCollapse').hidden = !hasKids; $('cbCollapse').querySelector('span').textContent = p.collapsed ? t('expand') : t('collapse'); $('cbCollapse').setAttribute('aria-label', p.collapsed ? t('expand') : t('collapse')); }
  document.body.dataset.theme = App.st.settings.theme;
}
function positionCardBar() { const bar = $('cardBar'); if (bar.hidden) return; const n = App.lay.nodes.get(App.selected); if (!n) { bar.hidden = true; return; }
  const r = App.canvas.getBoundingClientRect(); const bw = bar.offsetWidth, bh = bar.offsetHeight; let x = n.cx * App.view.k + App.view.x - bw / 2, y = (n.y + n.h) * App.view.k + App.view.y + 10;
  if (y + bh > r.height - 40) y = n.y * App.view.k + App.view.y - bh - 10; x = Math.max(8, Math.min(r.width - bw - 8, x)); y = Math.max(8, y); bar.style.left = x + 'px'; bar.style.top = y + 'px'; }
let toastTimer; function toast(msg, isErr) { const el = $('toast'); el.textContent = msg; el.className = 'toast' + (isErr ? ' error' : ''); el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 6000 : 3000); }

// --- search ---------------------------------------------------------------------------
function searchPersons(q, limit = 12) { q = q.trim().toLowerCase(); if (!q) return []; const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); const nq = norm(q);
  const out = []; for (const p of App.st.persons) { const name = norm(fullName(p)); if (name.includes(nq)) { out.push(p); if (out.length >= limit) break; } } return out; }
function renderResults(ul, list, onPick) { ul.innerHTML = ''; ul.hidden = false;
  if (!list.length) { const li = document.createElement('li'); li.textContent = t('noResult'); ul.appendChild(li); return; }
  list.forEach((p, i) => { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.tabIndex = 0; li.innerHTML = `<span></span><small></small>`; li.firstChild.textContent = fullName(p); li.lastChild.textContent = [formatDate(p.birth), p.place].filter(Boolean).join(' · ');
    li.addEventListener('click', () => onPick(p)); li.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPick(p); }); ul.appendChild(li); }); }
function setupSearch() { const inp = $('search'), ul = $('searchResults');
  const pick = (p) => { ul.hidden = true; inp.value = fullName(p); select(p.id); App.focus = p.id; centerOn(p.id, 320, 1); };
  inp.addEventListener('input', () => { if (!inp.value.trim()) { ul.hidden = true; return; } renderResults(ul, searchPersons(inp.value), pick); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = searchPersons(inp.value, 1); if (r[0]) pick(r[0]); } else if (e.key === 'Escape') ul.hidden = true; else if (e.key === 'ArrowDown') { const f = ul.querySelector('li'); if (f) { f.focus(); e.preventDefault(); } } });
  document.addEventListener('pointerdown', (e) => { if (!$('searchBox').contains(e.target)) ul.hidden = true; }); }

// --- dialogs: helpers ---------------------------------------------------------------------
function openDialog(d) { if (!d.open) d.showModal(); }
function closeDialog(d) { if (d.open) d.close(); }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
function applyStrings() {
  const m = { appTitle: 'appTitle', emptyHint: 'emptyHint', btnFirst: 'firstPerson', btnExample2: 'example', btnOpen2: 'open', relLegend: 'relation', lblChild: 'relChild', hintChild: 'relChildHint', lblPartner: 'relPartner', hintPartner: 'relPartnerHint', lblParent: 'relParent', hintParent: 'relParentHint', lblSibling: 'relSibling', hintSibling: 'relSiblingHint', lblWith: 'withPartner', lblAdopted: 'adopted', sibNeed: 'siblingNeedsParent', parentFull: 'parentsFull', lblExisting: 'existingPerson', lblFirst: 'firstName', aMoreLbl: 'moreFields', lblLast: 'lastName', lblBirth: 'birth', lblDeath: 'death', lblPlace: 'place', aDateHint: 'dateHint', aCancel: 'cancel', aSave: 'saveAndClose', dlgEditTitle: 'editTitle', ePick: 'choosePhoto', eCam: 'takePhoto', eRemovePhoto: 'removePhoto', elblFirst: 'firstName', elblLast: 'lastName', elblBirth: 'birth', elblDeath: 'death', elblPlace: 'place', elblNotes: 'notes', eDateHint: 'dateHint', eDelete: 'delete', eCancel: 'cancel', eSave: 'saveAndClose', cCancel: 'cancel', cOk: 'delete', cropTitle: 'cropTitle', cropHint: 'cropHint', lblShape: 'photo', lblZoom: 'zoom', cropCancel: 'cancel', cropOk: 'ok', setTitle: 'settingsTitle', lblTheme: 'theme', lblModern: 'themeModern', lblVintage: 'themeVintage', lblFields: 'shownFields', lblSLast: 'showLastName', lblSDates: 'showDates', lblSPlace: 'showPlace', lblSPhoto: 'showPhoto', lblSPlus: 'showPlus', hiddenNote: 'hiddenFieldsNote', lblTitle: 'treeTitle', lblSubtitle: 'treeSubtitle', setClose: 'close', expTitle: 'exportTitle', lblFormat: 'format', lblPaper: 'paper', optCustom: 'custom', lblWmm: 'widthMm', lblHmm: 'heightMm', lblOrient: 'orientation', lblDpi: 'dpi', lblMargin: 'margins', lblIncTitle: 'includeTitle', lblXT: 'treeTitle', lblXS: 'treeSubtitle', xClose: 'close', xGo: 'download', helpTitle: 'helpTitle', helpClose: 'close', cbEdit: 'edit', cbAdd: 'add', cbCenter: 'center' };
  for (const id in m) { const el = $(id); if (!el) continue; const span = el.querySelector && el.querySelector('span'); (span || el).textContent = t(m[id]); }
  $('search').placeholder = t('search'); $('existingSearch').placeholder = t('pickPerson');
  $('cropShape').options[0].textContent = t('shapeCircle'); $('cropShape').options[1].textContent = t('shapeSquare');
  const o = $('xOrient').options; o[0].textContent = t('auto'); o[1].textContent = t('portrait'); o[2].textContent = t('landscape');
  $('aBirth').placeholder = $('aDeath').placeholder = $('eBirth').placeholder = $('eDeath').placeholder = t('datePlaceholder');
  $('helpBody').innerHTML = HELP_HTML; $('cbEdit').setAttribute('aria-label', t('edit')); $('cbAdd').setAttribute('aria-label', t('add')); $('cbCenter').setAttribute('aria-label', t('recenter'));
}
const HELP_HTML = `
<h3>Ajouter des membres</h3>
<p>Touchez une carte puis <b>Ajouter</b> (ou le bouton <b>+</b> sur la carte). Choisissez le lien : <b>enfant</b>, <b>partenaire</b>, <b>parent</b> ou <b>frère / sœur</b>. Seul le prénom est obligatoire ; <kbd>Entrée</kbd> enregistre et la vue se centre sur la nouvelle personne. Vous pouvez aussi <b>lier une personne déjà dans l’arbre</b> (par exemple marier deux personnes de deux branches).</p>
<h3>Familles recomposées</h3>
<ul><li>Une personne peut avoir plusieurs partenaires (successifs ou simultanés) : ajoutez un partenaire à chaque fois. Les enfants de chaque union sont regroupés sous le trait de <i>cette</i> union.</li>
<li>Pour un enfant d’un parent seul, choisissez « Parent seul » dans la liste des partenaires.</li>
<li>Demi-frères et demi-sœurs : « Frère / sœur » puis « même parent X » ; l’autre parent peut être ajouté ensuite.</li>
<li>Les enfants adoptés sont reliés par un trait pointillé. Les beaux-parents et beaux-enfants apparaissent naturellement : l’enfant est sous l’union de ses parents, à côté du nouveau partenaire.</li>
<li>Les liens impossibles (une personne ancêtre d’elle-même) sont refusés.</li></ul>
<h3>Naviguer</h3>
<p>Glissez pour déplacer, pincez ou utilisez la molette pour zoomer. Recherchez un nom en haut pour aller directement sur une personne. <b>Réduire la branche</b> masque les descendants d’une personne. Au clavier : flèches, <kbd>Entrée</kbd>, <kbd>+</kbd>, <kbd>Échap</kbd>, <kbd>Ctrl</kbd>+<kbd>Z</kbd> pour annuler.</p>
<h3>Enregistrer</h3>
<p>Le fichier <b>JSON</b> (« Enregistrer ») est la vraie sauvegarde : il contient tout, photos comprises, et se rouvre avec « Ouvrir ». Un brouillon est aussi gardé automatiquement dans ce navigateur.</p>
<h3>Exporter pour imprimer</h3>
<p>« Exporter » produit une image <b>PNG</b> haute résolution, un <b>PDF</b> ou un <b>SVG</b> vectoriel, l’arbre entier sur une seule feuille (A4 à A0 ou taille personnalisée). Les photos sont intégrées en pleine résolution et le texte reste net. Si une résolution dépasse les capacités du navigateur, elle est plafonnée et indiquée ; le PDF et le SVG n’ont pas de limite.</p>`;

// --- add relative dialog ---------------------------------------------------------------------
let addCtx = null;
function openAdd(pid, preset) {
  const p = App.idx.byId.get(pid); if (!p) return; addCtx = { pid };
  const d = $('dlgAdd'); $('dlgAddTitle').textContent = t('addTitle', fullName(p));
  $('formAdd').reset(); $('aErr').hidden = true; $('existingId').value = ''; $('existingResults').innerHTML = ''; $('aMore').open = false;
  // union select
  const sel = $('selUnion'); sel.innerHTML = '';
  for (const u of App.idx.unionsOf.get(pid) || []) if (u.partners.length === 2) { const o = document.createElement('option'); o.value = u.id; o.textContent = fullName(App.idx.byId.get(u.partners.find(x => x !== pid))); sel.appendChild(o); }
  const so = document.createElement('option'); so.value = ''; so.textContent = t('singleParent'); sel.appendChild(so);
  // sibling choices
  const pu = App.idx.parentUnionOf.get(pid); const sc = $('sibChoices'); sc.innerHTML = ''; $('sibNeed').hidden = !!pu;
  if (pu) { const mk = (val, label) => { const l = document.createElement('label'); l.className = 'chk'; l.innerHTML = `<input type="radio" name="sib"><span></span>`; l.firstChild.value = val; l.lastChild.textContent = label; sc.appendChild(l); return l.firstChild; };
    if (pu.partners.length === 2) mk('full:' + pu.id, t('siblingFull')).checked = true; for (const par of pu.partners) { const r = mk('half:' + par, t('siblingHalf', fullName(App.idx.byId.get(par)))); if (pu.partners.length === 1) r.checked = true; } }
  const full = pu && pu.partners.length >= 2; $('parentFull').hidden = true; d.querySelector('input[value=parent]').disabled = !!full; d.querySelector('input[value=sibling]').disabled = !pu;
  if (preset) { const r = d.querySelector(`input[name=rel][value=${preset}]`); if (r && !r.disabled) r.checked = true; }
  updateAddForm(); openDialog(d); setTimeout(() => $('aFirst').focus(), 50);
}
function updateAddForm() { const rel = $('formAdd').rel.value; $('optChild').style.display = rel === 'child' ? '' : 'none'; $('optSibling').style.display = rel === 'sibling' ? '' : 'none';
  const ex = $('chkExisting').checked; $('existingBox').hidden = !ex; $('newBox').hidden = ex; }
function readPersonFields(prefix) { const g = (n) => $(prefix + n).value; const birth = parseDateInput(g('Birth')), death = parseDateInput(g('Death'));
  if (birth === null || death === null) throw new Error(t('invalidDate')); const first = g('First').trim(); if (!first) throw new Error(t('required'));
  return { first, last: g('Last'), birth, death, place: g('Place') }; }
function submitAdd(e) { e.preventDefault(); const f = $('formAdd'); const rel = f.rel.value; const pid = addCtx.pid; const err = $('aErr'); err.hidden = true;
  let newId = null;
  try {
    const existing = $('chkExisting').checked ? $('existingId').value : null;
    if ($('chkExisting').checked && !existing) throw new Error(t('errUnknown'));
    const fields = existing ? null : readPersonFields('a');
    commit((st, idx) => {
      const other = existing || newPerson(st, fields, idx).id; if (!existing) newId = other;
      if (rel === 'partner') addPartner(st, idx, pid, other);
      else if (rel === 'child') { const uid_ = $('selUnion').value; const u = uid_ ? idx.unionById.get(uid_) : null; addChildTo(st, idx, u, pid, other, $('chkAdopted').checked); }
      else if (rel === 'parent') addParentTo(st, idx, pid, other);
      else if (rel === 'sibling') { const sib = f.sib && (f.sib.value || [...f.querySelectorAll('input[name=sib]')].find(r => r.checked)?.value); if (!sib) throw new Error(t('siblingNeedsParent'));
        const [kind, ref] = sib.split(':'); if (kind === 'full') addChildTo(st, idx, idx.unionById.get(ref), null, other, false); else addChildTo(st, idx, null, ref, other, false); }
    });
  } catch (ex) { err.textContent = ex.message; err.hidden = false; return; }
  closeDialog($('dlgAdd')); const target = newId || $('existingId').value; select(target); App.focus = target; centerOn(target, 320, 1); App.canvas.focus({ preventScroll: true });
}
function setupAdd() { const f = $('formAdd'); f.addEventListener('submit', submitAdd); f.addEventListener('change', updateAddForm); $('aCancel').addEventListener('click', () => closeDialog($('dlgAdd')));
  const es = $('existingSearch'), er = $('existingResults');
  es.addEventListener('input', () => { renderResults(er, searchPersons(es.value).filter(p => p.id !== addCtx.pid), (p) => { $('existingId').value = p.id; es.value = fullName(p); er.hidden = true; $('aSave').focus(); }); });
  es.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const r = searchPersons(es.value, 2).filter(p => p.id !== addCtx.pid); if (r[0]) { $('existingId').value = r[0].id; es.value = fullName(r[0]); er.hidden = true; } } }); }

// --- edit dialog ----------------------------------------------------------------------------------
let editCtx = null;
function openEdit(pid) { const p = App.idx.byId.get(pid); if (!p) return; editCtx = { pid, photo: p.photo, photoShape: p.photoShape, newPhotoData: null, removed: false };
  $('eFirst').value = p.first; $('eLast').value = p.last; $('eBirth').value = dateToInput(p.birth); $('eDeath').value = dateToInput(p.death); $('ePlace').value = p.place; $('eNotes').value = p.notes || ''; $('eErr').hidden = true;
  updatePhotoPreview(); renderLinks(p); openDialog($('dlgEdit')); setTimeout(() => $('eFirst').focus(), 50); }
function updatePhotoPreview() { const el = $('ePhoto'); const src = editCtx.newPhotoData || (editCtx.photo && !editCtx.removed ? App.st.photos[editCtx.photo] : null); el.style.backgroundImage = src ? `url(${src})` : ''; el.className = 'photoPreview' + (editCtx.photoShape === 'square' ? ' square' : ''); $('eRemovePhoto').hidden = !src; }
function renderLinks(p) { const box = $('eLinks'); box.innerHTML = ''; const idx = App.idx;
  const pu = idx.parentUnionOf.get(p.id); if (pu) { const row = document.createElement('div'); row.className = 'lk'; row.innerHTML = `<span></span><button type="button" class="btn"></button>`; row.firstChild.textContent = t('parents') + ' : ' + pu.partners.map(id => fullName(idx.byId.get(id))).join(' & '); row.lastChild.textContent = t('unlinkParents');
    row.lastChild.addEventListener('click', () => { commit((st) => unlinkChild(st, p.id)); renderLinks(p); }); box.appendChild(row); }
  for (const u of idx.unionsOf.get(p.id) || []) { if (u.partners.length < 2) continue; const other = idx.byId.get(u.partners.find(x => x !== p.id)); const row = document.createElement('div'); row.className = 'lk'; row.innerHTML = `<span></span><button type="button" class="btn"></button>`;
    row.firstChild.textContent = t('unions') + ' : ' + fullName(other) + (u.children.length ? ` (${u.children.length})` : ''); row.lastChild.textContent = t('unlinkUnion');
    row.lastChild.addEventListener('click', () => { commit((st) => { const uu = st.unions.find(x => x.id === u.id); uu.partners = uu.partners.filter(x => x !== p.id); if (!uu.children.length) st.unions = st.unions.filter(x => x !== uu); }); renderLinks(p); }); box.appendChild(row); } }
function submitEdit(e) { e.preventDefault(); const err = $('eErr'); err.hidden = true; let fields; try { fields = readPersonFields('e'); } catch (ex) { err.textContent = ex.message; err.hidden = false; return; }
  const pid = editCtx.pid; commit((st) => { const p = st.persons.find(x => x.id === pid); Object.assign(p, fields, { notes: $('eNotes').value.trim(), photoShape: editCtx.photoShape });
    if (editCtx.newPhotoData) { const id = uid(); st.photos[id] = editCtx.newPhotoData; p.photo = id; } else if (editCtx.removed) p.photo = null; });
  closeDialog($('dlgEdit')); App.canvas.focus({ preventScroll: true }); }
function confirmDelete(pid) { const p = App.idx.byId.get(pid); const unions = (App.idx.unionsOf.get(pid) || []).filter(u => u.partners.length === 2).length; const kids = childrenOf(App.idx, pid).length;
  $('confirmTitle').textContent = t('deleteConfirmTitle', fullName(p)); $('confirmText').textContent = t('deleteExplain') + ' ' + t('deleteLinks', unions, kids);
  const d = $('dlgConfirm'); openDialog(d); $('cOk').onclick = () => { closeDialog(d); closeDialog($('dlgEdit')); commit((st) => removePerson(st, pid)); select(null); }; $('cCancel').onclick = () => closeDialog(d); }
function setupEdit() { $('formEdit').addEventListener('submit', submitEdit); $('eCancel').addEventListener('click', () => closeDialog($('dlgEdit'))); $('eDelete').addEventListener('click', () => confirmDelete(editCtx.pid));
  $('ePick').addEventListener('click', () => $('filePhoto').click()); $('eCam').addEventListener('click', () => $('filePhotoCam').click()); $('eRemovePhoto').addEventListener('click', () => { editCtx.removed = true; editCtx.newPhotoData = null; updatePhotoPreview(); });
  const onFile = async (inp) => { const f = inp.files[0]; inp.value = ''; if (!f) return; try { const data = await cropPhoto(f, editCtx.photoShape); if (data) { editCtx.newPhotoData = data.url; editCtx.photoShape = data.shape; editCtx.removed = false; updatePhotoPreview(); } } catch (e) { toast(t('photoTooBig'), true); } };
  $('filePhoto').addEventListener('change', () => onFile($('filePhoto'))); $('filePhotoCam').addEventListener('change', () => onFile($('filePhotoCam')));
  if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) $('eCam').hidden = true; }

// --- photo crop ---------------------------------------------------------------------------------------
async function loadImageFile(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ } }
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
}
function cropPhoto(file, shape) { return new Promise(async (resolve) => {
  const img = await loadImageFile(file); const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight; if (!iw || !ih) throw new Error('bad');
  const d = $('dlgCrop'), cv = $('cropCanvas'), g = cv.getContext('2d'); const S = 280; const base = S / Math.min(iw, ih); let zoom = 1, ox = 0, oy = 0; $('cropZoom').value = 1; $('cropShape').value = shape || 'circle';
  const draw = () => { const z = base * zoom; const w = iw * z, h = ih * z; ox = Math.max(Math.min(ox, 0), S - w); oy = Math.max(Math.min(oy, 0), S - h); g.fillStyle = '#222'; g.fillRect(0, 0, S, S); g.drawImage(img, ox, oy, w, h);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.rect(0, 0, S, S); if ($('cropShape').value === 'square') g.roundRect(6, 6, S - 12, S - 12, 8); else g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2, true); g.fill('evenodd'); };
  ox = (S - iw * base) / 2; oy = (S - ih * base) / 2; draw();
  const pts = new Map(); let last = null, pinch0 = null;
  const onDown = (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) {} pts.set(e.pointerId, [e.offsetX, e.offsetY]); if (pts.size === 1) last = [e.offsetX, e.offsetY]; else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom }; } };
  const onMove = (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; setZoom(pinch0.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0.d, S / 2, S / 2); return; }
    if (last) { ox += e.offsetX - last[0]; oy += e.offsetY - last[1]; last = [e.offsetX, e.offsetY]; draw(); } };
  const onUp = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; if (!pts.size) last = null; else last = [...pts.values()][0]; };
  const setZoom = (z, cx, cy) => { z = Math.max(1, Math.min(4, z)); const f = (base * z) / (base * zoom); ox = cx - (cx - ox) * f; oy = cy - (cy - oy) * f; zoom = z; $('cropZoom').value = z; draw(); };
  const onWheel = (e) => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.002), e.offsetX, e.offsetY); };
  const onRange = () => setZoom(parseFloat($('cropZoom').value), S / 2, S / 2); const onShape = () => draw();
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp); cv.addEventListener('wheel', onWheel, { passive: false }); $('cropZoom').addEventListener('input', onRange); $('cropShape').addEventListener('change', onShape);
  const cleanup = () => { cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp); cv.removeEventListener('wheel', onWheel); $('cropZoom').removeEventListener('input', onRange); $('cropShape').removeEventListener('change', onShape); closeDialog(d); };
  $('cropCancel').onclick = () => { cleanup(); resolve(null); };
  $('cropOk').onclick = () => { const OUT = 600; const c = document.createElement('canvas'); c.width = OUT; c.height = OUT; const cg = c.getContext('2d'); const sc = OUT / S; cg.fillStyle = '#fff'; cg.fillRect(0, 0, OUT, OUT); cg.drawImage(img, ox * sc, oy * sc, iw * base * zoom * sc, ih * base * zoom * sc);
    const url = c.toDataURL('image/jpeg', 0.85); const sh = $('cropShape').value; cleanup(); resolve({ url, shape: sh }); };
  d.addEventListener('cancel', () => { cleanup(); resolve(null); }, { once: true });
  openDialog(d);
}); }

// --- settings --------------------------------------------------------------------------------------------
function openSettings() { const s = App.st.settings; const f = $('formSettings'); f.theme.value = s.theme; $('sLast').checked = s.showLastName; $('sDates').checked = s.showDates; $('sPlace').checked = s.showPlace; $('sPhoto').checked = s.showPhoto; $('sPlus').checked = s.showPlus !== false; $('sTitle').value = s.title || ''; $('sSubtitle').value = s.subtitle || ''; openDialog($('dlgSettings')); }
function setupSettings() { const f = $('formSettings'); f.addEventListener('submit', (e) => { e.preventDefault(); closeDialog($('dlgSettings')); });
  f.addEventListener('change', () => { commit((st) => { Object.assign(st.settings, { theme: f.theme.value, showLastName: $('sLast').checked, showDates: $('sDates').checked, showPlace: $('sPlace').checked, showPhoto: $('sPhoto').checked, showPlus: $('sPlus').checked, title: $('sTitle').value.trim(), subtitle: $('sSubtitle').value.trim() }); }); });
  $('setClose').addEventListener('click', () => closeDialog($('dlgSettings'))); }

// --- export ----------------------------------------------------------------------------------------------
function exportOpts() { const f = $('formExport'); return { format: f.fmt.value, paper: $('xPaper').value, customW: +$('xW').value, customH: +$('xH').value, orientation: $('xOrient').value, dpi: +$('xDpi').value, margin: +$('xMargin').value, withTitle: $('xTitle').checked, title: $('xTitleText').value.trim(), subtitle: $('xSubText').value.trim(), theme: App.st.settings.theme }; }
function updateExportPreview() {
  const o = exportOpts(); $('customSize').hidden = o.paper !== 'custom'; const page = computePage(App.lay, o); App.exportPage = page;
  const cv = $('prevCanvas'); const maxW = Math.min(380, window.innerWidth - 80), maxH = 420; const s = Math.min(maxW / page.w, maxH / page.h); const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(page.w * s * dpr); cv.height = Math.round(page.h * s * dpr); cv.style.width = Math.round(page.w * s) + 'px'; cv.style.height = Math.round(page.h * s) + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0); renderPageTo(ctx, page, App.lay, App.st, App.idx, App.st.settings, null);
  const info = []; info.push(`${page.wmm} × ${page.hmm} mm`); if (o.format === 'png') info.push(t('effective', page.pxW, page.pxH, page.dpi)); else info.push(t('vectorNote'));
  info.push(t('cardScale', Math.round(page.k * 100))); $('expInfo').textContent = info.join(' · ');
  const warns = []; if (o.format === 'png' && page.capped) warns.push(t('capped', page.reqDpi, page.dpi)); if (page.cardMm < 22) warns.push(t('tooSmallWarning')); if (o.format === 'png' && typeof CompressionStream === 'undefined') warns.push(t('noCompression'));
  $('expWarn').hidden = !warns.length; $('expWarn').textContent = warns.join(' ');
  $('xGo').textContent = navigator.maxTouchPoints > 1 && navigator.canShare ? t('share') : t('download');
}
function openExport() { $('xTitleText').value = App.st.settings.title || ''; $('xSubText').value = App.st.settings.subtitle || ''; openDialog($('dlgExport')); updateExportPreview(); }
async function runExport(e) { e.preventDefault(); const o = exportOpts(); const page = computePage(App.lay, o); const btn = $('xGo'); btn.disabled = true; const prog = $('expProg'); prog.hidden = o.format !== 'png'; prog.value = 0; toast(t('exporting'));
  try { const t0 = performance.now(); const res = await exportTree(o.format, page, App.lay, App.st, App.idx, App.st.settings, (p) => { prog.value = p; }); App.lastExportMs = performance.now() - t0; App.lastExport = res; const how = await saveBlob(res.blob, res.name); if (how !== 'cancel') toast(t('exportDone')); }
  catch (ex) { console.error(ex); toast(String(ex.message || ex), true); } finally { btn.disabled = false; prog.hidden = true; } }
function setupExport() { const f = $('formExport'); f.addEventListener('submit', runExport); f.addEventListener('input', updateExportPreview); f.addEventListener('change', updateExportPreview); $('xClose').addEventListener('click', () => closeDialog($('dlgExport'))); }

// --- file open/save ----------------------------------------------------------------------------------------
function saveJSON() { const blob = new Blob([toJSON(App.st)], { type: 'application/json' }); const name = (App.st.settings.title || 'arbre-familial').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) + '.json'; saveBlob(blob, name).then(h => { if (h !== 'cancel') toast(t('saved')); }); }
function openJSONFile(file) { const r = new FileReader(); r.onload = () => { try { const st = fromJSON(r.result); const apply = () => { App.undo.push(snapshot()); App.st.persons = st.persons; App.st.unions = st.unions; App.st.photos = st.photos; App.st.settings = st.settings; App.st.seq = st.seq; App.selected = null; App.focus = null; photoCache.clear(); App.redo.length = 0; afterChange(); initialView(); toast(t('importOk', st.persons.length)); };
    if (App.st.persons.length && !confirm(t('replaceConfirm'))) return; apply(); } catch (e) { toast(e.message, true); } }; r.readAsText(file); }

// --- example photos (generated avatars so the demo exercises the photo pipeline) ----------------------------
function avatarDataUrl(initials, hue) { const c = document.createElement('canvas'); c.width = c.height = 300; const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 300, 300); grad.addColorStop(0, `hsl(${hue} 55% 72%)`); grad.addColorStop(1, `hsl(${hue + 40} 55% 48%)`); g.fillStyle = grad; g.fillRect(0, 0, 300, 300);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(150, 118, 58, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(150, 300, 110, Math.PI, 0); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 110px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials, 150, 160); return c.toDataURL('image/jpeg', 0.85); }
function loadExample() { const st = exampleTree(emptyState()); st.persons.slice(0, 8).forEach((p, i) => { const id = uid(); st.photos[id] = avatarDataUrl((p.first[0] || '') + (p.last[0] || ''), (i * 47) % 360); p.photo = id; p.photoShape = i % 3 === 2 ? 'square' : 'circle'; });
  setState(st); initialView(); toast(t('exampleLoaded')); }

// --- init -----------------------------------------------------------------------------------------------------
function init() {
  App.canvas = $('tree'); App.ctx = App.canvas.getContext('2d'); onPhotoReady = requestRender;
  applyStrings(); setupPointer(); setupSearch(); setupAdd(); setupEdit(); setupSettings(); setupExport();
  const restored = loadDraft(); reindex(); updateChrome(); resizeCanvas(); initialView();
  if (restored) toast(t('draftRestored'));
  $('autosave').textContent = t('autosaveNotice');
  new ResizeObserver(resizeCanvas).observe(App.canvas); window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
  const firstPerson = () => { let id; commit((st) => { id = newPerson(st, { first: '' }).id; }); App.undo.pop(); openEdit(id); $('eCancel').onclick = null; };
  $('btnFirst').addEventListener('click', () => { closeDialog($('dlgEdit')); const d = $('dlgEdit'); let id; commit((st) => { id = newPerson(st, { first: '?' }).id; });
    openEdit(id); $('eFirst').value = ''; const onClose = () => { d.removeEventListener('close', onClose); const p = App.idx.byId.get(id); if (p && p.first === '?') { doUndo(); App.redo.length = 0; } }; d.addEventListener('close', onClose); });
  $('btnExample').addEventListener('click', () => { if (!App.st.persons.length || confirm(t('replaceConfirm'))) loadExample(); $('moreMenu').hidden = true; });
  $('btnExample2').addEventListener('click', loadExample);
  $('btnNew').addEventListener('click', () => { $('moreMenu').hidden = true; if (!App.st.persons.length || confirm(t('newTreeConfirm'))) { commit((st) => { st.persons = []; st.unions = []; st.photos = {}; }); select(null); } });
  $('btnFitMenu').addEventListener('click', () => { $('moreMenu').hidden = true; fitAll(320); });
  $('btnMore').addEventListener('click', (e) => { const m = $('moreMenu'); m.hidden = !m.hidden; $('btnMore').setAttribute('aria-expanded', String(!m.hidden)); e.stopPropagation(); });
  document.addEventListener('click', (e) => { if (!$('moreMenu').contains(e.target) && e.target !== $('btnMore')) $('moreMenu').hidden = true; });
  $('btnOpen').addEventListener('click', () => $('fileJson').click()); $('btnOpen2').addEventListener('click', () => $('fileJson').click());
  const menuAlias = { mOpen: () => $('fileJson').click(), mSave: saveJSON, mRedo: doRedo, mSettings: openSettings, mHelp: () => openDialog($('dlgHelp')) };
  for (const id in menuAlias) $(id).addEventListener('click', () => { $('moreMenu').hidden = true; menuAlias[id](); });
  $('fileJson').addEventListener('change', () => { const f = $('fileJson').files[0]; $('fileJson').value = ''; if (f) openJSONFile(f); });
  $('btnSave').addEventListener('click', saveJSON); $('btnExport').addEventListener('click', openExport); $('btnSettings').addEventListener('click', openSettings); $('btnHelp').addEventListener('click', () => openDialog($('dlgHelp'))); $('helpClose').addEventListener('click', () => closeDialog($('dlgHelp')));
  $('btnUndo').addEventListener('click', doUndo); $('btnRedo').addEventListener('click', doRedo);
  $('zIn').addEventListener('click', () => { const r = App.canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.4); }); $('zOut').addEventListener('click', () => { const r = App.canvas.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.4); }); $('zFit').addEventListener('click', () => fitAll(320));
  $('cbEdit').addEventListener('click', () => openEdit(App.selected)); $('cbAdd').addEventListener('click', () => openAdd(App.selected)); $('cbCenter').addEventListener('click', () => centerOn(App.selected, 320, 1)); $('cbClose').addEventListener('click', () => select(null));
  $('cbCollapse').addEventListener('click', () => { const id = App.selected; commit((st) => { const p = st.persons.find(x => x.id === id); p.collapsed = !p.collapsed; if (!p.collapsed) delete p.collapsed; }); });
  document.addEventListener('keydown', (e) => { const tag = (e.target.tagName || '').toLowerCase(); const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); doUndo(); } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !typing) { e.preventDefault(); doRedo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveJSON(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !typing) { e.preventDefault(); $('search').focus(); } });
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $('empty').hidden = App.st.persons.length > 0;
}
document.addEventListener('DOMContentLoaded', init);

// Test / automation API (not used by the UI)
window.FT = {
  app: App, t, state: () => App.st, layout: () => App.lay, index: () => App.idx, toJSON: () => toJSON(App.st), loadJSON: (s) => { setState(fromJSON(s)); fitAll(0); }, loadExample, generate: (n, seed) => { setState(generateTree(emptyState(), n, seed)); fitAll(0); },
  commit, addPartner: (pid, f) => { let id; commit((st, idx) => { id = newPerson(st, f, idx).id; addPartner(st, idx, pid, id); }); return id; },
  addChild: (pid, uidOrNull, f, adopted) => { let id; commit((st, idx) => { id = newPerson(st, f, idx).id; addChildTo(st, idx, uidOrNull ? idx.unionById.get(uidOrNull) : null, pid, id, !!adopted); }); return id; },
  addParent: (pid, f) => { let id; commit((st, idx) => { id = newPerson(st, f, idx).id; addParentTo(st, idx, pid, id); }); return id; },
  linkPartners: (a, b) => commit((st, idx) => addPartner(st, idx, a, b)), linkChild: (uid_, pid, c) => commit((st, idx) => addChildTo(st, idx, uid_ ? idx.unionById.get(uid_) : null, pid, c, false)), linkParent: (c, p) => commit((st, idx) => addParentTo(st, idx, c, p)),
  update: (pid, f) => commit((st) => Object.assign(st.persons.find(p => p.id === pid), f)), remove: (pid) => commit((st) => removePerson(st, pid)), undo: doUndo, redo: doRedo,
  select, centerOn, fitAll, setView: (v) => { Object.assign(App.view, v); requestRender(); }, getView: () => ({ ...App.view }), render, frameTimes: () => App.frameTimes.slice(), layoutMs: () => App.layoutMs,
  openAdd, openEdit, openExport, openSettings, computePage, exportTree: (fmt, o) => { const page = computePage(App.lay, { theme: App.st.settings.theme, withTitle: true, title: App.st.settings.title, subtitle: App.st.settings.subtitle, orientation: 'auto', dpi: 300, margin: 10, paper: 'A1', ...o }); return exportTree(fmt, page, App.lay, App.st, App.idx, App.st.settings).then(r => ({ ...r, page })); },
  setTheme: (th) => commit((st) => { st.settings.theme = th; }), lastExportMs: () => App.lastExportMs, hitTest, THEMES, LY,
};
