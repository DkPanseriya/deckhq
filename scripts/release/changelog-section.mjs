#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md — the text between `## X.Y.Z`
 * and the next `## ` heading — for the body of the GitHub Release.
 *
 *   node scripts/release/changelog-section.mjs 1.2.0 [CHANGELOG.md]
 *   node scripts/release/changelog-section.mjs --release-body 1.2.0 [CHANGELOG.md]
 *   node scripts/release/changelog-section.mjs --release-body --max-chars 120000 1.2.0
 *
 * Exits 1 when the section is missing. publish.yml runs this before the
 * publish, so a version nobody wrote an entry for never reaches the registry,
 * and again afterwards to produce the release notes.
 *
 * A GitHub Release body is capped at 125,000 characters and 1.3.0's section is
 * 145,581, so `--release-body` produces a body that always fits: the Highlights
 * block whole, then the section's bullets in heading order until the budget is
 * spent — cut between bullets, never inside one — and a last line linking the
 * full section in CHANGELOG.md at the tag. A section already under the budget
 * is passed through unchanged, with no link. `--max-chars <n>` makes the script
 * exit 1 when what it produced is longer than `n`; that is the pre-check the
 * `publish` job runs BEFORE `npm publish`, so an oversize body fails the job
 * while failing still costs nothing. `docs/DEVIATIONS.md` §138.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { repoUrlOf } from './manifests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What GitHub accepts as a release body. Nothing here may reach it. */
export const GITHUB_RELEASE_BODY_LIMIT = 125_000;
/** What `--release-body` spends, leaving GitHub's cap a wide margin. */
export const RELEASE_BODY_BUDGET = 100_000;
/** What the `publish` job refuses to go past, before it publishes anything. */
export const PRECHECK_MAX_CHARS = 120_000;

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The fragment GitHub gives a rendered heading: lower case, everything that is
 * not a letter, a number, a mark, a connector or a hyphen dropped, then spaces
 * turned into hyphens. `1.3.0 — 2026-09-04` is `130--2026-09-04`: the dots go,
 * the em dash goes, and the two spaces it sat between become two hyphens.
 *
 * @param {string} text a heading's text, without its leading `#`s
 * @returns {string}
 */
export function githubAnchor(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/**
 * One version's entry: the heading line it was found under, and its body.
 *
 * @param {string} markdown the whole changelog
 * @param {string} version `1.2.0`; a leading `v` is tolerated
 * @returns {{heading: string, title: string, body: string}|null}
 */
export function changelogEntry(markdown, version) {
  const v = String(version).replace(/^v/, '');
  const heading = new RegExp(`^## \\[?v?${escapeRegExp(v)}\\]?(?=\\s|$)`);
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return {
    heading: lines[start],
    title: lines[start].replace(/^##\s+/, '').trim(),
    body: lines
      .slice(start + 1, end)
      .join('\n')
      .trim(),
  };
}

/**
 * @param {string} markdown the whole changelog
 * @param {string} version `1.2.0`; a leading `v` is tolerated
 * @returns {string|null} the section body, trimmed, or null when there is none
 */
export function changelogSection(markdown, version) {
  return changelogEntry(markdown, version)?.body ?? null;
}

/**
 * Cut a section body into the pieces a release body is assembled from, in the
 * order they appear: a `heading` carries its own `###` line and whatever prose
 * follows it before the first bullet, a `bullet` carries one top-level list
 * item and every continuation line under it — including the ones prettier
 * wrapped back to column 0 — and a `lead` is prose that came before any
 * heading. Nothing is ever split inside one of these.
 *
 * @param {string} body
 * @returns {{kind: 'lead'|'heading'|'bullet', text: string}[]}
 */
export function sectionChunks(body) {
  /** @type {{kind: 'lead'|'heading'|'bullet', text: string}[]} */
  const chunks = [];
  /** @type {{kind: 'lead'|'heading'|'bullet', lines: string[]}|null} */
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join('\n').replace(/\s+$/, '');
    if (text) chunks.push({ kind: current.kind, text });
    current = null;
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^#{2,6} /.test(line)) {
      flush();
      current = { kind: 'heading', lines: [line] };
    } else if (/^[-*] /.test(line)) {
      flush();
      current = { kind: 'bullet', lines: [line] };
    } else {
      if (!current) current = { kind: 'lead', lines: [] };
      current.lines.push(line);
    }
  }
  flush();
  return chunks;
}

/**
 * A release body that fits: the Highlights block in full, then the bullets in
 * heading order until the budget is spent, then the link to the rest. A body
 * already inside the budget is returned exactly as it is, with no link.
 *
 * @param {string} markdown the whole changelog
 * @param {string} version `1.3.0`; a leading `v` is tolerated
 * @param {{budget?: number, repoUrl?: string, changelogPath?: string}} [options]
 * @returns {string|null} null when there is no section for `version`
 */
