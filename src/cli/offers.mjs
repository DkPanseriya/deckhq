/**
 * What the three CLI commands that offer each other have in common — WP-92i,
 * `docs/plan/13-ARCHITECTURE-AUDIT.md` A-07.
 *
 * `app`, `pin` and `shortcut` are one story told in three commands: `deckhq
 * app` opens the window and then offers a Desktop icon, the offer is `pin`,
 * and the icon `pin` writes is `deckhq shortcut --install` doing the writing
 * under the answer as its consent. So each imported the next, and `shortcut`
 * imported `app` back for the one path all three point a launcher at —
 * `app.mjs → pin.mjs → shortcut.mjs → app.mjs`, the first of the three cycles
 * §1.2 of the audit found.
 *
 * The cycle was benign: every edge is read inside a function body, and ES
 * modules resolve a cycle as long as nothing in it reads an imported binding
 * while the module is still evaluating. It was readability debt rather than a
 * defect, and this is the cheapest way to pay it — the three things all three
 * commands share move here, to a module that imports nothing from `src/cli/`
 * and so cannot be in a cycle with anything:
 *
 *   `BIN`         the path a shortcut, a Startup entry and a spawned daemon
 *                 all name. `shortcut.mjs` took it from `app.mjs`, which is
 *                 the one STATIC edge the cycle had.
 *   the question  the pin offer's wording, its flag and the line a run with
 *                 nobody at the keyboard gets instead.
 *   the consent   `askLine` and `isYes`: how a yes is asked for and what
 *                 counts as one. `docs/02-ARCHITECTURE.md` §6's discipline
 *                 rests on `isYes` being one function, not three.
 *
 * `app → pin → shortcut` remains, and is a chain rather than a cycle: a
 * command may offer the next one, and nothing offers back.
 *
 * Nothing here touches a disk, a clock or a network, and every string in it is
 * a string the user reads.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * `bin/deckhq.mjs`, resolved from this file rather than from the PATH.
 *
 * Resolved from the module's own URL because a shortcut written on a machine
 * with two installs must point at THIS one — the `deckhq` on the PATH may be a
 * global install, and the icon would then quietly launch the other copy.
 */
export const BIN = fileURLToPath(new URL('../../bin/deckhq.mjs', import.meta.url));

/** The one question, asked once. */
export const PIN_QUESTION = 'Put DeckHQ on your Desktop and Start Menu? [y/N] ';

/** What the answer is recorded as, under `app` in `installed.json`. */
export const PIN_FLAG = 'pinOffered';

/** The line a non-interactive run gets instead of the question. */
export const PIN_HINT =
  '  An icon for this: `deckhq shortcut --install --yes` — Desktop and Start Menu,\n' +
  '  removable with `deckhq shortcut --remove --yes`.\n';

/** What a "no" is told, so a declined offer is a closed question rather than a lost one. */
export const PIN_DECLINED =
  '  This is not asked again. `deckhq shortcut --install` whenever you want it.\n\n';

/**
 * The same question, read from a stream that may not be a TTY.
 *
 * `node:readline` rather than a raw `data` handler because a Windows console
 * delivers a line as `\r\n` and a POSIX one as `\n`, and because closing the
 * interface is what lets the process exit — the command that asks is one step
 * from returning, and a half-open stdin would hold the loop open for ever.
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
