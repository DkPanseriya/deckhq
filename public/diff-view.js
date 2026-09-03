/**
 * The panel's unified-diff renderer. WP-47, `docs/plan/08-PLAN-V2-100X.md`
 * §8.1: "the unified diff as coloured text (still `textContent`)".
 *
 * Same two-stage shape as `public/markdown.js`, and for the same reason:
 * `parseDiff()` classifies lines and touches no DOM at all, and
 * `renderDiff()` builds elements whose only content is set through
 * `textContent`. A diff is the most attacker-shaped text in this product —
 * it is the literal contents of files an agent just wrote — so there is no
 * path here where a `<` becomes markup. No `innerHTML`, no string-built HTML,
 * no HTML parsing anywhere; `test/unit/panel-invariant.test.mjs` sweeps every
 * module under `public/` for exactly that, and `test/unit/diff-view.test.mjs`
 * renders a diff full of `<script>` against a stub document and asserts no
 * element came out of it.
 *
 * Colour is never the only carrier. Every added line already begins with `+`
 * and every removed line with `-` — that is what a unified diff is — so the
 * green and the red are a second signal on top of a character that is always
 * there. The stylesheet's rule that state and accent colours never set small
 * text is untouched: these two are their own tokens, they are not the floor's
 * palette, and they mean nothing about any session's state.
 */

/**
 * @typedef {'meta'|'hunk'|'add'|'del'|'context'} DiffLineKind
 * @typedef {{kind: DiffLineKind, text: string}} DiffLine
 */

/** Line prefixes that are diff machinery rather than file content. */
const META = [
  'diff --git',
  'diff --cc',
  'index ',
  'old mode ',
  'new mode ',
  'new file mode ',
  'deleted file mode ',
  'copy from ',
  'copy to ',
  'rename from ',
  'rename to ',
  'similarity index ',
  'dissimilarity index ',
  'Binary files ',
  'GIT binary patch',
  '\\ No newline at end of file',
];

/**
 * What one line of a unified diff is. Order matters: `---` and `+++` are file
 * headers, not a removal and an addition, and they are checked first.
 * @param {string} line
 * @returns {DiffLineKind}
 */
export function classifyLine(line) {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('--- ') || line.startsWith('+++ ')) return 'meta';
  if (line === '---' || line === '+++') return 'meta';
  for (const p of META) if (line.startsWith(p)) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
}

/**
 * Classify a whole diff, line by line. Pure: no DOM, no document.
 * @param {string} text
 * @returns {DiffLine[]}
 */
export function parseDiff(text) {
  const src = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  /** @type {DiffLine[]} */
  const lines = [];
  const raw = src.split('\n');
  // A diff ends with a newline, so the last split field is an empty tail that
  // is not a line of the file.
  if (raw.length && raw[raw.length - 1] === '') raw.pop();
  for (const line of raw) lines.push({ kind: classifyLine(line), text: line });
  return lines;
}

/**
 * Build the DOM for a diff. `doc` is injectable so the same function runs
 * against a stub document in the test suite.
 *
 * @param {string} text
 * @param {{createElement: (tag: string) => any}} [doc]
 * @returns {any} a single element to append
 */
export function renderDiff(text, doc = document) {
  const root = doc.createElement('div');
  root.className = 'diff';
  for (const { kind, text: line } of parseDiff(text)) {
    const el = doc.createElement('div');
    el.className = `diff-line diff-line--${kind}`;
    // A unified diff has no truly empty lines — a blank context line is a
    // single space — but a hand-fed one might, and an empty div would
    // collapse to nothing and lose a row of alignment.
    el.textContent = line === '' ? ' ' : line;
    root.appendChild(el);
  }
  return root;
}
