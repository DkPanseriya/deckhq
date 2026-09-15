/**
 * DeckHQ persistence layer. `state.json`, atomic writes, corruption recovery.
 * See docs/02-ARCHITECTURE.md §7 and the orchestrator CONTRACTS.md.
 *
 * No I/O happens outside `load()`, `save()` and `flush()`. Every other method
 * mutates the in-memory copy and schedules a debounced save.
 */

import { promises as fsp } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createLog } from './log.mjs';
import { EDITOR_NAMES } from './editor.mjs';
import { clampRetentionDays, DEFAULT_RETENTION_DAYS } from './ledger.mjs';
import { DEFAULT_THEME_NAME, sanitizeThemeName } from './themes.mjs';
import { DEFAULT_LOOK, sanitizeLook } from './look.mjs';
import { sanitizeAvatarSetName } from './avatars.mjs';
import { now as clockNow } from './clock.mjs';
import { migrateState, STATE_VERSION } from './state-migrations.mjs';

/** @typedef {import('./model.mjs').AckState} AckState */

/**
 * @typedef {object} AckRecord
 * @property {AckState} state
 * @property {number|null} reviewSince
 * @property {number|null} needsInputSince
 * @property {number} updatedAt
 */

/**
 * @typedef {'app'|'terminal'} ResumeTarget
 */

/**
 * The two timer functions `save()` and `flush()` use, in the shape of the
 * globals. Anything that returns a handle `clearTimeout` accepts back will do.
 * @typedef {object} Timers
 * @property {(fn: () => void, ms: number) => any} setTimeout
 * @property {(handle: any) => void} clearTimeout
 */

/**
 * Where "resume this session" opens by default. `'app'` may not be
 * installed on every machine; `'terminal'` always works, which is why it is
 * the default rather than a guess at what the user has.
 */
export const RESUME_TARGETS = /** @type {const} */ (['app', 'terminal']);

/**
 * The `terminal` setting's "work it out" value, and its default. Which
 * emulators exist, and how each is launched, belongs to
 * `src/adapters/claude-code/terminals.mjs`; the store deliberately does not
 * know — see `sanitizeTerminal` below.
 */
export const TERMINAL_AUTO = 'auto';

/**
 * How the floor and the chrome treat motion. `'system'` defers to the
 * browser's own `prefers-reduced-motion`; the other two are an explicit
 * override in either direction, for a machine whose OS setting is wrong for
 * this one window. docs/plan/05-GUI-UX-SPEC.md §5.4, §9.
 */
export const MOTION_MODES = /** @type {const} */ (['system', 'reduce', 'no-preference']);

/**
 * Every persisted setting, and nothing else. A key in here that no code reads
 * is a defect, not a placeholder: the header shipped a "Show let go" toggle
 * for four months that wrote `showLetGo` and changed nothing, and `zoom` was
 * written by no one and read by no one. Both are gone (WP-07,
 * docs/DEVIATIONS.md §94), and `test/unit/settings-keys.test.mjs` now fails
 * on the next orphan.
 *
 * @typedef {object} Settings
 * @property {number} stallWindowMs      how long silence means "stalled", 2–120 min
 * @property {number} pollIntervalMs     how often the registry rescans
 * @property {boolean} notifications     the OS-notification master switch
 * @property {boolean} notifyHandsUp     notify when a session raises its hand
 * @property {boolean} notifyForReview   notify when a session finishes and waits
 * @property {boolean} osNotify          let the DAEMON raise OS notifications (WP-16)
 * @property {boolean} sound             the sound master switch
 * @property {number} soundVolume        0–1, deliberately low by default
 * @property {'system'|'reduce'|'no-preference'} reducedMotion
 * @property {ResumeTarget} resumeIn     where "resume this session" opens
 * @property {string} approveText        what the panel's `2 Approve` sends
 * @property {string} editor             which editor "open in editor" launches (WP-47)
 * @property {string} terminal           pinned emulator id, or `auto` to detect (WP-04)
 * @property {string} codexBin           the `codex` binary "send" and "resume" mean,
 *                                       or `''` to find it: PATH first, then the
 *                                       desktop app's bundled copy (WP-23a, §136.1)
 * @property {number} goneHomeDays       days of no activity after which a benched
 *                                       agent is not DRAWN on the floor (WP-50). A
 *                                       display filter only — see
 *                                       `public/render/plan.js`'s `isGoneHome`.
 *                                       0 disables it.
 * @property {number} ledgerRetentionDays how many days of event ledger to keep (WP-17)
 * @property {number} lightsOutHour      the hour the floor turns its lights off
 *                                       and the day's card appears (WP-18)
 * @property {string} postcardDay        the local day whose card has been shown,
 *                                       `YYYY-MM-DD`, or empty (WP-18)
 * @property {string} wrappedShown       which Wrapped has been shown — `2026-W36`
 *                                       or `2026-annual`, or empty (WP-27)
 * @property {import('../../public/render/look-options.js').Look} look
 *                                       what the building is made of (WP-88a).
 * @property {string} theme              which floor theme is painted (WP-30). A
 *                                       name from `core/themes.mjs`, never a
 *                                       path and never a colour: the document
 *                                       lives in the build, not in state.json.
 * @property {string} avatarSet          which avatar set the agents are dressed
 *                                       from (WP-45), or `''` for the tables
 *                                       this build ships. A name from an
 *                                       installed pack, never a colour table.
 * @property {boolean} onboarded         first run is over
 */

/**
 * The three WP-18/WP-27 keys above were in this object, in
 * `sanitizeSettings()` and in `settings-keys.test.mjs`, and missing from the
 * `Settings` typedef, so every `Settings` in the tree was three fields short
 * of the real one (WP-22). The annotation is what stops that recurring.
 * @type {Readonly<Settings>}
 */
