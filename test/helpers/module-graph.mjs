/**
 * The import graph of a directory, built the way `docs/plan/13-ARCHITECTURE-AUDIT.md`
 * built its own, plus a cycle detector.
 *
 * WP-92i wrote these three functions inside `test/unit/cli-graph.test.mjs` and
 * exported them, which is as far as one gate needed to go. WP-92m adds a second
 * gate — the same question asked of `public/` — and a test file cannot import
 * another test file without running its tests twice, so they live here now.
 * Moved whole: not one line of any of the three changed.
 *
 * COMMENTS ARE STRIPPED FIRST, so a JSDoc `import('./x.mjs')` in a type
 * position is not counted as an edge — it is not one; it produces no code.
 * What is counted is every static `import`, every `export … from` and every
 * dynamic `import()` with a literal specifier, because all three are edges a
 * reader has to follow and all three are edges the module graph really has.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Source with every comment removed, so what is left is what runs.
 *
 * A small state machine rather than a regular expression: a regular expression
 * cannot tell `// a comment` from the `//` inside a string, and the whole point
 * of stripping is to stop reading strings and comments as code.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') {
          i += 2;
          if (i <= src.length) out += src[i - 1];
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Every relative specifier one module names, static and dynamic alike.
 * @param {string} src
 * @returns {string[]}
 */
export function specifiersOf(src) {
  const code = stripComments(src);
  /** @type {string[]} */
  const found = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) found.push(m[1]);
  }
  return found;
}

/**
 * The first cycle in a graph, as the path that closes it, or null.
 * @param {Map<string, string[]>} graph
 * @returns {string[]|null}
 */
export function findCycle(graph) {
  /** @type {Set<string>} */
  const done = new Set();
  /** @type {string[]} */
  const stack = [];

  /** @param {string} node @returns {string[]|null} */
  function walk(node) {
    const at = stack.indexOf(node);
    if (at !== -1) return [...stack.slice(at), node];
    if (done.has(node)) return null;
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    done.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * The graph of one directory: module basename -> the siblings it names.
 * Siblings only — a specifier that leaves the directory cannot close a cycle
 * inside it, and the two callers are each asking about one directory.
 *
 * @param {string} dir absolute
 * @param {string} ext `.mjs` or `.js`
 * @returns {Promise<Map<string, string[]>>}
 */
export async function graphOf(dir, ext) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(ext) && !f.endsWith('.test' + ext));
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  for (const file of files.sort()) {
    const src = await readFile(path.join(dir, file), 'utf8');
    const siblings = specifiersOf(src)
      .filter((s) => s.startsWith('./') && s.endsWith(ext))
      .map((s) => s.slice(2));
    graph.set(file, [...new Set(siblings)]);
  }
  return graph;
}
