/**
 * Lights out: WP-18's daily postcard and WP-27's Wrapped, on one surface.
 *
 * Split out of `app.js` by WP-22. `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md`
 * §3.3 is the whole design constraint and it is a constraint about restraint:
 * once per local day at most, one keystroke to dismiss, and it never comes
 * back on its own. Nothing here notifies, nothing here sounds, and nothing
 * here addresses the reader — `postcard.js` and `wrapped.js` own the words and
 * their own tests police the second person.
 */

import {
  MAX_PNG_BYTES,
  MIN_SCALE,
  compositeCard,
  nextScaleDown,
  pngBytes,
  snapshotModel,
  stripColors,
} from './snapshot.js';
import { lightsOut, postcardCopy, startOfDay } from './postcard.js';
import { wrappedCopy, wrappedDue } from './wrapped.js';
import { announce, el, latestSnapshot, openCard, scene, setOpenCard, toast } from './app-state.js';
import {
  capturing,
  copyPng,
  redactSnapshots,
  reportSnapshot,
  saveSnapshot,
  setCapturing,
  snapshotFonts,
} from './app-snapshot.js';
import { saveSetting } from './app-notify.js';

//
// WP-18 (the daily postcard) and WP-27 (Wrapped). One surface, two fillings;
// `public/postcard.js` and `public/wrapped.js` decide *what* it says and this
// file decides *when* and paints it.
//
// The whole design constraint is in `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md`
// §3.3: Stardew Valley's day-end save, "an ending, not a demand". So: once per
// local day at most, one keystroke or one click to dismiss, and it never comes
// back on its own. §6's interruption budget already counts this as an in-app
// event with no notification and no sound attached, and nothing here plays one.

/** True while a card is being fetched, so two snapshots cannot race one open. */
let cardLoading = false;
/** After a failed fetch, do not hammer the daemon on every snapshot. */
let cardRetryAfter = 0;

/**
 * Project names replaced by their MK tags, for the redacted card.
 *
 * The ledger holds project *hashes* and the route resolves them to names by
 * hashing the cwds the registry holds — so a card's `projects` map is
 * `{hash: name}`. Redaction here is therefore a second lookup, name to MK,
 * through the floor this tab already has. A key the floor cannot name stays
 * unresolved and the copy falls back to six characters of the hash, which
 * carries nothing (`docs/DEVIATIONS.md` §100 decision 5).
 *
 * @param {Record<string,string>|undefined} projects
 * @returns {Record<string,string>}
 */
function redactProjectNames(projects) {
  /** @type {Record<string,string>} */
  const out = {};
  const byName = new Map();
  for (const p of latestSnapshot?.projects || []) {
    if (p.name) byName.set(p.name, p.mk || `MK${p.projectMk ?? ''}` || 'MK');
  }
  for (const [key, name] of Object.entries(projects || {})) {
    out[key] = byName.get(name) || 'MK';
  }
  return out;
}

/**
 * Paint a card and dim the floor behind it.
 *
 * `announce` carries the whole card to a screen reader in one string, because
 * a region that appears silently is a card that half the audience never gets.
 *
 * @param {'postcard'|'wrapped'} kind
 * @param {{title:string, subtitle?:string, rows:{label?:string|null, value:string}[], footer?:string}} model
 * @param {string} name what a saved PNG is about, for the toast
 */
function showCard(kind, model, name) {
  setOpenCard({ kind, model, name });

  el.nightcardTitle.textContent = model.title;
  el.nightcardSub.textContent = model.subtitle || '';
  el.nightcardSub.hidden = !model.subtitle;

  el.nightcardRows.textContent = '';
  for (const row of model.rows || []) {
    const line = document.createElement('div');
    line.className = row.label ? 'nightcard-row has-label' : 'nightcard-row';
    if (row.label) {
      const label = document.createElement('span');
      label.className = 'nightcard-label';
      label.textContent = row.label;
      line.appendChild(label);
    }
    const value = document.createElement('span');
    value.textContent = row.value;
    line.appendChild(value);
    el.nightcardRows.appendChild(line);
  }

  el.nightcardFoot.textContent = model.footer || '';
  el.nightcardFoot.hidden = !model.footer;
  el.nightcardHint.textContent = 'Esc or click to dismiss · S saves it as a PNG';

  el.nightcard.hidden = false;
  el.nightOverlay.hidden = false;
  // Two frames' worth of delay so the fade has a start state, exactly as the
  // office-cleared line does. Reduced motion neutralises the transition in
  // the stylesheet and the dim simply arrives.
  setTimeout(() => el.nightOverlay.classList.add('is-shown'), 20);

  announce(
    [
      model.title,
      model.subtitle,
      ...(model.rows || []).map((r) => `${r.label ? `${r.label}: ` : ''}${r.value}`),
    ]
      .filter(Boolean)
      .join('. '),
  );
}

/** One keystroke, one click, and it is gone. Dismissing costs nothing (§3.3). */
export function dismissCard() {
  if (!openCard) return false;
  setOpenCard(null);
  el.nightcard.hidden = true;
  el.nightOverlay.classList.remove('is-shown');
  el.nightOverlay.hidden = true;
  return true;
}