export const DEFAULT_SETTINGS = Object.freeze({
  stallWindowMs: 600000,
  pollIntervalMs: 5000,
  notifications: true,
  notifyHandsUp: true,
  notifyForReview: true,
  // WP-16. The daemon's own OS notifications — the ones that arrive with
  // every browser window closed. OFF until the owner decides otherwise
  // (`docs/DEVIATIONS.md` §101): `notifications` above governs a permission the
  // browser asked for and the user granted, and this one governs a process
  // this machine's user never opted into. `deckhq --notify` turns it on for a
  // single run without writing anything here.
  osNotify: false,
  sound: false,
  soundVolume: 0.3,
  reducedMotion: 'system',
  resumeIn: 'terminal',
  approveText: 'Yes, go ahead.',
  // Blank means "decide for me": `$EDITOR` when it names an allowlisted
  // editor, else the first one found on PATH. A guess at install time would
  // be wrong on any machine that later installs a different editor.
  editor: '',
  terminal: TERMINAL_AUTO,
  // WP-23a. Which `codex` binary "send" and "resume" mean, for the machine
  // where the answer is not "the one on PATH" — the Codex desktop app bundles
  // a complete CLI at `%LOCALAPPDATA%\OpenAI\Codex\bin\<build-hash>\codex.exe`
  // and does not put it on PATH (`docs/DEVIATIONS.md` §136.1). Blank means
  // "find it": PATH first, then that bundled copy, newest build wins. This is
  // the escape hatch for an install neither of those describes, and it is
  // `editor`'s class of setting — a value that becomes a program — so it takes
  // `editor`'s three layers: shape here, an existence check at the route, and
  // one more check in `adapters/codex/binary.mjs` before anything is spawned.
  codexBin: '',
  goneHomeDays: 7,
  // WP-17. Ninety days is a quarter: long enough for "falling week over week"
  // to mean something and for an annual Wrapped to have most of its material,
  // short enough that the directory stays a few megabytes on a busy machine.
  ledgerRetentionDays: DEFAULT_RETENTION_DAYS,
  // WP-18. The hour the floor turns its lights off and the day's card
  // appears. 22:00 because the card is an ending, not a summons: it wants to
  // arrive after the last thing you were going to do today, and a card at
  // 18:00 is an interruption of the evening rather than a close to it. The
  // last live session ending after 18:00 brings it forward, which is the
  // "lights out" the name is about (`docs/plan/04` §3.3).
  lightsOutHour: 22,
  // The local day whose card has already been shown, `YYYY-MM-DD`. §3.3: "it
  // appears once, it does not nag". Kept here rather than in the browser so a
  // second tab, and a reload, cannot each earn their own card.
  postcardDay: '',
  // WP-27. Which Wrapped has already been shown — `2026-W36` for a week,
  // `2026-annual` for the year. Same reason as `postcardDay`.
  wrappedShown: '',
  // WP-30. Which floor theme is painted. `default` is the floor as it ships,
  // and every shipped theme is free — the Supporter pack
  // (`docs/plan/03-BUSINESS-MODEL.md` §5) sells MORE themes later and gates
  // nothing here. A name and not a document: a state.json that could carry
  // colours would be a state.json that could carry an unmeasured contrast
  // failure, and every theme this build offers has been measured
  // (`test/unit/state-visuals.test.mjs`).
  theme: DEFAULT_THEME_NAME,
  // WP-88a. WHAT THE BUILDING IS MADE OF: nine floor materials over four zones,
  // a colour scheme, a furniture set, two rugs, the planting, the prop density
  // and the lounge kit (`docs/plan/11-LOOK-CONTROL-CENTRE.md` §1).
  //
  // A DOCUMENT and not a name, which is the opposite of `theme` above, and the
  // difference is what the two can carry. A theme is colours, so a theme in
  // `state.json` would be an unmeasured contrast failure in `state.json`; a look
  // is option IDS from a table this build ships, so the worst a hand-edited one
  // can name is an option that does not exist — and `sanitizeLook` drops that,
  // measures what is left, and falls back to Studio oak if the combination is
  // one the guards refuse. `deckhq doctor` says so out loud (`lookWarning`).
  //
  // Studio oak is byte-identical to the floor that ships (§3, owner decision 2),
  // so an install that never opens the Look section is an install this key
  // changed nothing about.
  look: DEFAULT_LOOK,
  // WP-45. Which avatar set the agents are dressed from, or `''` — the tables
  // `public/render/palette.js` ships. A name and not a document, for the same
  // reason `theme` is: a set that arrived through `state.json` would be a set
  // nobody had held to the "no agent may wear a state colour" bar.
  //
  // Empty on every install, INCLUDING one with a pack installed. A face is
  // the one thing in this product that must never change on its own
  // (`appearanceRng`), so installing a pack offers a set and choosing one
  // applies it; nothing happens because a file appeared in a directory.
  avatarSet: '',
  // WP-83. WHETHER ANY CURRENCY FIGURE APPEARS ANYWHERE. Ships OFF.
  //
  // The owner, 14 September 2026: "mostly people will have subscriptions, so
  // they have a different billing system... it should help them track their
  // token usage". A list-price dollar figure is not a subscriber's bill and
  // not their budget; it is a number that looks like both. So the floor, the
  // deck, the panel, the room plate, the postcard, Wrapped and `deckhq stats`
  // show token usage by default, and turning this on restores every cost
  // surface exactly as it was — `08` §1.1 rule 7 is unchanged in both
  // directions, and `src/core/rates.mjs` is untouched by this package.
  showCost: false,
  onboarded: false,
});

/** The keys above whose value is a plain boolean, so a stray string cannot land. */
const BOOLEAN_SETTINGS = Object.freeze([
  'notifications',
  'notifyHandsUp',
  'notifyForReview',
  'osNotify',
  'sound',
  'showCost',
  'onboarded',
]);

/** An approval is one line the user would have typed; anything longer is a reply. */
const MAX_APPROVE_TEXT = 500;

