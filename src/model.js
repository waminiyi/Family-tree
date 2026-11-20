// ---------------------------------------------------------------------------
// Data model: persons, unions, photos. JSON schema versioned. Pure functions.
// ---------------------------------------------------------------------------
const SCHEMA = 'family-tree', SCHEMA_VERSION = 1;

function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

function defaultSettings() {
  return { theme: 'modern', showLastName: true, showDates: true, showPlace: true, showPhoto: true, showPlus: true, title: '', subtitle: '' };
}

function emptyState() {
  return { persons: [], unions: [], photos: {}, settings: defaultSettings(), seq: 0 };
}

// --- dates: stored as '', 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' -------------------
function parseDateInput(s) {
  s = (s || '').trim();
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{1,4})$/))) return m[1].padStart(4, '0');
  if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null; // invalid
}
function isValidStoredDate(s) { return s === '' || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s); }
function formatDate(s) { // stored -> French display
  if (!s) return '';
  const p = s.split('-');
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[1]}/${p[0]}`;
  return `${p[2]}/${p[1]}/${p[0]}`;
}
function dateYear(s) { return s ? parseInt(s.slice(0, 4), 10) : NaN; }
function dateToInput(s) { return formatDate(s); }

// --- indexes -----------------------------------------------------------------
function buildIndex(st) {
  const byId = new Map(), unionById = new Map(), unionsOf = new Map(), parentUnionOf = new Map();
  for (const p of st.persons) { byId.set(p.id, p); unionsOf.set(p.id, []); }
  for (const u of st.unions) {
    unionById.set(u.id, u);
    for (const pid of u.partners) if (unionsOf.has(pid)) unionsOf.get(pid).push(u);
    for (const c of u.children) parentUnionOf.set(c.id, u);
  }
  return { byId, unionById, unionsOf, parentUnionOf };
}

function parentsOf(idx, pid) { const u = idx.parentUnionOf.get(pid); return u ? u.partners.slice() : []; }
function childrenOf(idx, pid) { return (idx.unionsOf.get(pid) || []).flatMap(u => u.children.map(c => c.id)); }

function isAncestor(idx, a, b) { // is a an ancestor of b?
  const seen = new Set(); const stack = [b];
  while (stack.length) {
    const x = stack.pop();
    for (const p of parentsOf(idx, x)) { if (p === a) return true; if (!seen.has(p)) { seen.add(p); stack.push(p); } }
  }
  return false;
}
function hasCycle(idx, persons) {
  const state = new Map();
  for (const p of persons) {
    if (state.get(p.id)) continue;
    const stack = [[p.id, 0]]; state.set(p.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]; const ps = parentsOf(idx, top[0]);
      if (top[1] < ps.length) {
        const n = ps[top[1]++]; const s = state.get(n);
        if (s === 1) return true;
        if (!s) { state.set(n, 1); stack.push([n, 0]); }
      } else { state.set(top[0], 2); stack.pop(); }
    }
  }
  return false;
}

function fullName(p) { return [p.first, p.last].filter(Boolean).join(' ') || '?'; }

// --- person ops (mutating st; callers snapshot for undo) ----------------------
function newPerson(st, f, idx) {
  const p = { id: uid(), first: (f.first || '').trim(), last: (f.last || '').trim(), birth: f.birth || '', death: f.death || '',
    place: (f.place || '').trim(), notes: (f.notes || '').trim(), photo: f.photo || null, photoShape: f.photoShape || 'circle', seq: ++st.seq };
  if (f.collapsed) p.collapsed = true;
  st.persons.push(p); if (idx) { idx.byId.set(p.id, p); idx.unionsOf.set(p.id, []); } return p;
}
function newUnion(st, partners) { const u = { id: uid(), partners: partners.slice(), children: [], seq: ++st.seq }; st.unions.push(u); return u; }

function sortChildren(st, idx, u) {
  const key = (c) => { const p = idx.byId.get(c.id); const y = p ? dateYear(p.birth) : NaN; return isNaN(y) ? 1e9 : y; };
  u.children.sort((a, b) => key(a) - key(b) || (idx.byId.get(a.id)?.seq || 0) - (idx.byId.get(b.id)?.seq || 0));
}

// Link validations: return error key or null
function canBePartners(idx, a, b) {
  if (a === b) return 'errSelf';
  if (!idx.byId.has(a) || !idx.byId.has(b)) return 'errUnknown';
  if ((idx.unionsOf.get(a) || []).some(u => u.partners.includes(b))) return 'errAlreadyPartners';
  if (isAncestor(idx, a, b) || isAncestor(idx, b, a)) return 'errAncestor';
  return null;
}
function canBeChildOf(idx, u, child) {
  if (!idx.byId.has(child)) return 'errUnknown';
  if (u.partners.includes(child)) return 'errPartnerAsChild';
  if (u.children.some(c => c.id === child)) return 'errAlreadyChild';
  if (idx.parentUnionOf.has(child)) return 'errHasParents';
  for (const p of u.partners) if (p === child || isAncestor(idx, child, p)) return 'errAncestor';
  return null;
}
function canBeParentOf(idx, parent, child) {
  if (parent === child) return 'errSelf';
  if (!idx.byId.has(parent) || !idx.byId.has(child)) return 'errUnknown';
  const u = idx.parentUnionOf.get(child);
  if (u && u.partners.length >= 2) return 'parentsFull';
  if (u && u.partners.includes(parent)) return 'errAlreadyChild';
  if (isAncestor(idx, child, parent)) return 'errAncestor';
  return null;
}

// Add partner: returns union
function addPartner(st, idx, pid, partnerId) {
  const err = canBePartners(idx, pid, partnerId); if (err) throw new Error(t(err));
  return newUnion(st, [pid, partnerId]);
}
// Add child to a union (or create single-parent union for pid)
function addChildTo(st, idx, unionOrNull, pid, childId, adopted) {
  let u = unionOrNull;
  if (!u) { u = (idx.unionsOf.get(pid) || []).find(x => x.partners.length === 1); if (!u) u = newUnion(st, [pid]); }
  const err = canBeChildOf(idx, u, childId); if (err) throw new Error(t(err));
  u.children.push(adopted ? { id: childId, rel: 'adopted' } : { id: childId });
  sortChildren(st, idx, u);
  return u;
}
function addParentTo(st, idx, childId, parentId) {
  const err = canBeParentOf(idx, parentId, childId); if (err) throw new Error(t(err));
  let u = idx.parentUnionOf.get(childId);
  if (u) { u.partners.push(parentId); } else { u = newUnion(st, [parentId]); u.children.push({ id: childId }); }
  return u;
}
function removePerson(st, pid) {
  st.persons = st.persons.filter(p => p.id !== pid);
  for (const u of st.unions) { u.partners = u.partners.filter(x => x !== pid); u.children = u.children.filter(c => c.id !== pid); }
  st.unions = st.unions.filter(u => u.partners.length > 0 && (u.partners.length === 2 || u.children.length > 0));
}
function unlinkChild(st, pid) { for (const u of st.unions) u.children = u.children.filter(c => c.id !== pid); st.unions = st.unions.filter(u => u.partners.length === 2 || u.children.length > 0); }
function removeUnion(st, uid_) { st.unions = st.unions.filter(u => u.id !== uid_); }

// --- JSON --------------------------------------------------------------------
function toJSON(st) {
  const out = { schema: SCHEMA, version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: st.settings,
    persons: st.persons.map(p => { const o = { ...p }; delete o.seq; if (!o.collapsed) delete o.collapsed; return o; }),
    unions: st.unions.map(u => ({ id: u.id, partners: u.partners, children: u.children })), photos: st.photos };
  return JSON.stringify(out);
}
// Validate + normalise. Throws Error with French message.
function fromJSON(text) {
  let d; try { d = JSON.parse(text); } catch (e) { throw new Error(t('jsonBadFile')); }
  if (!d || typeof d !== 'object' || d.schema !== SCHEMA) throw new Error(t('jsonBadSchema'));
  if (typeof d.version !== 'number' || d.version > SCHEMA_VERSION) throw new Error(t('jsonBadVersion', d.version));
  if (!Array.isArray(d.persons)) throw new Error(t('jsonBadPersons'));
  const st = emptyState(); const ids = new Set();
  d.persons.forEach((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || typeof p.first !== 'string') throw new Error(t('jsonBadPerson', i));
    if (ids.has(p.id)) throw new Error(t('jsonDupId', p.id)); ids.add(p.id);
    const q = { id: p.id, first: p.first, last: String(p.last || ''), birth: isValidStoredDate(p.birth) ? p.birth : '', death: isValidStoredDate(p.death) ? p.death : '',
      place: String(p.place || ''), notes: String(p.notes || ''), photo: typeof p.photo === 'string' ? p.photo : null, photoShape: p.photoShape === 'square' ? 'square' : 'circle', seq: ++st.seq };
    if (p.collapsed) q.collapsed = true;
    st.persons.push(q);
  });
  const seenChild = new Set();
  (Array.isArray(d.unions) ? d.unions : []).forEach((u, i) => {
    if (!u || typeof u !== 'object' || !Array.isArray(u.partners) || u.partners.length < 1 || u.partners.length > 2) throw new Error(t('jsonBadUnion', i));
    for (const pid of u.partners) if (!ids.has(pid)) throw new Error(t('jsonBadRef', pid));
    const children = (Array.isArray(u.children) ? u.children : []).map(c => {
      const o = typeof c === 'string' ? { id: c } : c;
      if (!o || typeof o.id !== 'string' || !ids.has(o.id)) throw new Error(t('jsonBadRef', o && o.id));
      if (seenChild.has(o.id)) throw new Error(t('jsonTwoParents', o.id)); seenChild.add(o.id);
      return o.rel === 'adopted' ? { id: o.id, rel: 'adopted' } : { id: o.id };
    });
    if (u.partners[0] === u.partners[1]) throw new Error(t('jsonBadUnion', i));
    st.unions.push({ id: typeof u.id === 'string' && u.id ? u.id : uid(), partners: u.partners.slice(), children, seq: ++st.seq });
  });
  if (d.photos && typeof d.photos === 'object') for (const k in d.photos) if (typeof d.photos[k] === 'string' && d.photos[k].startsWith('data:image/')) st.photos[k] = d.photos[k];
  for (const p of st.persons) if (p.photo && !st.photos[p.photo]) p.photo = null;
  st.settings = { ...defaultSettings(), ...(d.settings && typeof d.settings === 'object' ? d.settings : {}) };
  if (st.settings.theme !== 'vintage') st.settings.theme = 'modern';
  const idx = buildIndex(st);
  if (hasCycle(idx, st.persons)) throw new Error(t('jsonCycle'));
  return st;
}

// --- example + generator -----------------------------------------------------
function exampleTree(st) {
  const P = (first, last, birth, death, place) => newPerson(st, { first, last, birth, death, place });
  const jean = P('Jean', 'Martin', '1940-03-12', '2015-11-02', 'Lyon'), marie = P('Marie', 'Dubois', '1942-07-01', '', 'Grenoble');
  const pierre = P('Pierre', 'Martin', '1965-05-20', '', 'Lyon'), sophie = P('Sophie', 'Martin', '1968-09-14', '', 'Lyon');
  const claire = P('Claire', 'Petit', '1950', '', 'Marseille'), lucas = P('Lucas', 'Martin', '1980-01-30', '', 'Marseille');
  const paul = P('Paul', 'Leroy', '1938', '2020', 'Annecy'), anne = P('Anne', 'Moreau', '1945', '', 'Annecy');
  const nina = P('Nina', 'Leroy', '1975-12-24', '', 'Annecy'), emma = P('Emma', 'Leroy', '1983-04-08', '', 'Grenoble');
  const julie = P('Julie', 'Bernard', '1967', '', 'Paris'), hugo = P('Hugo', 'Martin', '1995-06-15', '', 'Paris'), lea = P('Léa', 'Martin', '1998-02-02', '', 'Hanoï');
  const tom = P('Tom', 'Martin', '2001-10-10', '', 'Lyon'), ines = P('Inès', 'Roux', '1981', '', 'Nice'), zoe = P('Zoé', 'Martin', '2010-08-21', '', 'Nice');
  const U = (a, b, ...kids) => { const u = newUnion(st, b ? [a.id, b.id] : [a.id]); u.children = kids.map(k => Array.isArray(k) ? { id: k[0].id, rel: 'adopted' } : { id: k.id }); return u; };
  U(jean, marie, pierre, sophie); U(jean, claire, lucas); U(paul, anne, nina); U(marie, paul, emma);
  U(pierre, julie, hugo, [lea]); U(sophie, null, tom); U(lucas, ines, zoe);
  st.settings.title = 'Famille Martin – Dubois – Leroy'; st.settings.subtitle = 'Exemple de famille recomposée';
  return st;
}

function generateTree(st, target, seed) {
  let s = seed || 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const FIRST = ['Jean', 'Marie', 'Pierre', 'Sophie', 'Luc', 'Anne', 'Paul', 'Julie', 'Marc', 'Claire', 'Louis', 'Emma', 'Hugo', 'Léa', 'Tom', 'Zoé', 'Nina', 'Inès', 'Noah', 'Chloé', 'Jules', 'Manon', 'Léo', 'Camille'];
  const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Roux', 'Vincent'];
  const PLACE = ['Paris', 'Lyon', 'Marseille', 'Lille', 'Nantes', 'Rennes', 'Nice', 'Bordeaux', 'Toulouse', 'Strasbourg'];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const mk = (last, year) => newPerson(st, { first: pick(FIRST), last, birth: String(year), death: rnd() < 0.3 && year < 1950 ? String(year + 50 + Math.floor(rnd() * 40)) : '', place: pick(PLACE) });
  const queue = [];
  const roots = Math.max(1, Math.round(target / 1200));
  for (let r = 0; r < roots; r++) { const a = mk(pick(LAST), 1840 + Math.floor(rnd() * 30)); queue.push(a); }
  let count = st.persons.length;
  while (queue.length && count < target) {
    const p = queue.shift(); const yr = dateYear(p.birth);
    if (yr > 2000) continue;
    const nU = rnd() < 0.12 ? 2 : (rnd() < 0.02 ? 3 : 1);
    for (let k = 0; k < nU && count < target; k++) {
      const single = rnd() < 0.06;
      let u;
      if (single) u = newUnion(st, [p.id]);
      else { const q = mk(pick(LAST), yr + Math.floor(rnd() * 8) - 4); count++; u = newUnion(st, [p.id, q.id]); if (rnd() < 0.08) { const sp = mk(pick(LAST), yr + 2); count++; newUnion(st, [q.id, sp.id]); } }
      const nk = 1 + Math.floor(rnd() * 4);
      for (let c = 0; c < nk && count < target; c++) {
        const ch = mk(p.last, yr + 22 + c * 3 + Math.floor(rnd() * 4)); count++;
        u.children.push(rnd() < 0.03 ? { id: ch.id, rel: 'adopted' } : { id: ch.id }); queue.push(ch);
      }
    }
  }
  return st;
}
