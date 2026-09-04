/**
 * `deckhq pack` — WP-45. The five things anybody ever does with an asset pack.
 *
 *     deckhq pack build <dir> --key <file>   sign a pack source directory
 *     deckhq pack verify <file>              is this ours, and what is in it
 *     deckhq pack install <file>             verify, then copy into ~/.deckhq/packs
 *     deckhq pack list                       what is installed
 *     deckhq pack remove <name>              delete one
 *
 * ## No network, in any of them
 *
 * `install` takes a path on this machine. There is no `pack install <url>`,
 * no store client, no update check and no telemetry, and there will not be
 * one: `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 2 makes the free core
 * egress-free "including after we charge", and a pack is a file you already
 * have. How the file gets onto the machine is the customer's business and a
 * browser's job.
 *
 * ## `build` is the only command that touches a private key
 *
 * It reads the key named by `--key`, signs, and writes the signed document.
 * It never copies the key, never prints it, and never writes it into the
 * output. The key lives in the owner's password manager and nowhere in this
 * repository — see `src/core/publisher-key.mjs`.
 *
 * ## Every command is refuse-whole
 *
 * A pack that is unsigned, signed by a key this build does not know, edited
 * after signing, too large, not JSON, or malformed in its envelope is refused
 * with one reason and NOTHING is installed. Only the CONTENTS are refused
 * item by item: a theme that fails the contrast gate is dropped with its
 * reason and the rest of the pack still installs, which is what stops one bad
 * colour from costing a customer the pack they paid for.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { PACKS_DIR } from '../core/paths.mjs';
import {
  MAX_PACK_BYTES,
  PACK_KIND,
  PACK_VERSION,
  installPack,
  loadPacks,
  packFileFor,
  parsePack,
  removePack,
  signPack,
  validatePack,
} from '../core/packs.mjs';

export const PACK_HELP = `
  deckhq pack — signed asset packs: more themes and avatar sets.

  Usage: deckhq pack build <dir> --key <file> [--out <file>]
         deckhq pack verify <file>
         deckhq pack install <file> [--packs-dir <dir>]
         deckhq pack list [--packs-dir <dir>]
         deckhq pack remove <name> [--packs-dir <dir>]

  A pack carries themes and avatar sets and nothing else. It gates nothing:
  capture, the six states, the queue and every action are free, with a pack
  installed or without one. There is no account, no licence check and no
  network call anywhere in this command — a pack is a file.

  Every theme in a pack goes through the same schema and the same contrast
  gates as a theme DeckHQ ships. One that fails is dropped with its reason and
  the rest of the pack still installs. A pack that is not signed by DeckHQ's
  publisher key is refused whole and nothing in it loads.

  Installed packs live in ${PACKS_DIR}
`;

/** @param {string[]} argv @param {string} name */
function option(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && i < argv.length - 1 ? argv[i + 1] : null;
}

/** The first bare word in argv, skipping flag values. @param {string[]} argv */
function firstArg(argv) {
  const takesValue = new Set(['--key', '--out', '--packs-dir']);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (takesValue.has(argv[i])) i++;
      continue;
    }
    return argv[i];
  }
  return null;
}

/** @param {unknown} err */
function errorText(err) {
  return (err && /** @type {any} */ (err).message) || String(err);
}

/**
 * The lines `verify`, `install` and `list` all print about one pack. One
 * function so the three commands cannot describe the same pack differently.
 * @param {any} pack
 * @param {string} indent
 */
export function describePack(pack, indent = '  ') {
  const lines = [
    `${indent}${pack.name} ${pack.version} — ${pack.publisher}`,
    `${indent}signed by ${pack.keyId || 'an unnamed key'}`,
    `${indent}${pack.themes.length} theme(s): ${pack.themes.map((t) => t.name).join(', ') || '—'}`,
    `${indent}${pack.avatars.length} avatar set(s): ${pack.avatars.map((a) => a.name).join(', ') || '—'}`,
  ];
  for (const line of pack.rejected || []) lines.push(`${indent}refused: ${line}`);
  return lines.join('\n') + '\n';
}

/**
 * `deckhq pack …`
 *
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void,
 *          readFile?:(p:string)=>Buffer, packsDir?:string}} [deps]
 * @returns {Promise<number>}
 */
export async function runPack(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));
  const readFile = deps.readFile || ((p) => fs.readFileSync(p));

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    write(PACK_HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const verb = argv[0];
  const rest = argv.slice(1);
  const packsDir = option(rest, '--packs-dir') || deps.packsDir || PACKS_DIR;

  if (verb === 'build') return build(rest, { write, error, readFile });
  if (verb === 'verify') return verify(rest, { write, error, readFile });
  if (verb === 'install') return install(rest, { write, error, readFile, packsDir });
  if (verb === 'list') return list({ write, error, packsDir });
  if (verb === 'remove') return remove(rest, { write, error, packsDir });

  error(`  unknown: "${verb}". Try build, verify, install, list or remove.\n`);
  return 2;
}

/**
 * Sign a pack source directory.
 *
 * The source is `<dir>/pack.json` WITHOUT a signature — that is what makes a
 * pack source reviewable in a repository, which is what `packs/
 * supporter-sample/` is for. It is validated before it is signed, because
 * signing a document that will be refused on load only moves the failure to
 * the customer.
 *
 * @param {string[]} argv
 * @param {{write:Function, error:Function, readFile:Function}} io
 */
