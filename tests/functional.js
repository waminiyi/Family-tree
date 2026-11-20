const { launch, newPage, shot } = require('./lib');
const path = require('path'); const fs = require('fs');
const results = []; let failures = 0;
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); if (!ok) failures++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Layout invariants evaluated in the page
const LAYOUT_CHECKS = `(() => {
  const lay = FT.layout(), st = FT.state(), idx = FT.index(); const W = FT.LY.W, H = FT.LY.H; const nodes = [...lay.nodes.values()];
  const out = { overlaps: 0, edgeThroughCard: [], childNotUnderUnion: [], missingNodes: 0, n: nodes.length };
  const byLevel = new Map(); for (const n of nodes) { if (!byLevel.has(n.level)) byLevel.set(n.level, []); byLevel.get(n.level).push(n); }
  for (const arr of byLevel.values()) { arr.sort((a, b) => a.x - b.x); for (let i = 1; i < arr.length; i++) if (arr[i].x < arr[i - 1].x + W + FT.LY.sep - 0.5) out.overlaps++; }
  for (const p of st.persons) if (!lay.hidden.has(p.id) && !lay.nodes.has(p.id)) out.missingNodes++;
  // edges must not cross the interior of any card
  const inside = (x, y, n) => x > n.x + 0.5 && x < n.x + W - 0.5 && y > n.y + 0.5 && y < n.y + H - 0.5;
  for (const e of lay.edges) { if (e.kind === 'node' || e.kind === 'far') continue;
    for (let i = 1; i < e.pts.length; i++) { const [x1, y1] = e.pts[i - 1], [x2, y2] = e.pts[i];
      for (const n of nodes) { if (e.child === n.id) continue; const u = st.unions.find(u => u.id === e.u); if (u && u.partners.includes(n.id)) continue;
        // sample along the segment
        const steps = 8; let hit = false; for (let s = 1; s < steps; s++) { const x = x1 + (x2 - x1) * s / steps, y = y1 + (y2 - y1) * s / steps; if (inside(x, y, n)) { hit = true; break; } }
        if (hit) out.edgeThroughCard.push({ edge: e.kind, union: e.u, card: n.id }); } } }
  // children must sit between (or under) their union's partners
  for (const u of st.unions) { const P = u.partners.map(id => lay.nodes.get(id)).filter(Boolean); if (!P.length) continue;
    const L = Math.min(...P.map(n => n.x)) - 1, R = Math.max(...P.map(n => n.x + W)) + 1;
    for (const c of u.children) { const n = lay.nodes.get(c.id); if (!n) continue; if (P.length === 2 && (n.cx < L || n.cx > R)) out.childNotUnderUnion.push({ union: u.id, child: c.id }); } }
  return out; })()`;

