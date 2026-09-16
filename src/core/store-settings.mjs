/**
 * The settings schema, and the twenty sanitisers that hold a hand-edited
 * `state.json` to it. Split out of `src/core/store.mjs` by WP-92l
 * (`docs/plan/13-ARCHITECTURE-AUDIT.md` A-12, `docs/DEVIATIONS.md` §183)
 * unchanged: every declaration below is the one that was there, moved whole,
 * with the only edit inside one being the `export` keyword on its first line.
 *
 * The seam is the one the audit drew. `store.mjs` is persistence — atomic
 * writes, corruption recovery, the debounce — and this module is what a
 * settings value is allowed to be. Nothing here does I/O, nothing here holds
 * state, and every function is total: a value it refuses becomes the default
 * rather than an error, because the file these read is one a person can edit.
 */

import { EDITOR_NAMES } from './editor.mjs';
import { clampRetentionDays, DEFAULT_RETENTION_DAYS } from './ledger.mjs';
import { DEFAULT_THEME_NAME, sanitizeThemeName } from './themes.mjs';
import { DEFAULT_LOOK, sanitizeLook } from './look.mjs';
import { sanitizeAvatarSetName } from './avatars.mjs';

/**
 * @typedef {'app'|'terminal'} ResumeTarget
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
export function isPlainObject(v) {
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
 * @returns {import('./store-settings.mjs').ResumeTarget}
 */
function sanitizeResumeIn(v) {
  return /** @type {readonly string[]} */ (RESUME_TARGETS).includes(/** @type {string} */ (v))
    ? /** @type {import('./store-settings.mjs').ResumeTarget} */ (v)
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
export function sanitizeSettings(raw) {
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
export function sanitizeRoomOrder(v) {
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
export function sanitizePins(v) {
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
export const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

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
export function sanitizeStudioConsent(v) {
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
export function sanitizeStudioPlanner(v) {
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
export function sanitizeMachineId(v) {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : null;
}