export function releaseBody(markdown, version, options = {}) {
  const entry = changelogEntry(markdown, version);
  if (entry === null || entry.body === '') return null;

  const budget = options.budget ?? RELEASE_BODY_BUDGET;
  if (entry.body.length <= budget) return entry.body;

  const v = String(version).replace(/^v/, '');
  const repoUrl = options.repoUrl ?? repoUrlOf(readPackage());
  const changelogPath = options.changelogPath ?? 'CHANGELOG.md';
  const link = `Full notes for this release: ${repoUrl}/blob/v${v}/${changelogPath}#${githubAnchor(entry.title)}`;
  const reserve = 2 + link.length; // the blank line before it, and the line

  const chunks = sectionChunks(entry.body);
  // Everything up to the second heading: any lead prose, then the Highlights
  // block whole. It goes in whether or not it fits — the pre-check is what
  // refuses a Highlights block nobody could send.
  let cut = chunks.length;
  let seenHeading = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].kind !== 'heading') continue;
    if (++seenHeading === 2) {
      cut = i;
      break;
    }
  }

  /** @type {'lead'|'heading'|'bullet'|null} */
  let previous = null;
  let out = '';
  /** @param {{kind: 'lead'|'heading'|'bullet', text: string}} chunk */
  const append = (chunk) => {
    // A tight list stays tight; anything else is separated by a blank line.
    const gap = out === '' ? '' : previous === 'bullet' && chunk.kind === 'bullet' ? '\n' : '\n\n';
    out += gap + chunk.text;
    previous = chunk.kind;
  };
  /** @param {{kind: 'lead'|'heading'|'bullet', text: string}} chunk */
  const costOf = (chunk) =>
    (out === '' ? 0 : previous === 'bullet' && chunk.kind === 'bullet' ? 1 : 2) + chunk.text.length;

  for (const chunk of chunks.slice(0, cut)) append(chunk);

  /** @type {{kind: 'lead'|'heading'|'bullet', text: string}|null} */
  let pendingHeading = null;
  for (const chunk of chunks.slice(cut)) {
    if (chunk.kind === 'heading') {
      // A heading earns its place only when something under it fits too.
      pendingHeading = chunk;
      continue;
    }
    let cost = costOf(chunk);
    if (pendingHeading) {
      const headingCost = costOf(pendingHeading);
      cost = headingCost + 2 + chunk.text.length;
    }
    if (out.length + cost + reserve > budget) break;
    if (pendingHeading) {
      append(pendingHeading);
      pendingHeading = null;
    }
    append(chunk);
  }

  return `${out}\n\n${link}`;
}

/** package.json, for the repository URL the link is built from. */
function readPackage() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{releaseBody: boolean, maxChars: number|null, positional: string[]}} */
  const opts = { releaseBody: false, maxChars: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--release-body') opts.releaseBody = true;
    else if (arg === '--max-chars') opts.maxChars = Number(argv[++i]);
    else if (arg.startsWith('--max-chars='))
      opts.maxChars = Number(arg.slice('--max-chars='.length));
    else if (arg === '--') opts.positional.push(...argv.slice(i + 1));
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else opts.positional.push(arg);
  }
  if (opts.maxChars !== null && !Number.isFinite(opts.maxChars)) {
    throw new Error('--max-chars takes a number');
  }
  return opts;
}

function main() {
  /** @type {ReturnType<typeof parseArgs>} */
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${/** @type {Error} */ (err).message}\n`);
    process.exitCode = 2;
    return;
  }
  const [version, file = 'CHANGELOG.md'] = opts.positional;
  if (!version) {
    process.stderr.write(
      'usage: changelog-section.mjs [--release-body] [--max-chars <n>] <version> [CHANGELOG.md]\n',
    );
    process.exitCode = 2;
    return;
  }
  const markdown = readFileSync(path.resolve(file), 'utf8');
  const body = opts.releaseBody
    ? releaseBody(markdown, version, { changelogPath: path.basename(file) })
    : changelogSection(markdown, version);
  if (body === null || body === '') {
    process.stderr.write(`${file} has no "## ${version.replace(/^v/, '')}" section\n`);
    process.exitCode = 1;
    return;
  }
  const out = `${body}\n`;
  if (opts.maxChars !== null && out.length > opts.maxChars) {
    process.stderr.write(
      `the release body for ${version.replace(/^v/, '')} is ${out.length} characters, ` +
        `over the ${opts.maxChars} this refuses to publish past ` +
        `(GitHub's own cap is ${GITHUB_RELEASE_BODY_LIMIT})\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
