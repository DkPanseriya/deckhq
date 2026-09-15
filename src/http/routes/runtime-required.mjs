/**
 * A route that needs a runtime asks for one — WP-92j,
 * `docs/plan/13-ARCHITECTURE-AUDIT.md` A-08.
 *
 * Five handlers wrote `String(body.runtime || 'claude-code')`. That reads as a
 * default and it is not one: it is the daemon deciding, silently, which of four
 * runtimes a request was about, on the evidence of a field that was missing. A
 * request to start a session in a directory, or to answer a permission prompt,
 * is about exactly one runtime, and if the caller did not say which then
 * neither does the daemon. It says so instead:
 *
 *     400  { "error": "...", "field": "runtime" }
 *
 * `field` is there so the refusal is one line to diagnose from the other side —
 * §140's rule that an error names what to change, not just that something is
 * wrong. It is the only 4xx in the product that carries one, and it is not a
 * new convention: it is `error` plus the name of the thing that was absent.
 *
 * WHERE THIS DOES NOT APPLY, and why each is a choice rather than an omission:
 *
 *   - `POST /api/hook` resolves its runtime the way it always has. The audit
 *     names that one as must-not-change.
 *   - `POST /api/permission` is posted by Claude Code itself, to a URL the
 *     Claude Code adapter writes into the user's own settings. The payload is
 *     the runtime's, not ours, and carries no `runtime` field — so the
 *     constant there is the adapter that owns the URL, named and explained at
 *     its site. That route can never answer 400 in any case: everything it
 *     cannot handle ends as `{}`, which is how the terminal prompt wins.
 *   - `studio.mjs`'s `PLANNER_RUNTIME` is a measured choice with a paragraph
 *     already saying so: one runtime has a planner brief that has been run.
 *
 * Pure: no I/O but the response it writes, and it writes one only to refuse.
 */
import { sendJson } from '../server.mjs';

/** The name of the field, in the refusal and in the message. */
export const RUNTIME_FIELD = 'runtime';

/** What a caller that named no runtime is told. */
export const RUNTIME_REQUIRED =
  'A runtime is required. Name it as `runtime`: the id of the runtime this request is about.';

/**
 * The runtime this request names, or `null` — with the 400 already written.
 *
 * The caller's whole use is two lines, so that the refusal cannot be half
 * implemented at one of the four sites:
 *
 *     const runtime = requireRuntime(res, body.runtime);
 *     if (!runtime) return;
 *
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} value whatever the request offered as a runtime
 * @param {{hint?:string}} [opts] one sentence naming the other way to say it,
 *   for a route that can also read the runtime off an agent id
 * @returns {string|null}
 */
export function requireRuntime(res, value, opts = {}) {
  const runtime = String(value ?? '').trim();
  if (runtime) return runtime;
  const error = opts.hint ? `${RUNTIME_REQUIRED} ${opts.hint}` : RUNTIME_REQUIRED;
  sendJson(res, 400, { error, field: RUNTIME_FIELD });
  return null;
}
