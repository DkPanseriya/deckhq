#!/usr/bin/env node
// Builds the DeckHQ project hub: one self-contained HTML page generated from the
// repository's own documents. Zero dependencies.
//
//   node scripts/dashboard/build.mjs --out dist/deckhq-hub.html \
//        --tests 2497 --goldens 16 --ci green --npm 1.3.0
//
// Everything on the page is parsed from docs/. The four flags above are the only
// figures the page cannot read from a document; without them it prints
// "not supplied" rather than a number nobody measured.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parsePrinciples,
  parseRequirements,
  parseStories,
  parseOpenItems,
  parseWorkPackages,
  parseOwnerDecisions,
  parseDeviations,
  parseArchitecture,
  parseStudioLoop,
  parseFeatureFacts,
  parseChangelog,
} from './parse.mjs';
import { renderPage } from './template.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');

export function parseArgs(argv) {
  const out = {
    out: 'dist/deckhq-hub.html',
    tests: null,
    goldens: null,
    ci: null,
    npm: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () =>
      argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : '';
    if (a === '--out') out.out = take();
    else if (a === '--tests') out.tests = take();
    else if (a === '--goldens') out.goldens = take();
    else if (a === '--ci') out.ci = take();
    else if (a === '--npm') out.npm = take();
    else if (a === '--quiet') out.quiet = true;
    else if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split('=');
      if (k in out) out[k] = v;
    }
  }
  return out;
}

/** Read a repository file, or null with a warning. */
function readDoc(repo, rel, warn) {
  try {
    return readFileSync(join(repo, rel), 'utf8');
  } catch {
    warn(`${rel}: not readable — the collections it feeds are empty`);
    return '';
  }
}