/**
 * A gone-home window past a year is indistinguishable from "never", and a
 * negative one is meaningless. `0` is the honest way to say "draw everybody".
 */
const MAX_GONE_HOME_DAYS = 365;

/**
 * How long `save()` waits for further mutations before it writes. Exported so
 * the test suite can assert the window it schedules rather than sleep past it.
 */
export const SAVE_DEBOUNCE_MS = 250;
const MIN_STALL_WINDOW_MS = 2 * 60 * 1000;
const MAX_STALL_WINDOW_MS = 120 * 60 * 1000;
/**
 * The poll interval's floor is a courtesy to the machine — every scan reads
 * transcripts — and its ceiling is a courtesy to the user: past a minute the
 * floor stops being a live picture. Hooks make the interval close to
 * irrelevant; without them it is the whole latency budget.
 */
const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 60 * 1000;

/** @param {unknown} v */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** @param {unknown} ms */
function clampStallWindow(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.stallWindowMs;
  return Math.min(MAX_STALL_WINDOW_MS, Math.max(MIN_STALL_WINDOW_MS, n));
}

/** @param {unknown} ms */
function clampPollInterval(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.pollIntervalMs;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.round(n)));
}

/**
 * Volume as a 0–1 fraction. A non-number, a NaN or an out-of-range value is
 * clamped rather than rejected: the slider that writes this cannot produce one,
 * but a hand-edited state.json can, and a volume of 40 would be a fright.
 * @param {unknown} v
 */
function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.soundVolume;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/**
 * @param {unknown} v
 * @returns {'system'|'reduce'|'no-preference'}
 */
function sanitizeMotion(v) {
  return /** @type {readonly string[]} */ (MOTION_MODES).includes(/** @type {string} */ (v))
    ? /** @type {any} */ (v)
    : DEFAULT_SETTINGS.reducedMotion;
}

/**
 * An out-of-set value (a stray string, a stale value from an older build, a
 * hand-edited state.json) falls back to the default rather than being
 * stored as-is — same discipline as `clampStallWindow` above.
 * @param {unknown} v
 * @returns {import('./store.mjs').ResumeTarget}
 */
function sanitizeResumeIn(v) {
  return /** @type {readonly string[]} */ (RESUME_TARGETS).includes(/** @type {string} */ (v))
    ? /** @type {import('./store.mjs').ResumeTarget} */ (v)
    : DEFAULT_SETTINGS.resumeIn;
}

/**
 * Which terminal emulator "open in terminal" should use.
 *
 * Validated by SHAPE, not by membership. The list of emulators lives in the
 * adapter that launches them, and `core/` importing from `adapters/` would
 * invert the layering the whole architecture rests on
 * (`docs/02-ARCHITECTURE.md` §2). The three layers each check what they can
 * actually know:
 *
 *   - The HTTP route rejects an id no platform has, so a bad request is
 *     reported rather than quietly ignored (`src/http/routes/settings.mjs`).
 *   - This function rejects anything that is not a plausible id, so a
 *     hand-edited `state.json` cannot put a path, a flag or a shell fragment
 *     into a value the launcher will read.
 *   - Detection treats a pin it cannot resolve on this platform as absent and
 *     carries on, so a state file carried between a Mac and a Linux box still
 *     opens a terminal.
 *
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeTerminal(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[a-z][a-z0-9-]{0,31}$/.test(s) ? s : DEFAULT_SETTINGS.terminal;
}

/**
 * The affirmative `2 Approve` sends. A blank or non-string value falls back
 * to the default — an approve key that sent nothing would be a silent no-op —
 * and it is trimmed and capped so a stray paste cannot turn the key into a
 * prompt injector.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeApproveText(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, MAX_APPROVE_TEXT) : DEFAULT_SETTINGS.approveText;
}

/**
 * Which editor `open in editor` launches (WP-47). This is the one setting
 * whose value becomes a program, so it is validated here as well as at the
 * route and again in `core/editor.mjs`: only a name on the allowlist, or the
 * empty string for "decide for me", is ever stored. A hand-edited
 * `state.json` asking for `rm` reads back as `''`.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeEditor(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /** @type {readonly string[]} */ (EDITOR_NAMES).includes(s) ? s : DEFAULT_SETTINGS.editor;
}

/**
 * A path is at most this long before it stops being a path somebody typed and
 * starts being a paste. Windows' extended-length limit is 32 767; anything
 * near it in `state.json` is not a program.
 */
const MAX_CODEX_BIN = 1024;

/**
 * Which `codex` binary to run (WP-23a). Validated by SHAPE here, for the same
 * reason `sanitizeTerminal` is: `core/` cannot know what is on this disk, and
 * a hand-edited `state.json` is the one input nobody checked on the way in.
 * The layer that CAN check — the HTTP route — refuses a path that is not an
 * existing file, and `adapters/codex/binary.mjs` checks once more immediately
 * before the spawn, so a binary deleted between the two is a reported failure
 * rather than a silent fallback to a different program.
 *
 * A newline or a NUL would be a value smuggling a second line into somewhere
 * that logs it; both are dropped whole rather than stripped, because a path
 * containing one is not a path.
 * @param {unknown} v
 * @returns {string}
 */
function sanitizeCodexBin(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > MAX_CODEX_BIN) return DEFAULT_SETTINGS.codexBin;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 32) return DEFAULT_SETTINGS.codexBin;
  }
  return s;
}

/**
 * How many days of silence make a benched agent stop being drawn (WP-50).
 * Clamped the same way as the stall window: an out-of-range or non-numeric
 * value is a hand-edited state.json or a stale build, and falls back to the
 * default rather than reaching the renderer as a NaN that hides everybody.
 * @param {unknown} v
 * @returns {number}
 */
function clampGoneHomeDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.goneHomeDays;
  return Math.min(MAX_GONE_HOME_DAYS, Math.max(0, n));
}

