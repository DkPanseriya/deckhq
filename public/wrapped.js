/**
 * Wrapped — weekly and annual. WP-27.
 *
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.4, and `08` §7's table:
 * *Monday → weekly Wrapped card. 1 December → annual Wrapped, one click to
 * PNG.* Generated locally from the ledger and this machine's own transcripts.
 * No email, no server, no account, and — like everything else in this product
 * — no outbound request of any kind.
 *
 * ## Why this exists at all, given §5
 *
 * Spotify Wrapped and Raycast Wrapped are in `04` §1's evidence list as things
 * that *thrive*, beside the streaks and badges that were removed after
 * backlashes. The difference is what the artefact is about. A streak is a
 * score on the person, arrives daily, and can be broken. Wrapped is a record
 * of what a year contained, arrives once, and cannot be failed. So every line
 * below is a fact about the **team's work** — turns per room, the room that
 * never slept, the agent that was sent the most — in the third person, and
 * `test/unit/wrapped.test.mjs` scans every string this file can produce for a
 * second person addressed with an implication of fault, exactly as
 * `records.js` is scanned.
 *
 * ## Each line carries its own window
 *
 * §3.4's contents are all windowed, and a number labelled with the wrong
 * period is worse than no number. So the server hands back the window it
 * computed (`since`, `until`, `label`) and every line here is rendered under
 * that heading. A ledger younger than the window says where it actually
 * starts — *"since 1 Sep"* — rather than claiming a week it did not live
 * through.
 *
 * Pure: a `GET /api/wrapped` body in, strings out. No DOM, no fetch, no clock
 * of its own beyond what it is handed.
 */

import { compactTokens, formatMoney, formatWait } from './snapshot.js';
import { formatDay } from './records.js';
import { CARDS_OFF } from './postcard.js';

/** The two cards. */
export const KINDS = /** @type {const} */ (['week', 'annual']);

/** The month the annual card becomes available, 0-based: December. */
export const ANNUAL_MONTH = 11;
/** The day of that month it becomes available: `08` §7's "1 December". */
export const ANNUAL_DAY = 1;
/** Monday morning: the card waits for this hour before it arrives. */
export const MONDAY_HOUR = 6;

/**
 * Which Wrapped, if any, is due right now.
 *
 * Two triggers, both once-only and both persisted through `settings`:
 *
 *   - **the first open after 06:00 on a Monday**, about the week that just
 *     ended. Not 00:00: a card that appeared at one minute past midnight would
 *     be read by nobody and marked shown.
 *   - **on or after 1 December**, the annual one. It takes precedence, because
 *     a December Monday should not spend its one card on a week.
 *
 * `shownKey` is what has already been shown (`settings.wrappedShown`), and it
 * is compared against the key the server would give this window — so a card
 * cannot be earned twice by two tabs or by a reload.
 *
 * @param {{now:number, shownKey?:string, ready?:boolean}} o
 * @returns {{kind:'week'|'annual'|null, key:string|null}}
 */
export function wrappedDue(o) {
  const now = Number(o?.now) || 0;
  if (o?.ready === false) return { kind: null, key: null };
  // The opt-out, shared with the postcard. See `CARDS_OFF` in postcard.js.
  if (o?.shownKey === CARDS_OFF) return { kind: null, key: null };
  const d = new Date(now);

  if (d.getMonth() > ANNUAL_MONTH || (d.getMonth() === ANNUAL_MONTH && d.getDate() >= ANNUAL_DAY)) {
    const key = `${d.getFullYear()}-annual`;
    if (o.shownKey !== key) return { kind: 'annual', key };
    // The annual card has been seen. December's Mondays still get their week.
  }

  if (d.getDay() === 1 && d.getHours() >= MONDAY_HOUR) {
    const key = weekKeyOf(now);
    if (o.shownKey !== key) return { kind: 'week', key };
  }
  return { kind: null, key: null };
}

/**
 * `2026-W36` for the week that ENDED at the Monday on or before `ms`.
 *
 * A local mirror of `weekKey`/`wrappedWindow` in
 * `src/http/routes/wrapped.mjs`, for the same reason `records.js` mirrors the
 * day-key parser: a client file cannot import from `src/core/**` at runtime
 * (`docs/02-ARCHITECTURE.md` §9). The server's key is the one that is
 * authoritative — this one only decides whether to ask — and the card writes
 * back whichever key the server returned, so a disagreement costs at most one
 * request and never a double card.
 * @param {number} ms
 */
