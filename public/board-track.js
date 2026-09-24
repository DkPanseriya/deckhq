/**
 * The board's tracking strip and milestone header — WP-71,
 * `docs/07-STUDIO-DESIGN.md` §7.
 *
 * What `GET /api/studio/tracking` says, drawn: on each card one line of three
 * figures — tokens, time on the card, and the tests the handover quoted — and
 * above the columns one line per milestone with its burn-down. Pure, on
 * `board-view.js`'s terms: an answer and a `document` in, elements out, so
 * `test/unit/board-track.test.mjs` asserts the DOM without a browser.
 *
 * THE RULE THIS FILE KEEPS. A figure the daemon marked `no data` is drawn as
 * the words `no data` and never as a zero — the daemon sent no number, so the
 * page has none to print. A test count is drawn as the handover's own
 * sentence ("the handover says 43 passed") and never as a number in DeckHQ's
 * voice. A cost appears only when the daemon sent one, which it does only
 * with `showCost` on, and it always carries `list price` and the rate card's
 * date; a figure the rate card could not price reads `no rate`.
 *
 * ONE LINE PER CARD (WP-96). The strip used to be three spans, and a card with
 * nothing measured printed `no data` three times — the loudest thing on the
 * board was the absence of a number. Now it is one line of the figures that
 * exist, `400k tok · 12 min · says 43 passed`, and a card with none of them
 * says `no data` once. A figure left off the line is not a zero on it: the
 * line's tooltip and the card's accessible name are `trackSentence()`, which
 * still names every figure and says `no data` for each one that has none.
 *
 * Everything is written with `textContent`. There is no `innerHTML` here.
 */

/** What a figure with nothing behind it reads. */
export const NO_DATA = 'no data';

/** @param {number} n */
function group(n) {
  return Number(n).toLocaleString('en-US');
}

/**
 * A count as a card's line has room for it: `400k`, `1.3M`, `850`. The exact
 * figure is in the sentence beside it; this is the one a glance reads.
 * @param {number} n
 */
export function compactCount(n) {
  const v = Math.max(0, Number(n) || 0);
  /** @param {number} x */
  const trim = (x) => (x < 10 ? String(Math.round(x * 10) / 10) : String(Math.round(x)));
  if (v < 1000) return group(Math.round(v));
  if (v < 999_500) return `${trim(v / 1000)}k`;
  return `${trim(v / 1_000_000)}M`;
}

/** @param {any} doc @param {string} tag @param {string} [cls] */
function make(doc, tag, cls) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

/** @param {any} figure */
const ok = (figure) => figure && figure.status === 'ok';

/**
 * The strip's parts for one card, in the order they are drawn.
 *
 * `text` is the figure in full, for the sentence; `short` is what the card's
 * one line shows, and is `null` for a figure with nothing behind it.
 *
 * @param {any} entry one card of `GET /api/studio/tracking`
 * @returns {Array<{kind:string, label:string, text:string, short:string|null}>}
 */
export function trackParts(entry) {
  /** @type {Array<{kind:string, label:string, text:string, short:string|null}>} */
  const parts = [];
  const tokens = entry?.tokens;
  const session = tokens?.scope === 'session' ? ' (session)' : '';
  parts.push({
    kind: 'tokens',
    label: 'Tokens',
    text: ok(tokens) ? `${group(tokens.total)} tok${session}` : NO_DATA,
    short: ok(tokens) ? `${compactCount(tokens.total)} tok${session}` : null,
  });
  const time = entry?.time;
  const minutes = ok(time) ? `${group(time.minutes)} min${time.open ? ' so far' : ''}` : null;
  parts.push({ kind: 'time', label: 'Time on the card', text: minutes || NO_DATA, short: minutes });
  if (entry?.cost) {
    const cost = entry.cost;
    const text = ok(cost)
      ? `$${cost.usd} ${cost.label} · rates ${cost.rateCard}`
      : cost.status === 'no rate'
        ? `no rate · rates ${cost.rateCard}`
        : NO_DATA;
    parts.push({
      kind: 'cost',
      label: 'Cost estimate',
      text,
      short: text === NO_DATA ? null : text,
    });
  }
  const tests = entry?.tests;
  const quote = ok(tests) ? String(tests.quote) : null;
  parts.push({
    kind: 'tests',
    label: 'Tests run',
    text: quote || NO_DATA,
    // Still the handover's sentence, and still attributed: "says 43 passed"
    // on a card is the handover saying it, never DeckHQ.
    short: quote ? quote.replace(/^the handover says\b/, 'says') : null,
  });
  return parts;
}