async function build(argv, io) {
  const dir = firstArg(argv);
  if (!dir) {
    io.error('  a directory is required:  deckhq pack build packs/supporter-sample --key K\n');
    return 2;
  }
  const keyFile = option(argv, '--key');
  if (!keyFile) {
    io.error(
      '  --key is required. It names a file holding the PKCS#8 PEM of the DeckHQ publisher\n' +
        '  private key. That key is not in this repository and never will be.\n',
    );
    return 2;
  }

  const source = path.join(dir, 'pack.json');
  let text;
  try {
    text = io.readFile(source);
  } catch (err) {
    io.error(`  could not read ${source}: ${errorText(err)}\n`);
    return 2;
  }
  if (text.length > MAX_PACK_BYTES) {
    io.error(`  ${source} is ${text.length} bytes; a pack is at most ${MAX_PACK_BYTES}\n`);
    return 1;
  }

  let doc;
  try {
    doc = JSON.parse(text.toString('utf8'));
  } catch (err) {
    io.error(`  ${source} is not JSON: ${errorText(err)}\n`);
    return 1;
  }
  if (doc && typeof doc === 'object') {
    doc.kind = doc.kind ?? PACK_KIND;
    doc.schema = doc.schema ?? PACK_VERSION;
  }

  const validated = validatePack(doc);
  if ('error' in validated) {
    io.error(`  that source is not a pack this build can sign.\n  ${validated.error}\n`);
    return 1;
  }

  let key;
  try {
    key = io.readFile(keyFile).toString('utf8');
  } catch (err) {
    io.error(`  could not read the signing key at ${keyFile}: ${errorText(err)}\n`);
    return 2;
  }

  let signed;
  try {
    signed = signPack(doc, key);
  } catch (err) {
    io.error(`  could not sign: ${errorText(err)}\n`);
    return 1;
  }

  const out =
    option(argv, '--out') ||
    path.join('dist', 'packs', `${validated.pack.name}-${validated.pack.version}.deckhq-pack.json`);
  try {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  } catch (err) {
    io.error(`  could not write ${out}: ${errorText(err)}\n`);
    return 1;
  }

  io.write(`  signed ${out}\n`);
  io.write(describePack({ ...validated.pack, keyId: signed.signature.keyId }));
  for (const line of validated.pack.rejected) {
    io.error(`  this source carries something that will not load: ${line}\n`);
  }
  return 0;
}

/**
 * @param {string[]} argv
 * @param {{write:Function, error:Function, readFile:Function}} io
 */
async function verify(argv, io) {
  const file = firstArg(argv);
  if (!file) {
    io.error('  a file is required:  deckhq pack verify supporter-1.0.0.deckhq-pack.json\n');
    return 2;
  }
  let bytes;
  try {
    bytes = io.readFile(file);
  } catch (err) {
    io.error(`  could not read ${file}: ${errorText(err)}\n`);
    return 2;
  }
  const result = parsePack(bytes);
  if ('error' in result) {
    io.error(`  ${file} is not a pack DeckHQ will load.\n  ${result.error}\n`);
    return 1;
  }
  io.write(`  ${file}\n`);
  io.write(describePack(result.pack));
  return 0;
}

/**
 * @param {string[]} argv
 * @param {{write:Function, error:Function, readFile:Function, packsDir:string}} io
 */
async function install(argv, io) {
  const file = firstArg(argv);
  if (!file) {
    io.error('  a file is required:  deckhq pack install supporter-1.0.0.deckhq-pack.json\n');
    return 2;
  }
  let bytes;
  try {
    bytes = io.readFile(file);
  } catch (err) {
    io.error(`  could not read ${file}: ${errorText(err)}\n`);
    return 2;
  }
  const result = installPack(bytes, { dir: io.packsDir });
  if ('error' in result) {
    io.error(`  nothing was installed.\n  ${result.error}\n`);
    return 1;
  }
  io.write(
    result.replaced
      ? `  replaced ${result.pack.name} ${result.replaced} with ${result.pack.version}\n`
      : `  installed ${result.pack.name} ${result.pack.version}\n`,
  );
  io.write(describePack(result.pack));
  io.write(`  ${result.file}\n`);
  io.write('  A running DeckHQ picks this up within a second; no restart needed.\n');
  return 0;
}

/** @param {{write:Function, error:Function, packsDir:string}} io */
async function list(io) {
  const { packs, errors } = loadPacks({ dir: io.packsDir });
  if (!packs.length && !errors.length) {
    io.write(`  no packs installed in ${io.packsDir}\n`);
    return 0;
  }
  for (const pack of packs) io.write(describePack(pack));
  for (const bad of errors) io.error(`  ${bad.name}: ${bad.error}\n`);
  // A pack that will not load is a fact about the machine, not a failure of
  // this command: it listed what is there, which is what it was asked to do.
  return 0;
}

/**
 * @param {string[]} argv
 * @param {{write:Function, error:Function, packsDir:string}} io
 */
async function remove(argv, io) {
  const name = firstArg(argv);
  if (!name) {
    io.error('  a name is required:  deckhq pack remove supporter-sample\n');
    return 2;
  }
  const result = removePack(name, { dir: io.packsDir });
  if ('error' in result) {
    io.error(`  ${result.error}\n`);
    return 1;
  }
  io.write(`  removed ${name} (${result.dir})\n`);
  io.write(
    '  Any floor painted in one of its themes falls back to the default. Nothing else changes:\n' +
      '  no session, no acknowledgement and no queue entry lives in a pack.\n',
  );
  return 0;
}

/** Where an installed pack's document is, for anything that needs to say so. */
export { packFileFor };
