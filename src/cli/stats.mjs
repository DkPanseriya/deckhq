/**
 * `deckhq stats` — WP-17's numbers in the terminal.
 *
 * The same computation as `GET /api/stats`, from the same function over the
 * same files (`computeStats` in `src/core/ledger.mjs`), so the two can never
 * disagree about what a median is. A test asserts exactly that.
 *
 * **It does not look for a daemon.** Every other read command in this CLI
 * prefers a running DeckHQ, because a daemon holds liveness and the stall
 * clock and the files do not (`src/cli/source.mjs`). Stats hold none of that:
 * they are a replay of a directory of text files that both processes read
 * identically, so asking a daemon would add a port scan, an HTTP client and
 * ~90 ms to a command that needs none of them. The one thing the daemon
 * *could* add is the project names, and those come from the scan cache here —
 * the same source, minus the socket. Zero sockets is the point:
 * `docs/02-ARCHITECTURE.md` §9.
 *
 * Nothing here writes. Not the ledger, not `state.json`, not the cache.
 */
import fs from 'node:fs';
import process from 'node:process';

import { LEDGER_DIR } from '../core/paths.mjs';
import { computeStats, projectKeyFor, readAll } from '../core/ledger.mjs';
import { readCache } from './source.mjs';
import { group, palette, useColor, waited } from './deck.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

const HELP = [
  'deckhq stats — what the floor actually did, from the local event ledger.',
  '',
  'Usage: deckhq stats [--days N] [--json] [--no-color]',
  '',
  '  --days N     the window, in days. Default 30.',
  '  --json       the same numbers as JSON',
  '  --no-color   no ANSI (NO_COLOR is honoured too)',
  '  --help       this message',
  '',
  'Reads ~/.deckhq/ledger and nothing else. No daemon needed, no sockets opened.',
  'Time in review is measured from the ledger, so it is only as old as your',
  'retention window (settings.ledgerRetentionDays, 90 days by default).',
  '',
].join('\n');

/** @param {string[]} argv @param {string} name */
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

/** ms as the deck's own two-unit duration, or a dash. */
function dur(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return waited(ms) || 'just now';
}

/**
 * Project keys back to names, from the scan cache's cwds.
 *
 * The ledger holds hashes by design (WP-48), so this is a lookup and never a
 * reverse: a project the cache has no session for stays a hash, shortened,
 * which is honest about the fact that we do not know what it was called.
 *
 * @param {Array<{cwd:string}>} summaries
 * @returns {Record<string, string>}
 */
export function projectNames(summaries) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const s of summaries || []) {
    const cwd = String(s?.cwd || '');
    if (!cwd) continue;
    const parts = cwd
      .replace(/[\\/]+/g, '/')
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);
    const name = parts.length ? parts[parts.length - 1] : cwd;
    out[projectKeyFor(cwd)] = name;
  }
  return out;
}

/**
 * The report, as text.
 * @param {ReturnType<typeof computeStats>} stats
 * @param {{names?:Record<string,string>, color?:boolean, dir?:string}} [opts]
 */
export function renderStats(stats, opts = {}) {
  const c = palette(Boolean(opts.color));
  const names = opts.names || {};
  const lines = [''];

  if (stats.records === 0) {
    lines.push(
      '  the ledger is empty',
      '',
      c.dim('  it fills as the floor moves; there is nothing to measure yet'),
      '',
    );
    return lines.join('\n');
  }

  const label = (s) => c.dim(String(s).padEnd(26));
  const days = stats.days;

  lines.push(c.bold(`  the last ${days} day${days === 1 ? '' : 's'}`), '');

  lines.push(`  ${label('median time in review')}${dur(stats.forReview.medianMs)}`);
  lines.push(`  ${label('p90 time in review')}${dur(stats.forReview.p90Ms)}`);
  lines.push(
    `  ${label('discharged')}${group(stats.forReview.discharged)}` +
      c.dim(`  (${stats.dischargesPerDayMean.toFixed(1)}/day)`),
  );
  lines.push(
    `  ${label('sent from DeckHQ')}` +
      group(Object.values(stats.sendsPerDay).reduce((a, b) => a + b, 0)) +
      c.dim(`  (${stats.sendsPerDayMean.toFixed(1)}/day)`),
  );

  // docs/01-PRODUCT.md §6's first criterion, and the only one that has a
  // target rather than a direction. It is printed as a fact, never as a
  // reproach — "3 waiting", never "you have left 3 waiting" (§8.3).
  const over = stats.over24h;
  lines.push(`  ${label('waiting over 24h')}` + (over === 0 ? c.review('0') : c.old(String(over))));
  lines.push(`  ${label('waiting now')}${group(stats.forReview.open)}`);

  if (stats.longestWaitEver) {
    const l = stats.longestWaitEver;
    lines.push(
      '',
      `  ${label('longest wait ever')}${dur(l.ms)}` +
        c.dim(`  ${l.date}${l.open ? ', still waiting' : ''}`),
    );
  }

  // Tokens per project per day, folded to per project over the window, with
  // the per-day detail available in --json. A wall of days in a terminal is
  // not a report anyone reads.
  /** @type {Record<string, number>} */
  const perProject = {};
  for (const byProject of Object.values(stats.tokensPerProjectPerDay)) {
    for (const [key, n] of Object.entries(byProject)) {
      perProject[key] = (perProject[key] || 0) + n;
    }
  }
  const ranked = Object.entries(perProject)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (ranked.length) {
    lines.push('', c.dim('  tokens by project'), '');
    for (const [key, n] of ranked) {
      const name = names[key] || c.dim(key.slice(0, 8));
      lines.push(
        `  ${String(name).padEnd(26)}${group(n).padStart(12)}` +
          c.dim(`  ${group(Math.round(n / days))}/day`),
      );
    }
  }

  lines.push('');
  lines.push(c.dim(`  from ${opts.dir || LEDGER_DIR} — ${group(stats.records)} records`), '');
  return lines.join('\n');
}

/**
 * @param {string[]} [argv]
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, dir?:string,
 *          cacheDir?:string, now?:number, color?:boolean}} [deps]
 * @returns {Promise<number>}
 */
export async function runStats(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));
  if (argv.includes('--help') || argv.includes('-h')) {
    write(HELP);
    return 0;
  }

  const dir = deps.dir || LEDGER_DIR;
  const now = deps.now ?? Date.now();
  const rawDays = option(argv, '--days');
  const windowDays = rawDays == null ? 30 : Number(rawDays);
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    error('  --days takes a positive number of days\n');
    return 2;
  }

  let records;
  try {
    records = await readAll(dir);
  } catch (err) {
    error(`  could not read the ledger at ${dir}: ${err.message}\n`);
    return 1;
  }

  const stats = computeStats(records, { now, since: now - windowDays * DAY_MS });
  const names = projectNames(readCache(deps.cacheDir));

  if (argv.includes('--json')) {
    write(JSON.stringify({ ...stats, projects: names, dir }, null, 2) + '\n');
    return 0;
  }

  write(renderStats(stats, { names, color: deps.color ?? useColor({ argv }), dir }));
  return 0;
}

/** Exported so `deckhq doctor` could one day say how big the ledger is. */
export function ledgerBytes(dir = LEDGER_DIR) {
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      total += fs.statSync(`${dir}/${name}`).size;
    }
  } catch {
    return 0;
  }
  return total;
}
