/**
 * One streamed turn in a session — the send path, in one place.
 *
 * Lifted out of `POST /api/send` unchanged (WP-71), because two more things
 * now have to continue a session and neither may be a second way of doing it:
 * the PM pass, which hands the planner the board (`docs/07-STUDIO-DESIGN.md`
 * §8), and the budget stop's one message asking a session to stop and write a
 * handover. §9 invariant 4 is that Studio reaches a session through nothing
 * of its own, so both go through here — the same adapter `send`, the same
 * `SendHub` begin/publish/end, the same ledger note — and the panel draws
 * their progress exactly as it draws a turn the user typed.
 *
 * This starts a process through the adapter and it never stops one. Nothing
 * here, and nothing that calls it, sends a signal to a session.
 */
import { splitAgentId } from '../core/model.mjs';

/** How long one turn may run. */
export const SEND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Start a turn and hand back its id and its settlement.
 *
 * Throws only for an agent id whose runtime has no adapter, which the caller
 * answers as a 404. `turn` never rejects: an adapter that failed resolves to
 * `{ok:false, error}` after the error and the `done` have been published.
 *
 * @param {{adapters:any, sends:any, store:any, registry:any, log:any}} ctx
 * @param {{id:string, cwd?:string}} agent the registry's own agent
 * @param {string} text
 * @returns {{sendId:string, turn:Promise<{ok:boolean, text?:string, error?:string}>}}
 */
export function startTurn(ctx, agent, text) {
  const id = String(agent.id);
  const { runtime, sessionId } = splitAgentId(id);
  const adapter = ctx.adapters.getAdapter(runtime);
  if (!adapter) throw new Error(`Unknown runtime "${runtime}"`);
  const { sends, registry, log } = ctx;
  const { sendId, signal } = sends.begin({ agentId: id });

  // The turn, running in the background. Nothing below writes a response.
  const turn = adapter
    .send(sessionId, text, {
      cwd: agent.cwd,
      timeoutMs: SEND_TIMEOUT_MS,
      // WP-23a. The `codex` binary the user pinned, if they did. Every
      // adapter takes an options object it is free to ignore, and only the
      // Codex one reads this — the alternative was an adapter reaching into
      // `state.json`, which inverts the layering (`02-ARCHITECTURE.md` §2).
      codexBin: ctx.store?.settings?.codexBin,
      signal,
      onEvent: (event) => sends.publish(sendId, event),
    })
    .then(
      (result) => {
        registry?.noteSent?.(id, { chars: text.length, ok: result.ok !== false });
        // An adapter that produced no `result` event of its own — an older
        // runtime, a crash, a timeout — still has to close the turn on the
        // wire, or the panel would sit typing forever.
        if (!result.ok) {
          sends.publish(sendId, { type: 'error', error: result.error || 'Send failed' });
        }
        sends.publish(sendId, { type: 'done', ok: result.ok !== false });
        return result;
      },
      (err) => {
        log?.warn?.('send failed', id, err.message);
        sends.publish(sendId, { type: 'error', error: err.message || 'Send failed' });
        sends.publish(sendId, { type: 'done', ok: false });
        return { ok: false, error: err.message };
      },
    )
    .finally(() => sends.end(sendId));

  // Awaited only so an unhandled rejection cannot escape; `turn` never
  // rejects, because `.then`'s second argument already absorbs it.
  turn.catch(() => {});
  return { sendId, turn };
}
