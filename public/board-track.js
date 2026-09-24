/**
 * The board's tracking strip and milestone header — WP-71,
 * `docs/07-STUDIO-DESIGN.md` §7.
 *
 * What `GET /api/studio/tracking` says, drawn: on each card a strip of three
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
 * Everything is written with `textContent`. There is no `innerHTML` here.
 */

/** What a figure with nothing behind it reads. */
export const NO_DATA = 'no data';

/** @param {number} n */
function group(n) {
  return Number(n).toLocaleString('en-US');
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
 * @param {any} entry one card of `GET /api/studio/tracking`
 * @returns {Array<{kind:string, label:string, text:string}>}
 */
export function trackParts(entry) {
  /** @type {Array<{kind:string, label:string, text:string}>} */
  const parts = [];
  const tokens = entry?.tokens;
  parts.push({
    kind: 'tokens',
    label: 'Tokens',
    text: ok(tokens)
      ? `${group(tokens.total)} tok${tokens.scope === 'session' ? ' (session)' : ''}`
      : NO_DATA,
  });
  const time = entry?.time;
  parts.push({
    kind: 'time',
    label: 'Time on the card',
    text: ok(time) ? `${group(time.minutes)} min${time.open ? ' so far' : ''}` : NO_DATA,
  });
  if (entry?.cost) {
    const cost = entry.cost;
    const text = ok(cost)
      ? `$${cost.usd} ${cost.label} · rates ${cost.rateCard}`
      : cost.status === 'no rate'
        ? `no rate · rates ${cost.rateCard}`
        : NO_DATA;
    parts.push({ kind: 'cost', label: 'Cost estimate', text });
  }
  const tests = entry?.tests;
  parts.push({ kind: 'tests', label: 'Tests run', text: ok(tests) ? tests.quote : NO_DATA });
  return parts;
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
  const strip = make(doc, 'p', 'board-card-track');
  strip.setAttribute('aria-hidden', 'true');
  for (const part of trackParts(entry)) {
    const span = make(doc, 'span', `board-track board-track--${part.kind}`);
    if (part.text === NO_DATA) span.classList?.add?.('is-no-data');
    span.setAttribute('title', part.label);
    span.textContent = part.text;
    strip.appendChild(span);
  }
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