/**
 * The hour of the local day the lights go out, 0–23. A fractional or
 * out-of-range value is clamped rather than rejected: the settings row that
 * writes it cannot produce one, a hand-edited `state.json` can, and an hour of
 * 30 would mean a card that never appears — a silent failure, which is the
 * worst kind for a feature whose whole promise is that it arrives.
 * @param {unknown} v
 */
function clampLightsOutHour(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.lightsOutHour;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/**
 * A "which card has been seen" marker: a short opaque key the client writes
 * and reads back. Anything that is not a plain short token is dropped to
 * empty, which costs at most one extra card and never a stored string of
 * somebody's choosing.
 * @param {unknown} v
 */
function sanitizeShownKey(v) {
  return typeof v === 'string' && /^[0-9A-Za-z-]{0,32}$/.test(v) ? v : '';
}

/**
 * Coerce a whole settings object into range, key by key. Every sanitizer is
 * idempotent, so this is safe to run on already-clean data — which is why
 * both `normalize()` (disk) and `setSettings()` (HTTP) run the same pass
 * instead of each remembering its own subset.
 * @param {Record<string, any>} raw
 * @returns {Settings}
 */
function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.stallWindowMs = clampStallWindow(s.stallWindowMs);
  s.pollIntervalMs = clampPollInterval(s.pollIntervalMs);
  s.soundVolume = clampVolume(s.soundVolume);
  s.reducedMotion = sanitizeMotion(s.reducedMotion);
  s.resumeIn = sanitizeResumeIn(s.resumeIn);
  s.approveText = sanitizeApproveText(s.approveText);
  s.editor = sanitizeEditor(s.editor);
  s.terminal = sanitizeTerminal(s.terminal);
  s.codexBin = sanitizeCodexBin(s.codexBin);
  s.goneHomeDays = clampGoneHomeDays(s.goneHomeDays);
  s.ledgerRetentionDays = clampRetentionDays(s.ledgerRetentionDays);
  s.lightsOutHour = clampLightsOutHour(s.lightsOutHour);
  s.theme = sanitizeThemeName(s.theme);
  s.look = sanitizeLook(s.look);
  s.avatarSet = sanitizeAvatarSetName(s.avatarSet);
  s.postcardDay = sanitizeShownKey(s.postcardDay);
  s.wrappedShown = sanitizeShownKey(s.wrappedShown);
  for (const key of BOOLEAN_SETTINGS) s[key] = Boolean(s[key]);
  // Anything not in DEFAULT_SETTINGS is dropped rather than carried: a key
  // from an older build (`showLetGo`, `zoom`) must not survive a round-trip
  // through the store and reappear in state.json for ever.
  for (const key of Object.keys(s)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) delete s[key];
  }
  return /** @type {Settings} */ (s);
}

/**
 * WP-30's room order, coerced into range. Anything that is not a project slug
 * is dropped, duplicates collapse to the first mention, and the list is capped
 * — the same discipline as every sanitizer above, for the same reason: this
 * value reaches the renderer, and a hand-edited `state.json` is the one input
 * nobody validated on the way in.
 *
 * `MAX_ROOM_ORDER` is `core/layout.mjs`'s `MAX_ROOMS`, restated rather than
 * imported: the store is the bottom of the dependency graph and importing the
 * layout document's schema into it to borrow one integer would invert that for
 * no gain. `test/unit/layout-io.test.mjs` asserts the two agree.
 * @param {unknown} v
 * @returns {string[]}
 */
function sanitizeRoomOrder(v) {
  if (!Array.isArray(v)) return [];
  /** @type {string[]} */
  const out = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_ROOM_ORDER) break;
  }
  return out;
}

/** See `sanitizeRoomOrder`. */
const MAX_ROOM_ORDER = 512;

/**
 * WP-77's pinned project rooms, coerced into range.
 *
 * `pins[projectId] = { at }` — the instant the user asked for that repo to keep
 * a room whether or not anything is running in it. The owner, 14 September:
 * _"Pin any particular project room so it is always in a room, so the room does
 * not collapse when agents are not running."_
 *
 * IT IS USER-OWNED STATE, and it takes `ackState`'s discipline (`08` §1.1 rule
 * 1): nothing observed writes here. A session ending, a repo going quiet, a
 * scan finding nothing — none of them may clear a pin, and
 * `test/unit/pins.test.mjs` holds that as an `INVARIANT:` test. The only writer
 * is `POST /api/pin`, which is a person clicking.
 *
 * Keyed by PROJECT ID rather than by the ledger's `projectKey`, for the reason
 * `archivedProjects` and `layout.rooms` are: the id is what the floor, the
 * palette and the popover all address a room by, and a second spelling of "this
 * project" is a second thing that can disagree. It is `projectIdFromCwd`'s
 * alphabet and nothing else — see `sanitizeRoomOrder`.
 *
 * `at` is kept rather than a bare `true` so a later package can order the pins
 * by when they were made without asking the user to pin everything again.
 *
 * @param {unknown} v
 * @returns {Record<string, {at:number}>}
 */
function sanitizePins(v) {
  if (!isPlainObject(v)) return {};
  /** @type {Record<string, {at:number}>} */
  const out = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!PROJECT_ID_RE.test(key)) continue;
    const at = Number(isPlainObject(raw) ? /** @type {any} */ (raw).at : 0);
    out[key] = { at: Number.isFinite(at) && at > 0 ? at : 0 };
    if (Object.keys(out).length >= MAX_ROOM_ORDER) break;
  }
  return out;
}

/**
 * A project id is a slug of a path — `projectIdFromCwd`'s alphabet, and nothing
 * else. Restated here rather than imported for the reason `MAX_ROOM_ORDER` is:
 * the store is the bottom of the dependency graph. `test/unit/layout-io.test.mjs`
 * asserts the two agree.
 */
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

