/**
 * Claude Code hook install / remove. docs/02-ARCHITECTURE.md §6.
 *
 * We write one command hook per event into `~/.claude/settings.json`, each
 * tagged `"_deckhq": true` so removal is exact and never touches anything the
 * user (or another tool) put there. Every write is preceded by a backup of
 * the file's exact original bytes so `remove()` can restore them verbatim
 * when nothing else has changed in the meantime.
 *
 * ============================================================================
 * WP-22 follow-up · this file is install and remove — the two writes, the
 * backup taken before each, and the restore that only runs when the file's
 * bytes are still the ones that were backed up. What is written, what a
 * payload may say, and what policy allows are three modules, all re-exported
 * from here:
 *
 *   hooks-entries.mjs  the events, the command, the port, the permission
 *   hooks-summary.mjs  the bounded description of somebody else's tool call
 *   hooks-policy.mjs   settings, plugin, managed drop-ins, the allowlist
 * ============================================================================
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { BACKUP_DIR } from '../../core/paths.mjs';
import { buildHooksBlock, DEFAULT_PORT, HOOK_EVENTS, SETTINGS_FILE } from './hooks-entries.mjs';
import {
  readSettings,
  writeFileAtomic,
  firstDeckhqPort,
  hasDeckhqEntries,
  isPlainObject,
  deepEqual,
} from './hooks-policy.mjs';

export * from './hooks-entries.mjs';
export * from './hooks-summary.mjs';
export * from './hooks-policy.mjs';

/**
 * The port the installed hooks currently post to, or null if none are
 * installed. Never throws.
 * @returns {Promise<number|null>}
 */
export async function installedPort() {
  try {
    const { parsed } = await readSettings();
    return firstDeckhqPort(parsed);
  } catch {
    return null;
  }
}

/**
 * True if DeckHQ's hooks are currently installed AND pointing at this
 * daemon. Never throws: a missing or malformed settings file simply reads as
 * "not installed".
 *
 * The port matters. Hooks installed while the daemon was on 4317 keep posting
 * to 4317 after a restart on 4318 or a `--port 4400`, and every event lands
 * nowhere. Reporting that as "installed" would leave the interface promising
 * exact state while it silently ran on the inference path — so a port
 * mismatch reads as not installed, which puts the banner back up and offers
 * the user the one-click reinstall that fixes it.
 *
 * @param {number} [port] omit to ask only whether anything of ours is present
 * @returns {Promise<boolean>}
 */
export async function installed(port) {
  try {
    const { parsed } = await readSettings();
    if (!hasDeckhqEntries(parsed)) return false;
    if (port == null) return true;
    return firstDeckhqPort(parsed) === Number(port);
  } catch {
    return false;
  }
}

/**
 * Install DeckHQ's hooks. Reads the current settings, aborts with a clear
 * error and changes nothing if the file is malformed, otherwise backs up the
 * exact original bytes, merges our tagged entries in, and writes atomically.
 *
 * A no-op if already installed at this port. If ours are present but pointing
 * at a different port, they are removed first and re-added — otherwise the
 * daemon could never recover from a port change.
 *
 * @param {number} [port]
 * @returns {Promise<void>}
 */
export async function install(port = DEFAULT_PORT) {
  {
    const { parsed } = await readSettings();
    if (hasDeckhqEntries(parsed)) {
      if (firstDeckhqPort(parsed) === Number(port)) return; // already correct
      await remove(); // stale port: take ours out, then put them back below
    }
  }

  const { existed, raw, parsed } = await readSettings();

  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `settings-backup-${Date.now()}.json`);
  await fsp.writeFile(backupPath, JSON.stringify({ existed, raw }, null, 2), 'utf8');

  const next = { ...parsed };
  const hooks = isPlainObject(next.hooks) ? { ...next.hooks } : {};
  const ours = buildHooksBlock(port);
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...existing, ...ours[event]];
  }
  next.hooks = hooks;

  await writeFileAtomic(SETTINGS_FILE, JSON.stringify(next, null, 2));
}

/** Most recently created `settings-backup-*.json` in the data dir, or null. */
export async function latestBackup() {
  let names;
  try {
    names = await fsp.readdir(BACKUP_DIR);
  } catch {
    return null;
  }
  const backups = names.filter((n) => /^settings-backup-\d+\.json$/.test(n)).sort();
  if (backups.length === 0) return null;
  const file = path.join(BACKUP_DIR, backups[backups.length - 1]);
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Remove only the hook entries DeckHQ added (`_deckhq: true`), pruning
 * emptied matcher groups and emptied event keys. If the result matches the
 * backed-up pre-install content exactly, the original bytes are restored
 * verbatim so the file comes back byte-identical, even though our own
 * merge/prune cycle does not guarantee identical key ordering on its own.
 * Safe to run if the user hand-edited unrelated parts of the file since
 * install — in that case the pruned object is written as 2-space JSON.
 * A no-op if nothing tagged is present.
 * @returns {Promise<void>}
 */
export async function remove() {
  const { existed, parsed } = await readSettings();
  if (!hasDeckhqEntries(parsed)) return; // nothing to remove

  const next = { ...parsed };
  if (isPlainObject(next.hooks)) {
    const hooks = { ...next.hooks };
    for (const event of Object.keys(hooks)) {
      const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
      const prunedGroups = [];
      for (const group of groups) {
        if (!isPlainObject(group)) {
          prunedGroups.push(group);
          continue;
        }
        const list = Array.isArray(group.hooks) ? group.hooks : [];
        const prunedList = list.filter((h) => !(h && h._deckhq === true));
        if (prunedList.length > 0) {
          prunedGroups.push({ ...group, hooks: prunedList });
        }
        // else: this matcher group had only our hook(s); drop the group.
      }
      if (prunedGroups.length > 0) {
        hooks[event] = prunedGroups;
      } else {
        delete hooks[event];
      }
    }
    if (Object.keys(hooks).length > 0) {
      next.hooks = hooks;
    } else {
      delete next.hooks;
    }
  }

  const backup = await latestBackup();

  if (backup && !backup.existed && Object.keys(next).length === 0) {
    // The settings file did not exist before install, and nothing else has
    // added content since: restore that exact absence.
    try {
      await fsp.unlink(SETTINGS_FILE);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return;
  }

  if (backup && backup.existed && typeof backup.raw === 'string') {
    let original;
    try {
      original = JSON.parse(backup.raw);
    } catch {
      original = null;
    }
    if (original !== null && deepEqual(next, original)) {
      await writeFileAtomic(SETTINGS_FILE, backup.raw);
      return;
    }
  }

  // No usable backup, or the user changed something else in the meantime:
  // write the pruned object as clean 2-space JSON. If the file did not
  // exist before install (no `existed` info available), write it anyway,
  // since the object still holds other content the user or another tool
  // added after our install.
  if (!existed && Object.keys(next).length === 0) {
    try {
      await fsp.unlink(SETTINGS_FILE);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return;
  }
  await writeFileAtomic(SETTINGS_FILE, JSON.stringify(next, null, 2));
}
