// Parsers for the DeckHQ project hub. Zero dependencies, tolerant by contract:
// a missing file or a missing section yields an empty collection and a warning,
// never a throw. Every parser takes markdown text and returns plain data.

/** @param {string} s */
const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');

/** Collapse a markdown paragraph to one line. */
export function flat(s, cap = 0) {
  let t = norm(s).replace(/\s+/g, ' ').trim();
  if (cap && t.length > cap) t = t.slice(0, cap - 1).replace(/\s+\S*$/, '') + '…';
  return t;
}

/**
 * The text between a heading that matches `start` and the next heading at the
 * same or a shallower level.
 */
export function section(md, startRe, stopRe) {
  const lines = norm(md).split('\n');
  let from = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (startRe.test(lines[i])) { from = i + 1; break; }
  }
  if (from < 0) return '';
  let to = lines.length;
  for (let i = from; i < lines.length; i += 1) {
    if (stopRe.test(lines[i])) { to = i; break; }
  }
  return lines.slice(from, to).join('\n');
}

/** Every markdown table in `md`, as `{ header: string[], rows: string[][] }`. */
export function tables(md) {
  const out = [];
  const lines = norm(md).split('\n');
  let cur = null;
  const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      if (!cur) {
        const next = lines[i + 1] || '';
        if (!/^\s*\|[\s:|-]+\|?\s*$/.test(next)) continue;
        cur = { header: cells(line).map((h) => h.toLowerCase()), rows: [] };
        i += 1;
        continue;
      }
      cur.rows.push(cells(line));
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const STATUSES = ['done', 'in progress', 'planned', 'declined', 'superseded', 'blocked', 'open'];

/** Map free text onto one of the status words the page colours. */
export function statusOf(text, fallback = 'unknown') {
  const t = flat(text).toLowerCase().replace(/[*_~`]/g, '');
  if (!t) return fallback;
  if (/\bsuperseded\b/.test(t)) return 'superseded';
  if (/\bdeclined\b|\bdropped\b|\brefused\b/.test(t)) return 'declined';
  if (/\bblocked\b/.test(t)) return 'blocked';
  if (/\bin progress\b|\bin flight\b/.test(t)) return 'in progress';
  if (/\bdone\b|\blanded\b|\bshipped\b|\bresolved\b/.test(t)) return 'done';
  if (/\bplanned\b|\bnot started\b|\bopen\b/.test(t)) return 'planned';
  return fallback;
}

const stripMd = (s) => flat(s).replace(/^\*\*|\*\*$/g, '').replace(/~~/g, '');

/** WP ids named anywhere in a string, de-duplicated, in order. */
export function wpIds(text) {
  const out = [];
  for (const m of norm(text).matchAll(/\bWP-(\d{1,3}[a-z]?)\b/g)) {
    const id = `WP-${m[1]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * DEVIATIONS § numbers named in a string. `§9` is ambiguous — it is a deviation
 * in `DEVIATIONS.md §9` and a plan section in `` `08` §9 `` — so a bare § counts
 * only once the sentence has named DEVIATIONS, and never when the reference
 * carries another document's name.
 */
export function devRefs(text) {
  const out = [];
  const t = norm(text);
  let armed = false;
  for (const m of t.matchAll(/([^\s]{0,26}\s?)§\s?(\d{1,3})(?:\.\d+)?/g)) {
    const before = m[1] || '';
    const upto = t.slice(0, m.index);
    if (/DEVIATIONS/i.test(upto)) armed = true;
    const named = /DEVIATIONS/i.test(before);
    const otherDoc = /\.md`?\s*$|`\d{2}`\s*$|^\s*`?\d{2}[-`]/.test(before) && !named;
    if (!named && (otherDoc || !armed)) continue;
    const n = Number(m[2]);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// ─── 00-REQUIREMENTS.md ──────────────────────────────────────────────────────

export function parsePrinciples(md, warn) {
  const body = section(md, /^## 1\. Product principles/, /^## \d/);
  const rows = tables(body).flatMap((t) => t.rows);
  const out = rows
    .filter((r) => /^P-\d+$/.test((r[0] || '').trim()))
    .map((r) => ({
      id: r[0].trim(),
      text: stripMd(r[1] || ''),
      source: stripMd(r[2] || ''),
      date: stripMd(r[3] || ''),
    }));
  if (!out.length) warn('00-REQUIREMENTS.md §1: no principles table found');
  return out;
}

const FIELD = (block, name) => {
  const re = new RegExp(`\\*\\*${name}[.:]\\*\\*([\\s\\S]*?)(?=\\n?\\*\\*[A-Z][a-z]|$)`);
  const m = block.match(re);
  return m ? flat(m[1].replace(/^\s*[—-]\s*$/, '')) : '';
};

export function parseRequirements(md, warn, caps = {}) {
  const capField = caps.field || 130;
  const summary = section(md, /^### 2\.0 Summary table/, /^### 2\./);
  const meta = new Map();
  for (const t of tables(summary)) {
    for (const r of t.rows) {
      const id = (r[0] || '').trim();
      if (!/^R-\d+$/.test(id)) continue;
      meta.set(id, { title: stripMd(r[1] || ''), area: stripMd(r[2] || ''), status: statusOf(r[3] || '', 'planned') });
    }
  }
  if (!meta.size) warn('00-REQUIREMENTS.md §2.0: no summary table found');

  const body = section(md, /^## 2\. Requirements register/, /^## 3\./);
  const lines = body.split('\n');
  const marks = [];
  let area = '';
  for (let i = 0; i < lines.length; i += 1) {
    const h = lines[i].match(/^### 2\.\d+\s+(.+)$/);
    if (h) { area = stripMd(h[1]); continue; }
    const m = lines[i].match(/^\*\*(R-\d+)\s*[—–-]\s*(.+?)\*\*\s*$/);
    if (m) marks.push({ id: m[1], title: stripMd(m[2]), area, at: i });
  }
  const out = [];
  for (let k = 0; k < marks.length; k += 1) {
    const mark = marks[k];
    const end = k + 1 < marks.length ? marks[k + 1].at : lines.length;
    const block = lines.slice(mark.at + 1, end).join('\n');
    const known = meta.get(mark.id) || {};
    const bl = lines.slice(mark.at + 1, end);
    let quote = '';
    let quoteDate = '';
    let qi = bl.findIndex((l) => /^[*_](Owner|The owner|Derived|Asked|Owner’s)/i.test(l));
    if (qi >= 0) {
      let txt = bl[qi];
      for (let j = qi + 1; j < bl.length && bl[j].trim() && !/^\*\*/.test(bl[j]); j += 1) txt += ` ${bl[j]}`;
      const qm = txt.match(/^[*_](.+?)[*_]\s*([\s\S]*)$/);
      if (qm) {
        const dm = flat(qm[1]).match(/,\s*(\d{1,2} \w+ \d{4})/);
        quoteDate = dm ? dm[1] : '';
        quote = flat(qm[2], caps.quote || 150).replace(/^["“]\s*/, '').replace(/\s*["”]$/, '');
      }
    }
    const status = statusOf(FIELD(block, 'Status'), known.status || 'planned');
    const impl = FIELD(block, 'Implemented by');
    out.push({
      id: mark.id,
      title: known.title || mark.title,
      area: known.area || mark.area,
      status,
      statusText: flat(FIELD(block, 'Status'), 120).replace(/\.$/, '') || status,
      quote,
      quoteDate,
      interpretation: flat(FIELD(block, 'Interpretation'), capField),
      why: flat(FIELD(block, 'Why'), 130),
      implementedBy: flat(impl, 110),
      wps: wpIds(impl),
      devs: devRefs(impl),
      notes: flat(FIELD(block, 'Notes'), 120),
    });
  }
  // Ids that only ever appeared in the summary table still belong in the register.
  for (const [id, m] of meta) {
    if (!out.some((r) => r.id === id)) {
      out.push({
        id, title: m.title, area: m.area, status: m.status, statusText: m.status,
        quote: '', quoteDate: '', interpretation: '', why: '', implementedBy: '',
        wps: [], devs: [], notes: '',
      });
    }
  }
  if (!out.length) warn('00-REQUIREMENTS.md §2: no requirement entries found');
  out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}

export function parseStories(md, warn) {
  const body = section(md, /^## 3\. User stories/, /^## 4\./);
  const out = [];
  const re = /^\*\*(S-\d+)\s*[—–-]\s*([\s\S]*?)\*\*\s*(?:\*\(([^)]*)\)\*)?\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(body))) marks.push({ id: m[1], title: stripMd(m[2]).replace(/^["“]|["”]$/g, ''), date: flat(m[3] || ''), at: m.index + m[0].length });
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? body.lastIndexOf('\n**', marks[i + 1].at) : body.length;
    const text = body.slice(marks[i].at, end > marks[i].at ? end : body.length);
    const reqs = [];
    for (const r of text.matchAll(/\bR-(\d{3})\b/g)) if (!reqs.includes(`R-${r[1]}`)) reqs.push(`R-${r[1]}`);
    const principles = [];
    for (const p of text.matchAll(/\bP-(\d{2})\b/g)) if (!principles.includes(`P-${p[1]}`)) principles.push(`P-${p[1]}`);
    out.push({
      id: marks[i].id,
      title: marks[i].title,
      date: marks[i].date,
      body: flat(text.replace(/→[\s\S]*$/, ''), 340),
      requirements: reqs,
      principles,
    });
  }
  if (!out.length) warn('00-REQUIREMENTS.md §3: no user stories found');
  return out;
}

export function parseOpenItems(md, warn) {
  const four = section(md, /^## 4\. Open requirements/, /^## 5\./);
  const items = [];
  for (const t of tables(four)) {
    for (const r of t.rows) {
      const wp = stripMd(r[0] || '');
      if (!/^WP-/.test(wp)) continue;
      items.push({ kind: 'open requirement', wp, text: stripMd(r[1] || ''), requirements: (stripMd(r[2] || '').match(/R-\d+/g) || []) });
    }
  }
  const five = section(md, /^## 5\. What is not traced/, /^## \d/);
  const untraced = [];
  for (const m of five.matchAll(/^- ([\s\S]*?)(?=\n- |\n##|$)/gm)) untraced.push(flat(m[1], 460));
  if (!items.length) warn('00-REQUIREMENTS.md §4: no open-requirements table found');
  if (!untraced.length) warn('00-REQUIREMENTS.md §5: no untraced list found');
  return { items, untraced };
}

// ─── 08-PLAN-V2-100X.md §9 and §13, 06 and 07 work packages ──────────────────

const pick = (header, ...names) => {
  for (const n of names) {
    const i = header.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
};

function expandRange(headline) {
  // "WP-66 to WP-71", "WP-87 and WP-89", "WP-36"
  const ids = wpIds(headline);
  const range = headline.match(/\bWP-(\d{1,3})\s+to\s+WP-(\d{1,3})\b/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const all = [];
    for (let n = a; n <= b; n += 1) all.push(`WP-${String(n).padStart(2, '0')}`);
    for (const id of ids) if (!all.includes(id)) all.push(id);
    return all;
  }
  return ids;
}

export function parseWorkPackages(sources, warn) {
  const { plan = '', workplan = '', studio = '', changelog = '', deviations = '' } = sources;
  const byId = new Map();
  const add = (pkg) => {
    const prev = byId.get(pkg.id);
    if (!prev) { byId.set(pkg.id, pkg); return; }
    if (prev.from === 'table' || pkg.from !== 'table') return;
    byId.set(pkg.id, pkg);
  };

  const nine = section(plan, /^## 9\. Work packages/, /^## 10\./);
  if (!nine) warn('08-PLAN-V2-100X.md §9: section not found');

  for (const t of tables(nine)) {
    const iId = pick(t.header, 'id');
    if (iId < 0) continue;
    const iTitle = pick(t.header, 'title');
    const iOwner = pick(t.header, 'owner');
    const iSize = pick(t.header, 'size');
    const iDep = pick(t.header, 'depends');
    const iAcc = pick(t.header, 'accepted', 'acceptance');
    const iSt = pick(t.header, 'status');
    for (const r of t.rows) {
      const id = stripMd(r[iId] || '');
      if (!/^WP-\d/.test(id)) continue;
      const statusText = stripMd(r[iSt] || '');
      add({
        id,
        title: stripMd(r[iTitle] || ''),
        owner: stripMd(r[iOwner] || ''),
        size: stripMd(r[iSize] || ''),
        depends: stripMd(r[iDep] || '').replace(/^—$/, ''),
        acceptance: flat(r[iAcc] || '', 150),
        status: statusOf(statusText, 'planned'),
        statusText: flat(statusText, 150),
        devs: devRefs(statusText),
        source: '08 §9 table',
        from: 'table',
      });
    }
  }

  const narrative = (md, label, headRe) => {
    const lines = norm(md).split('\n');
    const marks = [];
    for (let i = 0; i < lines.length; i += 1) if (headRe.test(lines[i])) marks.push(i);
    for (let k = 0; k < marks.length; k += 1) {
      const head = lines[marks[k]].replace(/^#+\s*/, '');
      const end = k + 1 < marks.length ? marks[k + 1] : lines.length;
      const block = lines.slice(marks[k] + 1, end).join('\n');
      const parts = head.split('·').map((p) => p.trim());
      const ids = expandRange(parts[0] || head);
      const title = stripMd(parts[1] || parts[0] || '').replace(/^WP-\d+[a-z]?\s*[·—-]?\s*/, '');
      const accM = block.match(/\*\*Accepted when[:.]?\*\*([\s\S]*?)(?=\n\n|\n\*\*|$)/);
      for (const id of ids) {
        let statusText = '';
        const headSt = head.match(/(landed[^·]*|\*\*DONE\*\*|\bDONE\b|superseded[^·]*|absorbed[^·]*|partly landed)/i);
        if (headSt) statusText = stripMd(headSt[1]);
        if (!statusText) {
          const bodySt = block.match(/\*\*(done|DONE|superseded by [^*]+|landed[^*]*)\*\*/);
          if (bodySt) statusText = stripMd(bodySt[1]);
        }
        let status = statusText ? statusOf(statusText, 'planned') : '';
        if (!status) {
          const proof = new RegExp(`\\b${id}\\b`);
          const inChangelog = proof.test(changelog);
          const inDeviations = new RegExp(`^## \\d+\\..*\\b${id}\\b`, 'm').test(deviations);
          if (inChangelog || inDeviations) {
            status = 'done';
            statusText = `done (pre-table) — named by ${inChangelog ? 'CHANGELOG' : 'DEVIATIONS'}`;
          } else {
            status = 'unknown';
            statusText = 'unknown';
          }
        }
        add({
          id,
          title: ids.length > 1 ? `${title} (${ids[0]}–${ids[ids.length - 1]})` : title,
          owner: stripMd((parts.find((p) => /^`[A-Z]{2}`$/.test(p)) || '').replace(/`/g, '')),
          size: stripMd(parts.find((p) => /^(S|M|L|XL|[\d.]+d)$/.test(p)) || ''),
          depends: stripMd((head.match(/after ([^·]+)/) || [])[1] || ''),
          acceptance: flat(accM ? accM[1] : block.split('\n\n')[0] || '', 150),
          status,
          statusText: flat(statusText, 150),
          devs: devRefs(statusText),
          source: label,
          from: 'narrative',
        });
      }
    }
  };

  narrative(nine, '08 §9', /^### WP-\d/);
  narrative(workplan, '06 workplan', /^### WP-\d/);
  narrative(section(studio, /^## 10\. Work packages/, /^## 11\./), '07 Studio §10', /^### WP-\d/);

  const out = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (!out.length) warn('no work packages parsed');
  return out;
}

export function parseOwnerDecisions(plan, warn) {
  const body = section(plan, /^## 13\. Decisions and actions/, /^## 14\./);
  if (!body) { warn('08-PLAN-V2-100X.md §13: section not found'); return []; }
  const closed = new Set();
  const closedM = flat(body.slice(0, 600)).match(/Items? ([\d,\sand]+?)\s+(?:are|is)\s+closed/i);
  if (closedM) for (const n of closedM[1].match(/\d+/g) || []) closed.add(Number(n));
  const lines = body.split('\n');
  const out = [];
  let group = '';
  let cur = null;
  const flush = () => { if (cur) { cur.text = flat(cur.text, 280); out.push(cur); cur = null; } };
  for (const line of lines) {
    const g = line.match(/^\*\*([^*]+)\*\*\s*$/);
    if (g) { flush(); group = stripMd(g[1]); continue; }
    const item = line.match(/^(\d{1,2})\.\s+(.*)$/);
    if (item) {
      flush();
      const n = Number(item[1]);
      const titleM = item[2].match(/^\*\*(.+?)\*\*/) || item[2].match(/^([^.]{3,90})[.,]/);
      cur = {
        n,
        title: stripMd(titleM ? titleM[1] : item[2]).replace(/[.,]$/, ''),
        group,
        state: closed.has(n) ? 'done' : 'open',
        text: item[2],
        wps: [],
        devs: [],
      };
      continue;
    }
    if (cur) cur.text += ` ${line.trim()}`;
  }
  flush();
  for (const d of out) { d.wps = wpIds(d.text); d.devs = devRefs(d.text); }
  if (!out.length) warn('08-PLAN-V2-100X.md §13: no numbered decisions found');
  return out;
}

// ─── DEVIATIONS.md ───────────────────────────────────────────────────────────

export function parseDeviations(md, warn, cap = 140) {
  const lines = norm(md).split('\n');
  const marks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^## (\d{1,3})\.\s*(.+?)\s*$/);
    if (m) marks.push({ n: Number(m[1]), title: stripMd(m[2]), at: i });
  }
  const out = [];
  for (let k = 0; k < marks.length; k += 1) {
    const end = k + 1 < marks.length ? marks[k + 1].at : lines.length;
    const block = lines.slice(marks[k].at + 1, end);
    let para = '';
    for (const line of block) {
      if (!line.trim()) { if (para) break; continue; }
      if (/^\s*[-|>#]/.test(line) && !para) continue;
      para += (para ? ' ' : '') + line.trim();
      if (para.length > cap * 2) break;
    }
    const wps = wpIds(`${marks[k].title} ${para}`);
    out.push({
      n: marks[k].n,
      title: marks[k].title.replace(/\s*[—–-]\s*\*\*RAISE\*\*\s*$/, ''),
      raise: /RAISE/.test(marks[k].title) || /\*\*RAISE\*\*/.test(para),
      summary: flat(para, cap),
      wps,
    });
  }
  if (!out.length) warn('DEVIATIONS.md: no numbered entries found');
  return out;
}

// ─── 13-ARCHITECTURE-AUDIT.md + 13-audit-map.json ────────────────────────────

export function parseArchitecture({ audit = '', map = null, blueprint = '' }, warn) {
  const layers = [];
  const facts = { modules: 0, edges: 0, cycles: 0, srcToPublic: 0, publicToSrc: 0, capViolators: 0, capChecks: 0, generatedAt: '', repoVersion: '' };
  const cycles = [];
  const capExemptions = [];
  if (map && map.layers && map.layers.stats) {
    const order = (map.layers.order || Object.keys(map.layers.stats));
    const seen = new Set();
    for (const name of order) {
      const s = map.layers.stats[name];
      if (!s) continue;
      seen.add(name);
      layers.push({ name, count: s.count, lines: s.lines, tier: name.startsWith('public-') ? 'client' : 'server' });
    }
    for (const [name, s] of Object.entries(map.layers.stats)) {
      if (!seen.has(name)) layers.push({ name, count: s.count, lines: s.lines, tier: 'support' });
    }
  } else warn('13-audit-map.json: no layer stats');
  if (map && map.totals) {
    facts.modules = map.totals.files || 0;
    facts.edges = map.totals.edges || 0;
    facts.cycles = map.totals.cycles || 0;
    facts.srcToPublic = map.totals.srcToPublicEdges || 0;
    facts.publicToSrc = map.totals.publicToSrcViolations || 0;
    facts.capViolators = map.totals.capViolatorsNonTest || 0;
    facts.capChecks = map.totals.capGateChecks || 0;
    facts.linesSrc = map.totals.linesSrc || 0;
    facts.linesPublic = map.totals.linesPublic || 0;
  }
  if (map) { facts.generatedAt = map.generatedAt || ''; facts.repoVersion = map.repoVersion || ''; }
  for (const c of (map && map.cycles) || []) cycles.push(c);
  if (map && map.cap && Array.isArray(map.cap.violators)) {
    for (const v of map.cap.violators) capExemptions.push(typeof v === 'string' ? { file: v, lines: 0 } : { file: v.file || v.path || '', lines: v.lines || 0 });
  }
  const boundary = {
    rule: (map && map.boundary && map.boundary.rule) || '',
    srcToPublic: ((map && map.boundary && map.boundary.srcToPublic) || []).map((p) => (Array.isArray(p) ? p : [p, ''])),
  };

  const invBody = section(audit, /^## 2\. Invariants/, /^## 3\./);
  const invariants = [];
  const enforced = (map && map.invariants) || {};
  for (const t of tables(invBody)) {
    for (const r of t.rows) {
      const id = stripMd(r[0] || '');
      if (!/^I-\d+$/.test(id)) continue;
      const held = stripMd(r[3] || '');
      const key = Object.keys(enforced).find((k) => k.startsWith(id));
      invariants.push({
        id,
        name: stripMd((r[1] || '').split('.**')[0]),
        text: stripMd(r[1] || ''),
        enforcedIn: stripMd(r[2] || '').replace(/^—$/, ''),
        heldBy: held,
        modules: key ? (enforced[key].enforcedIn || []) : [],
        status: /convention/i.test(held) || /—/.test(stripMd(r[2] || '')) ? 'in progress' : 'done',
      });
    }
  }
  if (!invariants.length) warn('13-ARCHITECTURE-AUDIT.md §2: no invariants table');

  const findings = [];
  const fBody = section(audit, /^## 7\. Findings/, /^## 8\./);
  const fLines = fBody.split('\n');
  const fMarks = [];
  for (let i = 0; i < fLines.length; i += 1) {
    const m = fLines[i].match(/^### (A-\d+)\s*·\s*(.+)$/);
    if (m) fMarks.push({ id: m[1], rest: m[2], at: i });
  }
  for (let k = 0; k < fMarks.length; k += 1) {
    const end = k + 1 < fMarks.length ? fMarks[k + 1].at : fLines.length;
    const block = fLines.slice(fMarks[k].at + 1, end).join('\n');
    const parts = fMarks[k].rest.split('·').map((p) => stripMd(p));
    const resolved = /\bRESOLVED\b/.test(block);
    findings.push({
      id: fMarks[k].id,
      title: parts[0] || '',
      kind: (parts[1] || '').toLowerCase(),
      size: parts[2] || '',
      status: resolved ? 'done' : 'planned',
      statusText: resolved ? 'resolved' : 'open',
      summary: flat(block.replace(/^>\s?/gm, '').split('\n\n').slice(0, 2).join(' '), 210),
      wps: wpIds(block),
      devs: devRefs(block),
    });
  }
  if (!findings.length) warn('13-ARCHITECTURE-AUDIT.md §7: no findings');

  const outline = [];
  for (const line of norm(blueprint).split('\n')) {
    const m = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (m) outline.push({ level: m[1].length, title: stripMd(m[2]) });
  }
  if (!outline.length) warn('02-ARCHITECTURE.md: no headings');

  return { layers, facts, cycles, capExemptions, boundary, invariants, findings, outline };
}

// ─── 07-STUDIO-DESIGN.md §2 with §10 status ──────────────────────────────────

export function parseStudioLoop(md, warn) {
  const loop = section(md, /^## 2\. The loop/, /^## 3\./);
  const wpBody = section(md, /^## 10\. Work packages/, /^## 11\./);
  const done = [];
  for (const m of wpBody.matchAll(/^### (WP-\d+)\s*·\s*([^·]+)·[\s\S]*?$/gm)) {
    const head = m[0];
    done.push({ id: m[1], title: stripMd(m[2]), done: /\*\*DONE\*\*/.test(head) });
  }
  const steps = [];
  for (const m of loop.matchAll(/^\*\*([A-Z][^*]{1,30}?)\.?\*\*\s*([\s\S]*?)(?=\n\n\*\*|$)/gm)) {
    const name = stripMd(m[1]).replace(/\.$/, '');
    const text = flat(m[2], 300);
    const refs = (text.match(/§\d+(?:\.\d+)?/g) || []);
    const builtPkg = done.find((p) => p.done && new RegExp(`\\b${name}\\b`, 'i').test(p.title));
    steps.push({ name, text, status: builtPkg ? 'done' : 'planned', wp: builtPkg ? builtPkg.id : '', refs });
  }
  if (!steps.length) warn('07-STUDIO-DESIGN.md §2: no loop steps found');
  return { steps, packages: done };
}

// ─── 11-LOOK-CONTROL-CENTRE.md and 12-MOTION-AND-CREW.md ─────────────────────

export function parseFeatureFacts({ look = '', motion = '' }, warn) {
  const presets = [];
  const presetBody = section(look, /^## 3\. Presets/, /^## \d/);
  for (const t of tables(presetBody)) {
    for (const r of t.rows) {
      const name = stripMd(r[0] || '');
      if (!name || /^preset$/i.test(name)) continue;
      presets.push({ group: 'Look preset', title: name, detail: flat(r[1] || '', 200), extra: flat(r[2] || '', 160), source: 'plan/11 §3' });
    }
  }
  const options = [];
  for (const m of look.matchAll(/^### 1\.([a-g])\s+(.+?)\s*$/gm)) {
    options.push({ group: 'Look option set', title: stripMd(m[2]), detail: '', extra: '', source: `plan/11 §1.${m[1]}` });
  }
  const animations = [];
  const animBody = section(motion, /^## 2\. Character life/, /^## 3\./);
  for (const t of tables(animBody)) {
    for (const r of t.rows) {
      const name = stripMd(r[0] || '');
      if (!name || /^animation$/i.test(name)) continue;
      animations.push({
        group: 'Animation',
        title: name,
        detail: flat(r[1] || '', 260),
        extra: [stripMd(r[2] || ''), stripMd(r[4] || '') && `reduced: ${stripMd(r[4])}`].filter(Boolean).join(' · '),
        source: 'plan/12 §2',
      });
    }
  }
  if (!presets.length) warn('plan/11 §3: no preset table');
  if (!animations.length) warn('plan/12 §2: no animation table');
  return [...presets, ...options, ...animations];
}

// ─── CHANGELOG.md ────────────────────────────────────────────────────────────

export function parseChangelog(md, warn, caps = {}) {
  const lines = norm(md).split('\n');
  const marks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^## (.+?)\s*$/);
    if (m) marks.push({ head: stripMd(m[1]), at: i });
  }
  const releases = [];
  const shipped = [];
  for (let k = 0; k < marks.length; k += 1) {
    const end = k + 1 < marks.length ? marks[k + 1].at : lines.length;
    const block = lines.slice(marks[k].at + 1, end).join('\n');
    const head = marks[k].head;
    const dm = head.match(/^([\w.]+)\s*[—–-]\s*(.+)$/);
    const version = dm ? dm[1] : head;
    const date = dm ? dm[2] : '';
    const groups = [];
    const bLines = block.split('\n');
    let group = 'Notes';
    let count = 0;
    for (let i = 0; i < bLines.length; i += 1) {
      const g = bLines[i].match(/^### (.+?)\s*$/);
      if (g) { group = stripMd(g[1]); continue; }
      const b = bLines[i].match(/^- (.*)$/);
      if (!b) continue;
      let text = b[1];
      for (let j = i + 1; j < bLines.length && /^\s+\S/.test(bLines[j]); j += 1) text += ` ${bLines[j].trim()}`;
      const tm = text.match(/^\*\*(.+?)\*\*/);
      const title = stripMd(tm ? tm[1] : text.split('. ')[0] || text).replace(/\.$/, '');
      const entry = {
        group,
        title: flat(title, 110),
        detail: flat(text.replace(/^\*\*.+?\*\*\.?\s*/, ''), caps.detail || 90),
        wps: wpIds(text),
        devs: devRefs(text),
      };
      count += 1;
      groups.push(entry);
      if (k === 0) shipped.push({ ...entry, source: version });
    }
    const highlights = groups.slice(0, 6).map((g) => g.title);
    releases.push({ version, date, headline: head, count, highlights, groups: [...new Set(groups.map((g) => g.group))] });
  }
  if (!releases.length) warn('CHANGELOG.md: no release headings found');
  return { releases, shipped };
}
