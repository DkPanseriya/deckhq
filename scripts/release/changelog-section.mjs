#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md — the text between `## X.Y.Z`
 * and the next `## ` heading — for the body of the GitHub Release.
 *
 *   node scripts/release/changelog-section.mjs 1.2.0 [CHANGELOG.md]
 *
 * Exits 1 when the section is missing. publish.yml runs this before the
 * publish, so a version nobody wrote an entry for never reaches the registry,
 * and again afterwards to produce the release notes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} markdown the whole changelog
 * @param {string} version `1.2.0`; a leading `v` is tolerated
 * @returns {string|null} the section body, trimmed, or null when there is none
 */
export function changelogSection(markdown, version) {
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
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

function main() {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  if (!version) {
    process.stderr.write('usage: changelog-section.mjs <version> [CHANGELOG.md]\n');
    process.exitCode = 2;
    return;
  }
  const body = changelogSection(readFileSync(path.resolve(file), 'utf8'), version);
  if (body === null || body === '') {
    process.stderr.write(`${file} has no "## ${version.replace(/^v/, '')}" section\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${body}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