export function collect(repo = REPO, flags = {}) {
  const warnings = [];
  const warn = (m) => {
    warnings.push(m);
  };

  const requirementsMd = readDoc(repo, 'docs/00-REQUIREMENTS.md', warn);
  const planMd = readDoc(repo, 'docs/plan/08-PLAN-V2-100X.md', warn);
  const workplanMd = readDoc(repo, 'docs/plan/06-ENGINEERING-WORKPLAN.md', warn);
  const studioMd = readDoc(repo, 'docs/07-STUDIO-DESIGN.md', warn);
  const deviationsMd = readDoc(repo, 'docs/DEVIATIONS.md', warn);
  const auditMd = readDoc(repo, 'docs/plan/13-ARCHITECTURE-AUDIT.md', warn);
  const blueprintMd = readDoc(repo, 'docs/02-ARCHITECTURE.md', warn);
  const lookMd = readDoc(repo, 'docs/plan/11-LOOK-CONTROL-CENTRE.md', warn);
  const motionMd = readDoc(repo, 'docs/plan/12-MOTION-AND-CREW.md', warn);
  const changelogMd = readDoc(repo, 'CHANGELOG.md', warn);

  let auditMap = null;
  try {
    auditMap = JSON.parse(readFileSync(join(repo, 'docs/plan/13-audit-map.json'), 'utf8'));
  } catch {
    warn('docs/plan/13-audit-map.json: not readable or not JSON — architecture facts are empty');
  }
  let version = '';
  try {
    version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version || '';
  } catch {
    warn('package.json: version not readable');
  }

  const requirements = parseRequirements(requirementsMd, warn);
  const workPackages = parseWorkPackages(
    {
      plan: planMd,
      workplan: workplanMd,
      studio: studioMd,
      changelog: changelogMd,
      deviations: deviationsMd,
    },
    warn,
  );
  const deviations = parseDeviations(deviationsMd, warn);
  // The page carries the bullet titles of the latest section; the prose behind
  // them stays in CHANGELOG.md, which every entry names.
  const changelog = parseChangelog(changelogMd, warn);
  for (const s of changelog.shipped) delete s.detail;
  const architecture = parseArchitecture(
    { audit: auditMd, map: auditMap, blueprint: blueprintMd },
    warn,
  );
  const studio = parseStudioLoop(studioMd, warn);
  const open = parseOpenItems(requirementsMd, warn);

  // Cross-links, built once here so the page never has to scan.
  const devByWp = new Map();
  for (const d of deviations)
    for (const wp of d.wps) {
      if (!devByWp.has(wp)) devByWp.set(wp, []);
      if (devByWp.get(wp).length < 12) devByWp.get(wp).push(d.n);
    }
  const reqByWp = new Map();
  for (const r of requirements)
    for (const wp of r.wps) {
      if (!reqByWp.has(wp)) reqByWp.set(wp, []);
      reqByWp.get(wp).push(r.id);
    }
  const storiesByReq = new Map();
  for (const s of parseStories(requirementsMd, warn))
    for (const r of s.requirements) {
      if (!storiesByReq.has(r)) storiesByReq.set(r, []);
      storiesByReq.get(r).push(s.id);
    }
  const stories = parseStories(requirementsMd, () => {});
  for (const wp of workPackages) {
    wp.devsAll = [...new Set([...(wp.devs || []), ...(devByWp.get(wp.id) || [])])].sort(
      (a, b) => a - b,
    );
    wp.requirements = reqByWp.get(wp.id) || [];
    // Everything below is either derivable or already said by another field.
    delete wp.devs;
    delete wp.from;
    if (wp.statusText === wp.status) wp.statusText = '';
  }
  for (const r of requirements) if (r.statusText === r.status) r.statusText = '';
  for (const r of requirements) r.stories = storiesByReq.get(r.id) || [];

  const ownerArea = requirements.filter((r) => /owner/i.test(r.area));

  return {
    meta: {
      project: 'DeckHQ',
      tagline: 'Command deck for every agent session on your machine',
      version,
      generatedAt: new Date().toISOString().slice(0, 10),
      tests: flags.tests || null,
      goldens: flags.goldens || null,
      ci: flags.ci || null,
      npm: flags.npm || null,
      auditAt: architecture.facts.generatedAt,
      warnings,
      links: {
        site: 'https://dkpanseriya.github.io/deckhq/',
        repo: 'https://github.com/DkPanseriya/deckhq',
      },
    },
    principles: parsePrinciples(requirementsMd, warn),
    requirements,
    stories,
    openRequirements: open.items,
    untraced: open.untraced,
    workPackages,
    decisions: parseOwnerDecisions(planMd, warn),
    deviations,
    architecture,
    studio,
    features: parseFeatureFacts({ look: lookMd, motion: motionMd }, warn),
    shipped: changelog.shipped,
    releases: changelog.releases,
    ownerItems: ownerArea.map((r) => ({ id: r.id, title: r.title, status: r.status })),
  };
}

export function build(flags, repo = REPO) {
  const data = collect(repo, flags);
  const html = renderPage(data);
  return { data, html };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const flags = parseArgs(process.argv.slice(2));
  const { data, html } = build(flags);
  const outPath = resolve(flags.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  if (!flags.quiet) {
    const n = (v) => (v == null || v === '' ? 'not supplied' : v);
    console.log(`deckhq hub → ${outPath}  (${kb} KB)`);
    console.log(
      `  requirements ${data.requirements.length} · stories ${data.stories.length} · packages ${data.workPackages.length} ·` +
        ` deviations ${data.deviations.length} · features ${data.features.length + data.shipped.length} ·` +
        ` invariants ${data.architecture.invariants.length} · findings ${data.architecture.findings.length} ·` +
        ` decisions ${data.decisions.length} · releases ${data.releases.length}`,
    );
    console.log(
      `  version ${n(data.meta.version)} · npm ${n(data.meta.npm)} · tests ${n(data.meta.tests)} · goldens ${n(data.meta.goldens)} · ci ${n(data.meta.ci)}`,
    );
    for (const w of data.meta.warnings) console.log(`  warning: ${w}`);
  }
}