export function weekKeyOf(ms) {
  const d = new Date(ms);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
  const jan1 = new Date(start.getFullYear(), 0, 1);
  const days = Math.floor((start.getTime() - jan1.getTime()) / 86400000);
  const week = Math.floor((days + ((jan1.getDay() + 6) % 7)) / 7) + 1;
  return `${start.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The display name for a project key, or a short hash. Same rule as
 * `postcard.js`: a lookup, never a reverse.
 * @param {any} body a `GET /api/wrapped` body
 * @param {string} key
 */
export function roomName(body, key) {
  const name = body?.projects?.[key];
  if (typeof name === 'string' && name) return name;
  const k = String(key || '');
  return k ? k.slice(0, 6) : 'a room';
}

/** `09:00`. The hour of the day, as a person reads a clock. */
export function formatHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h) || h < 0 || h > 23) return '';
  return `${String(Math.floor(h)).padStart(2, '0')}:00`;
}

/** `1 Sep – 8 Sep`. Both ends, because a window with one end is not a window. */
export function formatRange(sinceMs, untilMs) {
  const day = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return formatDay(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  };
  const a = day(sinceMs);
  const b = day(untilMs);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * The card, as a heading and a list of labelled rows.
 *
 * A list rather than a paragraph: the postcard is one sentence about a day and
 * reads as prose; Wrapped is eight facts about a week and reads as a table.
 * Both are the same discipline about what they will not say.
 *
 * Every row is dropped when its number does not exist. A week with no sends
 * has no "sent the most" row rather than a row saying nobody was sent
 * anything, which is a sentence with a shape of blame in it.
 *
 * @param {any} body a `GET /api/wrapped` body
 * @returns {{title:string, subtitle:string, rows:{label:string, value:string}[], footer:string}}
 */
export function wrappedCopy(body) {
  const w = body?.window || {};
  const prev = body?.previous || {};
  const kind = body?.kind === 'annual' ? 'annual' : 'week';
  const title = kind === 'annual' ? 'The year so far' : 'Last week on the floor';

  // The window this card is about, and where the ledger actually starts if it
  // starts later. §3.4's degrade: "since <first record>".
  const start = w.covered === false && w.effectiveSince ? w.effectiveSince : body?.since;
  const subtitle =
    w.covered === false && w.firstDay
      ? `${formatRange(start, body?.until)} · since ${formatDay(w.firstDay)}, where this ledger starts`
      : formatRange(body?.since, body?.until);

  /** @type {{label:string, value:string}[]} */
  const rows = [];

  // 1. Turns per room. Three rooms at most: a card, not a report.
  const busy = (w.rooms || []).filter((r) => Number(r.turns) > 0).slice(0, 3);
  if (busy.length) {
    rows.push({
      label: 'Turns',
      value: `${w.turns} across ${w.roomCount} room${w.roomCount === 1 ? '' : 's'} — ${busy
        .map((r) => `${roomName(body, r.projectKey)} ${r.turns}`)
        .join(', ')}`,
    });
  } else if (Number(w.turns) > 0) {
    rows.push({ label: 'Turns', value: String(w.turns) });
  }

  // 2. Tokens.
  if (Number(w.tokens) > 0) rows.push({ label: 'Tokens', value: compactTokens(w.tokens) });

  // 3. Spend. Rule 7: an estimate, never a bill, naming its dated table.
  const spend = body?.spend || {};
  if (typeof spend.estimate === 'number' && spend.estimate > 0) {
    const version = spend.rateCardVersion ? `, rate card ${spend.rateCardVersion}` : '';
    const short =
      spend.unrated > 0 ? ` · ${spend.unrated} room${spend.unrated === 1 ? '' : 's'} unpriced` : '';
    rows.push({
      label: 'Spend',
      value: `≈ ${formatMoney(spend.estimate)} list price${version}${short}`,
    });
  }

  // 4. Longest wait, and whether it fell. The most satisfying number in the
  // product (`08` §7) — and a comparison, so both windows are the same length
  // by construction (see the route).
  const wait = w.longestWait;
  if (wait && Number(wait.ms) > 0) {
    const before = Number(prev?.longestWait?.ms) || 0;
    let trend = '';
    if (before > 0) {
      if (wait.ms < before) trend = ` — down from ${formatWait(before)}`;
      else if (wait.ms > before) trend = ` — up from ${formatWait(before)}`;
      else trend = ' — level';
    }
    rows.push({
      label: 'Longest wait',
      value: `${formatWait(wait.ms)}${wait.cleared ? ', cleared' : ', still standing'}${trend}`,
    });
  }

  // 5. The room that never slept.
  const room = w.neverSlept;
  if (room && Number(room.hours) > 0) {
    rows.push({
      label: 'Never slept',
      value: `${roomName(body, room.projectKey)} — ${room.hours} hour${room.hours === 1 ? '' : 's'} of the day`,
    });
  }

  // 6. The agent that was sent the most. By sends, which is the only half of
  // the conversation this product can honestly count — a turn typed in a
  // terminal never reached DeckHQ.
  const most = w.mostSent;
  if (most && Number(most.sends) > 0) {
    rows.push({
      label: 'Sent the most',
      value: `${most.sends} message${most.sends === 1 ? '' : 's'} to one session in ${roomName(body, most.projectKey)}`,
    });
  }

  // 7. The busiest hour.
  if (w.busiestHour && Number(w.busiestHour.turns) > 0) {
    rows.push({
      label: 'Busiest hour',
      value: `${formatHour(w.busiestHour.hour)} — ${w.busiestHour.turns} turn${w.busiestHour.turns === 1 ? '' : 's'}`,
    });
  }

  // 8. §3.4's derived stat. Third person about the agents, and honest about
  // being a floor when the read hit its ceiling.
  const cp = body?.catchphrase;
  if (cp && cp.supported && cp.phrase) {
    const n = Number(cp.count) || 0;
    const value =
      n === 0
        ? `not once ${kind === 'annual' ? 'this year' : 'this week'}`
        : `${cp.truncated ? 'at least ' : ''}${n} time${n === 1 ? '' : 's'}`;
    rows.push({ label: `"${cp.phrase}"`, value });
  }

  return {
    title,
    subtitle,
    rows,
    footer: 'Generated on this machine, from this machine. Nothing left it.',
  };
}
