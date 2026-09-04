/**
 * WP-46's records line (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. One quiet line, and only when one
 * of the team's records has this session or its room as its subject. A GET of
 * a replay of a directory of text files, at most every five minutes, never
 * awaited by anything the user is waiting on — a record is a grace note.
 */

import { recordLineFor } from './records.js';
import { RECORDS_TTL_MS } from './panel-rules.js';
import { currentId, displayedAgent } from './panel-state.js';

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom} ctx
 */
export function createRecordsPart(ctx) {
  const { recordEl } = ctx;
  /**
   * WP-46 · the last `GET /api/stats` body, for the records line.
   * @type {any}
   */
  let teamStats = null;
  let teamStatsAt = 0;
  let teamStatsInFlight = false;

  /**
   * WP-46 · fetch the team's records, at most every five minutes.
   *
   * A GET, of a replay of a directory of text files. It reads no ack state
   * and writes nothing at all — see the INVARIANT note at the top of this
   * file — and it is deliberately not awaited: a failed or slow stats call
   * costs the records line and nothing else. The records themselves move on
   * the scale of hours, so five minutes is already far more often than the
   * answer can change.
   */
  function loadTeamRecords() {
    const age = Date.now() - teamStatsAt;
    if (teamStatsInFlight || (teamStats && age < RECORDS_TTL_MS)) return;
    teamStatsInFlight = true;
    fetch('/api/stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        teamStatsInFlight = false;
        if (!body || typeof body !== 'object') return;
        teamStats = body;
        teamStatsAt = Date.now();
        if (currentId && displayedAgent) renderRecordLine();
      })
      .catch(() => {
        teamStatsInFlight = false;
      });
  }

  /**
   * The records line, or nothing. `textContent` only — the strings come from
   * `records.js`, and the project name inside one came off the daemon's own
   * registry, but neither is markup and neither is treated as markup.
   */
  function renderRecordLine() {
    const line = displayedAgent ? recordLineFor(displayedAgent, teamStats) : null;
    recordEl.textContent = line || '';
    recordEl.hidden = !line;
  }

  /**
   * The last `GET /api/stats` body, for a surface outside this panel — the
   * floor's hover card (WP-46, `docs/DEVIATIONS.md` §107).
   *
   * The cache is shared rather than copied: one fetch, one five-minute
   * window, one answer, so the card and the panel can never disagree about a
   * record while both are on screen. Calling this warms the cache and returns
   * whatever is in it — `null` on the first call, which `recordLineFor`
   * already reads as "no line", so a hover never waits on the network.
   * @returns {any}
   */
  function teamRecords() {
    loadTeamRecords();
    return teamStats;
  }

  return { loadTeamRecords, renderRecordLine, teamRecords };
}