/**
 * The card's one tracking line: the figures that exist, or `no data` once.
 * @param {any} entry
 */
export function trackLine(entry) {
  const shown = trackParts(entry)
    .map((p) => p.short)
    .filter(Boolean);
  return shown.length ? shown.join(' · ') : NO_DATA;
}

/**
 * The strip as one sentence, for the card's accessible name.
 * @param {any} entry
 */
export function trackSentence(entry) {
  return trackParts(entry)
    .map((p) => `${p.label}: ${p.text}.`)
    .join(' ');
}

/**
 * The strip for one card.
 * @param {any} entry
 * @param {any} doc
 */
export function buildTrackStrip(entry, doc) {
  const line = trackLine(entry);
  const strip = make(
    doc,
    'p',
    line === NO_DATA ? 'board-card-track is-no-data' : 'board-card-track',
  );
  // The card's own name already says all of this, so the line is not read
  // twice; the tooltip is the sentence, for a pointer on a line cut short.
  strip.setAttribute('aria-hidden', 'true');
  strip.setAttribute('title', trackSentence(entry));
  strip.textContent = line;
  return strip;
}

/**
 * One milestone's line: the burn-down, and what its cards measured.
 *
 * @param {any} m one of `GET /api/studio/tracking`'s `milestones`
 * @returns {string}
 */
export function milestoneText(m) {
  const burn = m?.burnDown;
  const parts = [String(m?.milestone || '')];
  parts.push(
    ok(burn)
      ? `${group(burn.ticked)} of ${group(burn.criteria)} criteria ticked`
      : `criteria ${NO_DATA}`,
  );
  parts.push(`${group(m?.left ?? 0)} of ${group(m?.cards ?? 0)} cards left`);
  parts.push(ok(m?.tokens) ? `${group(m.tokens.total)} tok` : `tokens ${NO_DATA}`);
  return parts.join(' · ');
}

/**
 * The milestone header above the columns, or null when no card names one.
 *
 * A `<progress>` for each burn-down, because a bar is what a burn-down is
 * and a native one reads its own value to a screen reader; the line of text
 * beside it says the same thing in words.
 *
 * @param {Array<any>|null|undefined} milestones
 * @param {any} doc
 */
export function renderMilestones(milestones, doc) {
  const list = Array.isArray(milestones) ? milestones : [];
  if (!list.length) return null;
  const wrap = make(doc, 'div', 'board-milestones');
  wrap.setAttribute('role', 'list');
  wrap.setAttribute('aria-label', 'Milestones');
  for (const m of list) {
    const row = make(doc, 'div', 'board-milestone');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-milestone', String(m?.milestone || ''));
    if (ok(m?.burnDown)) {
      const bar = make(doc, 'progress', 'board-burn');
      bar.setAttribute('max', String(m.burnDown.criteria));
      bar.setAttribute('value', String(m.burnDown.ticked));
      bar.setAttribute('aria-hidden', 'true');
      row.appendChild(bar);
    }
    const text = make(doc, 'span', 'board-milestone-text');
    text.textContent = milestoneText(m);
    row.appendChild(text);
    wrap.appendChild(row);
  }
  return wrap;
}
