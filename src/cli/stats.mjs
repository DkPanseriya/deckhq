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
 *
 * WP-46 adds the team's records under the report: longest wait ever, busiest
 * day, most turns in a week, the room that never slept, fastest discharge
 * day. They are records of the team's work and never a score on the person
 * reading them — `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6 — and a ledger
 * younger than a week prints the same lines under a `since <first day>` note
 * rather than padding a window it has not lived through.
 */
import fs from 'node:fs';
import process from 'node:process';

import { LEDGER_DIR } from '../core/paths.mjs';
import { computeStats, projectKeyFor, readAll, records as teamRecords } from '../core/ledger.mjs';
import { rateCardVersion } from '../core/rates.mjs';
import { COUNTERS, NO_DATA, usageReport } from '../core/usage.mjs';
import { readCache, readState } from './source.mjs';
import { group, palette, useColor, waited } from './deck.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

const HELP = [
  'deckhq stats — what the floor actually did, from the local event ledger.',
  '',
  'Usage: deckhq stats [--days N] [--json] [--no-color]',
  '',
  '  --days N     the window, in days. Default 30. The records below it are',
  '               never windowed — "ever" means ever.',
  '  --usage W    the token-usage window: today, 7d or 30d. Default 7d.',
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
 * The team's records, as text — WP-46.
 *
 * Every line is a fact about the team's work: how long a session waited, how
 * many turns a day held, which room had somebody in it at 4am. There is no
 * count of the reader's days, nothing that can be broken, and no sentence
 * whose subject is the person running the command (`docs/plan/08` §1.1 rule
 * 6, `docs/plan/04` §5). A test asserts the second person never appears here
 * in a fault sense.
 *
 * A ledger younger than a week prints exactly the same lines with `since
 * <first day>` beside the heading, rather than either padding the window or
 * printing nothing.
 *
 * @param {ReturnType<typeof teamRecords>} rec
 * @param {{names?:Record<string,string>, color?:boolean}} [opts]
 * @returns {string[]}
 */
export function renderRecords(rec, opts = {}) {
  const c = palette(Boolean(opts.color));
  const names = opts.names || {};
  const label = (s) => c.dim(String(s).padEnd(26));
  /** @type {string[]} */
  const lines = [];
  if (!rec) return lines;

  /** @type {string[]} */
  const rows = [];
  if (rec.longestWait) {
    const l = rec.longestWait;
    rows.push(
      `  ${label('longest wait ever')}${dur(l.ms)}` +
        c.dim(`  ${l.date}${l.open ? ', still waiting' : ''}`),
    );
  }
  if (rec.busiestDay) {
    const b = rec.busiestDay;
    rows.push(`  ${label('busiest day')}${group(b.turns)} turns` + c.dim(`  ${b.date}`));
  }
  if (rec.busiestWeek) {
    const w = rec.busiestWeek;
    rows.push(
      `  ${label('most turns in a week')}${group(w.turns)} turns` + c.dim(`  ${w.from} to ${w.to}`),
    );
  }
  if (rec.neverSlept) {
    const n = rec.neverSlept;
    const name = names[n.projectKey] || n.projectKey.slice(0, 8);
    rows.push(
      `  ${label('the room that never slept')}${name}` +
        c.dim(`  ${n.hours} hour${n.hours === 1 ? '' : 's'} of the day, ${n.from} to ${n.to}`),
    );
  }
  if (rec.fastestDischargeDay) {
    const f = rec.fastestDischargeDay;
    rows.push(
      `  ${label('fastest discharge day')}${dur(f.medianMs)} median` +
        c.dim(`  ${f.date}, ${group(f.discharged)} discharged`),
    );
  }
  if (rows.length === 0) return lines;

  lines.push('', c.bold('  the team’s records'));
  // The honest caveat, once, where it applies to every line under it.
  if (rec.partial) lines.push(c.dim(`  since ${rec.since}`));
  lines.push('', ...rows);
  return lines;
}

/** The heading each of the four counters gets in a report. */
const COUNTER_LABELS = Object.freeze({
  input: 'input',
  cacheWrite: 'cache write',
  cacheRead: 'cache read',
  output: 'output',
});

/**
 * WP-83's block: where the tokens went, split four ways.
 *
 * Every line is a fold of `tokens` records over the window and nothing else —
 * no rate, no currency, no plan. A counter that no record in the window named
 * prints `no data` rather than `0`, because `0` is a measurement and nobody
 * made it (`src/core/usage.mjs` rule 2), and the trend prints `no data` unless
 * both weeks were lived through.
 *
 * @param {ReturnType<typeof usageReport>} usage
 * @param {{names?:Record<string,string>, color?:boolean}} [opts]
 * @returns {string[]}
 */
export function renderUsage(usage, opts = {}) {
  const c = palette(Boolean(opts.color));
  const names = opts.names || {};
  const label = (s) => c.dim(String(s).padEnd(26));
  /** @type {string[]} */
  const lines = ['', c.bold(`  tokens · ${usage.label || 'last 7 days'}`), ''];

  if (usage.empty) {
    lines.push(c.dim(`  ${NO_DATA} — no token record in this window`), '');
    return lines;
  }

  const t = usage.totals;
  lines.push(`  ${label('total')}${group(t.total).padStart(12)}`);
  for (const counter of COUNTERS) {
    const cell = t.absent.includes(counter) ? NO_DATA : group(t[counter]);
    lines.push(`  ${label(COUNTER_LABELS[counter])}${cell.padStart(12)}`);
  }

  if (usage.byProject.length) {
    lines.push('', c.dim('  where they went — by project'), '');
    for (const row of usage.byProject.slice(0, 8)) {
      const name = names[row.projectKey] || c.dim(row.projectKey.slice(0, 8));
      lines.push(`  ${String(name).padEnd(26)}${group(row.total).padStart(12)}`);
    }
  }

  if (usage.byModel.length) {
    lines.push('', c.dim('  by model'), '');
    for (const row of usage.byModel.slice(0, 8)) {
      lines.push(`  ${String(row.model).padEnd(26)}${group(row.total).padStart(12)}`);
    }
  }

  const pct = usage.trend.status === 'ok' ? usage.trend.changePct : null;
  lines.push(
    '',
    c.dim(`  7 days vs the 7 before: ${pct == null ? NO_DATA : `${pct >= 0 ? '+' : ''}${pct}%`}`),
    '',
  );
  return lines;
}

/**
 * The report, as text.
 *
 * WP-83: the rate-card line appears only when `showCost` is on. It ships off,
 * so by default this command reports tokens and never a currency.
 *
 * @param {ReturnType<typeof computeStats>} stats
 * @param {{names?:Record<string,string>, color?:boolean, dir?:string, rateCard?:string,
 *          records?:ReturnType<typeof teamRecords>, showCost?:boolean,
 *          usage?:ReturnType<typeof usageReport>}} [opts]
 */
export function renderStats(stats, opts = {}) {
  const c = palette(Boolean(opts.color));
  const names = opts.names || {};
  const lines = [''];
  // WP-26. Wherever a number that came off the rate card is shown, the dated
  // table it came off is named beside it — here, in the panel, on the room
  // plate and in the settings sheet. Printed even for an empty ledger:
  // "which table is this build pricing with" is a question a user asks
  // before there are any numbers, and this is the command they ask it from.
  const showCost = opts.showCost === true;
  const rateCard = opts.rateCard || rateCardVersion();
  const rateCardLine = showCost
    ? c.dim(`  rate card ${rateCard} — list-price estimate, not a bill`)
    : null;

  if (stats.records === 0) {
    lines.push(
      '  the ledger is empty',
      '',
      c.dim('  it fills as the floor moves; there is nothing to measure yet'),
      '',
      ...(rateCardLine ? [rateCardLine, ''] : []),
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

  // WP-46's block leads with the longest wait ever, so the §6 report prints
  // it only when it is being rendered without records — one number, one
  // place, whichever way this function is called.
  const recordLines = renderRecords(opts.records, { names, color: opts.color });
  if (recordLines.length === 0 && stats.longestWaitEver) {
    const l = stats.longestWaitEver;
    lines.push(
      '',
      `  ${label('longest wait ever')}${dur(l.ms)}` +
        c.dim(`  ${l.date}${l.open ? ', still waiting' : ''}`),
    );
  }
  lines.push(...recordLines);

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

  // WP-83. Where the tokens went, in place of where the money went.
  if (opts.usage) lines.push(...renderUsage(opts.usage, { names, color: opts.color }));
  else lines.push('');

  if (rateCardLine) lines.push(rateCardLine);
  lines.push(c.dim(`  from ${opts.dir || LEDGER_DIR} — ${group(stats.records)} records`), '');
  return lines.join('\n');
}

/**
 * @param {string[]} [argv]
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, dir?:string,
 *          cacheDir?:string, now?:number, color?:boolean, showCost?:boolean,
 *          stateFile?:string}} [deps]
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
  // Records are never windowed by --days: "ever" means ever, and the rolling
  // week is a week whatever the report above it covers.
  const teamRec = teamRecords(records, { now });
  const names = projectNames(readCache(deps.cacheDir));

  // WP-83. Whether this command prints a currency at all, read from the same
  // `state.json` the floor reads so the terminal and the window agree. A
  // state file that is missing or unreadable is a floor with the shipped
  // default, which is off — `readState` never throws.
  const showCost =
    deps.showCost ??
    (deps.stateFile ? readState(deps.stateFile) : readState()).settings.showCost === true;
  const rateCard = rateCardVersion();
  const usage = usageReport(records, { now, window: option(argv, '--usage') || '7d' });

  if (argv.includes('--json')) {
    write(
      JSON.stringify(
        {
          ...stats,
          records: teamRec,
          projects: names,
          dir,
          // WP-83. The same fold the deck's Usage tab and `GET /api/stats`
          // read, from the same function, so the three cannot disagree.
          usage,
          showCost,
          // The rate card's version travels whether or not it is being shown:
          // `--json` is for a script, and a script asking which table this
          // build would price with is asking about the build, not the setting.
          rateCardVersion: rateCard,
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  }

  write(
    renderStats(stats, {
      names,
      color: deps.color ?? useColor({ argv }),
      dir,
      records: teamRec,
      rateCard,
      showCost,
      usage,
    }),
  );
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
