/**
 * Writing a plan from `src/core/launcher.mjs`, and taking it back out — WP-62.
 *
 * The half that touches the disk. It writes only files that do not already
 * exist or that already carry our tag, it records every path it wrote, and
 * `remove()` deletes a path only when the record names it **and** the file on
 * disk still says it is ours. Nothing here is ever handed a path a user typed:
 * every one comes out of a plan built from a platform, an environment and a
 * state directory.
 *
 * WHY THERE IS A POWERSHELL SCRIPT AND NOT A COMMAND STRING. A `.lnk` is a
 * binary format with no documented writer outside COM, so Windows itself has
 * to be asked. `docs/DEVIATIONS.md` §101 measured what `powershell -Command`
 * does with arguments — it appends them to the *command text*, and a path
 * became script source — so this runs `src/core/shortcut.ps1` with `-File` and
 * named parameters, and nothing this module holds is ever interpolated into a
 * command line.
 *
 * No egress. No process is killed. Nothing outside the planned paths and the
 * state directory is written.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DATA_DIR } from './paths.mjs';
import { RECORD_NAME, TAG } from './launcher.mjs';
import { pngToIco, readIco } from './ico.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The fixed script the Windows path runs. Its text never varies. */
export const SHORTCUT_SCRIPT = path.join(HERE, 'shortcut.ps1');

/** The PNGs the icon is wrapped from, largest first. */
export const ICON_PNGS = [
  fileURLToPath(new URL('../../public/icon-512.png', import.meta.url)),
  fileURLToPath(new URL('../../public/icon-192.png', import.meta.url)),
];

/** Where the generated `.ico` goes: under the state dir, which we own. */
export function icoPathFor(dataDir = DATA_DIR) {
  return path.join(dataDir, 'icons', 'deckhq.ico');
}

/** The biggest PNG this package ships, for the two docs-only platforms. */
export function iconPngPath() {
  return ICON_PNGS[0];
}

/**
 * Run `shortcut.ps1` with named parameters and nothing interpolated.
 *
 * @param {string[]} args parameters after `-File <script>`
 * @param {{exec?:typeof execFile, powershell?:string}} [deps]
 * @returns {Promise<string>} stdout
 */
export function runShortcutScript(args, deps = {}) {
  const exec = deps.exec || execFile;
  const ps = deps.powershell || 'powershell.exe';
  return new Promise((resolve, reject) => {
    exec(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        // `-File` is subject to execution policy where `-Command` was not, so
        // this one invocation carries a Bypass. It changes no machine policy;
        // see `docs/DEVIATIONS.md` §101.
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SHORTCUT_SCRIPT,
        ...args,
      ],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || err.message).trim() || 'powershell failed'));
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

/**
 * Everything `shortcut.ps1 -Action create` needs, as a JSON document.
 *
 * **NOT AS COMMAND-LINE PARAMETERS**, and that is measured rather than
 * fastidious. A `.lnk`'s `Arguments` field is itself a quoted command line —
 * `"C:\…\deckhq.mjs" "app"` — so passing it as a parameter puts double quotes
 * through Node's win32 quoting and then through `powershell -File`'s own
 * parsing, and the two do not agree about them. On the reference machine that
 * produced `Parameter set cannot be resolved using the specified named
 * parameters`, an error that names neither the parameter nor the reason. The
 * same run also showed `-File` **dropping an empty-string argument from the
 * command line entirely**, so `-IconLocation "" -Description "d"` bound the
 * *name* `-Description` as the icon location.
 *
 * A file has neither problem, and it is the strictly stronger form of §101's
 * rule: with a spec file, no value DeckHQ holds is on a command line at all.
 *
 * Pure. The test asserts the whole document.
 *
 * @param {import('./launcher.mjs').PlannedFile} file
 * @returns {Record<string, any>}
 */
export function shortcutSpec(file) {
  const lnk = /** @type {NonNullable<import('./launcher.mjs').PlannedFile['lnk']>} */ (
    file.lnk || {}
  );
  return {
    path: file.path,
    target: lnk.target,
    arguments: lnk.args || '',
    workingDirectory: lnk.workingDirectory || '',
    iconLocation: lnk.iconLocation || '',
    description: lnk.description || '',
    windowStyle: lnk.windowStyle ?? 1,
  };
}

/**
 * Write one `.lnk` by handing Windows a spec file, and delete the spec after.
 *
 * The spec lives under the state directory, which this package owns, so no
 * temp-file race with anything else and nothing left behind on a failure that
 * a later run could read.
 *
 * @param {import('./launcher.mjs').PlannedFile} file
 * @param {{dataDir?:string, exec?:typeof execFile, powershell?:string}} deps
 */
