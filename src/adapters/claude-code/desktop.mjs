/**
 * The Claude Code desktop app's own session store.
 *
 * The app keeps one small JSON file per session at
 * `%APPDATA%/Claude/claude-code-sessions/<install>/<profile>/local_<id>.json`,
 * holding the metadata the app's sidebar shows. Two fields matter here:
 *
 *   - `isArchived` — the user archived the session in the app. DeckHQ reads
 *     this as "let go", and un-archiving as "rehired".
 *   - `cliSessionId` — the join key. The app's own `sessionId` is
 *     `local_<uuid>` and is NOT the transcript's name; the transcript is
 *     `<cliSessionId>.jsonl` under `~/.claude/projects/`. Everything else in
 *     DeckHQ is keyed by that id, so this is the only usable link between the
 *     two stores. Verified on this machine: 43 of 51 app sessions join to a
 *     transcript, 14 of those archived.
 *
 * This is a read-only observation of a store DeckHQ does not own, so it is
 * defensive throughout: a missing directory, an unreadable file or a JSON
 * parse failure yields no entry rather than an error. The app is free to
 * change this format; if it does, the archive mapping quietly goes empty and
 * everything else still works.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Where the desktop app keeps its session metadata. Overridable for tests.
 * On Windows this is %APPDATA%; the app uses the same relative path under the
 * platform config dir elsewhere.
 */
export function desktopSessionsDir() {
  if (process.env.DECKHQ_DESKTOP_SESSIONS_DIR) {
    return process.env.DECKHQ_DESKTOP_SESSIONS_DIR;
  }
  const home = os.homedir();
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : path.join(home, '.config'));
  return path.join(appData, 'Claude', 'claude-code-sessions');
}

/** Depth guard: the real layout is <install>/<profile>/<file>.json. */
const MAX_DEPTH = 4;

/** Sanity cap so a pathological directory cannot stall a poll. */
const MAX_FILES = 5000;

/**
 * Every `*.json` under `dir`, to a bounded depth. Never throws.
 * @param {string} dir
 * @param {number} [depth]
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectJson(dir, depth = 0, out = []) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJson(full, depth + 1, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/**
 * @typedef {object} DesktopSession
 * @property {boolean} archived
 * @property {string} [title]  the title the app's sidebar shows
 */

/**
 * Read the desktop app's view of every session, keyed by `cliSessionId` —
 * i.e. by the same id DeckHQ uses for a claude-code agent.
 *
 * @returns {Map<string, DesktopSession>}
 */
export function readDesktopSessions() {
  /** @type {Map<string, DesktopSession>} */
  const out = new Map();
  const dir = desktopSessionsDir();

  for (const file of collectJson(dir)) {
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // unreadable or mid-write; the next poll will see it
    }
    if (!rec || typeof rec !== 'object') continue;
    const cli = rec.cliSessionId;
    if (typeof cli !== 'string' || !cli) continue;

    out.set(cli, {
      archived: rec.isArchived === true,
      title: typeof rec.title === 'string' && rec.title ? rec.title : undefined,
    });
  }
  return out;
}
