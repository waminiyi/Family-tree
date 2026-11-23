// ---------------------------------------------------------------------------
// Layout: generation levels + recursive "chain" units packed by per-level contours.
// A chain = partners placed side by side on one row; each union's children hang
// in the gap between the two partners (or under a single parent). In-marrying
// partners get their own parents/siblings attached above (ancestor attachment).
// ---------------------------------------------------------------------------
const LY = { W: 120, H: 176, Hnophoto: 62, Hphoto: 176, sep: 20, gapMin: 40, levelGap: 96, busOff: 60, laneStep: 10, bracketBase: 10, bracketStep: 9, rootSep: 130 };
function pitch() { return LY.H + LY.levelGap; }
function levelY(l) { return l * pitch(); }

function hiddenSet(st, idx) {
  const hidden = new Set();
  const hideDesc = (pid) => { for (const u of idx.unionsOf.get(pid) || []) for (const c of u.children) if (!hidden.has(c.id)) { hidden.add(c.id); hideDesc(c.id); } };
  for (const p of st.persons) if (p.collapsed) hideDesc(p.id);
  // in-marrying partners of hidden people (no parents in tree) are hidden too
  let changed = true;
  while (changed) { changed = false; for (const u of st.unions) if (u.partners.length === 2) { const [a, b] = u.partners; const ha = hidden.has(a), hb = hidden.has(b);
    if (ha && !hb && !idx.parentUnionOf.has(b) && !st.persons.find(p => p.id === b)?.collapsed) { hidden.add(b); hideDesc(b); changed = true; }
    if (hb && !ha && !idx.parentUnionOf.has(a) && !st.persons.find(p => p.id === a)?.collapsed) { hidden.add(a); hideDesc(a); changed = true; } } }
  return hidden;
}
function countDescendants(idx, pid) { const seen = new Set(); const rec = (id) => { for (const u of idx.unionsOf.get(id) || []) for (const c of u.children) if (!seen.has(c.id)) { seen.add(c.id); rec(c.id); } }; rec(pid); return seen.size; }

function computeLevels(persons, unions) {
  const lvl = new Map(); for (const p of persons) lvl.set(p.id, 0);
  let changed = true, it = 0;
  while (changed && it++ < 200) {
    changed = false;
    for (const u of unions) {
      let L = 0; for (const id of u.partners) L = Math.max(L, lvl.get(id));
      for (const id of u.partners) if (lvl.get(id) !== L) { lvl.set(id, L); changed = true; }
      for (const c of u.children) if (lvl.get(c.id) < L + 1) { lvl.set(c.id, L + 1); changed = true; }
    }
  }
  return lvl;
}

class Unit {
  constructor() { this.ids = []; this.min = []; this.max = []; this.phantoms = []; }
  get empty() { return this.ids.length === 0 && this.phantoms.length === 0; }
  cov(l, a, b) { if (this.min[l] == null || a < this.min[l]) this.min[l] = a; if (this.max[l] == null || b > this.max[l]) this.max[l] = b; }
  globalMin() { let m = Infinity; for (const v of this.min) if (v != null && v < m) m = v; return m; }
  globalMax() { let m = -Infinity; for (const v of this.max) if (v != null && v > m) m = v; return m; }
}