export async function createShortcut(file, deps = {}) {
  const dataDir = deps.dataDir || DATA_DIR;
  const spec = path.join(dataDir, `shortcut-${process.pid}-${Date.now()}.json`);
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(spec, JSON.stringify(shortcutSpec(file), null, 2), 'utf8');
  try {
    return await runShortcutScript(['-Action', 'create', '-SpecFile', spec], deps);
  } finally {
    try {
      await fsp.unlink(spec);
    } catch {
      /* already gone */
    }
  }
}

/**
 * The real Desktop, Start Menu and Startup folders, asked of Windows.
 *
 * `%USERPROFILE%\Desktop` is a guess, and on a machine with OneDrive folder
 * backup switched on it is the wrong one — the icon lands in a directory
 * Explorer no longer draws. Returns null on any failure, and the caller then
 * falls back to the guess rather than refusing to install.
 *
 * @param {{exec?:typeof execFile, powershell?:string}} [deps]
 * @returns {Promise<{desktop:string, programs:string, startup:string}|null>}
 */
export async function probeWindowsFolders(deps = {}) {
  try {
    const out = await runShortcutScript(['-Action', 'folders'], deps);
    const parsed = JSON.parse(out);
    if (!parsed || typeof parsed.desktop !== 'string' || !parsed.desktop) return null;
    return { desktop: parsed.desktop, programs: parsed.programs, startup: parsed.startup };
  } catch {
    return null;
  }
}

/**
 * What an existing `.lnk` says about itself, or null.
 * @param {string} file
 * @param {{exec?:typeof execFile, powershell?:string}} [deps]
 */
