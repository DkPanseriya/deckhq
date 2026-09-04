/**
 * The shareable report, and the picture of it (WP-22 follow-up).
 *
 * Split out of `doctor.mjs` unchanged: the redaction pass, the share text,
 * and the proof page a capture is taken of.
 *
 * `redact` is the part that matters. A report a user pastes into an issue
 * must carry no path, no project name and no session title they did not mean
 * to send, and the redaction runs over the finished text rather than at each
 * site that might have produced one.
 */

import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { DATA_DIR } from '../core/paths.mjs';
import { plural, describeDeck, describeRuntime, ago, group } from './doctor-report.mjs';

// ---------------------------------------------------------------------------
// The share block
// ---------------------------------------------------------------------------

/**
 * The pitch, as one line, and the last line of every share block.
 * `docs/plan/08-PLAN-V2-100X.md` §1.3 is the source; the wording of this line
 * belongs to the PM (WP-44 in that document's §11 list), so it is a named
 * export rather than a string buried in a template.
 */
export const PITCH =
  'DeckHQ — every AI coding session on your machine, on one office floor. ' +
  'npx deckhq · local, private, MIT.';

/** How wide the share block's label gutter is. The report's width, unindented. */
export const SHARE_LABEL_WIDTH = 16;

/**
 * Everything that could name this machine or its work, gone.
 *
 * The share block is assembled only from counts and fixed phrases, so on the
 * ordinary path this replaces nothing at all. It exists because two fields in
 * the report are strings this file did not write — a runtime's `version()` and
 * an adapter's error message — and an error message from a filesystem call
 * carries an absolute path by default. Defence in depth for a block whose
 * whole purpose is to be pasted somewhere public.
 *
 * The home directory goes first, so `~` never has to be inferred from a
 * pattern, then the shapes of an absolute path, then the machine's name.
 * Hostnames under three characters are left alone: a two-letter host name is
 * indistinguishable from a word and redacting it would corrupt the text it is
 * meant to protect.
 *
 * @param {string} text
 * @param {{home?:string, host?:string}} [opts]
 * @returns {string}
 */
