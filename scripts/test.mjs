#!/usr/bin/env node
/**
 * Portable test entry point.
 *
 * `node --test <dir>` is not portable across the Node versions we support —
 * 18 wants a directory, 24 wants explicit files or a glob — so we enumerate
 * the files ourselves and hand them to the runner. Extra argv is forwarded,
 * which is how you run one file:  npm test -- test/unit/model.test.mjs
 */
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} dir @returns {string[]} */
function collect(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.test.mjs') || name.endsWith('.test.js')) out.push(full);
  }
  return out.sort();
}

const explicit = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('-'));
const files = explicit.length ? explicit : collect(path.join(root, 'test'));

if (files.length === 0) {
  process.stderr.write('no test files found under test/\n');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...flags, ...files], {
  stdio: 'inherit',
  cwd: root,
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