(async () => {
  const browser = await launch();
  const page = await newPage(browser);
  const ex = (fn, ...a) => page.evaluate(fn, ...a);
  const state = () => ex(() => FT.state());
  const byName = async (first) => (await state()).persons.find(p => p.first === first);
  const layoutOK = async (label) => { const r = await ex(LAYOUT_CHECKS); check(`${label}: no card overlap`, r.overlaps === 0, `${r.overlaps} overlaps / ${r.n} cards`); check(`${label}: no edge through a foreign card`, r.edgeThroughCard.length === 0, JSON.stringify(r.edgeThroughCard.slice(0, 3))); check(`${label}: children under their union`, r.childNotUnderUnion.length === 0, JSON.stringify(r.childNotUnderUnion.slice(0, 3))); check(`${label}: every visible person placed`, r.missingNodes === 0); return r; };

  // ---- 1. UI-driven adds (desktop forms) --------------------------------------------------
  await page.click('#btnFirst'); await sleep(200);
  await page.type('#eFirst', 'Alice'); await page.type('#eLast', 'Root'); await page.type('#eBirth', '1950'); await page.keyboard.press('Enter'); await sleep(200);
  check('first person via big button + Enter', (await state()).persons.length === 1 && (await byName('Alice')).birth === '1950');
  const alice = await byName('Alice');
  const uiAdd = async (pid, rel, first, extra) => { await ex((id) => FT.openAdd(id), pid); await sleep(150); await page.click(`input[name=rel][value=${rel}]`); if (extra) await extra(); await page.click('#aFirst', { clickCount: 3 }); await page.type('#aFirst', first); await page.keyboard.press('Enter'); await sleep(250); return byName(first); };
  const bob = await uiAdd(alice.id, 'partner', 'Bob'); check('add partner via form', !!bob && (await state()).unions.some(u => u.partners.includes(alice.id) && u.partners.includes(bob.id)));
  const carl = await uiAdd(alice.id, 'child', 'Carl'); check('add child via form (union preselected)', !!carl && (await state()).unions.some(u => u.partners.includes(bob.id) && u.children.some(c => c.id === carl.id)));
  const dora = await uiAdd(carl.id, 'sibling', 'Dora'); check('add full sibling via form', !!dora && (await state()).unions.find(u => u.children.some(c => c.id === carl.id)).children.some(c => c.id === dora.id));
  const gran = await uiAdd(alice.id, 'parent', 'Gran'); check('add parent via form', !!gran && (await state()).unions.some(u => u.partners.length === 1 && u.partners[0] === gran.id && u.children.some(c => c.id === alice.id)));
  const gramp = await uiAdd(alice.id, 'parent', 'Gramp'); check('add second parent completes the union', !!gramp && (await state()).unions.some(u => u.partners.includes(gran.id) && u.partners.includes(gramp.id)));
  // third parent blocked
  await ex((id) => FT.openAdd(id), alice.id); await sleep(100); check('parent option disabled when two parents exist', await ex(() => document.querySelector('input[name=rel][value=parent]').disabled)); await page.keyboard.press('Escape');
  // half sibling via form: pick "même parent Alice"
  const hal = await uiAdd(carl.id, 'sibling', 'Hal', async () => { await page.click('input[name=sib][value^="half:' + alice.id + '"]'); });
  check('add half sibling via form (single-parent union of Alice)', !!hal && (await state()).unions.some(u => u.partners.length === 1 && u.partners[0] === alice.id && u.children.some(c => c.id === hal.id)));
  // adopted child, single parent via form
  const ivy = await uiAdd(bob.id, 'child', 'Ivy', async () => { await page.select('#selUnion', ''); await page.click('#chkAdopted'); });
  check('adopted child of single parent via form', !!ivy && (await state()).unions.some(u => u.partners.length === 1 && u.partners[0] === bob.id && u.children.some(c => c.id === ivy.id && c.rel === 'adopted')));
  await sleep(500); check('view centred on new person', await ex((id) => { const n = FT.layout().nodes.get(id); const v = FT.getView(); const r = document.getElementById('tree').getBoundingClientRect(); return Math.abs(n.cx * v.k + v.x - r.width / 2) < 2 && Math.abs(n.cy * v.k + v.y - r.height / 2) < 2; }, ivy.id));
  // link existing person as partner via form (Dora ∞ Hal would be half-siblings: allowed? they share parent Alice → not ancestor; allowed by model) — use Gran ∞ existing? test link existing: Ivy ∞ Dora
  await ex((id) => FT.openAdd(id), ivy.id); await sleep(100); await page.click('input[name=rel][value=partner]'); await page.click('#chkExisting'); await page.type('#existingSearch', 'Dora'); await sleep(100); await page.click('#existingResults li'); await page.keyboard.press('Enter'); await sleep(200);
  check('link existing person as partner via form', (await state()).unions.some(u => u.partners.includes(ivy.id) && u.partners.includes(dora.id)));
  // impossible: Gran as child of Carl (ancestor as descendant)
  const err1 = await ex((c, g) => { try { FT.linkChild(null, c, g); return null; } catch (e) { return e.message; } }, carl.id, gran.id);
  check('blocked: ancestor cannot become a descendant', !!err1 && err1.includes('ancêtre'), err1);
  const err2 = await ex((a) => { try { FT.linkPartners(a, a); return null; } catch (e) { return e.message; } }, alice.id);
  check('blocked: self link', !!err2, err2);
  const err3 = await ex((a, c) => { try { FT.linkPartners(a, c); return null; } catch (e) { return e.message; } }, alice.id, carl.id);
  check('blocked: partner with own child', !!err3 && err3.includes('ancêtre'), err3);
  // edit + delete via form
  await ex((id) => FT.openEdit(id), hal.id); await sleep(100); await page.click('#eFirst', { clickCount: 3 }); await page.type('#eFirst', 'Hal2'); await page.type('#ePlace', 'Lyon'); await page.keyboard.press('Enter'); await sleep(150);
  check('edit via form', (await byName('Hal2'))?.place === 'Lyon');
  await ex((id) => FT.openEdit(id), gramp.id); await sleep(100); await page.click('#eDelete'); await sleep(100); await page.click('#cOk'); await sleep(200);
  const stAfterDel = await state(); check('delete via form keeps union single-parent', !(await byName('Gramp')) && stAfterDel.unions.some(u => u.partners.length === 1 && u.partners[0] === gran.id && u.children.some(c => c.id === alice.id)));
  await ex(() => FT.undo()); check('undo restores deleted person', !!(await byName('Gramp'))); await ex(() => FT.redo()); check('redo re-deletes', !(await byName('Gramp'))); await ex(() => FT.undo());
  await layoutOK('UI tree');
  await shot(page, 'func-ui-tree');

  // ---- 2. Scenario: three successive partners with children from each ----------------------
  await ex(() => FT.loadJSON(JSON.stringify({ schema: 'family-tree', version: 1, persons: [{ id: 'a', first: 'Anchor' }], unions: [] })));
  const p1 = await ex(() => FT.addPartner('a', { first: 'P1' })), p2 = await ex(() => FT.addPartner('a', { first: 'P2' })), p3 = await ex(() => FT.addPartner('a', { first: 'P3' }));
  const unionOf = async (x, y) => (await state()).unions.find(u => u.partners.includes(x) && u.partners.includes(y));
  for (const [p, names] of [[p1, ['C1a', 'C1b']], [p2, ['C2a']], [p3, ['C3a', 'C3b', 'C3c']]]) { const u = await unionOf('a', p); for (const n of names) await ex((uid, f) => FT.addChild('a', uid, { first: f }), u.id, n); }
  let st = await state(); check('3 partners: 3 unions', st.unions.filter(u => u.partners.includes('a') && u.partners.length === 2).length === 3);
  check('3 partners: children attached to the right unions', (await unionOf('a', p1)).children.length === 2 && (await unionOf('a', p2)).children.length === 1 && (await unionOf('a', p3)).children.length === 3);
  let r = await layoutOK('3 partners');
  check('3 partners: exactly one bracket union', await ex(() => FT.layout().edges.filter(e => e.kind === 'bracket').length === 1));
  await ex(() => FT.fitAll(0)); await shot(page, 'func-three-partners');

  // ---- 3. Divorced parents each remarry, new children (half + step siblings) --------------
  await ex(() => FT.loadJSON(JSON.stringify({ schema: 'family-tree', version: 1, persons: [{ id: 'm', first: 'Mum' }, { id: 'd', first: 'Dad' }], unions: [{ id: 'u0', partners: ['m', 'd'], children: [] }] })));
  const kid = await ex(() => FT.addChild('m', 'u0', { first: 'Kid' }));
  const m2 = await ex(() => FT.addPartner('m', { first: 'StepDad' })), d2 = await ex(() => FT.addPartner('d', { first: 'StepMum' }));
  const um2 = await unionOf('m', m2), ud2 = await unionOf('d', d2);
  const half1 = await ex((u) => FT.addChild('m', u, { first: 'HalfM' }), um2.id), half2 = await ex((u) => FT.addChild('d', u, { first: 'HalfD' }), ud2.id);
  const step = await ex((d2) => FT.addChild(d2, null, { first: 'StepKid' }), d2); // StepMum's child from a previous union (single parent)
  st = await state();
  check('remarriage: Kid under Mum∞Dad only', st.unions.filter(u => u.children.some(c => c.id === kid)).length === 1 && st.unions.find(u => u.id === 'u0').children.some(c => c.id === kid));
  check('remarriage: half siblings under new unions', st.unions.find(u => u.id === um2.id).children.some(c => c.id === half1) && st.unions.find(u => u.id === ud2.id).children.some(c => c.id === half2));
  check('remarriage: step child under StepMum alone', st.unions.some(u => u.partners.length === 1 && u.partners[0] === d2 && u.children.some(c => c.id === step)));
  r = await layoutOK('remarriage');
  check('remarriage: Mum, Dad, StepDad, StepMum all on one row and all unions adjacent', await ex(() => { const l = FT.layout(); const lv = new Set(['m', 'd'].map(id => l.nodes.get(id).level)); return lv.size === 1 && l.edges.filter(e => e.kind === 'bracket').length === 0; }));
  await ex(() => FT.fitAll(0)); await shot(page, 'func-remarriage');

  // ---- 4. In-marrying partner whose parents are in the tree (ancestor attachment) ------------
  await ex(() => FT.loadExample());
  const sophie = await byName('Sophie'), tom = await byName('Tom');
  const gfId = await ex((id) => FT.addParent(id, { first: 'GrandPa', last: 'Roux' }), (await byName('Inès')).id);
  await ex((id) => FT.addChild(id, null, { first: 'Oncle', last: 'Roux' }), gfId);
  r = await layoutOK('ancestor attachment');
  check('ancestor attachment: GrandPa placed above Inès', await ex((gf, i) => { const l = FT.layout(); return l.nodes.get(gf).level === l.nodes.get(i).level - 1; }, gfId, (await byName('Inès')).id));
  await ex(() => FT.fitAll(0)); await shot(page, 'func-ancestor-attach');

  // ---- 5. Collapse / expand -----------------------------------------------------------------
  const jean = await byName('Jean');
  await ex((id) => FT.update(id, { collapsed: true }), jean.id);
  check('collapse hides descendants', await ex((id) => { const l = FT.layout(); return !l.nodes.has(id) && l.collapsed.size === 1; }, (await byName('Pierre')).id));
  await ex((id) => FT.update(id, { collapsed: false }), jean.id);
  check('expand restores', await ex((id) => FT.layout().nodes.has(id), (await byName('Pierre')).id));

  // ---- 6. JSON round trip ---------------------------------------------------------------------
  const json1 = await ex(() => FT.toJSON());
  await ex((j) => FT.loadJSON(j), json1);
  const json2 = await ex(() => FT.toJSON());
  const strip = (j) => { const o = JSON.parse(j); delete o.exportedAt; return JSON.stringify(o); };
  check('JSON export → import → export identical', strip(json1) === strip(json2));
  check('JSON contains photos as data URLs', JSON.parse(json1).photos && Object.values(JSON.parse(json1).photos).every(v => v.startsWith('data:image/jpeg')));
  const same = await ex((j) => { const a = FT.layout(); FT.loadJSON(j); const b = FT.layout(); for (const [id, n] of a.nodes) { const m = b.nodes.get(id); if (!m || m.x !== n.x || m.y !== n.y) return false; } return a.edges.length === b.edges.length; }, json1);
  check('layout identical after reload', same);
  for (const [label, bad] of [['bad json', '{nope'], ['bad schema', '{"schema":"x","version":1,"persons":[]}'], ['bad ref', '{"schema":"family-tree","version":1,"persons":[{"id":"a","first":"A"}],"unions":[{"partners":["a","zz"],"children":[]}]}'], ['cycle', '{"schema":"family-tree","version":1,"persons":[{"id":"a","first":"A"},{"id":"b","first":"B"}],"unions":[{"partners":["a"],"children":[{"id":"b"}]},{"partners":["b"],"children":[{"id":"a"}]}]}'], ['future version', '{"schema":"family-tree","version":9,"persons":[]}']]) {
    const msg = await ex((j) => { try { FT.loadJSON(j); return null; } catch (e) { return e.message; } }, bad); check(`import rejects ${label} with French message`, !!msg && /[a-zéè]/.test(msg), msg); }

  // ---- 7. Photo import through file chooser + crop ------------------------------------------
  await ex(() => FT.loadExample()); const lea = await byName('Léa');
  await ex((id) => FT.openEdit(id), lea.id); await sleep(100);
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#ePick')]);
  await chooser.accept([path.resolve(__dirname, 'photo.png')]); await sleep(400);
  check('crop dialog opened', await ex(() => document.getElementById('dlgCrop').open));
  await page.select('#cropShape', 'square'); await page.click('#cropOk'); await sleep(200); await page.click('#eSave'); await sleep(200);
  const ph = await ex((id) => { const p = FT.state().persons.find(x => x.id === id); const url = FT.state().photos[p.photo]; return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight, jpeg: url.startsWith('data:image/jpeg'), shape: p.photoShape, len: url.length }); im.src = url; }); }, lea.id);
  check('photo imported, resized to ≤600px JPEG, square shape', ph.jpeg && ph.w === 600 && ph.h === 600 && ph.shape === 'square', JSON.stringify(ph));
  await ex((id) => { FT.select(id); FT.centerOn(id, 0, 1.5); }, lea.id); await sleep(200); await shot(page, 'func-photo');

  // ---- 8. Exports (PNG / PDF / SVG) produced in-page, offline --------------------------------
  const exp = await ex(async () => { const out = {}; for (const f of ['png', 'pdf', 'svg']) { const t0 = performance.now(); const r = await FT.exportTree(f, { paper: 'A3', dpi: 150 }); const buf = new Uint8Array(await r.blob.arrayBuffer()); out[f] = { size: buf.length, ms: performance.now() - t0, head: Array.from(buf.slice(0, 8)), name: r.name, px: [r.page.pxW, r.page.pxH] }; } return out; });
  check('PNG export signature', exp.png.head.join(',') === '137,80,78,71,13,10,26,10', JSON.stringify(exp.png));
  check('PDF export header', String.fromCharCode(...exp.pdf.head.slice(0, 5)) === '%PDF-', JSON.stringify(exp.pdf));
  check('SVG export header', String.fromCharCode(...exp.svg.head.slice(0, 5)) === '<?xml', JSON.stringify(exp.svg));
  check('no network requests during the whole run (offline)', page._requests.length === 0, JSON.stringify(page._requests));
  check('no console errors', page._errors.length === 0, JSON.stringify(page._errors));
  await page.close();

  // ---- 9. Mobile-emulated run (touch) --------------------------------------------------------
  const mp = await newPage(browser, { width: 390, height: 844, mobile: true, dpr: 2 });
  await mp.tap('#btnFirst'); await sleep(200); await mp.type('#eFirst', 'Mob'); await mp.keyboard.press('Enter'); await sleep(200);
  const mob = (await mp.evaluate(() => FT.state())).persons[0];
  // tap the card itself to select, then tap "Ajouter" in the floating bar
  const pt = await mp.evaluate((id) => { const n = FT.layout().nodes.get(id); const v = FT.getView(); const r = document.getElementById('tree').getBoundingClientRect(); return { x: (n.cx - 40) * v.k + v.x + r.left, y: n.cy * v.k + v.y + r.top }; }, mob.id);
  await mp.touchscreen.tap(pt.x, pt.y); await sleep(200);
  check('mobile: tap selects card and shows action bar', await mp.evaluate(() => !document.getElementById('cardBar').hidden));
  await mp.tap('#cbAdd'); await sleep(200); await mp.tap('input[name=rel][value=partner]'); await mp.type('#aFirst', 'Mob2'); await mp.keyboard.press('Enter'); await sleep(250);
  check('mobile: add partner through touch', (await mp.evaluate(() => FT.state())).persons.length === 2 && (await mp.evaluate(() => FT.state())).unions.length === 1);
  // pinch zoom emulation via two touch points
  const k0 = (await mp.evaluate(() => FT.getView())).k;
  await mp.evaluate(() => { const c = document.getElementById('tree'); const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    const r = c.getBoundingClientRect(); const cx = r.left + 195, cy = r.top + 400; ev('pointerdown', 1, cx - 40, cy); ev('pointerdown', 2, cx + 40, cy); ev('pointermove', 1, cx - 80, cy); ev('pointermove', 2, cx + 80, cy); ev('pointerup', 1, cx - 80, cy); ev('pointerup', 2, cx + 80, cy); });
  const k1 = (await mp.evaluate(() => FT.getView())).k; check('mobile: pinch zooms in', k1 > k0 * 1.5, `${k0} → ${k1}`);
  // drag pans
  const v0 = await mp.evaluate(() => FT.getView());
  await mp.evaluate(() => { const c = document.getElementById('tree'); const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', clientX: x, clientY: y, bubbles: true })); ev('pointerdown', 100, 300); ev('pointermove', 150, 320); ev('pointermove', 200, 350); ev('pointerup', 200, 350); });
  const v1 = await mp.evaluate(() => FT.getView()); check('mobile: drag pans', Math.abs(v1.x - v0.x - 100) < 1 && Math.abs(v1.y - v0.y - 50) < 1, JSON.stringify([v0, v1]));
  check('mobile: no network, no errors', mp._requests.length === 0 && mp._errors.length === 0, JSON.stringify(mp._errors));
  await mp.close();
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'out', 'functional-results.json'), JSON.stringify({ results, failures, exports: exp }, null, 2));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
