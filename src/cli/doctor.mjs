/**
 * `deckhq doctor` — the environment report, and the launch asset.
 *
 * The claim DeckHQ is built on is that it sees every agent session on the
 * machine, including the ones the runtime's own view cannot: Claude Code's
 * documentation says plainly that "interactive sessions you have open in other
 * terminals don't appear until you background them". That claim is worth
 * exactly as much as a user's ability to check it on their own machine in one
 * line. This command is that line.
 *
 * Everything here goes through the adapter registry (docs/02-ARCHITECTURE.md
 * §2). No transcript is read and no runtime CLI is spawned from this file —
 * `scanSessions()` and `liveSessions()` do both, behind the interface.
 *
 * No network egress (§9). The only sockets opened are to 127.0.0.1: a probe
 * for "is anything listening on the port the hooks target", and, when there is,
 * a read of the running daemon's own hook-health numbers.
 *
 * ============================================================================
 * WP-22 follow-up · this file is `runDoctor`, the command: parse the flags,
 * ask for a report, and print it — or share it, or photograph it. What it
 * calls is three modules:
 *
 *   doctor-collect.mjs  the probes and reads, and `collectReport`, the one
 *                       function that decides what "ok" means
 *   doctor-report.mjs   how the report reads on a terminal
 *   doctor-share.mjs    the redacted share text and the proof page
 * ============================================================================
 */

import process from 'node:process';

import { collectReport } from './doctor-collect.mjs';
import { renderReport } from './doctor-report.mjs';
import { captureProof, renderShare } from './doctor-share.mjs';

export * from './doctor-collect.mjs';
export * from './doctor-report.mjs';
export * from './doctor-share.mjs';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the command. Returns the process exit code rather than calling
 * `process.exit`, so it is directly testable.
 *
 * @param {string[]} [argv] argv after the `doctor` subcommand
 * @param {{write?:(s:string)=>void, collect?:typeof collectReport}} [deps]
 * @returns {Promise<number>}
 */
export async function runDoctor(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const collect = deps.collect || collectReport;

  if (argv.includes('--help') || argv.includes('-h')) {
    write(
      [
        'deckhq doctor — what DeckHQ can see on this machine.',
        '',
        'Usage: deckhq doctor [options]',
        '',
        '  --json             emit the same report as a JSON object',
        '  --share            print the report as a fenced block with no paths,',
        '                     project names or machine name in it, ready to paste',
        '  --capture-proof    also write a PNG of the comparison to',
        '                     ~/.deckhq/snapshots/, ready to post',
        '  --port <n>         also look for a running DeckHQ on this port',
        '  --help             this message',
        '',
        'Starts nothing and opens nothing. Makes no outbound network calls.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  const portIndex = argv.indexOf('--port');
  const port = portIndex !== -1 ? Number(argv[portIndex + 1]) || null : null;

  const report = await collect({ port });
  const json = argv.includes('--json');
  const wantProof = argv.includes('--capture-proof');
  const wantShare = argv.includes('--share');

  // Text mode prints the report first and lets the capture add its own line
  // underneath. JSON mode stays exactly one JSON document on stdout, whatever
  // the flags — anything else is unparseable by the scripts this flag exists
  // for, so the capture's progress line is swallowed there.
  //
  // `--share` prints the block and nothing else: it is meant to be selected
  // whole, or piped straight into a clipboard command, and a second copy of
  // the same numbers above it makes both jobs harder. With `--json` it becomes
  // one more field of the single document rather than stdout carrying two
  // formats at once.
  const share = wantShare ? renderShare(report) : null;
  if (!json) write('\n' + (share ?? renderReport(report)));

  const proof = wantProof
    ? await captureProof(report, { write: json ? () => {} : write })
    : { ok: false, path: null, reason: 'not requested' };

  if (json) write(JSON.stringify({ ...report, proof, share }, null, 2) + '\n');
  else write('\n');

  return report.ok ? 0 : 1;
}

export default runDoctor;