/**
 * WP-66's per-project Studio grants, coerced into range.
 *
 * `studio.consent[projectKey] = { grantedAt, root }`, exactly as
 * `docs/07-STUDIO-DESIGN.md` §3 step 3 specifies. Consent is per project and
 * is never inferred from another, so this is a map and not a boolean, and a
 * key that is not a project key — a hand-edited `state.json`, a value from a
 * build that hashed differently — is dropped rather than carried: a grant this
 * build cannot match to a directory is a grant it must not act on.
 *
 * The `root` is kept beside the key because the key is a hash and cannot be
 * read back into a path. It is what `GET /api/studio` shows the user and what
 * `disable` names; it is never used to decide whether a write is allowed —
 * that is `src/studio/paths.mjs`'s job, from the directory the request names.
 *
 * @param {unknown} v
 * @returns {Record<string, {grantedAt:number, root:string}>}
 */
function sanitizeStudioConsent(v) {
  if (!isPlainObject(v)) return {};
  /** @type {Record<string, {grantedAt:number, root:string}>} */
  const out = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!/^[0-9a-f]{16}$/.test(key) || !isPlainObject(raw)) continue;
    const grantedAt = Number(/** @type {any} */ (raw).grantedAt);
    const root = typeof (/** @type {any} */ (raw).root) === 'string' ? raw.root : '';
    if (!root || root.length > MAX_CODEX_BIN) continue;
    out[key] = { grantedAt: Number.isFinite(grantedAt) ? grantedAt : 0, root };
  }
  return out;
}

/**
 * WP-67's per-project planner record: `studio.planner[projectKey] =
 * { agentId, startedAt }`.
 *
 * **This is not a session list** (`docs/07-STUDIO-DESIGN.md` §9 invariant 4).
 * It is one id per project, written once the ORDINARY scan has found the
 * planner session, and it exists so that `POST /api/studio/plan` on a project
 * that already has a planner CONTINUES it — the panel's normal streaming send
 * — instead of starting a second one. Everything anyone knows about that
 * session is read back out of the registry by its id, exactly as it is for any
 * other session; nothing about it is cached here.
 *
 * A record whose agent id is not a session id shape, or whose key is not a
 * project key, is dropped rather than carried, on `sanitizeStudioConsent`'s
 * terms and for its reason.
 *
 * @param {unknown} v
 * @returns {Record<string, {agentId:string, startedAt:number}>}
 */
function sanitizeStudioPlanner(v) {
  if (!isPlainObject(v)) return {};
  /** @type {Record<string, {agentId:string, startedAt:number}>} */
  const out = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!/^[0-9a-f]{16}$/.test(key) || !isPlainObject(raw)) continue;
    const agentId = typeof (/** @type {any} */ (raw).agentId) === 'string' ? raw.agentId : '';
    if (!agentId || agentId.length > 256) continue;
    const startedAt = Number(/** @type {any} */ (raw).startedAt);
    out[key] = { agentId, startedAt: Number.isFinite(startedAt) ? startedAt : 0 };
  }
  return out;
}

/**
 * A hand-edited or absent machine id reads back as absent, and the getter
 * mints a new one. WP-48: 32 hex characters of `randomBytes`, nothing derived
 * from the machine — not its name, not its MAC, not its user. A random id is
 * a join key for two of the user's OWN ledgers; anything derived would be a
 * fingerprint, which is a different thing entirely.
 * @param {unknown} v
 */
function sanitizeMachineId(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : null;
}

function defaultData() {
  return {
    // WP-86. A file this build writes is already current, so a machine that has
    // never run DeckHQ migrates nothing — see `core/state-migrations.mjs`
    // rule 4, and the goldens' fixture, which is rebuilt from nothing.
    version: STATE_VERSION,
    // What each versioned pass did, and when: `id → {at, version, ...}`. Empty
    // on a fresh install and on any machine no pass has had anything to do on.
    migrations: {},
    seededAt: null,
    // WP-48. Minted on first use, never sent anywhere. See `get machineId`.
    machineId: null,
    settings: { ...DEFAULT_SETTINGS },
    ack: {},
    // MK numbering and user-chosen names. Assigned once and kept forever, so
    // a tag the user has learned never moves. See core/identity.mjs.
    identity: { projects: {}, agents: {}, projectOf: {}, names: {}, nextProject: 1 },
    // Project ids the user has collapsed off the floor. Purely a view
    // preference — it never affects what is captured or what any agent is
    // doing, and an id in here that no longer exists is harmless.
    archivedProjects: {},
    // WP-77. Project ids the user has PINNED: they keep a room on the floor
    // with nothing running in them, at a third of a live room's footprint.
    // Empty on every install, and only a user action ever writes here — see
    // `sanitizePins`.
    pins: {},
    // WP-30. The order the floor deals rooms in, as project ids. Empty on
    // every install that has never imported a layout, and empty means "the
    // order the scan produced" — which is why an untouched floor is laid out
    // byte for byte as it always was. A view preference like the line above:
    // it moves rooms, it never touches a session.
    layout: { rooms: [] },
    // WP-66. Which projects have granted Studio permission to write inside
    // `<project>/.deckhq/studio/`, and when. Empty on every install: Studio is
    // opt-in per project and disabled is the default everywhere
    // (`docs/07-STUDIO-DESIGN.md` §1). See `sanitizeStudioConsent`.
    // WP-67 adds `planner`, which is empty for the same reason and stays
    // empty until a planner session has been found by the ordinary scan.
    studio: { consent: {}, planner: {} },
  };
}

/**
 * Fill in anything missing from a parsed-but-partial state object. Called
 * only on data that already parsed as a JSON object; genuinely corrupt or
 * mis-shaped top-level data is handled by the caller before this runs.
 * @param {any} parsed
 */
