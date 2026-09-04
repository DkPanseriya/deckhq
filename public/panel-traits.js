/**
 * WP-28's trait line, and the cache the hover card shares with it.
 *
 * One quiet line under the identity area:
 *
 *     asks often · shell-heavy · terse · opus-5 · since 1 Sep
 *
 * ## What this module will not say
 *
 * The same rule WP-46's records line keeps, for the same reason
 * (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6): the agents are the characters,
 * the human is the manager, and the manager is never scored. There is no
 * second person in any string this renders, nothing here is a level or a rank,
 * and nothing here can be earned, lost or broken. The strings themselves come
 * off `GET /api/traits`, computed from `src/core/traits.mjs`'s fixed
 * vocabulary, and are rendered with `textContent` and never as markup.
 *
 * ## Why the cache is here
 *
 * The floor's hover card wants a trait line the instant the cursor lands on
 * somebody, and a hover must never wait on the network. So this holds the last
 * response for five minutes and hands it to both surfaces, exactly as
 * `panel-records.js` does for the team's records (`docs/DEVIATIONS.md` §107):
 * one fetch, one window, one answer, so the card and the panel cannot disagree
 * about an agent while both are on screen. Before the first response resolves
 * there is simply no line, which is the correct failure for a grace note.
 */

import { RECORDS_TTL_MS } from './panel-rules.js';
import { currentId, displayedAgent } from './panel-state.js';

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {onTendencies?: (map: Record<string, string|null>) => void}} ctx
 */
export function createTraitsPart(ctx) {
  const { traitEl } = ctx;
  /**
   * The last `GET /api/traits` body's `traits` map, keyed by agent id.
   * @type {Record<string, any>|null}
   */
  let byAgent = null;
  let fetchedAt = 0;
  let inFlight = false;

  /**
   * Fetch every agent's traits, at most every five minutes.
   *
   * A GET. It reads a directory of text files and a tally the scan already
   * took; it writes nothing at all and touches no ack state — see
   * `src/http/routes/traits.mjs`. Deliberately not awaited: a failed or slow
   * call costs the trait line and nothing else.
   */
  function loadTraits() {
    const age = Date.now() - fetchedAt;
    if (inFlight || (byAgent && age < RECORDS_TTL_MS)) return;
    inFlight = true;
    fetch('/api/traits')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        inFlight = false;
        if (!body || typeof body.traits !== 'object' || !body.traits) return;
        byAgent = body.traits;
        fetchedAt = Date.now();
        if (typeof ctx.onTendencies === 'function') ctx.onTendencies(tendencies());
        if (currentId && displayedAgent) renderTraitLine();
      })
      .catch(() => {
        inFlight = false;
      });
  }

  /**
   * The idle-animation tendency for every agent that has one, keyed by id.
   * @returns {Record<string, string|null>}
   */
  function tendencies() {
    /** @type {Record<string, string|null>} */
    const out = {};
    for (const [id, set] of Object.entries(byAgent || {})) {
      out[id] = set && typeof set.tendency === 'string' ? set.tendency : null;
    }
    return out;
  }

  /** The trait line for one agent, or null. */
  function traitLineFor(agent) {
    const set = agent && byAgent ? byAgent[agent.id] : null;
    const line = set && typeof set.line === 'string' ? set.line.trim() : '';
    return line || null;
  }

  /** The line, or nothing. `textContent` only. */
  function renderTraitLine() {
    const line = displayedAgent ? traitLineFor(displayedAgent) : null;
    traitEl.textContent = line || '';
    traitEl.hidden = !line;
  }

  /**
   * The cached lines, for a surface outside this panel — the floor's hover
   * card. Calling this warms the cache and returns whatever is in it, `null`
   * on the first call, which `traitLineFor` reads as "no line".
   * @returns {{lineFor: (agent: any) => string|null}}
   */
  function agentTraits() {
    loadTraits();
    return { lineFor: traitLineFor };
  }

  return { loadTraits, renderTraitLine, agentTraits };
}
