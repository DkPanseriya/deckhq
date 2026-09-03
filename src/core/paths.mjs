/**
 * Where DeckHQ keeps the state it owns.
 *
 * This must NOT be the package directory. `npx deckhq` installs the package
 * into a directory the package manager owns and is free to prune, replace on
 * a version bump, or (for a root-owned `-g` install) make read-only. The
 * user-owned half of the model — every acknowledgement, bench, let-go and MK
 * name — is the whole product, and storing it there means it silently
 * evaporates on upgrade or silently fails to write.
 *
 * So it lives beside the user, in `~/.deckhq`, with an override for anyone
 * who keeps their dotfiles somewhere else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Everything DeckHQ writes lives under here. */
export const DATA_DIR = resolveDataDir();

/** Acknowledgements, settings and identity. */
export const STATE_FILE = path.join(DATA_DIR, 'state.json');

/** Pre-install copies of files DeckHQ modifies on the user's behalf. */
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * Derived scan caches, one file per runtime. Nothing user-owned lives here:
 * every byte is re-derivable from the transcripts on disk, so this directory
 * can be deleted at any time and the only cost is one slow scan. That is why
 * it sits beside `state.json` rather than inside it — a corrupt cache must be
 * discardable without touching the half of the model the user wrote.
 */
export const CACHE_DIR = path.join(DATA_DIR, 'cache');

/**
 * The event ledger, one append-only `YYYY-MM-DD.jsonl` per local day (WP-17).
 *
 * Beside the cache rather than inside `state.json` for the same reason the
 * cache is: it is derived measurement, not the user-owned half of the model.
 * Deleting it costs the history behind the postcard and the records and
 * nothing else — no acknowledgement lives here. It is pruned to
 * `settings.ledgerRetentionDays` at every daemon start.
 */
export const LEDGER_DIR = path.join(DATA_DIR, 'ledger');

/**
 * Where one runtime adapter's scan cache lives.
 *
 * The id is sanitised rather than trusted: it becomes a filename, and an
 * adapter id carrying a separator or a `..` would otherwise write outside
 * CACHE_DIR. Adapter ids are ours today, but a path that can escape its
 * directory is a path that eventually does.
 *
 * @param {string} runtimeId
 * @returns {string}
 */
export function cacheFileFor(runtimeId) {
  const safe = String(runtimeId || '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 64);
  return path.join(CACHE_DIR, `${safe || 'runtime'}.json`);
}

function resolveDataDir() {
  const override = process.env.DECKHQ_STATE_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return path.join(os.homedir(), '.deckhq');
}

/**
 * One-time move of state written by a pre-1.1 build, which kept it inside the
 * package directory. Copies rather than moves: if the old location is still
 * readable there is no benefit to deleting it, and a half-completed move
 * would lose the file outright.
 *
 * Never throws. A machine where this fails simply starts from defaults, which
 * is exactly what it would have done without a legacy file.
 *
 * @param {string} legacyRoot  the package directory of the old install
 * @param {{info:Function, warn:Function}} [log]
 * @returns {{state:boolean, backups:number}} what was actually carried over
 */
export function migrateLegacyState(legacyRoot, log) {
  const result = { state: false, backups: 0 };
  if (!legacyRoot) return result;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    log?.warn?.(`could not create ${DATA_DIR}`, err);
    return result;
  }

  const legacyState = path.join(legacyRoot, 'state.json');
  if (!fs.existsSync(STATE_FILE) && fs.existsSync(legacyState)) {
    try {
      fs.copyFileSync(legacyState, STATE_FILE);
      result.state = true;
      log?.info?.(`migrated state from ${legacyState} to ${STATE_FILE}`);
    } catch (err) {
      log?.warn?.('could not migrate legacy state.json', err);
    }
  }

  // The settings backups matter too: hook removal restores the user's
  // original settings.json from one of them.
  const legacyBackups = path.join(legacyRoot, 'state');
  try {
    if (!fs.existsSync(legacyBackups)) return result;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    for (const name of fs.readdirSync(legacyBackups)) {
      if (!/^settings-backup-\d+\.json$/.test(name)) continue;
      const target = path.join(BACKUP_DIR, name);
      if (fs.existsSync(target)) continue;
      fs.copyFileSync(path.join(legacyBackups, name), target);
      result.backups += 1;
    }
    if (result.backups > 0) {
      log?.info?.(`migrated ${result.backups} settings backup(s) to ${BACKUP_DIR}`);
    }
  } catch (err) {
    log?.warn?.('could not migrate legacy settings backups', err);
  }

  return result;
}
