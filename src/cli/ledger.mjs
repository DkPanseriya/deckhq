/**
 * `deckhq ledger` — WP-48's export and verify.
 *
 *     deckhq ledger days                 which days the ledger holds
 *     deckhq ledger export [--day D]     write a day out, verbatim
 *     deckhq ledger export --signed      ... plus an Ed25519 signature beside it
 *     deckhq ledger verify <file>        check a file against its signature
 *
 * ## What the signature is for, and what it is not
 *
 * A BYOS team floor (WP-49) is assembled from ledgers each machine wrote into
 * *the customer's* storage — a bucket, a share, a directory. Nothing of ours
 * is in that path, which is the whole commercial argument (`03-BUSINESS-MODEL`
 * §5), and it means the merge has no server to ask "did this really come from
 * Ana's laptop". The signature is what answers that instead: the day file is
 * signed with a key generated once on this machine, and the sidecar carries
 * the public half so verification needs the two files and nothing else.
 *
 * That proves **integrity and one consistent signer**. It does not prove
 * identity — anybody can generate a key — so `verify` prints the key's
 * fingerprint, which is the thing a team pins per machine. Said here rather
 * than implied by the word "signed".
 *
 * ## No network, and no daemon
 *
 * This command reads and writes files under the state directory and the
 * working directory. It opens no socket at all — not even to loopback. It
 * never reads `state.json`'s ack map and never writes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { DATA_DIR, LEDGER_DIR } from '../core/paths.mjs';
import {
  dayKey,
  keyFingerprint,
  listDays,
  loadOrCreateKey,
  parseRecords,
  signBytes,
  verifyBytes,
} from '../core/ledger.mjs';

const HELP = [
  'deckhq ledger — the local event ledger, and how to hand a day of it to somebody else.',
  '',
  'Usage: deckhq ledger days',
  '       deckhq ledger export [--day YYYY-MM-DD] [--signed] [--out <dir>]',
  '       deckhq ledger verify <file.jsonl>',
  '',
  '  days       list the days the ledger holds, with their size',
  '  export     copy one day out. --day defaults to today, --out to the',
  '             current directory. --signed also writes <file>.sig, an',
  '             Ed25519 signature over the exact bytes.',
  '  verify     check a day file against the .sig beside it (or a path you give',
  '             with --sig) and print the signing key fingerprint.',
  '',
  'The signing key is generated once into your state directory and never leaves',
  'this machine. Only its public half goes into a signature. Nothing here opens',
  'a network connection.',
  '',
].join('\n');

/** @param {string[]} argv @param {string} name */
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

/** The first bare word after the subcommand. */
function firstArg(argv, skipValueFlags = ['--day', '--out', '--sig']) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (skipValueFlags.includes(argv[i])) i++;
      continue;
    }
    return argv[i];
  }
  return null;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * @param {string[]} [argv]
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, dir?:string,
 *          stateDir?:string, cwd?:string, now?:number}} [deps]
 * @returns {Promise<number>}
 */
export async function runLedger(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));
  const dir = deps.dir || LEDGER_DIR;
  const stateDir = deps.stateDir || DATA_DIR;
  const cwd = deps.cwd || process.cwd();
  const now = deps.now ?? Date.now();

  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;
  if (!sub || argv.includes('--help') || argv.includes('-h')) {
    write(HELP);
    return sub ? 0 : 2;
  }
  const rest = argv.slice(1);

  if (sub === 'days') return days(dir, write);
  if (sub === 'export') return exportDay(dir, stateDir, cwd, rest, now, write, error);
  if (sub === 'verify') return verify(cwd, rest, write, error);

  error(`  deckhq ledger: unknown command "${sub}". Try "deckhq ledger --help".\n`);
  return 2;
}

/** @param {string} dir @param {(s:string)=>void} write */
async function days(dir, write) {
  const found = await listDays(dir);
  if (found.length === 0) {
    write('\n  the ledger is empty — start DeckHQ and it fills as the floor moves\n\n');
    return 0;
  }
  const lines = ['', `  ${dir}`, ''];
  let total = 0;
  for (const day of found) {
    let size = 0;
    let records = 0;
    try {
      const raw = fs.readFileSync(path.join(dir, `${day}.jsonl`), 'utf8');
      size = Buffer.byteLength(raw);
      records = parseRecords(raw).length;
    } catch {
      /* a day that vanished between listing and reading is simply zero */
    }
    total += size;
    lines.push(`  ${day}   ${String(records).padStart(7)} records   ${human(size).padStart(9)}`);
  }
  lines.push('', `  ${found.length} day(s), ${human(total)}`, '');
  write(lines.join('\n'));
  return 0;
}

