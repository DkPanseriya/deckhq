// The page. One template string, no external resources, no build step.
// The data is embedded as a columnar JSON payload (a key list plus rows) so the
// file stays inside its 220 KB budget; the page rehydrates it on load.
// The stylesheet and the client script live in their own modules; this file
// assembles the page around them.

import { CSS } from './template-css.mjs';
import { clientScript } from './template-script.mjs';

/**
 * Turn an array of objects into `{k: [...keys], r: [[...values]]}`, dropping
 * trailing empties: the page fills a short row back out with ''.
 */
export function pack(rows, keys) {
  const k = keys || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const r = rows.map((row) => {
    const v = k.map((key) => (row[key] === undefined ? '' : row[key]));
    let n = v.length;
    while (n > 0) {
      const last = v[n - 1];
      if (last === '' || (Array.isArray(last) && !last.length)) n -= 1;
      else break;
    }
    return v.slice(0, n);
  });
  return { k, r };
}

export function packData(data) {
  return {
    meta: data.meta,
    principles: pack(data.principles),
    requirements: pack(data.requirements),
    stories: pack(data.stories),
    openRequirements: pack(data.openRequirements),
    untraced: data.untraced,
    workPackages: pack(data.workPackages),
    decisions: pack(data.decisions),
    deviations: pack(data.deviations),
    features: pack(data.features),
    shipped: pack(data.shipped),
    releases: pack(data.releases),
    ownerItems: pack(data.ownerItems),
    studio: { steps: pack(data.studio.steps), packages: pack(data.studio.packages) },
    architecture: {
      layers: pack(data.architecture.layers),
      invariants: pack(data.architecture.invariants),
      findings: pack(data.architecture.findings),
      outline: pack(data.architecture.outline),
      facts: data.architecture.facts,
      cycles: data.architecture.cycles,
      capExemptions: pack(data.architecture.capExemptions),
      boundary: data.architecture.boundary,
    },
  };
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const json = (v) =>
  JSON.stringify(v).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

/**
 * Drop the indentation the template is written with. Every line of the page is
 * either markup, one CSS declaration or one JavaScript statement, and no string
 * literal in it spans a line, so leading whitespace and blank lines are free.
 */
function tighten(html) {
  return html
    .split('\n')
    .map((line) =>
      line.startsWith('<script type="application/json"') ? line : line.replace(/^\s+/, ''),
    )
    .filter((line) => line !== '')
    .join('\n');
}

export function renderPage(data) {
  return tighten(page(data));
}

function page(data) {
  return `<title>DeckHQ Progress</title>
<style>
${CSS}
</style>

<header class="top">
  <div class="top-in">
    <div class="brandrow">
      <h1>DeckHQ</h1>
      <span class="tagline" id="tagline"></span>
      <span class="spacer"></span>
      <button class="ghost" id="theme" type="button" aria-label="Switch colour theme">Theme</button>
    </div>
    <div class="statusline" id="statusline"></div>
    <div class="tiles" id="stats"></div>
    <nav class="tabs" id="tabs" role="tablist" aria-label="Sections"></nav>
  </div>
</header>

<main class="wrap" id="main"></main>

<script type="application/json" id="hub-data">${json(packData(data))}</script>
<script>
${clientScript(data)}
</script>
`;
}
