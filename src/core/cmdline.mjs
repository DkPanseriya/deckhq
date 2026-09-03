/**
 * One quoting rule for the two places DeckHQ has to hand `cmd.exe` a command
 * line instead of an argv array.
 *
 * Everywhere else in this project a child process is started with an explicit
 * argument array and no shell ever sees the values (`docs/DEVIATIONS.md` §28,
 * §91, §95). Windows has two spots where that is not possible:
 *
 *   1. `code` is `code.cmd`, and Node refuses to spawn a `.cmd` without a
 *      shell (CVE-2024-27980). `src/core/editor.mjs`, WP-47, §90.
 *   2. Opening a new console window means `start`, which is an internal
 *      `cmd.exe` command and not a program. `src/core/terminals.mjs`, WP-04,
 *      §98.
 *
 * Both therefore build a command line, and both must build it the same way,
 * because `cmd.exe` does not parse a command line the way `CreateProcess`
 * does. Node's win32 argument quoting adds quotes only around a value that
 * contains a space, a tab or a quote — which leaves `&`, `|`, `^`, `<` and `>`
 * bare, and `cmd.exe` reads those as syntax. `a&calc` is two commands.
 *
 * **The rule.** Every value is wrapped in double quotes by this module, and
 * the two characters that can escape a double-quoted `cmd` argument are
 * refused rather than escaped:
 *
 * - `"` ends the quoting, and nothing inside quotes can re-establish it;
 *   `cmd.exe` has no escape for a quote inside a quoted string.
 * - `%` expands a variable **inside** quotes, so `%PATH%` is not text.
 *
 * `&`, `|`, `^`, `<`, `>` and `()` were each checked on Windows 11 and are
 * literal inside the quotes, so a value containing them is passed rather than
 * refused. Control characters are refused too: one would end the command line.
 *
 * Refusing is the right answer for both callers. A file path cannot contain a
 * `"` on Windows at all, a Claude Code session id is a UUID, and a directory
 * with a `%` in its name is rare — so the refusal costs approximately nobody
 * anything, and it is a decision that cannot be got subtly wrong the way an
 * escaping scheme across three levels of re-parsing can.
 */

/**
 * `err.code` on every refusal this module raises. Callers use it to tell a
 * value they must not quote from an ordinary failure — `launchTerminal()`
 * re-throws it rather than moving on to the next emulator, because trying a
 * different terminal cannot make a `%` safe.
 */
export const CMD_UNSAFE_CODE = 'ERR_DECKHQ_CMD_UNSAFE';

/** The message used when a caller supplies none. */
const DEFAULT_MESSAGE =
  'That value contains a character DeckHQ will not put on a Windows command line ' +
  '(a double quote or a percent sign).';

/**
 * Does this value survive `cmd.exe`'s quoting rules? See the header.
 * @param {unknown} s
 * @returns {boolean} true when it must be refused
 */
export function cmdUnsafe(s) {
  for (const ch of String(s)) {
    if (ch === '"' || ch === '%' || ch.codePointAt(0) < 0x20) return true;
  }
  return false;
}

/**
 * The error a refusal throws. Carries `CMD_UNSAFE_CODE` so a caller can tell
 * it apart without matching on text.
 * @param {string} message
 * @returns {Error}
 */
export function cmdRefusal(message) {
  const err = new Error(message);
  // @ts-expect-error -- a code on an Error is the node convention
  err.code = CMD_UNSAFE_CODE;
  return err;
}

/**
 * Refuse the whole launch if any value cannot be quoted. Checked up front, as
 * one pass over every value, so the error can say what the user should do
 * rather than naming one argument out of context.
 * @param {unknown[]} values
 * @param {string} [message] what the user is told
 */
export function assertCmdSafe(values, message = DEFAULT_MESSAGE) {
  for (const value of values) {
    if (cmdUnsafe(value)) throw cmdRefusal(message);
  }
}

/**
 * One double-quoted `cmd.exe` argument. Refuses rather than escaping — there
 * is nothing to escape with.
 * @param {unknown} value
 * @param {string} [message]
 * @returns {string}
 */
export function cmdQuote(value, message = DEFAULT_MESSAGE) {
  const s = String(value);
  if (cmdUnsafe(s)) throw cmdRefusal(message);
  return `"${s}"`;
}

/**
 * Is this a bare command name — something `cmd.exe` can be handed unquoted?
 *
 * It matters in one place. `cmd /s /k <line>` strips the first and last
 * character of `<line>` **only when the first one is a quote**, so leaving the
 * program name unquoted is what keeps the quotes around every following
 * argument intact through the strip. That is only safe for a name with no
 * `cmd` syntax in it at all, which is what this asserts. DeckHQ's own callers
 * pass `claude` and `codex`; nothing user-supplied ever lands here.
 * @param {unknown} s
 * @returns {boolean}
 */
export function isCmdBareWord(s) {
  return /^[A-Za-z0-9._+-]+$/.test(String(s));
}