export function redact(text, opts = {}) {
  const home = opts.home ?? os.homedir();
  const host = opts.host ?? os.hostname();
  let out = String(text);

  if (home) {
    for (const form of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) {
      // Anything hanging off the home directory goes with it: the path is the
      // part that identifies the machine, the rest identifies the work.
      //
      // Anchored at the start of a token, because the separator-swapped forms
      // are otherwise substrings of the real thing: `C:\Users\ada` contains
      // `\Users\ada`, and replacing the tail alone would leave `C:[path]`
      // behind for the drive-letter rule to no longer recognise.
      out = out.replace(
        new RegExp(`(^|[\\s,;('"=])${escapeRegExp(form)}[^\\s,;)'"]*`, 'gi'),
        '$1[path]',
      );
    }
  }

  out = out
    .replace(/\\\\[^\s,;)'"]+/g, '[path]') // \\server\share
    .replace(/[A-Za-z]:[\\/][^\s,;)'"]*/g, '[path]') // C:\Users\…, C:/Users/…
    .replace(/~[\\/][^\s,;)'"]*/g, '[path]') // ~/…
    .replace(/(?:\/[A-Za-z0-9._@%+-]+){2,}\/?/g, '[path]'); // /home/ada/work

  for (const name of new Set([host, String(host).split('.')[0]])) {
    if (!name || name.length < 3) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), '[host]');
  }
  return out;
}

/** @param {string} s */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The pasteable block: the same report, fenced, with nothing in it that
 * belongs to the person running it. `docs/plan/08-PLAN-V2-100X.md` WP-44.
 *
 * This is the launch asset, and it is text on purpose — a number travels
 * through a thread, a terminal and a chat window, and a screenshot only
 * travels through one of those. What makes it postable is that a reader can
 * run the same command and check it, so the block carries the whole report's
 * numbers and not a selected highlight.
 *
 * What it drops against `renderReport`, and why:
 *
 *   - **The state path.** The only path in the healthy report, and a home
 *     directory names its owner. The row keeps its verdict — writable or not
 *     — because that is the part a reader can act on.
 *   - **Every free-text problem, note and per-runtime error.** These are the
 *     strings most likely to carry a path, a project name or a machine name,
 *     and none of them is meaningful to a stranger. When the report is not
 *     `ok`, the block says how many problems there are and where to see them:
 *     the honest summary, with nothing leaked.
 *   - **The hook port.** A port number tells a reader nothing about whether
 *     hooks are working, which is what the row is for.
 *
 * It adds a date (UTC, to the day — the hour would date-stamp a person's
 * working habits for no gain) and the pitch as its last line.
 *
 * Project names never appear because they never enter: `collectReport` counts
 * distinct working directories and keeps the count, never the strings. The
 * test for that asserts the absence of the fixture's directory names in the
 * rendered block rather than trusting this paragraph.
 *
 * @param {Awaited<ReturnType<typeof import('./doctor-collect.mjs').collectReport>>} report
 * @param {{home?:string, host?:string}} [opts]
 * @returns {string}
 */
export function renderShare(report, opts = {}) {
  /** @param {string} label @param {string} value */
  const srow = (label, value) => `${label.padEnd(SHARE_LABEL_WIDTH)}${value}`;
  const lines = [`deckhq doctor · ${new Date(report.generatedAt).toISOString().slice(0, 10)}`, ''];

  for (const rt of report.runtimes) {
    const name = rt.label.toLowerCase();
    if (!rt.available) {
      lines.push(srow(name, 'not installed'));
      continue;
    }
    // WP-23a: the same sentence the report prints, and it names a source
    // ("bundled with the app") rather than a path — nothing in it identifies
    // this machine, and `redact()` below still runs over the whole block.
    lines.push(srow(name, describeRuntime(rt)));
    lines.push(
      srow(
        'transcripts',
        `${group(rt.sessions)} ${plural(rt.sessions, 'session')} across ` +
          `${group(rt.projects)} ${plural(rt.projects, 'project')}`,
      ),
    );
    lines.push(
      srow(
        'running now',
        `${group(rt.live)}   (${name}'s own agent view reports ${group(rt.liveReported)})`,
      ),
    );
    lines.push(
      srow(
        'on the floor',
        rt.finished > 0
          ? `${group(rt.sessions)}  ← ${group(rt.finished)} ${plural(rt.finished, 'session')} ` +
              `${rt.finished === 1 ? 'has' : 'have'} already finished; ` +
              'the agent view no longer lists them'
          : `${group(rt.sessions)}`,
      ),
    );
  }

  lines.push(srow('waiting on you', describeDeck(report.deck, report.generatedAt)));

  const hookRows = report.hooks.filter((h) => h.supported);
  for (const h of hookRows) {
    const label = hookRows.length > 1 ? `hooks (${h.label.toLowerCase()})` : 'hooks';
    lines.push(srow(label, describeHooksForShare(h, report.generatedAt)));
  }

  lines.push(srow('state', report.state.writable ? 'writable' : 'NOT WRITABLE'));
  lines.push(srow('egress', report.egress.note));

  if (report.problems.length) {
    lines.push('');
    lines.push(
      `! ${group(report.problems.length)} ${plural(report.problems.length, 'problem')} — ` +
        'run `deckhq doctor` here for the detail',
    );
  }

  lines.push('');
  lines.push(PITCH);

  return '```\n' + redact(lines.join('\n'), opts) + '\n```\n';
}

/**
 * The hooks row for the share block: the verdict and the delivery evidence,
 * without the port and without an error message.
 * @param {any} h
 * @param {number} now
 */
export function describeHooksForShare(h, now) {
  if (h.error) return 'could not be read';
  if (!h.installed) return 'not installed (DeckHQ polls instead)';
  // The key, without the file. A managed settings path is a path like any
  // other and the share block carries none; the key alone is the actionable
  // half, and it is the same on every machine that policy is deployed to.
  if (h.blockedByPolicy) {
    return `installed, but a managed policy blocks them — ${h.blockedByPolicy.key}`;
  }
  const parts = [h.viaPlugin && h.port == null ? 'installed as a plugin' : 'installed'];
  if (h.listening === false) parts.push('NOTHING LISTENING THERE');
  if (h.eventsSeen != null) {
    parts.push(`${group(h.eventsSeen)} ${plural(h.eventsSeen, 'event')}`);
    if (h.lastEventAt) parts.push(`last ${ago(now - h.lastEventAt)} ago`);
    else parts.push('none yet this run');
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// The capture proof
// ---------------------------------------------------------------------------

/** @param {unknown} s */
export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * The comparison card: what is running right now beside what is on the floor,
 * on this machine at this moment.
 *
 * WHAT THIS CARD MAY AND MAY NOT CLAIM. An earlier version headlined "DeckHQ
 * sees 61 sessions the agent view cannot", comparing 5 running against 66
 * all-history. `claude agents --json` was then measured on the reference
 * machine and returns every live session, `kind: "interactive"`, including
 * terminal-launched ones in other repositories — it is not blind to them. The
 * claim was literally true and rhetorically dishonest, and a reader who ran
 * the command would have caught us. It is gone.
 *
 * The real difference is persistence, not sight: a view of running processes
 * forgets a session the moment its process exits, and DeckHQ keeps it along
 * with whether it still owes you an answer. So the headline leads with the
 * debt — sessions waiting on the user that are NOT running, which no
 * live-process view lists by construction — and falls back to a bare
 * descriptive count when no daemon is running to supply it, rather than
 * reinstating a softer version of the old claim. docs/DEVIATIONS.md §74.
 *
 * Self-contained on purpose — no web font, no stylesheet, no image, no script.
 * A launch asset that fetches anything is a launch asset that contradicts the
 * thing it is proving (docs/02-ARCHITECTURE.md §9), and system fonts render
 * identically enough at this size.
 *
 * @param {Awaited<ReturnType<typeof import('./doctor-collect.mjs').collectReport>>} report
 * @param {{width?:number, height?:number, host?:string}} [opts]
 * @returns {string}
 */
export function buildProofHtml(report, opts = {}) {
  const width = opts.width || 1200;
  const height = opts.height || 630;
  const rt =
    report.runtimes.find((r) => r.available && r.finished > 0) ||
    report.runtimes.find((r) => r.available) ||
    report.runtimes[0];

  const name = rt ? rt.label.toLowerCase() : 'runtime';
  const theirs = rt ? group(rt.live) : '0';
  const ours = rt ? group(rt.sessions) : '0';
  const finished = rt ? rt.finished : 0;
  const when = new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' ');
  const host = opts.host ?? os.hostname();

  const owed = report.deck.found ? report.deck.waitingNotRunning : null;
  let headline;
  let sub;
  if (owed) {
    headline =
      `${group(owed)} finished ${plural(owed, 'session')} ` +
      `${owed === 1 ? 'is' : 'are'} still waiting on you.`;
    sub = 'The agent view lists none of them.';
    if (report.deck.oldestWaitAt) {
      sub += ` Oldest: ${ago(report.generatedAt - report.deck.oldestWaitAt)}.`;
    }
  } else if (finished > 0) {
    // No daemon to ask, or nothing owed. State the count and stop — no
    // comparative claim at all.
    headline = `${group(finished)} of them have already finished.`;
    sub = report.deck.found ? 'Nothing is waiting on you right now.' : '';
  } else {
    headline = 'Every session on this machine is running right now.';
    sub = '';
  }

  return `<!doctype html>
<meta charset="utf-8">
<title>DeckHQ capture proof</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${width}px; height: ${height}px;
    background: #14120F;
    color: #EDE7DD;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 56px 64px;
    -webkit-font-smoothing: antialiased;
  }
  .eyebrow {
    font-size: 20px; letter-spacing: .22em; text-transform: uppercase;
    color: #8A8178; font-weight: 600;
  }
  .cols { display: flex; align-items: stretch; gap: 40px; }
  .col { flex: 1; padding: 28px 32px; border-radius: 18px; background: #1E1B17; border: 1px solid #2E2A24; }
  .col.ours { background: #1B211B; border-color: #33452F; }
  .who { font-size: 24px; color: #B5ACA1; font-variant-ligatures: none; }
  .col.ours .who { color: #9CCB8C; }
  .num { font-size: 132px; line-height: 1.02; font-weight: 800; letter-spacing: -.04em; margin-top: 8px; }
  .col.ours .num { color: #A9E08F; }
  .unit { font-size: 22px; color: #8A8178; margin-top: 6px; }
  .headline { font-size: 40px; font-weight: 700; line-height: 1.22; letter-spacing: -.02em; }
  .sub { font-size: 27px; color: #B5ACA1; margin-top: 10px; line-height: 1.3; }
  .foot { font-size: 19px; color: #6F6860; display: flex; justify-content: space-between; gap: 24px; }
  .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace; }
</style>
<div class="eyebrow">DeckHQ &middot; capture proof</div>

<div class="cols">
  <div class="col">
    <div class="who mono">${esc(name)} &middot; its own agent view</div>
    <div class="num">${esc(theirs)}</div>
    <div class="unit">sessions running right now</div>
  </div>
  <div class="col ours">
    <div class="who mono">deckhq</div>
    <div class="num">${esc(ours)}</div>
    <div class="unit">sessions on the floor</div>
  </div>
</div>

<div>
  <div class="headline">${esc(headline)}</div>
  ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
</div>

<div class="foot">
  <span>${esc(host)} &middot; ${esc(when)} UTC</span>
  <span class="mono">npx deckhq</span>
</div>
`;
}

/**
 * Write the proof PNG. Best effort by contract: a machine with no Chrome, or
 * a Node too old for the CDP client, prints one sentence and is not a failure.
 * `doctor` must never fail because a screenshot could not be taken.
 *
 * @param {Awaited<ReturnType<typeof import('./doctor-collect.mjs').collectReport>>} report
 * @param {{outDir?:string, out?:string, write?:(s:string)=>void, now?:number}} [opts]
 * @returns {Promise<{ok:boolean, path:string|null, reason:string|null}>}
 */
export async function captureProof(report, opts = {}) {
  const write = opts.write || ((s) => process.stdout.write(s));
  const chrome = await import('./chrome.mjs');

  if (!chrome.hasWebSocket()) {
    const reason =
      `--capture-proof needs Node 22 or newer (this is ${process.version}); ` +
      'the report above is unaffected.';
    write(`\n  ${reason}\n`);
    return { ok: false, path: null, reason };
  }

  const chromePath = chrome.findChrome();
  if (!chromePath) {
    const reason =
      'no Chrome, Chromium or Edge was found, so no proof image was written. ' +
      'Set CHROME_PATH to the executable and run this again.';
    write(`\n  ${reason}\n`);
    return { ok: false, path: null, reason };
  }

  const stamp = new Date(opts.now ?? report.generatedAt)
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const outDir = opts.outDir || path.join(DATA_DIR, 'snapshots');
  const outFile = opts.out || path.join(outDir, `capture-proof-${stamp}.png`);

  try {
    await chrome.screenshotHtml({
      html: buildProofHtml(report),
      outFile,
      width: 1200,
      height: 630,
      scale: 2,
      chromePath,
    });
  } catch (err) {
    const reason = `could not write the proof image: ${err?.message || err}`;
    write(`\n  ${reason}\n`);
    return { ok: false, path: null, reason };
  }

  write(`\n  proof           ${outFile}\n`);
  return { ok: true, path: outFile, reason: null };
}
