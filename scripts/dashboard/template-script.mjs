// The page client script. Moved verbatim out of template.mjs to keep each file
// under the 900-line ceiling; template.mjs drops it between its <script> tags.

export function clientScript(data) {
  return `(function () {
  'use strict';
  var RAW = JSON.parse(document.getElementById('hub-data').textContent);
  var ARRAYS = ['wps', 'devs', 'devsAll', 'requirements', 'stories', 'principles', 'highlights', 'groups', 'modules', 'refs'];
  function hydrate(p) {
    if (!p || !p.k) return [];
    return p.r.map(function (row) {
      var o = {};
      for (var i = 0; i < p.k.length; i += 1) {
        var v = row[i];
        o[p.k[i]] = v === undefined ? (ARRAYS.indexOf(p.k[i]) >= 0 ? [] : '') : v;
      }
      return o;
    });
  }
  var D = {
    meta: RAW.meta,
    principles: hydrate(RAW.principles),
    requirements: hydrate(RAW.requirements),
    stories: hydrate(RAW.stories),
    openRequirements: hydrate(RAW.openRequirements),
    untraced: RAW.untraced || [],
    workPackages: hydrate(RAW.workPackages),
    decisions: hydrate(RAW.decisions),
    deviations: hydrate(RAW.deviations),
    features: hydrate(RAW.features),
    shipped: hydrate(RAW.shipped),
    releases: hydrate(RAW.releases),
    ownerItems: hydrate(RAW.ownerItems),
    studio: { steps: hydrate(RAW.studio.steps), packages: hydrate(RAW.studio.packages) },
    arch: {
      layers: hydrate(RAW.architecture.layers),
      invariants: hydrate(RAW.architecture.invariants),
      findings: hydrate(RAW.architecture.findings),
      outline: hydrate(RAW.architecture.outline),
      facts: RAW.architecture.facts,
      cycles: RAW.architecture.cycles || [],
      capExemptions: hydrate(RAW.architecture.capExemptions),
      boundary: RAW.architecture.boundary || { rule: '', srcToPublic: [] }
    }
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var TAGCLASS = {
    done: 'done', 'in progress': 'progress', planned: 'planned', superseded: 'dim',
    declined: 'dim', blocked: 'stop', unknown: 'unknown', open: 'progress'
  };
  var STCOLOR = {
    done: 'var(--done)', 'in progress': 'var(--prog)', planned: 'var(--plan)',
    superseded: 'var(--dim)', declined: 'var(--dim)', blocked: 'var(--stop)', unknown: 'var(--line)'
  };
  function tag(status, label) {
    return '<span class="tag ' + (TAGCLASS[status] || 'planned') + '">' + esc(label || status) + '</span>';
  }
  function md(s) {
    var t = esc(s);
    t = t.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    t = t.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[\\s(])_([^_]{2,60})_(?=[\\s.,;:)]|$)/g, '$1<em>$2</em>');
    t = t.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '$1');
    return t;
  }
  function refLinks(text) {
    return md(text)
      .replace(/\\b(WP-\\d{1,3}[a-z]?)\\b/g, function (m) { return has('wp', m) ? link('wp', m, m) : m; })
      .replace(/\\b(R-\\d{3})\\b/g, function (m) { return has('req', m) ? link('req', m, m) : m; })
      .replace(/\\b(S-\\d{2})\\b/g, function (m) { return has('story', m) ? link('story', m, m) : m; });
  }
  function link(kind, id, label) {
    return '<a class="tag ref" href="#' + kind + '/' + encodeURIComponent(id) + '">' + esc(label) + '</a>';
  }
  var INDEX = {};
  function indexAll() {
    INDEX.req = {}; INDEX.wp = {}; INDEX.dev = {}; INDEX.story = {};
    INDEX.dec = {}; INDEX.feat = {}; INDEX.rel = {}; INDEX.arch = {};
    D.requirements.forEach(function (r) { INDEX.req[r.id] = r; });
    D.workPackages.forEach(function (r) { INDEX.wp[r.id] = r; });
    D.deviations.forEach(function (r) { INDEX.dev[r.key || String(r.n)] = r; });
    D.stories.forEach(function (r) { INDEX.story[r.id] = r; });
    D.decisions.forEach(function (r) { INDEX.dec[String(r.n)] = r; });
    featureList().forEach(function (r) { INDEX.feat[r.key] = r; });
    D.releases.forEach(function (r) { INDEX.rel[r.version] = r; });
    D.arch.invariants.forEach(function (r) { INDEX.arch[r.id] = r; });
    D.arch.findings.forEach(function (r) { INDEX.arch[r.id] = r; });
  }
  function has(kind, id) { return !!(INDEX[kind] && INDEX[kind][id]); }
  var FEATS = null;
  function featureList() {
    if (FEATS) return FEATS;
    FEATS = [];
    D.shipped.forEach(function (f, i) {
      FEATS.push({
        key: 'F' + (i + 1), kind: 'shipped', group: f.group, title: f.title, detail: f.detail,
        wps: f.wps || [], devs: f.devs || [], source: 'CHANGELOG ' + f.source, status: 'done'
      });
    });
    D.features.forEach(function (f, i) {
      FEATS.push({
        key: 'P' + (i + 1), kind: 'spec', group: f.group, title: f.title,
        detail: [f.detail, f.extra].filter(Boolean).join(' · '), wps: [], devs: [],
        source: f.source, status: 'planned'
      });
    });
    return FEATS;
  }
  function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }
  function counts(items, key) {
    var m = {};
    items.forEach(function (i) { var k = i[key] || 'unknown'; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  var ORDER = ['done', 'in progress', 'planned', 'unknown', 'blocked', 'superseded', 'declined'];
  function meter(items) {
    var c = counts(items, 'status');
    var total = items.length;
    var bar = '', legend = '';
    ORDER.forEach(function (s) {
      if (!c[s]) return;
      bar += '<i style="width:' + pct(c[s], total) + '%;background:' + STCOLOR[s] + '" title="' + esc(s + ' ' + c[s]) + '"></i>';
      legend += '<span><i style="background:' + STCOLOR[s] + '"></i>' + esc(s) + ' <b class="num">' + c[s] + '</b></span>';
    });
    return '<div class="meter" role="img" aria-label="' + esc(ORDER.filter(function (s) { return c[s]; })
      .map(function (s) { return c[s] + ' ' + s; }).join(', ')) + '">' + bar + '</div><div class="legend">' + legend + '</div>';
  }

  // ── state ─────────────────────────────────────────────────────────────────
  var TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'packages', label: 'Work packages' },
    { id: 'requirements', label: 'Requirements' },
    { id: 'stories', label: 'User stories' },
    { id: 'features', label: 'Features' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'releases', label: 'Releases' }
  ];
  var S = { tab: 'overview', view: {}, q: {}, status: {}, area: {}, sort: {} };
  function load() {
    try {
      var raw = localStorage.getItem('deckhq-hub');
      if (raw) {
        var v = JSON.parse(raw);
        if (v && typeof v === 'object') {
          S.tab = v.tab || S.tab;
          S.view = v.view || {}; S.q = v.q || {}; S.status = v.status || {};
          S.area = v.area || {}; S.sort = v.sort || {};
        }
      }
    } catch (e) { /* private window, blocked storage: defaults are fine */ }
    if (!TABS.some(function (t) { return t.id === S.tab; })) S.tab = 'overview';
  }
  function save() {
    try { localStorage.setItem('deckhq-hub', JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  // ── list configuration ────────────────────────────────────────────────────
  var LISTS = {
    packages: {
      kind: 'wp', empty: 'No work package matches.',
      items: function () { return D.workPackages; },
      id: function (i) { return i.id; },
      title: function (i) { return i.title || i.id; },
      sub: function (i) { return i.acceptance || i.statusText; },
      area: function (i) { return i.source; },
      areaLabel: 'Source',
      sorts: [['id', 'Id'], ['status', 'Status'], ['title', 'Title'], ['area', 'Source']],
      search: function (i) { return [i.id, i.title, i.acceptance, i.statusText, i.owner, i.depends].join(' '); }
    },
    requirements: {
      kind: 'req', empty: 'No requirement matches.',
      items: function () { return D.requirements; },
      id: function (i) { return i.id; },
      title: function (i) { return i.title; },
      sub: function (i) { return i.quote || i.interpretation; },
      area: function (i) { return i.area; },
      areaLabel: 'Area',
      sorts: [['id', 'Id'], ['status', 'Status'], ['area', 'Area'], ['title', 'Title']],
      search: function (i) { return [i.id, i.title, i.area, i.quote, i.interpretation, i.why, i.notes, i.implementedBy].join(' '); }
    },
    stories: {
      kind: 'story', empty: 'No story matches.',
      items: function () { return D.stories.map(function (s) { return Object.assign({ status: 'done' }, s, { status: storyStatus(s) }); }); },
      id: function (i) { return i.id; },
      title: function (i) { return i.title; },
      sub: function (i) { return i.body; },
      area: function (i) { return i.date || 'undated'; },
      areaLabel: 'Said',
      sorts: [['id', 'Id'], ['status', 'Status'], ['title', 'Title']],
      search: function (i) { return [i.id, i.title, i.body, (i.requirements || []).join(' ')].join(' '); }
    },
    features: {
      kind: 'feat', empty: 'No feature matches.',
      items: function () { return featureList(); },
      id: function (i) { return i.key; },
      title: function (i) { return i.title; },
      sub: function (i) { return i.detail; },
      area: function (i) { return i.group; },
      areaLabel: 'Group',
      sorts: [['area', 'Group'], ['title', 'Title'], ['status', 'Status']],
      search: function (i) { return [i.title, i.detail, i.group, i.source].join(' '); }
    },
    decisions: {
      kind: 'dev', empty: 'No decision matches.',
      items: function () {
        return D.deviations.map(function (d) {
          return Object.assign({}, d, { status: d.raise ? 'in progress' : 'done', id: d.key || String(d.n) });
        });
      },
      id: function (i) { return i.key || String(i.n); },
      title: function (i) { return i.title; },
      sub: function (i) { return i.summary; },
      area: function (i) { return (i.wps && i.wps[0]) || 'no package'; },
      areaLabel: 'Package',
      sorts: [['n', 'Number'], ['title', 'Title'], ['status', 'State']],
      search: function (i) { return ['§' + i.n, i.title, i.summary, (i.wps || []).join(' ')].join(' '); }
    }
  };
  function storyStatus(s) {
    var reqs = (s.requirements || []).map(function (id) { return INDEX.req[id]; }).filter(Boolean);
    if (!reqs.length) return 'planned';
    if (reqs.every(function (r) { return r.status === 'done'; })) return 'done';
    if (reqs.some(function (r) { return r.status === 'done' || r.status === 'in progress'; })) return 'in progress';
    return 'planned';
  }

  function tabCount(id) {
    if (LISTS[id]) return LISTS[id].items().length;
    if (id === 'releases') return D.releases.length;
    if (id === 'architecture') return D.arch.findings.length;
    return 0;
  }

  // ── chrome ────────────────────────────────────────────────────────────────
  function renderChrome() {
    var m = D.meta;
    document.getElementById('tagline').textContent = m.tagline;
    var na = function (v) { return (v === null || v === undefined || v === '') ? '<span class="tag dim">not supplied</span>' : '<b class="num">' + esc(v) + '</b>'; };
    var ci = m.ci ? '<span class="dot ' + (m.ci === 'green' ? '' : 'red') + '"></span> CI ' + esc(m.ci)
      : '<span class="dot grey"></span> CI <span class="tag dim">not supplied</span>';
    document.getElementById('statusline').innerHTML = [
      ci,
      'version <b class="num">' + esc(m.version || 'unknown') + '</b>',
      'npm ' + na(m.npm),
      'tests ' + na(m.tests),
      'goldens ' + na(m.goldens),
      'built ' + esc(m.generatedAt),
      'audit map ' + esc(m.auditAt || 'unknown')
    ].join('<span aria-hidden="true">·</span>');

    var reqDone = D.requirements.filter(function (r) { return r.status === 'done'; }).length;
    var wpDone = D.workPackages.filter(function (r) { return r.status === 'done'; }).length;
    var openDec = D.decisions.filter(function (d) { return d.state === 'open'; }).length;
    var stats = [
      ['Requirements', reqDone + '<small>/' + D.requirements.length + '</small>', pct(reqDone, D.requirements.length) + '% done'],
      ['Work packages', wpDone + '<small>/' + D.workPackages.length + '</small>', pct(wpDone, D.workPackages.length) + '% done'],
      ['Decision log', String(D.deviations.length), 'numbered deviations'],
      ['Needs you', String(openDec), 'open owner decisions'],
      ['Modules', String(D.arch.facts.modules || 0), (D.arch.facts.edges || 0) + ' imports · ' + (D.arch.facts.cycles || 0) + ' cycles']
    ];
    document.getElementById('stats').innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="k">' + esc(s[0]) + '</div><div class="v num">' + s[1] + '</div><div class="s">' + esc(s[2]) + '</div></div>';
    }).join('');

    var tabs = document.getElementById('tabs');
    tabs.innerHTML = TABS.map(function (t) {
      var c = tabCount(t.id);
      return '<button role="tab" type="button" id="tab-' + t.id + '" aria-controls="main" data-tab="' + t.id + '"'
        + ' aria-selected="' + (S.tab === t.id ? 'true' : 'false') + '">' + esc(t.label)
        + (c ? '<span class="cnt num">' + c + '</span>' : '') + '</button>';
    }).join('');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      S.tab = b.dataset.tab; save(); renderChrome(); renderTab();
    });
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  function renderTab() {
    var main = document.getElementById('main');
    if (LISTS[S.tab]) main.innerHTML = listHtml(S.tab);
    else if (S.tab === 'overview') main.innerHTML = overviewHtml();
    else if (S.tab === 'architecture') main.innerHTML = architectureHtml();
    else if (S.tab === 'releases') main.innerHTML = releasesHtml();
    wireTab();
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false');
    });
  }

  function filtered(tab) {
    var cfg = LISTS[tab];
    var items = cfg.items().slice();
    var q = (S.q[tab] || '').toLowerCase().trim();
    var st = S.status[tab] || [];
    var ar = S.area[tab] || [];
    if (q) items = items.filter(function (i) { return cfg.search(i).toLowerCase().indexOf(q) >= 0; });
    if (st.length) items = items.filter(function (i) { return st.indexOf(i.status) >= 0; });
    if (ar.length) items = items.filter(function (i) { return ar.indexOf(cfg.area(i)) >= 0; });
    var sort = S.sort[tab] || cfg.sorts[0][0];
    items.sort(function (a, b) {
      if (sort === 'n') return a.n - b.n;
      if (sort === 'status') return String(a.status).localeCompare(String(b.status)) || String(cfg.id(a)).localeCompare(String(cfg.id(b)), undefined, { numeric: true });
      if (sort === 'title') return String(cfg.title(a)).localeCompare(String(cfg.title(b)));
      if (sort === 'area') return String(cfg.area(a)).localeCompare(String(cfg.area(b))) || String(cfg.id(a)).localeCompare(String(cfg.id(b)), undefined, { numeric: true });
      return String(cfg.id(a)).localeCompare(String(cfg.id(b)), undefined, { numeric: true });
    });
    return items;
  }

  function listHtml(tab) {
    var cfg = LISTS[tab];
    var all = cfg.items();
    var items = filtered(tab);
    var view = S.view[tab] || 'tiles';
    var statuses = Object.keys(counts(all, 'status')).sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
    var areas = Object.keys(counts(all.map(function (i) { return { a: cfg.area(i) }; }), 'a')).sort();
    var sel = S.status[tab] || [], selA = S.area[tab] || [];
    var h = '<div class="panel">' + meter(all) + '</div>';
    h += '<div class="bar">'
      + '<label class="search"><span class="sr" hidden>Search</span>'
      + '<input id="q" type="search" placeholder="Search ' + esc(cfg.kind === 'dev' ? 'the decision log' : tab) + '" value="' + esc(S.q[tab] || '') + '" aria-label="Search ' + esc(tab) + '"><kbd>/</kbd></label>'
      + '<select class="sort" id="sort" aria-label="Sort">' + cfg.sorts.map(function (s) {
        return '<option value="' + s[0] + '"' + ((S.sort[tab] || cfg.sorts[0][0]) === s[0] ? ' selected' : '') + '>Sort: ' + esc(s[1]) + '</option>';
      }).join('') + '</select>'
      + '<span class="seg"><button type="button" data-view="tiles" aria-pressed="' + (view === 'tiles') + '">Tiles</button>'
      + '<button type="button" data-view="rows" aria-pressed="' + (view === 'rows') + '">Rows</button></span>'
      + '</div>';
    h += '<div class="chips" id="chips">'
      + statuses.map(function (s) {
        return '<button class="chip" type="button" data-f="status" data-v="' + esc(s) + '" aria-pressed="' + (sel.indexOf(s) >= 0) + '">' + esc(s) + '</button>';
      }).join('')
      + '<span class="chip flat" aria-hidden="true">' + esc(cfg.areaLabel) + '</span>'
      + areas.map(function (a) {
        return '<button class="chip" type="button" data-f="area" data-v="' + esc(a) + '" aria-pressed="' + (selA.indexOf(a) >= 0) + '">' + esc(a) + '</button>';
      }).join('') + '</div>';
    h += '<p class="count" role="status">' + items.length + ' of ' + all.length
      + (sel.length || selA.length || (S.q[tab] || '') ? ' · <button class="ghost" id="clear" type="button">Clear filters</button>' : '') + '</p>';
    if (!items.length) return h + '<p class="empty">' + esc(cfg.empty) + '</p>';
    h += '<div class="' + (view === 'rows' ? 'rows' : 'grid') + '" id="cards" role="list">'
      + items.map(function (i) { return cardHtml(cfg, i); }).join('') + '</div>';
    return h;
  }

  function cardHtml(cfg, i) {
    var id = cfg.id(i);
    return '<button class="card" type="button" role="listitem" data-card data-kind="' + cfg.kind + '" data-id="' + esc(id) + '"'
      + ' style="--st:' + STCOLOR[i.status] + '" tabindex="-1">'
      + '<span class="id">' + esc(cfg.kind === 'dev' ? '§' + id : id) + '</span>'
      + '<span class="t">' + md(cfg.title(i)) + '</span>'
      + '<span class="sub">' + md(cfg.sub(i) || '') + '</span>'
      + '<span class="foot">' + tag(i.status, i.statusText && i.statusText.length < 26 ? i.statusText : i.status)
      + (cfg.area(i) ? '<span class="tag area">' + esc(cfg.area(i)) + '</span>' : '') + '</span>'
      + '</button>';
  }

  function overviewHtml() {
    var latest = D.releases[0] || { version: 'Unreleased', groups: [] };
    var recent = D.shipped.slice(0, 8);
    var inProg = D.requirements.filter(function (r) { return r.status === 'in progress'; });
    var next = D.workPackages.filter(function (w) { return w.status === 'planned'; });
    var open = D.decisions.filter(function (d) { return d.state === 'open'; });
    var owner = D.ownerItems;
    var h = '<div class="panel"><h2>Where the product is</h2>'
      + '<p class="lede">' + esc(D.requirements.filter(function (r) { return r.status === 'done'; }).length)
      + ' of ' + D.requirements.length + ' requirements are done, '
      + D.workPackages.filter(function (w) { return w.status === 'done'; }).length + ' of ' + D.workPackages.length
      + ' work packages have landed, and ' + D.deviations.length + ' departures from the blueprint are on the record. '
      + open.length + ' decisions are waiting on the owner.</p>'
      + '<div class="cols" style="margin-top:12px">'
      + '<div><h3>Requirements by status</h3>' + meter(D.requirements) + '</div>'
      + '<div><h3>Work packages by status</h3>' + meter(D.workPackages) + '</div>'
      + '</div></div>';
    h += '<div class="cols">';
    h += '<div class="panel"><h2>What landed — ' + esc(latest.version) + '</h2><ul class="feed">'
      + recent.map(function (f, ix) {
        return '<li><div class="t">' + md(f.title) + '</div><div class="d">' + esc(f.group)
          + (f.wps && f.wps.length ? ' · ' + f.wps.map(function (w) { return link('wp', w, w); }).join(' ') : '') + '</div></li>';
      }).join('')
      + '</ul><p class="count">' + D.shipped.length + ' entries in the ' + esc(latest.version) + ' section — see Features.</p></div>';
    h += '<div class="panel"><h2>In progress</h2><ul class="feed">'
      + (inProg.length ? inProg.map(function (r) {
        return '<li><div class="t">' + link('req', r.id, r.id) + ' ' + md(r.title) + '</div><div class="d">' + refLinks(r.statusText || '') + '</div></li>';
      }).join('') : '<li class="d">Nothing is marked in progress.</li>')
      + '</ul></div>';
    h += '</div>';
    h += '<div class="cols">';
    h += '<div class="panel"><h2>Next — planned packages</h2><ul class="feed">'
      + next.slice(0, 10).map(function (w) {
        return '<li><div class="t">' + link('wp', w.id, w.id) + ' ' + md(w.title) + '</div><div class="d">' + md((w.acceptance || '').slice(0, 150)) + '</div></li>';
      }).join('') + '</ul></div>';
    h += '<div class="panel"><h2>Needs you</h2><ul class="feed">'
      + open.slice(0, 10).map(function (d) {
        return '<li><div class="t">' + esc(d.n + '. ') + md(d.title) + '</div><div class="d">' + esc(d.group || '') + '</div></li>';
      }).join('')
      + owner.map(function (o) {
        return '<li><div class="t">' + link('req', o.id, o.id) + ' ' + md(o.title) + '</div><div class="d">owner-side · ' + esc(o.status) + '</div></li>';
      }).join('')
      + '</ul><p class="count">' + open.length + ' open of ' + D.decisions.length + ' owner decisions · ' + owner.length + ' owner-side requirements</p></div>';
    h += '</div>';
    h += '<div class="panel"><h2>Product principles</h2><div class="scroll-x"><table class="data"><thead><tr><th>Id</th><th>Principle</th><th>Source</th></tr></thead><tbody>'
      + D.principles.map(function (p) {
        return '<tr><td class="mono">' + esc(p.id) + '</td><td>' + md(p.text) + '</td><td class="mono">' + esc(p.source) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    if (D.untraced.length) {
      h += '<div class="panel"><h2>Not traced to a source</h2><ul class="feed">'
        + D.untraced.map(function (u) { return '<li><div class="d">' + refLinks(u) + '</div></li>'; }).join('') + '</ul></div>';
    }
    if (D.meta.warnings && D.meta.warnings.length) {
      h += '<div class="panel"><h2>Build warnings</h2><ul class="feed">'
        + D.meta.warnings.map(function (w) { return '<li><div class="d">' + esc(w) + '</div></li>'; }).join('') + '</ul></div>';
    }
    return h;
  }

  function archSvg() {
    var server = D.arch.layers.filter(function (l) { return l.tier === 'server'; });
    var client = D.arch.layers.filter(function (l) { return l.tier === 'client'; });
    var support = D.arch.layers.filter(function (l) { return l.tier === 'support'; });
    var maxLines = Math.max.apply(null, D.arch.layers.map(function (l) { return l.lines || 0; }).concat([1]));
    var rowH = 30, gap = 6, padTop = 34;
    var rows = Math.max(server.length, client.length);
    var H = padTop + rows * (rowH + gap) + 66;
    var colW = 268, leftX = 8, rightX = 352;
    function band(l, x, y, colour) {
      var w = Math.max(28, Math.round((l.lines / maxLines) * (colW - 96)));
      return '<g><rect x="' + x + '" y="' + y + '" width="' + colW + '" height="' + rowH + '" rx="4" fill="var(--surface-2)" stroke="var(--line)"/>'
        + '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + w + '" height="' + (rowH - 2) + '" rx="3" fill="' + colour + '" opacity="0.14"/>'
        + '<text x="' + (x + 9) + '" y="' + (y + 19) + '" font-size="11.5" fill="var(--ink)" font-family="var(--mono)">' + esc(l.name) + '</text>'
        + '<text x="' + (x + colW - 9) + '" y="' + (y + 19) + '" font-size="11" text-anchor="end" fill="var(--muted)" font-family="var(--mono)">'
        + l.count + ' mod · ' + l.lines.toLocaleString() + ' ln</text></g>';
    }
    var s = '<svg class="arch" viewBox="0 0 628 ' + H + '" role="img" aria-label="Layered module map: '
      + server.length + ' server layers, ' + client.length + ' client layers, arrows show the allowed import direction">';
    s += '<defs><marker id="ar" markerWidth="7" markerHeight="7" refX="6" refY="3.2" orient="auto">'
      + '<path d="M0,0 L7,3.2 L0,6.4 z" fill="var(--faint)"/></marker></defs>';
    s += '<text x="' + leftX + '" y="16" font-size="11" fill="var(--muted)">src/ — daemon side, imports downward only</text>';
    s += '<text x="' + rightX + '" y="16" font-size="11" fill="var(--muted)">public/ — the floor, no src/ imports</text>';
    server.forEach(function (l, i) {
      var y = padTop + i * (rowH + gap);
      s += band(l, leftX, y, 'var(--accent)');
      if (i) s += '<line x1="' + (leftX + colW / 2) + '" y1="' + (y - gap) + '" x2="' + (leftX + colW / 2) + '" y2="' + (y - 1) + '" stroke="var(--faint)" marker-end="url(#ar)"/>';
    });
    client.forEach(function (l, i) {
      var y = padTop + i * (rowH + gap);
      s += band(l, rightX, y, 'var(--done)');
      if (i) s += '<line x1="' + (rightX + colW / 2) + '" y1="' + (y - gap) + '" x2="' + (rightX + colW / 2) + '" y2="' + (y - 1) + '" stroke="var(--faint)" marker-end="url(#ar)"/>';
    });
    var midY = padTop + rows * (rowH + gap) + 12;
    s += '<line x1="' + (leftX + colW) + '" y1="' + midY + '" x2="' + rightX + '" y2="' + midY + '" stroke="var(--faint)" stroke-dasharray="4 3" marker-end="url(#ar)"/>';
    s += '<text x="' + (leftX + colW + 6) + '" y="' + (midY - 6) + '" font-size="10.5" fill="var(--muted)">'
      + (D.arch.facts.srcToPublic || 0) + ' src→public (pure)</text>';
    s += '<text x="' + (leftX + colW + 6) + '" y="' + (midY + 14) + '" font-size="10.5" fill="var(--stop)">'
      + (D.arch.facts.publicToSrc || 0) + ' public→src (forbidden)</text>';
    if (support.length) {
      s += '<text x="' + leftX + '" y="' + (midY + 40) + '" font-size="10.5" fill="var(--muted)">support: '
        + esc(support.map(function (l) { return l.name + ' ' + l.count; }).join(' · ')) + '</text>';
    }
    s += '</svg>';
    return s;
  }

  function architectureHtml() {
    var f = D.arch.facts;
    var h = '<div class="panel"><h2>The map, as measured ' + esc(f.generatedAt || '') + '</h2>'
      + '<div class="scroll-x">' + archSvg() + '</div>'
      + '<p class="count">' + (f.modules || 0) + ' modules · ' + (f.edges || 0) + ' value imports · '
      + (f.cycles || 0) + ' cycles · ' + (f.capViolators || 0) + ' files over the 900-line cap · '
      + (f.capChecks || 0) + ' of ' + (f.modules || 0) + ' files the cap gate actually checks.</p></div>';
    h += '<div class="cols">';
    h += '<div class="panel"><h2>Cycles</h2><ul class="feed">'
      + (D.arch.cycles.length ? D.arch.cycles.map(function (c) {
        return '<li><div class="d mono">' + esc(c.join(' → ')) + '</div></li>';
      }).join('') : '<li class="d">None.</li>') + '</ul>'
      + '<h3>Cap exemptions</h3><ul class="feed">'
      + (D.arch.capExemptions.length ? D.arch.capExemptions.map(function (c) {
        return '<li><div class="d mono">' + esc(c.file) + (c.lines ? ' · ' + c.lines + ' ln' : '') + '</div></li>';
      }).join('') : '<li class="d">None recorded.</li>') + '</ul></div>';
    h += '<div class="panel"><h2>The static-file boundary</h2><p class="lede">' + md(D.arch.boundary.rule || 'not recorded') + '</p>'
      + '<ul class="feed">' + D.arch.boundary.srcToPublic.map(function (p) {
        return '<li><div class="d mono">' + esc(p[0]) + ' → ' + esc(p[1]) + '</div></li>';
      }).join('') + '</ul></div>';
    h += '</div>';
    h += '<div class="panel"><h2>Invariants — ' + D.arch.invariants.length + '</h2><div class="scroll-x"><table class="data">'
      + '<thead><tr><th>Id</th><th>Invariant</th><th>Enforced in</th><th>Held by</th><th>State</th></tr></thead><tbody>'
      + D.arch.invariants.map(function (i) {
        return '<tr><td class="mono">' + esc(i.id) + '</td><td>' + md(i.text) + '</td><td>' + md(i.enforcedIn || '—')
          + '</td><td>' + md(i.heldBy) + '</td><td>' + tag(i.status, i.status === 'done' ? 'enforced' : 'convention') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    h += '<div class="panel"><h2>Findings</h2><div class="grid">'
      + D.arch.findings.map(function (a) {
        return '<div class="card" style="--st:' + STCOLOR[a.status] + ';cursor:default">'
          + '<span class="id">' + esc(a.id) + ' · ' + esc(a.kind) + ' · ' + esc(a.size) + '</span>'
          + '<span class="t">' + md(a.title) + '</span>'
          + '<span class="sub">' + md(a.summary) + '</span>'
          + '<span class="foot">' + tag(a.status, a.statusText) + (a.wps || []).slice(0, 3).map(function (w) { return link('wp', w, w); }).join('') + '</span></div>';
      }).join('') + '</div></div>';
    h += '<div class="panel"><h2>Studio — the loop</h2><div class="stepper">'
      + D.studio.steps.map(function (s, i) {
        return '<div class="step" style="--st:' + STCOLOR[s.status] + '"><div class="n">' + (i + 1) + ' · ' + esc(s.status) + '</div>'
          + '<div class="t">' + esc(s.name) + '</div><div class="d">' + md(s.text) + '</div></div>';
      }).join('') + '</div></div>';
    h += '<div class="panel"><h2>Blueprint outline — 02-ARCHITECTURE.md</h2><ul class="feed">'
      + D.arch.outline.map(function (o) {
        return '<li style="padding-left:' + ((o.level - 2) * 16) + 'px"><div class="' + (o.level === 2 ? 't' : 'd') + '">' + md(o.title) + '</div></li>';
      }).join('') + '</ul></div>';
    return h;
  }

  function releasesHtml() {
    var h = '<div class="panel"><h2>Releases</h2><p class="lede">Every section of CHANGELOG.md, newest first. '
      + 'The current package version is ' + esc(D.meta.version || 'unknown') + '.</p></div>';
    h += D.releases.map(function (r) {
      return '<div class="panel" id="rel-' + esc(r.version) + '"><h2>' + esc(r.version) + (r.date ? ' — ' + esc(r.date) : '') + '</h2>'
        + '<p class="count">' + r.count + ' entries · ' + esc((r.groups || []).join(' · ')) + '</p>'
        + '<ul class="feed">' + (r.highlights || []).map(function (t) {
          return '<li><div class="t">' + md(t) + '</div></li>';
        }).join('') + '</ul></div>';
    }).join('');
    return h;
  }

  // ── drawer ────────────────────────────────────────────────────────────────
  var lastFocus = null;
  function fieldHtml(k, v) {
    if (!v) return '';
    return '<div class="field"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
  }
  function chipRow(kind, ids, label) {
    if (!ids || !ids.length) return '';
    return fieldHtml(label, ids.map(function (id) {
      return has(kind, String(id)) ? link(kind, String(id), kind === 'dev' ? '§' + id : id)
        : '<span class="tag dim">' + esc(kind === 'dev' ? '§' + id : id) + '</span>';
    }).join(' '));
  }
  function detailHtml(kind, id) {
    var i = INDEX[kind] && INDEX[kind][id];
    if (!i) return null;
    var head, body = '';
    if (kind === 'req') {
      head = { id: i.id, title: i.title, status: i.status, statusText: i.statusText, meta: i.area };
      if (i.quote) body += '<div class="field"><blockquote class="owner">' + md(i.quote)
        + '<cite>the owner' + (i.quoteDate ? ', ' + esc(i.quoteDate) : '') + '</cite></blockquote></div>';
      body += fieldHtml('Interpretation', md(i.interpretation));
      body += fieldHtml('Why', md(i.why));
      body += fieldHtml('Status', esc(i.statusText));
      body += fieldHtml('Implemented by', refLinks(i.implementedBy));
      body += chipRow('wp', i.wps, 'Work packages');
      body += chipRow('dev', i.devs, 'Decision log');
      body += chipRow('story', i.stories, 'User stories');
      body += fieldHtml('Notes', md(i.notes));
    } else if (kind === 'wp') {
      head = { id: i.id, title: i.title, status: i.status, statusText: i.statusText, meta: i.source };
      body += fieldHtml('Accepted when', md(i.acceptance));
      body += fieldHtml('Status', refLinks(i.statusText));
      body += fieldHtml('Owner', esc(i.owner));
      body += fieldHtml('Size', esc(i.size));
      body += fieldHtml('Depends on', refLinks(i.depends));
      body += chipRow('req', i.requirements, 'Requirements served');
      body += chipRow('dev', i.devsAll, 'Decision log');
      body += fieldHtml('Source', esc(i.source));
    } else if (kind === 'dev') {
      head = { id: '§' + i.n + (i.dup ? ' (second entry under this number)' : ''), title: i.title, status: i.raise ? 'in progress' : 'done', statusText: i.raise ? 'RAISE — open question' : 'recorded', meta: 'DEVIATIONS.md' };
      body += fieldHtml('What changed, and why', md(i.summary));
      body += chipRow('wp', i.wps || [], 'Work packages');
      var back = D.requirements.filter(function (r) { return (r.devs || []).indexOf(i.n) >= 0; }).map(function (r) { return r.id; });
      body += chipRow('req', back, 'Requirements citing it');
    } else if (kind === 'story') {
      head = { id: i.id, title: i.title, status: storyStatus(i), statusText: storyStatus(i), meta: i.date };
      body += fieldHtml('The case', md(i.body));
      body += chipRow('req', i.requirements, 'Requirements');
      body += fieldHtml('Principles', (i.principles || []).map(function (p) { return '<span class="tag area">' + esc(p) + '</span>'; }).join(' '));
    } else if (kind === 'feat') {
      head = { id: i.key, title: i.title, status: i.status, statusText: i.kind === 'shipped' ? 'shipped' : 'specified', meta: i.group };
      body += fieldHtml('Detail', md(i.detail));
      body += fieldHtml('Source', esc(i.source));
      body += chipRow('wp', i.wps, 'Work packages');
      body += chipRow('dev', i.devs, 'Decision log');
    } else return null;
    return '<header><div style="flex:1 1 auto"><span class="id mono">' + esc(head.id) + '</span>'
      + '<h2>' + md(head.title) + '</h2>'
      + '<div class="foot" style="display:flex;gap:5px;margin-top:7px">' + tag(head.status, head.statusText || head.status)
      + (head.meta ? '<span class="tag area">' + esc(head.meta) + '</span>' : '') + '</div></div>'
      + '<button class="x" id="close" type="button" aria-label="Close">✕</button></header>'
      + '<div class="body">' + body + '</div>';
  }
  function openDetail(kind, id, push) {
    var html = detailHtml(kind, String(id));
    if (!html) return false;
    closeDrawer(true);
    lastFocus = document.activeElement;
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.addEventListener('click', function () { closeDrawer(); });
    var d = document.createElement('aside');
    d.id = 'drawer';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', kind + ' ' + id);
    d.innerHTML = html;
    document.body.appendChild(scrim);
    document.body.appendChild(d);
    d.querySelector('#close').addEventListener('click', function () { closeDrawer(); });
    d.addEventListener('keydown', trap);
    d.querySelector('#close').focus();
    if (push !== false && location.hash !== '#' + kind + '/' + id) {
      history.replaceState(null, '', '#' + kind + '/' + encodeURIComponent(id));
    }
    return true;
  }
  function trap(e) {
    if (e.key !== 'Tab') return;
    var d = document.getElementById('drawer');
    var f = d.querySelectorAll('a[href], button, input, select, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeDrawer(quiet) {
    var d = document.getElementById('drawer');
    var s = document.getElementById('scrim');
    if (d) d.remove();
    if (s) s.remove();
    if (!quiet) {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    }
  }
  var TABFOR = { req: 'requirements', wp: 'packages', dev: 'decisions', story: 'stories', feat: 'features' };
  function fromHash(push) {
    var m = /^#([a-z]+)\\/(.+)$/.exec(location.hash || '');
    if (!m) return false;
    var kind = m[1], id = decodeURIComponent(m[2]);
    if (!has(kind, id)) return false;
    if (TABFOR[kind] && S.tab !== TABFOR[kind]) { S.tab = TABFOR[kind]; save(); renderChrome(); renderTab(); }
    return openDetail(kind, id, push);
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function wireTab() {
    var tab = S.tab;
    var cards = document.getElementById('cards');
    if (cards) {
      var list = cards.querySelectorAll('[data-card]');
      if (list.length) list[0].tabIndex = 0;
      cards.addEventListener('click', function (e) {
        var c = e.target.closest('[data-card]');
        if (c) openDetail(c.dataset.kind, c.dataset.id);
      });
      cards.addEventListener('keydown', function (e) {
        var c = e.target.closest('[data-card]');
        if (!c) return;
        var all = Array.prototype.slice.call(cards.querySelectorAll('[data-card]'));
        var ix = all.indexOf(c);
        var perRow = 1;
        if (cards.classList.contains('grid')) {
          var top = c.getBoundingClientRect().top;
          perRow = all.filter(function (n) { return Math.abs(n.getBoundingClientRect().top - top) < 4; }).length || 1;
        }
        var next = null;
        if (e.key === 'ArrowRight') next = all[ix + 1];
        else if (e.key === 'ArrowLeft') next = all[ix - 1];
        else if (e.key === 'ArrowDown') next = all[ix + perRow] || all[all.length - 1];
        else if (e.key === 'ArrowUp') next = all[ix - perRow] || all[0];
        else if (e.key === 'Home') next = all[0];
        else if (e.key === 'End') next = all[all.length - 1];
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(c.dataset.kind, c.dataset.id); return; }
        if (next) { e.preventDefault(); all.forEach(function (n) { n.tabIndex = -1; }); next.tabIndex = 0; next.focus(); }
      });
    }
    var q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', function () {
        S.q[tab] = q.value; save();
        var pos = q.selectionStart;
        renderTab();
        var nq = document.getElementById('q');
        if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
      });
    }
    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () { S.sort[tab] = sort.value; save(); renderTab(); });
    var chips = document.getElementById('chips');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]');
      if (!b) return;
      var bag = S[b.dataset.f];
      var arr = (bag[tab] || []).slice();
      var ix = arr.indexOf(b.dataset.v);
      if (ix >= 0) arr.splice(ix, 1); else arr.push(b.dataset.v);
      bag[tab] = arr; save(); renderTab();
    });
    var clear = document.getElementById('clear');
    if (clear) clear.addEventListener('click', function () {
      S.q[tab] = ''; S.status[tab] = []; S.area[tab] = []; save(); renderTab();
    });
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { S.view[tab] = b.dataset.view; save(); renderTab(); });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('drawer')) { e.preventDefault(); closeDrawer(); return; }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) {
      var q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var m = /^#([a-z]+)\\/(.+)$/.exec(a.getAttribute('href'));
    if (!m) return;
    e.preventDefault();
    var kind = m[1], id = decodeURIComponent(m[2]);
    if (!has(kind, id)) return;
    if (TABFOR[kind] && S.tab !== TABFOR[kind]) { S.tab = TABFOR[kind]; save(); renderChrome(); renderTab(); }
    openDetail(kind, id);
  });
  window.addEventListener('hashchange', function () { if (!fromHash(false)) closeDrawer(true); });

  document.getElementById('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var now = root.getAttribute('data-theme');
    var dark = now ? now === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('deckhq-hub-theme', dark ? 'light' : 'dark'); } catch (e) {}
  });
  try {
    var savedTheme = localStorage.getItem('deckhq-hub-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
  } catch (e) {}

  load();
  indexAll();
  renderChrome();
  renderTab();
  fromHash(false);
  var foot = document.createElement('footer');
  foot.className = 'foot wrap';
  foot.innerHTML = 'Generated from the repository\\u2019s own documents by scripts/dashboard/build.mjs'
    + '<span>Site: <a href="${data.meta.links.site}">${data.meta.links.site}</a></span>'
    + '<span>Repository: <a href="${data.meta.links.repo}">${data.meta.links.repo}</a></span>'
    + '<span>Press / to search, arrows to move, Enter to open, Esc to close</span>';
  // After #main, not inside it: renderTab() rewrites main.innerHTML on every
  // tab switch, and a footer parented there would go with it.
  document.getElementById('main').insertAdjacentElement('afterend', foot);
}());`;
}
