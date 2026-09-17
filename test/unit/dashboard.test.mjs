/**
 * The project hub — `scripts/dashboard/build.mjs`.
 *
 * The page is generated from the repository's own documents, so the parsers are
 * tested against those documents and not against fixtures: a fixture would pass
 * for ever while a heading rename quietly emptied a tab. Every collection must
 * come back non-empty, every id must be unique, and the page itself must stay
 * self-contained — no external URL, no `<html>` or `<body>` tag of its own, and
 * inside the 220 KB budget an Artifact has to live in.
 *
 * `docs/DEVIATIONS.md` §187.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build, collect, parseArgs, REPO } from '../../scripts/dashboard/build.mjs';
import { devRefs, flat, statusOf, tables, section, wpIds } from '../../scripts/dashboard/parse.mjs';

const data = collect();
const { html } = build({ tests: '2497', goldens: '16', ci: 'green', npm: '1.3.0' });

test('every collection the page shows is non-empty', () => {
  const sizes = {
    principles: data.principles.length,
    requirements: data.requirements.length,
    stories: data.stories.length,
    openRequirements: data.openRequirements.length,
    untraced: data.untraced.length,
    workPackages: data.workPackages.length,
    decisions: data.decisions.length,
    deviations: data.deviations.length,
    features: data.features.length,
    shipped: data.shipped.length,
    releases: data.releases.length,
    layers: data.architecture.layers.length,
    invariants: data.architecture.invariants.length,
    findings: data.architecture.findings.length,
    outline: data.architecture.outline.length,
    studioSteps: data.studio.steps.length,
  };
  for (const [name, n] of Object.entries(sizes)) {
    assert.ok(n > 0, `${name} parsed as empty — the document it reads has moved`);
  }
});

test('the build reports no warnings against the real documents', () => {
  assert.deepEqual(data.meta.warnings, []);
});

test('every requirement has an id, a title and a known status', () => {
  const known = ['done', 'in progress', 'planned', 'declined', 'superseded', 'blocked'];
  const ids = new Set();
  for (const r of data.requirements) {
    assert.match(r.id, /^R-\d{3}$/);
    assert.ok(r.title.length > 3, `${r.id} has no title`);
    assert.ok(known.includes(r.status), `${r.id} has status "${r.status}"`);
    assert.ok(!ids.has(r.id), `${r.id} is listed twice`);
    ids.add(r.id);
  }
});

test('every work package id is unique, and the pre-table ones say what proves them', () => {
  const ids = new Set();
  for (const w of data.workPackages) {
    assert.match(w.id, /^WP-\d{1,3}[a-z]?$/);
    assert.ok(!ids.has(w.id), `${w.id} appears twice`);
    ids.add(w.id);
    assert.ok(w.status, `${w.id} has no status`);
    // A status the page cannot prove says so; `statusText` is dropped when it
    // would only repeat the status word.
    if (w.status === 'unknown') assert.ok(w.statusText === '' || w.statusText === 'unknown');
  }
  // The table rows of §9 must win over the narrative headings they restate.
  const wp77 = data.workPackages.find((w) => w.id === 'WP-77');
  assert.equal(wp77.status, 'done');
  assert.ok(wp77.acceptance.length > 20);
});

test('requirements, stories and packages cross-link both ways', () => {
  const r043 = data.requirements.find((r) => r.id === 'R-043');
  assert.ok(r043.wps.length > 0, 'R-043 names no work package');
  assert.ok(r043.devs.length > 0, 'R-043 names no deviation');
  assert.ok(r043.stories.includes('S-02'), 'R-043 is not reachable from S-02');
  for (const id of r043.wps) {
    assert.ok(data.workPackages.some((w) => w.id === id), `R-043 points at unknown ${id}`);
  }
  const s01 = data.stories.find((s) => s.id === 'S-01');
  assert.ok(s01.requirements.length >= 3);
});

test('the owner quote survives with its date', () => {
  const r010 = data.requirements.find((r) => r.id === 'R-010');
  assert.match(r010.quote, /friction/);
  assert.match(r010.quoteDate, /September 2026/);
});

test('deviations are numbered, keyed uniquely and summarised inside their cap', () => {
  const keys = new Set();
  for (const d of data.deviations) {
    assert.ok(Number.isInteger(d.n) && d.n > 0);
    // The log is hand-numbered and two numbers were issued twice; the key is
    // what a deep link uses, and it must be unique even when the number is not.
    assert.ok(!keys.has(d.key), `deviation key ${d.key} appears twice`);
    keys.add(d.key);
    assert.ok(d.title.length > 3, `deviation ${d.key} has no title`);
    assert.ok(d.summary.length <= 400, `deviation ${d.key} summary is over 400 chars`);
  }
  assert.ok(data.deviations.some((d) => d.n === 1 && d.raise), '§1 is a RAISE and should say so');
  const dups = data.deviations.filter((d) => d.dup);
  for (const d of dups) assert.match(d.key, /^\d+-\d$/);
});

test('the architecture facts come from the audit map, not from prose', () => {
  const f = data.architecture.facts;
  assert.ok(f.modules > 100 && f.edges > 100);
  assert.equal(f.publicToSrc, 0);
  assert.ok(data.architecture.cycles.length > 0);
  const i01 = data.architecture.invariants.find((i) => i.id === 'I-01');
  assert.match(i01.name, /Ack ownership/);
  assert.ok(i01.modules.length > 0, 'I-01 names no enforcing module');
  assert.ok(data.architecture.findings.some((a) => a.id === 'A-01' && a.status === 'done'));
});

test('the flags are the only unmeasured numbers, and absent they say so', () => {
  assert.equal(data.meta.version, JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version);
  const bare = build({}).data;
  assert.equal(bare.meta.tests, null);
  assert.equal(bare.meta.ci, null);
  const bareHtml = build({}).html;
  assert.match(bareHtml, /not supplied/);
  assert.equal(parseArgs(['--out', 'x.html', '--tests', '10', '--ci', 'red']).tests, '10');
  assert.equal(parseArgs(['--ci', 'red']).ci, 'red');
  assert.equal(parseArgs([]).out, 'dist/deckhq-hub.html');
});

test('a missing document empties its collections and warns, and never throws', () => {
  const empty = collect(join(REPO, 'test', 'fixtures', 'no-such-directory'));
  assert.equal(empty.requirements.length, 0);
  assert.equal(empty.deviations.length, 0);
  assert.ok(empty.meta.warnings.length > 5);
  assert.doesNotThrow(() => build({}, join(REPO, 'test', 'fixtures', 'no-such-directory')));
});

test('the parser helpers hold their contracts', () => {
  assert.equal(flat('  a\n  b  ', 0), 'a b');
  assert.equal(flat('abcdef ghij', 8).length <= 8, true);
  assert.equal(statusOf('**done** (DEVIATIONS §160)'), 'done');
  assert.equal(statusOf('superseded by WP-88c'), 'superseded');
  assert.equal(statusOf(''), 'unknown');
  assert.deepEqual(wpIds('after WP-12 and WP-88c, not WP-12'), ['WP-12', 'WP-88c']);
  // `08` §9 is a plan section; DEVIATIONS.md §153 is a deviation.
  assert.deepEqual(devRefs('`08` §9 row marked done'), []);
  assert.deepEqual(devRefs('WP-78 (`DEVIATIONS.md` §153), WP-50 (§96)'), [153, 96]);
  assert.equal(tables('| a | b |\n|---|---|\n| 1 | 2 |')[0].rows[0][1], '2');
  assert.equal(section('## 1 x\nbody\n## 2 y\nother', /^## 1/, /^## \d/).trim(), 'body');
});

// ── the page itself ─────────────────────────────────────────────────────────

test('the page is a self-contained artifact fragment', () => {
  assert.match(html, /<title>DeckHQ Progress<\/title>/);
  assert.ok(html.indexOf('<title>') < 8192, 'the title must be in the first 8 KB');
  assert.doesNotMatch(html, /<!DOCTYPE/i);
  assert.doesNotMatch(html, /<\/?html[\s>]/i);
  assert.doesNotMatch(html, /<\/?body[\s>]/i);
  assert.doesNotMatch(html, /<\/?head[\s>]/i);
});

test('the page loads nothing from anywhere', () => {
  const allowed = ['https://dkpanseriya.github.io/deckhq/', 'https://github.com/DkPanseriya/deckhq'];
  const urls = [];
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)) urls.push(m[1]);
  for (const u of urls) {
    if (u.startsWith('#') || u === '') continue;
    assert.ok(allowed.includes(u), `the page links out to ${u}`);
  }
  assert.doesNotMatch(html, /@import/);
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /fonts\.googleapis|cdnjs|jsdelivr|unpkg/);
});

test('the page is inside the 220 KB budget', () => {
  const kb = Buffer.byteLength(html, 'utf8') / 1024;
  assert.ok(kb <= 220, `the page is ${kb.toFixed(1)} KB`);
  assert.ok(kb > 60, 'the page is suspiciously small — a collection is probably empty');
});

test('the page is theme-aware from tokens, not from a media query alone', () => {
  assert.match(html, /:root\s*\{/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /body\s*\{[^}]*background:\s*var\(--bg\)/);
  assert.match(html, /prefers-reduced-motion/);
});

test('every deep-linkable id in the payload exists, and the page knows the shapes', () => {
  const payload = JSON.parse(
    html.slice(html.indexOf('id="hub-data">') + 14, html.indexOf('</script>', html.indexOf('id="hub-data">'))),
  );
  const un = (p) => p.r.map((row) => Object.fromEntries(p.k.map((k, i) => [k, row[i] === undefined ? '' : row[i]])));
  const reqs = un(payload.requirements);
  const wps = un(payload.workPackages);
  const devs = un(payload.deviations);
  const stories = un(payload.stories);
  assert.ok(reqs.some((r) => r.id === 'R-043'), '#req/R-043 has no entry');
  assert.ok(wps.some((w) => w.id === 'WP-88c'), '#wp/WP-88c has no entry');
  assert.ok(devs.some((d) => d.n === 172), '#dev/172 has no entry');
  assert.ok(stories.some((s) => s.id === 'S-01'), '#story/S-01 has no entry');

  const wpIdSet = new Set(wps.map((w) => w.id));
  const devSet = new Set(devs.map((d) => d.n));
  const reqSet = new Set(reqs.map((r) => r.id));
  // A chip the page renders as a link must resolve; one that does not is drawn
  // as plain text, so the only thing asserted here is that most of them land.
  const wpRefs = reqs.flatMap((r) => r.wps || []);
  const hits = wpRefs.filter((id) => wpIdSet.has(id)).length;
  assert.ok(hits / Math.max(1, wpRefs.length) > 0.8, 'most requirement → package links are dead');
  for (const s of stories) {
    for (const id of s.requirements || []) assert.ok(reqSet.has(id), `${s.id} points at unknown ${id}`);
  }
  assert.ok([...devSet].every((n) => Number.isInteger(n)));
});
