/**
 * How the doctor's report reads on a terminal (WP-22 follow-up).
 *
 * Split out of `doctor.mjs` unchanged: the column layout, the relative time,
 * the home-relative path, and one describer per section.
 *
 * A doctor that counts differently from the product is worse than no doctor,
 * so every number here comes from the collector rather than being recomputed.
 */

import os from 'node:os';

import { LABEL_WIDTH } from './doctor-collect.mjs';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Thousands separators without depending on the machine's ICU build.
 * @param {number} n
 */
export function group(n) {
  const s = String(Math.trunc(Math.abs(n)));
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return (n < 0 ? '-' : '') + parts.join(',');
}

/**
 * "2m", "3h", "4d" — the shortest true thing about an elapsed span.
 * @param {number} ms
 */
export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Collapse the user's home directory back to `~`, so the report is readable
 * and safe to paste in a bug report.
 * @param {string} p
 * @param {string} [home]
 */
export function tildify(p, home = os.homedir()) {
  const norm = (s) => String(s).replace(/\\/g, '/');
  const np = norm(p);
  const nh = norm(home).replace(/\/$/, '');
  if (nh && (np === nh || np.startsWith(nh + '/'))) return '~' + np.slice(nh.length);
  return np;
}

/** @param {string} label @param {string} value */
export function row(label, value) {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

/**
 * The plain-text report.
 * @param {Awaited<ReturnType<typeof import('./doctor-collect.mjs').collectReport>>} report
 * @param {{home?:string}} [opts]
 * @returns {string}
 */
export function renderReport(report, opts = {}) {
  const lines = [];

  for (const rt of report.runtimes) {
    const name = rt.label.toLowerCase();
    if (!rt.available) {
      lines.push(row(name, 'not installed'));
      continue;
    }
    lines.push(row(name, describeRuntime(rt)));
    lines.push(
      row(
        'transcripts',
        `${group(rt.sessions)} ${plural(rt.sessions, 'session')} across ` +
          `${group(rt.projects)} ${plural(rt.projects, 'project')}`,
      ),
    );
    lines.push(
      row(
        'running now',
        `${group(rt.live)}   (${name}'s own agent view reports ${group(rt.liveReported)})`,
      ),
    );
    const floor = `${group(rt.sessions)}`;
    lines.push(
      row(
        'on the floor',
        rt.finished > 0
          ? `${floor}  ← ${group(rt.finished)} ${plural(rt.finished, 'session')} ` +
              `${rt.finished === 1 ? 'has' : 'have'} already finished; ` +
              'the agent view no longer lists them'
          : floor,
      ),
    );
    if (rt.error) lines.push(row('', `error: ${rt.error}`));
  }

  lines.push(row('waiting on you', describeDeck(report.deck, report.generatedAt)));

  const hookRows = report.hooks.filter((h) => h.supported);
  for (const h of hookRows) {
    const label = hookRows.length > 1 ? `hooks (${h.label.toLowerCase()})` : 'hooks';
    lines.push(row(label, describeHooks(h, report.generatedAt)));
  }

  lines.push(row('terminal', describeTerminalRow(report.terminal)));

  lines.push(
    row(
      'state',
      `${tildify(report.state.path, opts.home)}, ${report.state.writable ? 'writable' : 'NOT WRITABLE'}` +
        (report.state.writable || !report.state.error ? '' : ` (${report.state.error})`),
    ),
  );
  lines.push(row('egress', report.egress.note));

  if (report.notes.length || !report.ok) lines.push('');
  for (const problem of report.problems) lines.push(`  ! ${problem}`);
  for (const note of report.notes) lines.push(`  · ${note}`);

  return lines.join('\n') + '\n';
}

/**
 * How the runtime's own line reads: which program was found, and how.
 *
 * WP-23a. The row used to be the bare word `available`, which on a machine
 * with the Codex desktop app was true of the transcripts and silent about the
 * fact that the CLI was 250 MB inside an app directory and unreachable
 * (`docs/DEVIATIONS.md` §136.1). Every phrase names a check that ran: a
 * setting that is stored, a binary on `PATH`, a file in the app's own bundle
 * directory — the same discipline as `describeTerminalRow` below.
 *
 * An adapter that reports no binary at all keeps the old wording exactly, so
 * this changes nothing for a runtime whose adapter has not grown one.
 * @param {any} rt
 * @returns {string}
 */
export function describeRuntime(rt) {
  if (!rt.binary) return rt.version ? `${rt.version} on PATH` : 'available';
  if (!rt.binary.found) {
    return rt.binary.pinProblem
      ? `transcripts readable; the pinned ${rt.id} binary is not a file`
      : `transcripts readable; no ${rt.id} binary found`;
  }
  const how =
    {
      pinned: 'pinned',
      path: 'on PATH',
      bundled: 'bundled with the app',
    }[rt.binary.source] || null;
  const what = rt.version || 'found';
  return how ? `${what}   (${how})` : what;
}

/**
 * @param {any} h
 * @param {number} now
 */
export function describeHooks(h, now) {
  if (h.error) return `could not be read: ${h.error}`;
  if (!h.installed) return 'not installed (DeckHQ polls instead)';
  if (h.blockedByPolicy) {
    return (
      'installed, but a managed policy blocks them — ' +
      `${h.blockedByPolicy.key} (${h.blockedByPolicy.file})`
    );
  }
  // A plugin install carries no port: its hook command asks the daemon where
  // it is on every event, so there is no port to report and nothing that can
  // go stale. Saying so is the difference between a row that explains the
  // missing port and a row that looks half-read.
  const parts = [h.viaPlugin && h.port == null ? 'installed as a plugin' : 'installed'];
  if (h.port != null) parts.push(`port ${h.port}`);
  if (h.listening === false) parts.push('NOTHING LISTENING THERE');
  if (h.eventsSeen != null) {
    parts.push(`${group(h.eventsSeen)} ${plural(h.eventsSeen, 'event')}`);
    if (h.lastEventAt) parts.push(`last ${ago(now - h.lastEventAt)} ago`);
    else parts.push('none yet this run');
  }
  return parts.join(', ');
}

/**
 * Which terminal "open in terminal" would use, and how it was chosen.
 *
 * Same wording discipline as the rest of the report (`docs/DEVIATIONS.md`
 * §72–§73): every phrase here names a check that was actually run — an
 * environment variable that is set, a binary on `PATH`, an app bundle that
 * exists, a setting that is stored. The row does NOT claim the launch works.
 * As of WP-04 no launch form outside Windows has been run on a real desktop
 * (`docs/DEVIATIONS.md` §9), and a row saying "will open Ghostty" would be
 * exactly the kind of unearned claim §74 exists to keep out of this file.
 * @param {any} t
 */
export function describeTerminalRow(t) {
  if (!t || !t.id) {
    return 'none found — "open in terminal" has nothing to open';
  }
  if (t.pinned && !t.present) {
    return `${t.label}   (pinned in settings; not found on this machine)`;
  }
  const how = {
    pinned: 'pinned in settings',
    env: 'this session runs inside it',
    TERMINAL: '$TERMINAL',
    installed: 'installed',
    fallback: 'always present',
  }[t.reason];
  return how ? `${t.label}   (${how})` : String(t.label);
}

/**
 * The debt line. This is the number that cannot be argued with: sessions that
 * owe the user an answer AND are not running, so no view derived from live
 * processes lists them at all.
 * @param {any} deck
 * @param {number} now
 */
export function describeDeck(deck, now) {
  if (!deck.found) return 'needs a running DeckHQ to count';
  if (deck.waitingNotRunning === 0) {
    return deck.waiting > 0
      ? `0   (${group(deck.waiting)} waiting, all still running)`
      : '0   nothing is waiting on you';
  }
  const parts = [`${group(deck.waitingNotRunning)}  ← none of these are running`];
  if (deck.oldestWaitAt) parts.push(`oldest ${ago(now - deck.oldestWaitAt)}`);
  return parts.join('; ');
}

/** @param {number} n @param {string} word */
export function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}