/**
 * The daily postcard. `manual` is the palette's "Today's card", which shows it
 * again without changing whether the automatic one has been spent — asking for
 * something is not the same as being interrupted by it.
 * @param {{manual?:boolean, day?:string}} [opts]
 */
export async function openPostcard(opts = {}) {
  if (cardLoading) return;
  cardLoading = true;
  try {
    const now = Date.now();
    // The card is about the local day, so the window starts at local midnight
    // — the same boundary the ledger rolls on (`docs/DEVIATIONS.md` §100
    // decision 2), which is what makes the two agree.
    const res = await fetch(`/api/stats?since=${startOfDay(now)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();
    if (redactSnapshots) stats.projects = redactProjectNames(stats.projects);
    const copy = postcardCopy({ stats, snapshot: latestSnapshot, now });
    showCard(
      'postcard',
      {
        title: `${copy.weekday}.`,
        subtitle: '',
        rows: copy.lines.map((value) => ({ label: null, value })),
        footer: '',
      },
      'card',
    );
    if (!opts.manual) await saveSetting({ postcardDay: opts.day || copy.day });
  } catch (err) {
    console.debug('[deckhq] the day’s card could not be built', err);
    cardRetryAfter = Date.now() + 60_000;
    if (opts.manual) toast('Could not read the ledger for today’s card.', { isError: true });
  } finally {
    cardLoading = false;
  }
}

/**
 * Wrapped, weekly or annual.
 * @param {'week'|'annual'} kind
 * @param {{manual?:boolean, key?:string}} [opts]
 */
export async function openWrapped(kind, opts = {}) {
  if (cardLoading) return;
  cardLoading = true;
  try {
    const res = await fetch(`/api/wrapped?kind=${encodeURIComponent(kind)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (redactSnapshots) body.projects = redactProjectNames(body.projects);
    showCard('wrapped', wrappedCopy(body), 'wrapped');
    // The server's key wins: it is the one that computed the window.
    if (!opts.manual) await saveSetting({ wrappedShown: body.key || opts.key || '' });
  } catch (err) {
    console.debug('[deckhq] Wrapped could not be built', err);
    cardRetryAfter = Date.now() + 60_000;
    if (opts.manual) toast('Could not read the ledger for Wrapped.', { isError: true });
  } finally {
    cardLoading = false;
  }
}

/**
 * Is a card due? Called once per snapshot, which is every poll.
 *
 * Wrapped outranks the postcard on a Monday evening: one card a day is the
 * budget, and the week is the bigger thing to have missed.
 */
export function maybeShowNightCard() {
  if (openCard || cardLoading || !latestSnapshot) return;
  // The actors are not real sessions, so their day is not a day (WP-13).
  if (latestSnapshot.demo) return;
  const now = Date.now();
  if (now < cardRetryAfter) return;
  const settings = latestSnapshot.settings || {};

  const wrapped = wrappedDue({ now, shownKey: settings.wrappedShown });
  if (wrapped.kind) {
    openWrapped(wrapped.kind, { key: wrapped.key });
    return;
  }

  const out = lightsOut({
    now,
    lightsOutHour: settings.lightsOutHour,
    shownDay: settings.postcardDay,
    liveCount: (latestSnapshot.agents || []).filter((a) => a.live).length,
  });
  if (out.show) openPostcard({ day: out.day });
}

/**
 * `S` while a card is up: the card, plus a small photograph of the floor it is
 * about, as one PNG — on the clipboard and saved beside every other snapshot.
 *
 * It goes through the same compositor and the same route as `S` on the floor
 * (WP-14), so redaction, the size budget, the resolution floor and the
 * daemon-names-the-file rule are all the ones already tested in
 * `docs/DEVIATIONS.md` §109 rather than a second implementation of each.
 */
export async function saveCard() {
  if (!openCard || capturing) return;
  setCapturing(true);
  const wasRunning = Boolean(scene) && !document.hidden;
  try {
    if (scene && redactSnapshots) {
      try {
        scene.stop();
        scene.setState(snapshotModel(latestSnapshot, { redact: true }).source);
      } catch (err) {
        console.warn('[deckhq] could not redact the floor for the card', err);
        toast('Could not redact the floor, so nothing was captured.', { isError: true });
        return;
      }
    }
    const colors = stripColors(document);
    const dpr = window.devicePixelRatio || 1;
    let scale = Math.max(MIN_SCALE, Math.round(dpr));
    let bytes = null;
    for (;;) {
      const out = compositeCard({
        floor: el.canvas.hidden ? null : el.canvas,
        model: openCard.model,
        scale,
        dpr,
        colors,
        ...snapshotFonts(),
      });
      bytes = pngBytes(out);
      if (bytes.length <= MAX_PNG_BYTES) break;
      const next = nextScaleDown(scale);
      if (next === null || next === scale) break;
      scale = next;
    }
    const oversize = bytes.length > MAX_PNG_BYTES;
    const copied = await copyPng(bytes);
    const saved = await saveSnapshot(bytes);
    reportSnapshot({ copied, saved, oversize, bytes: bytes.length });
  } finally {
    if (scene && redactSnapshots) {
      try {
        scene.setState(latestSnapshot);
        if (wasRunning) scene.start();
      } catch (err) {
        console.warn('[deckhq] could not restore the floor after a card', err);
      }
    }
    setCapturing(false);
  }
}