/**
 * @param {string} dir @param {string} stateDir @param {string} cwd
 * @param {string[]} argv @param {number} now
 * @param {(s:string)=>void} write @param {(s:string)=>void} error
 */
async function exportDay(dir, stateDir, cwd, argv, now, write, error) {
  const day = option(argv, '--day') || dayKey(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    error(`  "${day}" is not a day. Use YYYY-MM-DD.\n`);
    return 2;
  }
  const source = path.join(dir, `${day}.jsonl`);
  let bytes;
  try {
    bytes = fs.readFileSync(source);
  } catch {
    error(`  there is no ledger for ${day}. \`deckhq ledger days\` lists what there is.\n`);
    return 2;
  }

  const outDir = path.resolve(cwd, option(argv, '--out') || '.');
  const target = path.join(outDir, `${day}.jsonl`);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    // Byte-for-byte. The signature is over exactly these bytes, so anything
    // that reformatted them would make the signature a lie.
    fs.writeFileSync(target, bytes);
  } catch (err) {
    error(`  could not write ${target}: ${err.message}\n`);
    return 1;
  }

  const lines = [
    '',
    `  ${target}`,
    `  ${parseRecords(bytes.toString('utf8')).length} records, ${human(bytes.length)}`,
  ];

  if (argv.includes('--signed')) {
    let key;
    try {
      key = loadOrCreateKey(stateDir);
    } catch (err) {
      error(`  could not open the signing key: ${err.message}\n`);
      return 1;
    }
    let machineId = 'unknown';
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'));
      if (typeof parsed.machineId === 'string') machineId = parsed.machineId;
    } catch {
      /* a machine that has never run the daemon has no id yet */
    }
    const sig = signBytes(bytes, key, { day, machineId, now });
    try {
      fs.writeFileSync(`${target}.sig`, JSON.stringify(sig, null, 2) + '\n', 'utf8');
    } catch (err) {
      error(`  could not write ${target}.sig: ${err.message}\n`);
      return 1;
    }
    lines.push(
      `  ${target}.sig`,
      `  signed ed25519, key ${sig.fingerprint}${key.created ? ' (generated just now)' : ''}`,
    );
    if (key.created && process.platform === 'win32') {
      lines.push(
        '  the key file carries mode 0600, which Windows does not enforce; it is',
        '  protected by your profile directory and nothing more',
      );
    }
  }

  lines.push('');
  write(lines.join('\n'));
  return 0;
}

/**
 * @param {string} cwd @param {string[]} argv
 * @param {(s:string)=>void} write @param {(s:string)=>void} error
 */
async function verify(cwd, argv, write, error) {
  const file = firstArg(argv);
  if (!file) {
    error('  which file? `deckhq ledger verify <file.jsonl>`\n');
    return 2;
  }
  const target = path.resolve(cwd, file);
  const sigPath = path.resolve(cwd, option(argv, '--sig') || `${target}.sig`);

  let bytes;
  try {
    bytes = fs.readFileSync(target);
  } catch (err) {
    error(`  could not read ${target}: ${err.message}\n`);
    return 2;
  }
  let sig;
  try {
    sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  } catch {
    error(`  there is no signature at ${sigPath}\n`);
    return 2;
  }

  const result = verifyBytes(bytes, sig);
  if (!result.ok) {
    error(`\n  NOT VERIFIED — ${result.reason}\n\n`);
    return 1;
  }
  write(
    [
      '',
      `  verified   ${target}`,
      `  day        ${result.day}`,
      `  records    ${result.records}`,
      `  machine    ${result.machineId}`,
      `  key        ${result.fingerprint}`,
      '',
      '  This proves the file has not changed since it was signed, and that it was',
      '  signed by whoever holds that key. It does not prove who that is — pin the',
      '  fingerprint per machine if that matters.',
      '',
    ].join('\n'),
  );
  return 0;
}

/** Re-exported so a caller can print a fingerprint without importing core. */
export { keyFingerprint };
