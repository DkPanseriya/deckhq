/**
 * The first-run pin offer — WP-75.
 *
 * `deckhq app` opens a window. On the run where that window is the first one
 * this machine has ever had, and only then, it asks one question:
 *
 *     Put DeckHQ on your Desktop and Start Menu? [y/N]
 *
 * WHY IT IS HERE AT ALL. The friction this package exists to delete is the
 * list of steps a person has to be told: install Node, install the package,
 * run `deckhq app`, then run `deckhq shortcut --install --yes`. The last of
 * those is the one nobody discovers on their own, and it is the one that turns
 * a command into an icon — after which there is no command at all. A product
 * whose job is to let you stop watching (`docs/plan/08-PLAN-V2-100X.md` §1.2)
 * cannot require a second command to become reachable.
 *
 * THE CONSENT DISCIPLINE IS NOT RELAXED, and this is the part to read before
 * changing anything here:
 *
 *   - The question is asked **after** the window is open, so the user has seen
 *     what they are being offered a shortcut to.
 *   - The full path list `deckhq shortcut --install` prints is printed first,
 *     unchanged, by the same function. Nothing is written before the user has
 *     seen every path.
 *   - `y` is the consent. It is exactly as strong as `--yes`, because it is
 *     the same answer to the same printed list; `src/cli/shortcut.mjs` takes
 *     it through `deps.confirm` rather than by passing `--yes` behind the
 *     user's back, so there is one place where a plan turns into files.
 *   - Anything else writes nothing and **never asks again**: the answer is
 *     recorded as `app.pinOffered` in `<state dir>/installed.json`.
 *   - Off a TTY there is no question. There is one line naming the command,
 *     because a prompt nobody can answer is a prompt that hangs a login
 *     script, and because an unanswered question must not be recorded as
 *     answered.
 *
 * Nothing here spawns anything off a TTY — in particular it does not build the
 * Windows plan, which asks PowerShell for the real Desktop folder. A machine
 * that is not being asked a question pays nothing for the offer existing.
 */
import process from 'node:process';

import { DATA_DIR } from '../core/paths.mjs';
import { readAppFlags, recordedPaths, writeAppFlags } from '../core/launcher-apply.mjs';

/** The one question, asked once. */
export const PIN_QUESTION = 'Put DeckHQ on your Desktop and Start Menu? [y/N] ';

/** What the answer is recorded as, under `app` in `installed.json`. */
export const PIN_FLAG = 'pinOffered';

/** The line a non-interactive run gets instead of the question. */
export const PIN_HINT =
  '  An icon for this: `deckhq shortcut --install --yes` — Desktop and Start Menu,\n' +
  '  removable with `deckhq shortcut --remove --yes`.\n';

/**
 * Should this run ask?
 *
 * Pure, so every branch is asserted rather than reasoned about.
 *
 *   `--no-pin`            never.
 *   `--pin`               always, even if the question was answered before —
 *                         it is the user asking for the question.
 *   a recorded shortcut   no: they already have one.
 *   `app.pinOffered`      no: they have already answered.
 *   otherwise             yes.
 *
 * @param {{argv?:string[], installed?:boolean, offered?:boolean}} opts
 * @returns {boolean}
 */
export function shouldOfferPin(opts = {}) {
  const argv = opts.argv || [];
  if (argv.includes('--no-pin')) return false;
  if (argv.includes('--pin')) return true;
  if (opts.installed) return false;
  if (opts.offered) return false;
  return true;
}

/**
 * The same question, read from a stream that may not be a TTY.
 *
 * `node:readline` rather than a raw `data` handler because a Windows console
 * delivers a line as `\r\n` and a POSIX one as `\n`, and because closing the
 * interface is what lets the process exit — this command is one step from
 * returning, and a half-open stdin would hold the loop open for ever.
 *
 * @param {string} question
 * @param {{input?:any, output?:any}} [deps]
 * @returns {Promise<string>}
 */
export async function askLine(question, deps = {}) {
  const input = deps.input || process.stdin;
  const output = deps.output || process.stdout;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input, output });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

/**
 * `y` or `yes`, in any case, and nothing else. Everything else — an empty
 * line, `n`, a stray word, a closed stdin — is a no.
 *
 * @param {unknown} answer
 * @returns {boolean}
 */
export function isYes(answer) {
  return /^(y|yes)$/i.test(String(answer ?? '').trim());
}

/**
 * Make the offer, once.
 *
 * @param {string[]} argv the `deckhq app` argv, for `--pin` / `--no-pin`
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, dataDir?:string,
 *          tty?:boolean, ask?:(q:string)=>Promise<string>,
 *          install?:(confirm:(plan:any)=>Promise<boolean>) => Promise<number>,
 *          flags?:Record<string, any>,
 *          record?:(patch:Record<string, any>) => void,
 *          installedPaths?:string[], now?:number}} [deps]
 * @returns {Promise<{asked:boolean, answered:boolean, installed:boolean,
 *                    hinted:boolean}>}
 */
export async function offerPin(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const dataDir = deps.dataDir || DATA_DIR;
  const quiet = { asked: false, answered: false, installed: false, hinted: false };

  let installedPaths = deps.installedPaths;
  let flags = deps.flags;
  try {
    if (!installedPaths) installedPaths = recordedPaths('shortcut', dataDir);
    if (!flags) flags = readAppFlags(dataDir);
  } catch {
    // An unreadable record costs the offer and nothing else. It must never
    // cost the window that has already opened.
    return quiet;
  }

  if (
    !shouldOfferPin({
      argv,
      installed: (installedPaths || []).length > 0,
      offered: Boolean(flags?.[PIN_FLAG]),
    })
  ) {
    return quiet;
  }

  const tty = deps.tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) {
    // No question, and nothing recorded: an offer nobody could answer has not
    // been made, so the next interactive run still owes it.
    write(PIN_HINT);
    return { ...quiet, hinted: true };
  }

  const ask = deps.ask || ((q) => askLine(q, {}));
  const record = deps.record || ((patch) => writeAppFlags(patch, { dataDir }));

  let answer = '';
  let installed = false;
  // The printed path list and the write are `deckhq shortcut --install`'s own,
  // called with the answer as its consent. One implementation of the
  // discipline, not two.
  const confirm = async () => {
    answer = await ask(`\n  ${PIN_QUESTION}`);
    return isYes(answer);
  };

  const install =
    deps.install ||
    (async (fn) => {
      const { runShortcut } = await import('./shortcut.mjs');
      return runShortcut(['--install'], { write, error: deps.error, dataDir, confirm: fn });
    });

  try {
    await install(confirm);
    installed = isYes(answer);
  } catch (err) {
    write(`\n  The shortcut could not be written: ${err?.message || err}\n\n`);
  }

  try {
    record({ [PIN_FLAG]: { at: deps.now ?? Date.now(), answer: isYes(answer) ? 'yes' : 'no' } });
  } catch {
    // A state directory that cannot be written is a machine that will be
    // asked again. That is the right failure: it never writes anything the
    // user did not just agree to.
  }

  if (!installed) {
    write('  This is not asked again. `deckhq shortcut --install` whenever you want it.\n\n');
  }

  return { asked: true, answered: true, installed, hinted: false };
}

export default offerPin;