function normalize(parsed) {
  const settings = sanitizeSettings(isPlainObject(parsed.settings) ? parsed.settings : {});
  const ack = isPlainObject(parsed.ack) ? { ...parsed.ack } : {};
  const rawIdentity = isPlainObject(parsed.identity) ? parsed.identity : {};
  const identity = {
    projects: isPlainObject(rawIdentity.projects) ? { ...rawIdentity.projects } : {},
    agents: isPlainObject(rawIdentity.agents) ? { ...rawIdentity.agents } : {},
    projectOf: isPlainObject(rawIdentity.projectOf) ? { ...rawIdentity.projectOf } : {},
    names: isPlainObject(rawIdentity.names) ? { ...rawIdentity.names } : {},
    nextProject: typeof rawIdentity.nextProject === 'number' ? rawIdentity.nextProject : 1,
  };
  const archivedProjects = isPlainObject(parsed.archivedProjects)
    ? { ...parsed.archivedProjects }
    : {};
  const pins = sanitizePins(parsed.pins);
  const layout = {
    rooms: sanitizeRoomOrder(isPlainObject(parsed.layout) ? parsed.layout.rooms : []),
  };
  const studio = {
    consent: sanitizeStudioConsent(isPlainObject(parsed.studio) ? parsed.studio.consent : {}),
    planner: sanitizeStudioPlanner(isPlainObject(parsed.studio) ? parsed.studio.planner : {}),
  };
  return {
    // The version the FILE carries, not this build's: `migrateState` needs to
    // know how old what it just read is, and a normalize that stamped the
    // current version on everything would have made every file look current.
    version: Number.isInteger(parsed.version) && parsed.version > 0 ? parsed.version : 1,
    migrations: isPlainObject(parsed.migrations) ? { ...parsed.migrations } : {},
    seededAt: typeof parsed.seededAt === 'number' ? parsed.seededAt : null,
    machineId: sanitizeMachineId(parsed.machineId),
    settings,
    ack,
    identity,
    archivedProjects,
    pins,
    layout,
    studio,
  };
}

export class Store {
  /**
   * @param {string} file absolute path to state.json
   * @param {{log?: import('./log.mjs').Log, timers?: Timers}} [opts]
   */
  constructor(file, opts = {}) {
    this.file = file;
    this._log = opts.log || createLog('store');
    this._data = defaultData();
    /**
     * The clock the debounce is scheduled on. Production uses the real timer
     * wheel; the test suite hands in one it cranks by hand, so proving the
     * debounce never depends on how promptly a loaded CI runner services a
     * 250 ms setTimeout.
     * @type {Timers}
     */
    this._timers = opts.timers || { setTimeout, clearTimeout };
    this._saveTimer = null;
    /** @type {Promise<void>|null} chain of in-flight/queued disk writes, serialized */
    this._writing = null;
    /**
     * The last disk write that failed, or null. Read by the daemon and shown
     * in the interface: a store that cannot write is a store whose
     * acknowledgements vanish on restart, and the user has to be told rather
     * than left to discover it.
     * @type {{file:string, message:string, at:number}|null}
     */
    this.writeError = null;
  }