function computeLayout(st, idx) {
  const W = LY.W, H = LY.H, sep = LY.sep, gapMin = LY.gapMin;
  const hidden = hiddenSet(st, idx);
  const persons = st.persons.filter(p => !hidden.has(p.id));
  // visible unions
  const vUnions = []; const vUnionsOf = new Map(); const vParentUnion = new Map();
  for (const p of persons) vUnionsOf.set(p.id, []);
  for (const u of st.unions) {
    const partners = u.partners.filter(id => !hidden.has(id)); if (!partners.length) continue;
    const collapsed = partners.some(id => idx.byId.get(id)?.collapsed);
    const children = collapsed ? [] : u.children.filter(c => !hidden.has(c.id));
    if (partners.length < 2 && !children.length) continue;
    const vu = { id: u.id, partners, children, src: u };
    vUnions.push(vu); for (const id of partners) vUnionsOf.get(id).push(vu); for (const c of children) vParentUnion.set(c.id, vu);
  }
  const lvl = computeLevels(persons, vUnions);
  const pos = new Map(); const placed = new Set();
  const chainOf = new Map(); // id -> {c, i}
  const anchorOf = new Map(); // unionId -> anchor person id (for bracket unions)
  let chainSeq = 0;

  const translate = (u, dx) => { for (const id of u.ids) pos.get(id).x += dx; for (const ph of u.phantoms) ph.x += dx;
    for (let l = 0; l < u.min.length; l++) if (u.min[l] != null) { u.min[l] += dx; u.max[l] += dx; } };
  const merge = (A, B) => { for (const id of B.ids) A.ids.push(id); for (const ph of B.phantoms) A.phantoms.push(ph);
    for (let l = 0; l < B.min.length; l++) if (B.min[l] != null) A.cov(l, B.min[l], B.max[l]); };
  const fitRight = (A, B, s) => { let dx = null; const n = Math.max(A.max.length, B.min.length);
    for (let l = 0; l < n; l++) if (A.max[l] != null && B.min[l] != null) { const d = A.max[l] + s - B.min[l]; if (dx == null || d > dx) dx = d; } return dx; };
  const fitLeft = (A, B, s) => { let dx = null; const n = Math.max(A.min.length, B.max.length);
    for (let l = 0; l < n; l++) if (A.min[l] != null && B.max[l] != null) { const d = A.min[l] - s - B.max[l]; if (dx == null || d < dx) dx = d; } return dx; };
  const placeAfter = (A, B, s) => { if (A.empty) return; let dx = fitRight(A, B, s); if (dx == null) dx = A.globalMax() + s - B.globalMin(); translate(B, dx); };

  function linearize(startId) {
    const seq = [startId]; placed.add(startId); const queue = [startId];
    while (queue.length) {
      const pid = queue.shift(); let toggle = 0;
      for (const u of vUnionsOf.get(pid)) {
        if (u.partners.length < 2) continue;
        const q = u.partners[0] === pid ? u.partners[1] : u.partners[0];
        if (placed.has(q) || lvl.get(q) !== lvl.get(pid)) continue;
        const i = seq.indexOf(pid), atR = i === seq.length - 1, atL = i === 0;
        let side; if (atR && atL) side = toggle++ % 2 === 0 ? 'R' : 'L'; else if (atR) side = 'R'; else if (atL) side = 'L'; else side = toggle++ % 2 === 0 ? 'R' : 'L';
        if (side === 'R') seq.push(q); else seq.unshift(q);
        placed.add(q); anchorOf.set(u.id, pid); queue.push(q);
      }
    }
    return seq;
  }

  // Attach PU (parents' chain + siblings of pid, with a phantom for pid) beside U on the given side.
  function attachParents(U, PU, pid, side, L) {
    const ph = PU.phantoms.find(p => p.id === pid);
    if (ph) translate(PU, pos.get(pid).x - ph.x);
    PU.min[L] = null; PU.max[L] = null; for (const id of PU.ids) { const q = pos.get(id); if (q.level === L) PU.cov(L, q.x, q.x + W); }
    if (side === 'R') { const need = fitRight(U, PU, sep); if (need != null && need > 0) translate(PU, need); }
    else { const need = fitLeft(U, PU, sep); if (need != null && need < 0) translate(PU, need); }
    merge(U, PU);
  }
  // encl = level of the chain whose gap this unit hangs in (-Infinity for roots).
  function buildUnit(startId, phantomReq, encl) {
    const U = new Unit(); U.deferred = []; const L = lvl.get(startId);
    const seq = linearize(startId); const k = seq.length - 1; const cid = ++chainSeq;
    seq.forEach((id, i) => chainOf.set(id, { c: cid, i }));
    const indexIn = new Map(seq.map((id, i) => [id, i]));
    // unions of the chain -> slot keys. gap i (between i-1 and i) = 2i ; under i = 2i+1
    const slots = new Map(); const seenU = new Set(); const pending = [];
    const addSlot = (key, items) => { if (!slots.has(key)) slots.set(key, []); slots.get(key).push(...items); };
    for (let i = 0; i <= k; i++) for (const u of vUnionsOf.get(seq[i])) {
      if (seenU.has(u.id)) continue; seenU.add(u.id);
      let key;
      if (u.partners.length === 2 && indexIn.has(u.partners[0]) && indexIn.has(u.partners[1])) {
        const a = indexIn.get(u.partners[0]), b = indexIn.get(u.partners[1]); const lo = Math.min(a, b), hi = Math.max(a, b);
        if (hi - lo === 1) key = 2 * hi; else { const an = indexIn.get(anchorOf.get(u.id)) ?? lo; const far = an === lo ? hi : lo; key = far > an ? 2 * far : 2 * (far + 1); }
      } else key = 2 * i + 1; // single parent, or partner placed elsewhere
      const kids = u.children.filter(c => !placed.has(c.id));
      const items = [];
      if (phantomReq && phantomReq.unionId === u.id) { const ph = { phantom: true, id: phantomReq.personId }; if (phantomReq.side === 'R') items.push(ph); }
      for (const c of kids) { const g = buildUnit(c.id, null, L); items.push({ unit: g, anchor: c.id }); for (const d of g.deferred) pending.push(d); }
      if (phantomReq && phantomReq.unionId === u.id && phantomReq.side === 'L') items.push({ phantom: true, id: phantomReq.personId });
      if (items.length) addSlot(key, items);
    }
    // pack groups left to right
    const keys = [...slots.keys()].sort((a, b) => a - b); const row = new Unit(); const span = new Map(); const slotUnits = new Map();
    for (const key of keys) {
      let left = Infinity, right = -Infinity; const units = [];
      for (const it of slots.get(key)) {
        let un, ax;
        if (it.phantom) { const pl = lvl.get(it.id); un = new Unit(); const ph = { id: it.id, x: 0, level: pl }; un.phantoms.push(ph); un.cov(pl, 0, W); placeAfter(row, un, sep); ax = ph.x; }
        else { un = it.unit; placeAfter(row, un, sep); ax = pos.get(it.anchor).x; }
        merge(row, un); units.push(un); if (ax < left) left = ax; if (ax + W > right) right = ax + W;
      }
      span.set(key, { left, right }); slotUnits.set(key, units);
    }
    const center = (key) => { const s = span.get(key); return s ? (s.left + s.right) / 2 : null; };
    const shiftFrom = (key, d) => { for (const kk of keys) if (kk >= key) { for (const un of slotUnits.get(kk)) translate(un, d); const s = span.get(kk); s.left += d; s.right += d; } };
    // chain x positions
    const x = new Array(k + 1);
    { const c0 = center(1), c1 = center(2); x[0] = c0 != null ? c0 - W / 2 : (c1 != null ? c1 - W - gapMin / 2 : 0); }
    for (let i = 1; i <= k; i++) {
      const minX = x[i - 1] + W + gapMin; let xi = minX;
      const cg = center(2 * i);
      if (cg != null) { const want = 2 * cg - x[i - 1] - W; if (want >= minX) xi = want; else shiftFrom(2 * i, (minX + x[i - 1] + W) / 2 - cg); }
      const cu = center(2 * i + 1);
      if (cu != null) { const want = cu - W / 2; if (want >= xi) xi = want; else shiftFrom(2 * i + 1, xi + W / 2 - cu); }
      x[i] = xi;
    }
    for (let i = 0; i <= k; i++) { pos.set(seq[i], { x: x[i], level: L }); U.ids.push(seq[i]); U.cov(L, x[i], x[i] + W); }
    for (const key of keys) for (const un of slotUnits.get(key)) merge(U, un);
    // parents of chain members: attach above (level L-1) unless that row is the enclosing chain's row -> defer one level up
    for (let i = 0; i <= k; i++) {
      const pid = seq[i]; const pu = vParentUnion.get(pid); if (!pu) continue;
      if (pu.partners.some(p => placed.has(p))) continue;
      if (lvl.get(pu.partners[0]) <= encl) { U.deferred.push({ pid, pu }); continue; }
      const side = (i === 0 && k > 0) ? 'L' : 'R';
      const PU = buildUnit(pu.partners[0], { unionId: pu.id, personId: pid, side }, encl);
      attachParents(U, PU, pid, side, lvl.get(pid)); for (const d of PU.deferred) U.deferred.push(d);
    }
    // deferred in-law attachments coming from child groups: their parents' chain is on this chain's row -> place beside this unit
    for (const d of pending) {
      if (d.pu.partners.some(p => placed.has(p))) continue;
      const pl = lvl.get(d.pid); const px = pos.get(d.pid).x; let nl = 0, nr = 0;
      for (const id of U.ids) { const q = pos.get(id); if (q.level === pl) { if (q.x < px) nl++; else if (q.x > px) nr++; } }
      const side = nl < nr ? 'L' : 'R';
      const PU = buildUnit(d.pu.partners[0], { unionId: d.pu.id, personId: d.pid, side }, encl);
      attachParents(U, PU, d.pid, side, pl); for (const dd of PU.deferred) U.deferred.push(dd);
    }
    return U;
  }

  const root = new Unit();
  for (const p of persons) {
    if (placed.has(p.id)) continue;
    let top = p.id; const seen = new Set();
    while (!seen.has(top)) { seen.add(top); const pu = vParentUnion.get(top); const ps = pu ? pu.partners.filter(x => !placed.has(x)) : []; if (!ps.length) break; top = ps[0]; }
    const un = buildUnit(top, null, -Infinity);
    placeAfter(root, un, LY.rootSep); merge(root, un);
  }

  // nodes
  const nodes = new Map(); let minX = Infinity, maxX = -Infinity, maxL = 0;
  for (const [id, q] of pos) { const y = levelY(q.level); nodes.set(id, { id, x: q.x, y, w: W, h: H, level: q.level, cx: q.x + W / 2, cy: y + H / 2 }); if (q.x < minX) minX = q.x; if (q.x + W > maxX) maxX = q.x + W; if (q.level > maxL) maxL = q.level; }
  // edges
  const edges = []; const bracketCount = new Map(); const buses = new Map(); // level -> [{l, r, union}]
  for (const u of vUnions) {
    const P = u.partners.map(id => nodes.get(id)).filter(Boolean); if (!P.length) continue;
    let ux, uy, bracketTop = null;
    if (P.length === 2) {
      const [a, b] = P; const ca = chainOf.get(a.id), cb = chainOf.get(b.id);
      const adjacent = ca && cb && ca.c === cb.c && Math.abs(ca.i - cb.i) === 1;
      if (adjacent) {
        const l = a.x < b.x ? a : b, r = l === a ? b : a; const y = a.cy;
        edges.push({ kind: 'union', pts: [[l.x + W, y], [r.x, y]], u: u.id }); ux = (l.x + W + r.x) / 2; uy = y;
      } else if (ca && cb && ca.c === cb.c) {
        const anId = anchorOf.get(u.id) || (a.x < b.x ? a.id : b.id); const an = nodes.get(anId), far = an === a ? b : a;
        const n = bracketCount.get(anId) || 0; bracketCount.set(anId, n + 1);
        const h = LY.bracketBase + LY.bracketStep * Math.min(n, 3); const dir = far.x > an.x ? 1 : -1;
        const x1 = an.cx + dir * W * 0.3, x2 = far.cx - dir * W * 0.3, yTop = an.y - h;
        edges.push({ kind: 'bracket', pts: [[x1, an.y], [x1, yTop], [x2, yTop], [x2, far.y]], u: u.id });
        // drop from the gap next to the far partner (towards the anchor)
        const fi = chainOf.get(far.id).i; const neighbor = [...chainOf].find(([id, c]) => c.c === ca.c && c.i === fi - dir);
        const nb = neighbor ? nodes.get(neighbor[0]) : an;
        const gL = Math.min(nb.x + W, far.x), gR = Math.max(nb.x + W, far.x);
        let gL2 = gL, gR2 = gR; if (dir < 0) { gL2 = far.x + W; gR2 = nb.x; }
        ux = (gL2 + gR2) / 2; uy = yTop; bracketTop = { gL: gL2 + 6, gR: gR2 - 6 };
      } else { // partners placed apart: straight link
        edges.push({ kind: 'far', pts: [[a.cx, a.cy], [b.cx, b.cy]], u: u.id }); ux = (a.cx + b.cx) / 2; uy = (a.cy + b.cy) / 2;
      }
    } else { ux = P[0].cx; uy = P[0].y + H; }
    const kids = u.children.map(c => ({ n: nodes.get(c.id), adopted: c.rel === 'adopted' })).filter(c => c.n);
    if (!kids.length) continue;
    const minLevel = Math.min(...kids.map(c => c.n.level));
    const cxs = kids.map(c => c.n.cx);
    if (bracketTop) ux = Math.max(bracketTop.gL, Math.min(bracketTop.gR, (Math.min(...cxs) + Math.max(...cxs)) / 2));
    const left = Math.min(ux, ...cxs), right = Math.max(ux, ...cxs);
    if (!buses.has(minLevel)) buses.set(minLevel, []);
    buses.get(minLevel).push({ l: left, r: right, ux, uy, kids, u: u.id, level: minLevel });
  }
  // assign bus lanes per level to avoid collinear overlaps
  for (const [level, list] of buses) {
    list.sort((p, q) => p.l - q.l); const laneEnd = [];
    for (const b of list) {
      let lane = 0; while (lane < laneEnd.length && laneEnd[lane] > b.l - 6) lane++;
      laneEnd[lane] = b.r; lane = Math.min(lane, 3);
      const busY = levelY(level) - LY.busOff + lane * LY.laneStep;
      const uid_ = b.u;
      edges.push({ kind: 'drop', pts: [[b.ux, b.uy], [b.ux, busY]], u: uid_ });
      if (b.r > b.l) edges.push({ kind: 'bus', pts: [[b.l, busY], [b.r, busY]], u: uid_ });
      for (const c of b.kids) edges.push({ kind: 'child', pts: [[c.n.cx, busY], [c.n.cx, c.n.y]], u: uid_, child: c.n.id, dashed: c.adopted });
      edges.push({ kind: 'node', x: b.ux, y: b.uy, u: uid_ });
    }
  }
  for (const u of vUnions) if (!u.children.length && u.partners.length === 2) { const P = u.partners.map(id => nodes.get(id)); const e = edges.find(e => e.u === u.id && (e.kind === 'union' || e.kind === 'bracket')); if (e) { const p = e.kind === 'union' ? [(e.pts[0][0] + e.pts[1][0]) / 2, e.pts[0][1]] : [(e.pts[1][0] + e.pts[2][0]) / 2, e.pts[1][1]]; edges.push({ kind: 'node', x: p[0], y: p[1], u: u.id }); } }
  // hops: where a vertical connector crosses a horizontal line of another union, jump over it
  const HS = new Map(); const PITCH = pitch(); const band = (y) => Math.floor(y / PITCH);
  const addH = (x1, x2, y, u) => { const b = band(y); if (!HS.has(b)) HS.set(b, []); HS.get(b).push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y, u }); };
  for (const e of edges) { if (e.kind === 'union' || e.kind === 'bus') addH(e.pts[0][0], e.pts[1][0], e.pts[0][1], e.u); else if (e.kind === 'bracket') addH(e.pts[1][0], e.pts[2][0], e.pts[1][1], e.u); }
  const R = 5;
  for (const e of edges) {
    if (e.kind !== 'drop' && e.kind !== 'child' && e.kind !== 'bracket') continue;
    const out = [e.pts[0]];
    for (let i = 1; i < e.pts.length; i++) {
      const [x1, y1] = e.pts[i - 1], [x2, y2] = e.pts[i];
      if (x1 === x2 && y1 !== y2) {
        const lo = Math.min(y1, y2), hi = Math.max(y1, y2); const hits = [];
        for (let b = band(lo); b <= band(hi); b++) for (const h of (HS.get(b) || [])) if (h.u !== e.u && h.y > lo + R && h.y < hi - R && x1 > h.x1 + 1 && x1 < h.x2 - 1) hits.push(h.y);
        hits.sort((a, b) => y1 < y2 ? a - b : b - a);
        for (const hy of hits) { const dir = y1 < y2 ? 1 : -1; out.push([x1, hy - dir * R]); for (let a = 1; a < 6; a++) { const t = a / 6 * Math.PI; out.push([x1 + R * Math.sin(t), hy - dir * R * Math.cos(t)]); } out.push([x1, hy + dir * R]); }
      }
      out.push(e.pts[i]);
    }
    e.pts = out;
  }
  const collapsed = new Map(); for (const p of persons) if (p.collapsed) { const n = countDescendants(idx, p.id); if (n) collapsed.set(p.id, n); }
  const bbox = nodes.size ? { x: minX, y: -LY.busOff - 8, w: maxX - minX, h: levelY(maxL) + H + LY.busOff + 8 } : { x: 0, y: 0, w: 0, h: 0 };
  return { nodes, edges, bbox, hidden, collapsed, levels: lvl };
}