export async function inspectShortcut(file, deps = {}) {
  try {
    return JSON.parse(await runShortcutScript(['-Action', 'inspect', '-Path', file], deps));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * `<state dir>/installed.json` — every path this package created, when, and
 * **how it can be proved still to be ours**.
 *
 * Deliberately not `state.json`: nothing here is user-owned, and the file the
 * acknowledgements live in gets exactly one writer (`docs/DEVIATIONS.md` §93,
 * and `daemon.json`'s header for the same argument).
 *
 * @param {string} [dataDir]
 * @returns {{version:number, entries:Array<{surface:string, path:string,
 *            at:number, proof:string, digest?:string}>}}
 */
export function readRecord(dataDir = DATA_DIR) {
  const empty = { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, RECORD_NAME), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return empty;
    return {
      version: Number(parsed.version) || 1,
      entries: parsed.entries.filter(
        (e) => e && typeof e.path === 'string' && typeof e.surface === 'string',
      ),
    };
  } catch {
    return empty;
  }
}

/**
 * Replace the entries for one surface, leaving the other surface's alone.
 * Idempotent by construction: installing twice records each path once.
 *
 * @param {string} surface
 * @param {Array<string|{path:string, proof?:string, digest?:string}>} written
 * @param {{dataDir?:string, now?:number}} [opts]
 */
export function writeRecord(surface, written, opts = {}) {
  const dataDir = opts.dataDir || DATA_DIR;
  const at = opts.now ?? Date.now();
  const record = readRecord(dataDir);
  const kept = record.entries.filter((e) => e.surface !== surface);
  const seen = new Set();
  const added = [];
  for (const item of written) {
    const entry = typeof item === 'string' ? { path: item } : item;
    if (!entry || !entry.path || seen.has(entry.path)) continue;
    seen.add(entry.path);
    added.push({
      surface,
      path: entry.path,
      at,
      proof: entry.proof || 'tag',
      ...(entry.digest ? { digest: entry.digest } : {}),
    });
  }
  const next = { version: 1, entries: [...kept, ...added] };
  const file = path.join(dataDir, RECORD_NAME);
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return next;
}

/** Everything recorded for one surface. */
export function recordedEntries(surface, dataDir = DATA_DIR) {
  return readRecord(dataDir).entries.filter((e) => e.surface === surface);
}

/**
 * Just the files, in the order they were written. Directories this package had
 * to create are recorded too but are not files it wrote, so they are not what
 * `--remove` shows the user or counts.
 */
export function recordedPaths(surface, dataDir = DATA_DIR) {
  return recordedEntries(surface, dataDir)
    .filter((e) => e.proof !== 'dir')
    .map((e) => e.path);
}

/** SHA-256 of a file, or null. The proof for a file that cannot hold a tag. */
export function digestOf(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Is this file ours?
// ---------------------------------------------------------------------------

/**
 * Is the file at this path still one this package wrote?
 *
 * Four proofs, because there are four kinds of file, and none of them is "the
 * record says so" alone — a record is a claim about the past, and `--remove`
 * has to be sure about the present:
 *
 *   `statedir`  it is under our own state directory. Nothing else writes
 *               there, and a byte-level tag inside an `.ico` would be a chunk
 *               Explorer might not forgive.
 *   `lnk`       the tag is in the shortcut's Description, which only Windows
 *               can read, so this asks it.
 *   `tag`       the tag is a line in the file: `X-DeckHQ-Tag=`, a `DeckHQTag`
 *               plist key, or a `#` comment in the bundle's shell script.
 *   `sha256`    a copied binary — the icon in a `.app` bundle or under
 *               `~/.local/share/icons` — cannot hold a tag at all, so what is
 *               proved instead is that the bytes are still exactly the bytes
 *               we put there. A file somebody has replaced with their own
 *               icon fails this, and is therefore left alone.
 *
 * A file that does not exist answers `false`, not an error: `--remove` run
 * twice must be quiet the second time.
 *
 * @param {string} file
 * @param {{dataDir?:string, exec?:typeof execFile, powershell?:string,
 *          entry?:{proof?:string, digest?:string}|null}} [deps]
 * @returns {Promise<boolean>}
 */
export async function isOurs(file, deps = {}) {
  const dataDir = deps.dataDir || DATA_DIR;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  // Anything inside the state directory is ours by construction.
  const rel = path.relative(path.resolve(dataDir), path.resolve(file));
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;

  if (deps.entry && deps.entry.proof === 'sha256') {
    return Boolean(deps.entry.digest) && digestOf(file) === deps.entry.digest;
  }

  if (file.toLowerCase().endsWith('.lnk')) {
    const info = await inspectShortcut(file, deps);
    return Boolean(info && String(info.description || '').includes(TAG));
  }

  try {
    // The tag is always in the first few hundred bytes of the files we write;
    // reading the whole of a small text file is simpler than a windowed read
    // and these are never large.
    return fs.readFileSync(file, 'utf8').includes(TAG);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Build the `.ico` from the PNGs this package ships, and write it.
 *
 * Returns null rather than throwing when the assets cannot be read: an icon is
 * a nicety, and a machine that cannot produce one should still get a working
 * shortcut with a note saying why it looks like node.exe.
 *
 * @param {{icoPath:string, pngs?:string[]}} opts
 * @returns {{path:string, bytes:number, entries:number}|null}
 */
export function writeIco(opts) {
  try {
    const buffers = (opts.pngs || ICON_PNGS).map((p) => fs.readFileSync(p));
    const ico = pngToIco(buffers);
    const parsed = readIco(ico);
    if (!parsed) throw new Error('the ICO this produced does not parse');
    fs.mkdirSync(path.dirname(opts.icoPath), { recursive: true });
    fs.writeFileSync(opts.icoPath, ico);
    return { path: opts.icoPath, bytes: ico.length, entries: parsed.count };
  } catch {
    return null;
  }
}

/**
 * Write every file in a plan.
 *
 * A path that already exists and is **not** ours is refused: the whole plan
 * stops before anything is written, and the caller reports which file it was.
 * DeckHQ does not overwrite somebody else's `DeckHQ.lnk`, and it does not back
 * one up either — backing up a file we did not create is exactly the thing the
 * consent discipline forbids.
 *
 * @param {import('./launcher.mjs').Plan} plan
 * @param {{dataDir?:string, exec?:typeof execFile, powershell?:string,
 *          now?:number}} [deps]
 * @returns {Promise<{written:string[], skipped:string[], icon:any, dirs:string[]}>}
 */
export async function apply(plan, deps = {}) {
  const dataDir = deps.dataDir || DATA_DIR;
  const known = new Map(recordedEntries(plan.surface, dataDir).map((e) => [e.path, e]));

  for (const file of plan.files) {
    if (
      fs.existsSync(file.path) &&
      !(await isOurs(file.path, { ...deps, dataDir, entry: known.get(file.path) || null }))
    ) {
      throw new Error(
        `${file.path} already exists and was not written by DeckHQ, so nothing was changed. ` +
          'Move or delete it yourself if you meant to replace it.',
      );
    }
  }

  /** @type {Array<{path:string, proof:string, digest?:string}>} */
  const written = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const madeDirs = [];
  let icon = null;

  for (const file of plan.files) {
    for (const dir of missingAncestors(file.path)) {
      if (!madeDirs.includes(dir)) madeDirs.push(dir);
    }
  }

  for (const file of plan.files) {
    if (file.source === 'ico') {
      icon = writeIco({ icoPath: file.path });
      if (icon) written.push({ path: file.path, proof: 'statedir' });
      else skipped.push(file.path);
      continue;
    }
    if (file.kind === 'lnk') {
      await createShortcut(file, { ...deps, dataDir });
      written.push({ path: file.path, proof: 'lnk' });
      continue;
    }
    await fsp.mkdir(path.dirname(file.path), { recursive: true });
    if (file.kind === 'binary') {
      // A planned binary carries the path it is copied from. It can hold no
      // tag, so its proof is its bytes; see `isOurs`.
      await fsp.copyFile(String(file.contents), file.path);
      written.push({ path: file.path, proof: 'sha256', digest: digestOf(file.path) });
    } else {
      await fsp.writeFile(file.path, String(file.contents), 'utf8');
      written.push({ path: file.path, proof: 'tag' });
    }
    if (file.mode != null) {
      try {
        await fsp.chmod(file.path, file.mode);
      } catch {
        // A filesystem with no execute bit — a Windows checkout of a POSIX
        // plan under test — is not a reason to fail the install.
      }
    }
  }

  // Directories we had to create are recorded too, so removal can put the
  // tree back as it found it — and, more to the point, so it removes NOTHING
  // ELSE. Pruning "any empty parent" would delete a user's real Desktop folder
  // on the day they happened to have nothing else on it.
  writeRecord(plan.surface, [...written, ...madeDirs.map((d) => ({ path: d, proof: 'dir' }))], {
    dataDir,
    now: deps.now,
  });
  return { written: written.map((w) => w.path), skipped, icon, dirs: madeDirs };
}

/**
 * Every ancestor of this path that does not exist yet, shallowest first.
 * Read before anything is written, so it is the set `mkdir -p` will create.
 *
 * @param {string} file
 * @returns {string[]}
 */
function missingAncestors(file) {
  /** @type {string[]} */
  const missing = [];
  let dir = path.dirname(path.resolve(file));
  for (let depth = 0; depth < 16; depth++) {
    const parent = path.dirname(dir);
    if (fs.existsSync(dir) || parent === dir) break;
    missing.unshift(dir);
    dir = parent;
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Delete what we wrote, and only what we wrote.
 *
 * Two gates, both required: the path is in our record, and the file still says
 * it is ours. A directory left empty by the removal — a `.app` bundle's
 * `Contents/MacOS` — is pruned upward only while it is empty and only while it
 * is still inside the directory the plan created.
 *
 * @param {'shortcut'|'autostart'} surface
 * @param {{dataDir?:string, exec?:typeof execFile, powershell?:string}} [deps]
 * @returns {Promise<{removed:string[], missing:string[], foreign:string[]}>}
 */
export async function remove(surface, deps = {}) {
  const dataDir = deps.dataDir || DATA_DIR;
  const entries = recordedEntries(surface, dataDir);
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const foreign = [];
  const kept = [];

  for (const entry of entries.filter((e) => e.proof !== 'dir')) {
    const file = entry.path;
    if (!fs.existsSync(file)) {
      missing.push(file);
      continue;
    }
    if (!(await isOurs(file, { ...deps, dataDir, entry }))) {
      foreign.push(file);
      kept.push(entry);
      continue;
    }
    try {
      fs.unlinkSync(file);
      removed.push(file);
    } catch {
      foreign.push(file);
      kept.push(entry);
    }
  }

  // Then the directories this package created, deepest first, and only while
  // they are empty. A directory that is not empty is one somebody put
  // something in, and it stays — along with its record entry, so a later
  // removal can still finish the job.
  const dirs = entries
    .filter((e) => e.proof === 'dir')
    .sort((a, b) => b.path.length - a.path.length);
  for (const entry of dirs) {
    try {
      if (fs.readdirSync(entry.path).length > 0) {
        kept.push(entry);
        continue;
      }
      fs.rmdirSync(entry.path);
    } catch {
      // Already gone, or not ours to remove after all.
    }
  }

  writeRecord(surface, kept, { dataDir });
  // Reported in the order they were installed, not the order they were walked.
  const order = entries.map((e) => e.path);
  const byOrder = (a, b) => order.indexOf(a) - order.indexOf(b);
  return {
    removed: removed.sort(byOrder),
    missing: missing.sort(byOrder),
    foreign: foreign.sort(byOrder),
  };
}