  /**
   * Load state.json. A corrupt or unparseable file never prevents startup:
   * it is backed up alongside itself and the store starts from defaults.
   *
   * An id already minted in this process survives the re-read. `load()` is
   * called more than once on a normal start — `startDaemon()` calls it, and
   * `Registry.start()` calls it again — and the machine id is minted between
   * those two, before the 250 ms debounce has put it on disk. Without this
   * the second read would parse a file with no id, hand back `null`, and the
   * daemon would mint a *different* id on every start: the one field in the
   * file whose entire value is being stable would be the one field that
   * never was. See `docs/DEVIATIONS.md` §100.
   *
   * @returns {Promise<void>}
   */
  async load() {
    const minted = this._data?.machineId || null;
    const restore = () => {
      if (minted && !this._data.machineId) {
        this._data.machineId = minted;
        this.save();
      }
    };
    let raw;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        this._data = defaultData();
        restore();
        return;
      }
      this._log.warn(`could not read ${this.file}; starting from defaults`, err);
      this._data = defaultData();
      restore();
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      await this._backupCorrupt(raw);
      this._log.warn(
        `corrupt state file at ${this.file}; backed up and starting from defaults`,
        err,
      );
      this._data = defaultData();
      restore();
      return;
    }

    if (!isPlainObject(parsed)) {
      await this._backupCorrupt(raw);
      this._log.warn(
        `state file at ${this.file} has an invalid shape; backed up and starting from defaults`,
      );
      this._data = defaultData();
      restore();
      return;
    }

    this._data = normalize(parsed);
    this._migrate();
    restore();
  }

  /**
   * Carry a file an older build wrote up to `STATE_VERSION` (WP-86).
   *
   * Runs on every `load()` that read an actual file, and on no fresh one: a
   * default state object is already current, so the loop inside `migrateState`
   * has nothing to do. A pass that changed something schedules the ordinary
   * debounced write — the migration is not worth a synchronous one, because
   * every pass is idempotent and the next start would simply run it again.
   *
   * What ran is logged at `info`, once, with what it did. A name changing
   * underneath somebody is exactly the kind of thing a log has to be able to
   * account for afterwards.
   */
  _migrate() {
    const result = migrateState(this._data, { now: clockNow() });
    if (!result.ran.length) return;
    for (const pass of result.ran) {
      const detail = Object.entries(pass.detail)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      this._log.info(
        `state migration ${pass.id} (v${pass.version})${detail ? ` — ${detail}` : ''}`,
      );
    }
    this.save();
  }

  /** @param {string} raw */
  async _backupCorrupt(raw) {
    const backupPath = `${this.file}.corrupt-${Date.now()}`;
    try {
      await fsp.writeFile(backupPath, raw, 'utf8');
    } catch (err) {
      this._log.warn(`failed to back up corrupt state file to ${backupPath}`, err);
    }
  }

  /**
   * The identity block, returned live rather than copied: `Identity` assigns
   * MK numbers into it and calls `touch()` to persist.
   */
  get identity() {
    return this._data.identity;
  }

  /** Mark the state dirty after a direct mutation of a live sub-object. */
  touch() {
    this.save();
  }

  /** @returns {Settings} */
  get settings() {
    return { ...this._data.settings };
  }

  /**
   * @param {Partial<Settings>} patch
   * @returns {Settings}
   */
  setSettings(patch) {
    this._data.settings = sanitizeSettings({ ...this._data.settings, ...(patch || {}) });
    this.save();
    return this.settings;
  }

  /**
   * This machine's random id, minted on first read and kept forever.
   *
   * WP-48. It exists so that two ledgers the same person's two machines
   * wrote can be merged into one team floor without either of them holding a
   * name, a path or an account. It is written to `state.json` and read by
   * `src/core/ledger.mjs`; **nothing in this repository sends it anywhere**,
   * and there is a test that asserts the string never appears in any
   * outbound-facing surface (`doctor --share`).
   *
   * @returns {string}
   */
  get machineId() {
    if (!this._data.machineId) {
      this._data.machineId = randomBytes(16).toString('hex');
      this.save();
    }
    return this._data.machineId;
  }

  /** @returns {number|null} */
  get seededAt() {
    return this._data.seededAt;
  }

  /** @param {number} ts */
  markSeeded(ts) {
    this._data.seededAt = ts;
    this.save();
  }

  /**
   * @param {string} id
   * @returns {AckRecord|undefined}
   */
  getAck(id) {
    const rec = this._data.ack[id];
    return rec ? { ...rec } : undefined;
  }

  /**
   * @param {string} id
   * @param {Partial<AckRecord>} patch
   * @returns {AckRecord}
   */
  setAck(id, patch) {
    const prev = this._data.ack[id] || {
      state: 'active',
      reviewSince: null,
      needsInputSince: null,
      updatedAt: 0,
    };
    const next = { ...prev, ...(patch || {}), updatedAt: clockNow() };
    this._data.ack[id] = next;
    this.save();
    return { ...next };
  }

  /**
   * Is this project collapsed off the floor?
   * @param {string} projectId
   */
  isProjectArchived(projectId) {
    return this._data.archivedProjects[projectId] === true;
  }

  /**
   * Collapse or restore a project room. Storing `false` would leave a growing
   * record of every project ever restored, so restoring deletes the key.
   * @param {string} projectId
   * @param {boolean} archived
   */
  setProjectArchived(projectId, archived) {
    const id = String(projectId || '');
    if (!id) return;
    if (archived) this._data.archivedProjects[id] = true;
    else delete this._data.archivedProjects[id];
    this.save();
  }

  /** @returns {string[]} */
  archivedProjects() {
    return Object.keys(this._data.archivedProjects);
  }

  /**
   * Is this project pinned — does it keep a room with nothing running in it
   * (WP-77)?
   * @param {string} projectId
   */
  isProjectPinned(projectId) {
    return Object.prototype.hasOwnProperty.call(this._data.pins, String(projectId || ''));
  }

  /**
   * Pin a project's room, or take the pin back.
   *
   * THE ONLY WRITER, and it is only ever reached from `POST /api/pin` — a
   * person clicking. No scan, no hook and no ended session calls this: a pin is
   * user-owned state on `ackState`'s terms (`08` §1.1 rule 1), and
   * `test/unit/pins.test.mjs` holds that as an `INVARIANT:` test.
   *
   * Unpinning DELETES the key rather than storing `false`, for the reason
   * `setProjectArchived` and `revokeStudioConsent` delete: a record of every
   * project ever unpinned is a growing list nobody asked for.
   *
   * @param {string} projectId
   * @param {boolean} pinned
   * @returns {boolean} whether the project is pinned now
   */
  setProjectPinned(projectId, pinned) {
    const id = String(projectId || '');
    if (!PROJECT_ID_RE.test(id)) return false;
    if (pinned) this._data.pins[id] = { at: clockNow() };
    else delete this._data.pins[id];
    this.save();
    return this.isProjectPinned(id);
  }

  /**
   * Every pinned project, as `projectId → { at }`. A copy, for the reason
   * `studioConsent` returns one: a caller that could mutate the map in place
   * would be a second writer.
   * @returns {Record<string, {at:number}>}
   */
  pinnedProjects() {
    /** @type {Record<string, {at:number}>} */
    const out = {};
    for (const [id, rec] of Object.entries(this._data.pins)) out[id] = { ...rec };
    return out;
  }

  /**
   * The order the floor deals rooms in, as project ids (WP-30).
   *
   * Empty is the normal answer and means "however the scan ordered them".
   * Ids that no longer exist are kept rather than pruned: a repo you have not
   * opened this week is not a repo you have deleted, and pruning would make an
   * imported layout decay every time you did not run something.
   * @returns {string[]}
   */
  roomOrder() {
    return [...this._data.layout.rooms];
  }

  /**
   * Set that order. Sanitised here as well as at the route, on the same terms
   * as every other value in this file: a hand-edited `state.json` cannot put a
   * path, a duplicate or ten thousand entries into a list the renderer reads.
   * @param {unknown} ids
   */
  setRoomOrder(ids) {
    this._data.layout.rooms = sanitizeRoomOrder(ids);
    this.save();
    return this.roomOrder();
  }

  /**
   * Every project that has enabled Studio, as `projectKey → { grantedAt, root }`
   * (WP-66). A copy: consent is written by exactly one path — `enable` — and a
   * caller that could mutate the map in place would be a second one.
   * @returns {Record<string, {grantedAt:number, root:string}>}
   */
  studioConsent() {
    /** @type {Record<string, {grantedAt:number, root:string}>} */
    const out = {};
    for (const [key, rec] of Object.entries(this._data.studio.consent)) out[key] = { ...rec };
    return out;
  }

  /**
   * The grant for one project, or null. Null is the answer on every install
   * that has not enabled Studio, which is all of them by default.
   * @param {string} projectKey
   * @returns {{grantedAt:number, root:string}|null}
   */
  studioConsentFor(projectKey) {
    const rec = this._data.studio.consent[String(projectKey || '')];
    return rec ? { ...rec } : null;
  }

  /**
   * Record a grant. Called from `src/studio/consent.mjs` and nowhere else: the
   * grant and the tagged file are written together or not at all.
   * @param {string} projectKey
   * @param {{grantedAt:number, root:string}} record
   */
  grantStudioConsent(projectKey, record) {
    const key = String(projectKey || '');
    if (!/^[0-9a-f]{16}$/.test(key)) return null;
    const next = {
      grantedAt: Number(record?.grantedAt) || clockNow(),
      root: String(record?.root || ''),
    };
    if (!next.root) return null;
    this._data.studio.consent[key] = next;
    this.save();
    return { ...next };
  }

  /**
   * Take one back. Deletes the key rather than storing `false`, for the reason
   * `setProjectArchived` deletes rather than stores: a record of every project
   * ever disabled is a growing list nobody asked for.
   * @param {string} projectKey
   */
  revokeStudioConsent(projectKey) {
    const key = String(projectKey || '');
    const hadPlanner = key in this._data.studio.planner;
    // Studio being off for a project means Studio remembers nothing about it.
    // The session itself is untouched — it is an ordinary session on the floor
    // and stays exactly where it is (§8: DeckHQ does not kill what it did not
    // start, and does not stop what it did).
    if (hadPlanner) delete this._data.studio.planner[key];
    if (!(key in this._data.studio.consent)) {
      if (hadPlanner) this.save();
      return false;
    }
    delete this._data.studio.consent[key];
    this.save();
    return true;
  }

  /**
   * Every project that has a planner recorded, as
   * `projectKey → { agentId, startedAt }`. A copy, on `studioConsent`'s terms.
   * @returns {Record<string, {agentId:string, startedAt:number}>}
   */
  studioPlanner() {
    /** @type {Record<string, {agentId:string, startedAt:number}>} */
    const out = {};
    for (const [key, rec] of Object.entries(this._data.studio.planner)) out[key] = { ...rec };
    return out;
  }

  /**
   * The planner session recorded for one project, or null (WP-67). Null is the
   * answer until a planner has been started AND found by the ordinary scan.
   * @param {string} projectKey
   * @returns {{agentId:string, startedAt:number}|null}
   */
  studioPlannerFor(projectKey) {
    const rec = this._data.studio.planner[String(projectKey || '')];
    return rec ? { ...rec } : null;
  }

  /**
   * Write one down. Called from `POST /api/studio/plan` when the scan hands it
   * a session in the project's directory, and from nowhere else: an id nobody
   * observed would be exactly the guess §4 forbids.
   * @param {string} projectKey
   * @param {{agentId:string, startedAt:number}} record
   */
  recordStudioPlanner(projectKey, record) {
    const key = String(projectKey || '');
    if (!/^[0-9a-f]{16}$/.test(key)) return null;
    const agentId = String(record?.agentId || '');
    if (!agentId) return null;
    const next = { agentId, startedAt: Number(record?.startedAt) || clockNow() };
    this._data.studio.planner[key] = next;
    this.save();
    return { ...next };
  }

  /**
   * Forget one. The session is left alone — this removes DeckHQ's note that it
   * was the planner, which is all the note ever was.
   * @param {string} projectKey
   */
  forgetStudioPlanner(projectKey) {
    const key = String(projectKey || '');
    if (!(key in this._data.studio.planner)) return false;
    delete this._data.studio.planner[key];
    this.save();
    return true;
  }

  /** @returns {Record<string, AckRecord>} */
  allAck() {
    /** @type {Record<string, AckRecord>} */
    const out = {};
    for (const [id, rec] of Object.entries(this._data.ack)) {
      out[id] = { ...rec };
    }
    return out;
  }

  /**
   * Schedule a debounced, atomic write. Safe to call as often as you like;
   * at most one disk write happens per 250ms, always with the freshest
   * in-memory data at the moment it actually runs.
   */
  save() {
    if (this._saveTimer) return;
    this._saveTimer = this._timers.setTimeout(() => {
      this._saveTimer = null;
      this._triggerWrite();
    }, SAVE_DEBOUNCE_MS);
    if (typeof this._saveTimer.unref === 'function') this._saveTimer.unref();
  }

  /** Chain the next write onto any in-flight one so writes never overlap. */
  _triggerWrite() {
    const prior = this._writing || Promise.resolve();
    const p = prior
      .then(() => this._writeNow())
      .then(() => {
        this.writeError = null;
      })
      .catch((err) => {
        // A failed write means every acknowledgement made since the last good
        // one is gone at the next restart — the user-owned half of the model,
        // silently discarded. A log line is not enough: this is surfaced in
        // the interface. See `writeError`.
        this.writeError = {
          file: this.file,
          message: (err && err.message) || String(err),
          at: Date.now(),
        };
        this._log.error(`failed to write ${this.file}`, err);
      })
      .finally(() => {
        if (this._writing === p) this._writing = null;
      });
    this._writing = p;
  }

  /** Atomic write: temp file, then rename. */
  async _writeNow() {
    const tmp = `${this.file}.tmp-${process.pid}`;
    const json = JSON.stringify(this._data, null, 2);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, this.file);
  }

  /**
   * Await any pending or in-flight save. The daemon calls this on shutdown
   * so a debounced write is never lost.
   * @returns {Promise<void>}
   */
  async flush() {
    if (this._saveTimer) {
      this._timers.clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this._triggerWrite();
    }
    while (this._writing) {
      await this._writing;
    }
  }
}
