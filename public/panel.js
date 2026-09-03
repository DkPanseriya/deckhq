/**
 * DeckHQ session side panel — the review card.
 *
 * docs/01-PRODUCT.md §2 (THE INVARIANT), docs/02-ARCHITECTURE.md §5.1,
 * docs/plan/05-GUI-UX-SPEC.md §4 (the layout, top to bottom), WP-08.
 *
 * ============================================================================
 * THE INVARIANT: opening this panel, reading the conversation, hovering,
 * scrolling and selecting must NEVER clear `reviewSince`/`needsInputSince`
 * or send any /api/ack request. Only an explicit button press (or the
 * equivalent explicit keyboard shortcut, routed through performAction
 * below) may do that. Every function in this file that touches rendering,
 * fetching, or scrolling carries a reminder comment where it would be
 * tempting to "helpfully" wire an ack call in.
 * ============================================================================
 *
 * `performAction()` is the ONLY place in this module — and the only place in
 * the whole client — that calls POST /api/ack. It is invoked exclusively from
 * explicit button click handlers built below (the `3` slot and the `⋯ more`
 * menu), from the `3` number key via pressNumberKey(), and from app.js's
 * explicit A/B keyboard shortcuts. It is never called from open(), refresh(),
 * render*(), load*(), or any scroll/hover/input listener.
 * test/unit/panel-invariant.test.mjs asserts this statically.
 *
 * WP-19's permission card has its own funnel, `answerPermission()`, and its
 * own endpoint, POST /api/permission/decide. It is deliberately NOT routed
 * through performAction(): allowing or denying one tool call says nothing
 * about whether the user is done with the session, and letting it move
 * `ackState` would be an observed event clearing a user-owned state. Nothing
 * in the permission path touches ack state, and there is an `INVARIANT:` test
 * for it in test/unit/panel-invariant.test.mjs.
 *
 * `2 Approve` is a SEND, not an ack: it posts the configurable affirmative
 * through /api/send exactly as typing it would. The review is discharged by
 * the daemon when the runtime records the user turn — the documented
 * UserPromptSubmit exception — never by this client guessing.
 *
 * All conversation text is rendered as text. The markdown renderer in
 * ./markdown.js builds DOM from a token tree with `textContent` and never
 * touches `innerHTML` — a hard security requirement (docs/02-ARCHITECTURE.md
 * §9; 07-AGENT-HANDOVERS.md rule 8).
 */

import { renderMarkdown } from './markdown.js';
import { renderDiff } from './diff-view.js';
import { drafts } from './drafts.js';
import { recordLineFor } from './records.js';

const STATE_LABELS = {
  working: 'Working',
  needs_input: 'Hands up',
  stalled: 'Stalled',
  for_review: 'For review',
  benched: 'Benched',
  let_go: 'Let go',
  ended: 'Ended',
};

const STATE_ICON_GLYPH = {
  working: '',
  needs_input: '✋',
  stalled: '⏳',
  for_review: '✓',
  benched: '',
  let_go: '',
};

/** Fallback copy of docs/03-VISUAL-SPEC.md §5; see app.js for the same note. */
const FALLBACK_STATE_COLORS = {
  working: '#2E7D63',
  needs_input: '#B87333',
  stalled: '#9A7B4F',
  for_review: '#C0392B',
  benched: '#7B8794',
  let_go: '#BDB7AA',
};

const DEFAULT_APPROVE_TEXT = 'Yes, go ahead.';

/**
 * What an action on the empty-machine floor says (WP-13). The actors are not
 * sessions and are not addressable, so the refusal is about them rather than
 * about the reader — no second-person fault, per
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5.
 */
const DEMO_REFUSAL =
  "Actors don't take instructions. Run `claude` in any repo and a real one walks in.";
/** The close-up's on-screen size, docs/plan/05-GUI-UX-SPEC.md §4.2. */
const CLOSEUP_PX = 44;
/** How often the "waiting …" line re-reads the clock while the panel is open. */
const WAITING_TICK_MS = 30_000;
/** How long a `GET /api/stats` body is reused for the records line (WP-46). */
const RECORDS_TTL_MS = 5 * 60_000;

/**
 * The state an agent should LOOK like, which is not always its
 * `activityState`. `bench` and `let_go` change only `ackState`, so a benched
 * agent keeps `for_review` — and rendering it crimson would spend the
 * reserved accent on something that is resting in the lounge, not standing
 * in the office. Mirrors `colorForAgent` in render/scene.js.
 * @param {any} agent
 */
function visualState(agent) {
  if (!agent) return 'ended';
  if (agent.ackState === 'let_go') return 'let_go';
  if (agent.ackState === 'benched') return 'benched';
  return agent.activityState;
}

/** @type {{STATE_COLORS?: Record<string,string>}|null} set once render/palette.js loads */
let paletteModule = null;

const ACTION_LABELS = {
  acknowledge: 'Acknowledge',
  review: 'Mark for review',
  bench: 'Bench',
  recall: 'Recall',
  let_go: 'Let go',
  rehire: 'Rehire',
};

/**
 * Which of the six ACK_ACTIONS are legal from an agent's current state.
 * docs/02-ARCHITECTURE.md §5.1.
 * @param {any} agent
 * @returns {string[]}
 */
function legalActions(agent) {
  if (!agent) return [];
  if (agent.ackState === 'let_go') return ['rehire'];
  if (agent.ackState === 'benched') return ['recall', 'let_go'];
  const acts = [];
  if (
    agent.activityState === 'needs_input' ||
    agent.activityState === 'stalled' ||
    agent.activityState === 'for_review'
  ) {
    acts.push('acknowledge');
  }
  if (agent.activityState !== 'for_review') acts.push('review');
  acts.push('bench', 'let_go');
  return acts;
}

/**
 * The third weighted slot: where this agent goes next. Bench sends an active
 * agent to the lounge; from the lounge the same key brings them back; a
 * let-go agent is rehired.
 * @param {any} agent
 */
function thirdAction(agent) {
  if (!agent) return 'bench';
  if (agent.ackState === 'let_go') return 'rehire';
  if (agent.ackState === 'benched') return 'recall';
  return 'bench';
}

/**
 * Which permission decision, if any, a keystroke means — and therefore which
 * of the two `S` keys the user just pressed.
 *
 * `A`, `D` and `S` answer WP-19's permission card. `S` is also WP-14's office
 * snapshot, and `Shift+S` is WP-14's redaction toggle, both bound in app.js.
 * Two features cannot own one key by accident, so the precedence is written
 * down here, in one pure function, rather than emerging from the order two
 * listeners happen to be registered in:
 *
 *   1. WP-19 wins `S` only when there is a card to answer — the panel open on
 *      an agent, a `pendingPermission` on it that the runtime did not mark
 *      `requiresUserInteraction`, the composer (or any text control) not
 *      focused, and no modal `<dialog>` over the top. `S` in particular also
 *      needs the runtime to have offered a session-scoped suggestion; with no
 *      suggestion there is no "allow for session" to give.
 *   2. Otherwise this returns null, the listener lets the event through, and
 *      app.js does what it always does: `S` takes the snapshot.
 *
 * `Shift` is never WP-19's. `Shift+S` is the redaction toggle wherever the
 * user is standing, card or no card, so a held shift ends the question here.
 *
 * Pure, so `test/unit/permission-keys.test.mjs` can walk every case without a
 * DOM. It reads nothing and decides nothing on its own — the caller acts.
 *
 * @param {{key:string, shiftKey?:boolean, ctrlKey?:boolean, metaKey?:boolean,
 *          altKey?:boolean}} e
 * @param {{panelOpen:boolean, typing:boolean, dialogOpen:boolean,
 *          pending:any}} ctx
 * @returns {'allow'|'deny'|'session'|null} null means "not ours; let it pass"
 */
export function permissionKeyDecision(e, ctx) {
  if (!e || !ctx) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  // Shift+S is WP-14's redaction toggle, always. Shift+A and Shift+D mean
  // nothing to the card either, so one rule covers all three.
  if (e.shiftKey) return null;
  if (!ctx.panelOpen || ctx.typing || ctx.dialogOpen) return null;
  const p = ctx.pending;
  if (!p || p.requiresUserInteraction) return null;
  switch (e.key) {
    case 'a':
    case 'A':
      return 'allow';
    case 'd':
    case 'D':
      return 'deny';
    case 's':
    case 'S':
      // No session-scoped suggestion means no third button, so `S` is not the
      // card's to take and falls through to the office snapshot.
      return Array.isArray(p.suggestions) && p.suggestions.length > 0 ? 'session' : null;
    default:
      return null;
  }
}

/**
 * A locally-computed guess at the agent's shape immediately after an
 * action, used purely for optimistic UI. The daemon's next snapshot
 * (pushed over SSE, typically within 250ms per docs/02-ARCHITECTURE.md §8)
 * is always the source of truth and overwrites this guess via refresh().
 * @param {any} agent
 * @param {string} action
 */
function optimisticPatch(agent, action) {
  const now = Date.now();
  switch (action) {
    case 'acknowledge':
      return { ...agent, activityState: 'working', reviewSince: null, needsInputSince: null };
    case 'review':
      return { ...agent, activityState: 'for_review', reviewSince: agent.reviewSince ?? now };
    case 'bench':
      return { ...agent, ackState: 'benched' };
    case 'recall':
      return { ...agent, ackState: 'active' };
    case 'let_go':
      return { ...agent, ackState: 'let_go' };
    case 'rehire':
      return { ...agent, ackState: 'active' };
    default:
      return agent;
  }
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {() => any} opts.getSnapshot
 * @param {(message:string, opts?:{isError?:boolean}) => void} opts.toast
 * @param {(text:string) => void} opts.announce
 * @param {() => void} [opts.onClosed]
 * @param {(projectId:string) => void} [opts.onNewAgent] open the "new agent
 *   in this project" flow (WP15 task C.2), for the currently displayed
 *   agent's project.
 * @param {(agent:any) => void} [opts.onRename] open the "rename /
 *   re-avatar" flow (WP15 task C.3) for the currently displayed agent.
 * @param {(id:string, hasDraft:boolean) => void} [opts.onDraftChange] the
 *   composer's unsent text for a session appeared or went away.
 */
export function createPanel(opts) {
  const { root, getSnapshot, toast, announce, onClosed, onNewAgent, onRename, onDraftChange } =
    opts;

  /** @type {string|null} */
  let currentId = null;
  /** WP-19: an answer is in flight, so the buttons are held. */
  let answering = false;
  /** The permission request id the card last announced, so it is said once. */
  let announcedPermissionId = null;
  /** @type {any} the agent object currently displayed, possibly optimistic */
  let displayedAgent = null;
  let sending = false;
  let conversationToken = 0; // guards against a slow fetch clobbering a newer one
  /** @type {{role:string,text:string,at:number}[]|null} null until loaded */
  let messages = null;
  let changesToken = 0;
  /** @type {number|null|undefined} the scan the rendered diff belongs to */
  let changesScannedAt = undefined;
  /**
   * Which file rows are open, by `U:`/`S:` plus path (WP-47). A new scan
   * rebuilds the whole table, and a diff the user opened must not close
   * itself every few seconds because the daemon looked at the disk again —
   * so expansion is state about the session, not about the rendered nodes.
   * @type {Set<string>}
   */
  const expandedFiles = new Set();
  /** @type {{key:string, path:string, staged:boolean, head:any, diffEl:any, loaded:boolean, line:number}[]} */
  let fileRows = [];
  // Whether the daemon has confirmed a claude:// handler exists, for the
  // agent currently open — set only from loadResumeTargets(), never guessed
  // client-side. Starts false so "resume in app" never flashes on before
  // that check has actually come back positive.
  let resumeAppAvailable = false;
  let resumeTargetsToken = 0; // guards against a slow fetch clobbering a newer one
  let closeUpRaf = null;
  let closeUpStartTs = 0;
  let waitingTimer = null;
  /** @type {any} */
  let rig = null;
  /** @type {any} */
  let clips = null;
  /** @type {any} */
  let palette = null;
  let renderModulesLoaded = false;
  /**
   * WP-46 · the last `GET /api/stats` body, for the records line. Read-only,
   * refreshed at most every RECORDS_TTL_MS, and never awaited by anything the
   * user is waiting on: a record is a grace note, and the panel opens at the
   * same speed whether or not this has ever resolved.
   * @type {any}
   */
  let teamStats = null;
  let teamStatsAt = 0;
  let teamStatsInFlight = false;
  /**
   * WP-09 · the turn currently streaming into the live region, if any.
   * `{sendId, id, text, fromComposer}` — `text` is what was sent, kept so a
   * failure can put it back in the composer where the user left it.
   * @type {{sendId:string, id:string, text:string, fromComposer:boolean}|null}
   */
  let streaming = null;
  /** The panel's own SSE connection (send progress + transcript tail). */
  let liveSource = null;
  /** Which agent id `liveSource` is watching, so it is not reopened per render. */
  let liveWatching = null;
  let liveBackoff = 1000;
  let liveRetryTimer = null;
  /** Coalesces transcript pings into at most one re-read (WP-09). */
  let tailTimer = null;

  // ---------------------------------------------------------------- build
  root.textContent = '';

  const top = document.createElement('div');
  top.className = 'panel-top';

  // Identity line: the close-up, shrunk to 44 px and inline (§4.2 "the
  // close-up moves"), then the literal MK tag plus the display name when the
  // user has set one — "the panel keeps the full title as its heading, with
  // the MK tag beside it" (WP15 task B). When there is no display name,
  // agent.label === agent.mk, so the chip reads as just the tag.
  const identityRow = document.createElement('div');
  identityRow.className = 'panel-identity';
  const closeupWrap = document.createElement('div');
  closeupWrap.className = 'panel-closeup';
  const closeupCanvas = document.createElement('canvas');
  closeupCanvas.width = CLOSEUP_PX * 2;
  closeupCanvas.height = CLOSEUP_PX * 2;
  closeupCanvas.setAttribute('aria-hidden', 'true');
  closeupWrap.appendChild(closeupCanvas);
  const mkChip = document.createElement('span');
  mkChip.className = 'mk-chip';
  // "Your draft": text sitting unsent in this session's composer is the
  // agent's queue being held by you (docs/plan/08 §3.5). Shown here on the
  // header; the deck rows (WP-10) read the same `hasDraft` off client state.
  const draftChip = document.createElement('span');
  draftChip.className = 'draft-chip';
  draftChip.textContent = 'draft';
  draftChip.title = 'You have an unsent reply in the composer';
  draftChip.hidden = true;
  const identitySpacer = document.createElement('span');
  identitySpacer.className = 'panel-identity-spacer';
  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'icon-btn';
  renameBtn.setAttribute('aria-label', 'Rename or re-avatar this agent');
  renameBtn.textContent = '✎';
  renameBtn.addEventListener('click', () => {
    if (displayedAgent) onRename?.(displayedAgent);
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => close());
  identityRow.append(closeupWrap, mkChip, draftChip, identitySpacer, renameBtn, closeBtn);

  const titleEl = document.createElement('h2');
  titleEl.className = 'panel-title';

  const metaEl = document.createElement('div');
  metaEl.className = 'panel-meta';

  // "waiting 1d 2h" — mono, live. The spec draws it in crimson; the
  // stylesheet's contrast rule forbids crimson small text, so the words stay
  // in ink and a crimson rule carries the colour (docs/DEVIATIONS.md, WP-08).
  const waitingEl = document.createElement('div');
  waitingEl.className = 'panel-waiting';
  waitingEl.hidden = true;

  // "doing: Bash npm test" — the live tool line (WP-52), one quiet line under
  // the header, present only while a tool is actually running. The text comes
  // from a hook payload, so it is set with `textContent` and never as markup.
  const doingEl = document.createElement('div');
  doingEl.className = 'panel-doing';
  doingEl.hidden = true;

  // WP-46 · one quiet line, and only when one of the team's records has this
  // session or its room as its subject: "longest wait ever was here: 2d 12h,
  // 1 Sep". A record of the team's work, in the third person, never a score
  // on the person reading it (docs/plan/08 §1.1 rule 6). Absent the whole
  // time no record involves this agent, which is most of the time.
  const recordEl = document.createElement('div');
  recordEl.className = 'panel-record';
  recordEl.hidden = true;

  top.append(identityRow, titleEl, metaEl, waitingEl, doingEl, recordEl);

  // The scrolling body: WHAT IT SAID, the rest of the thread folded beneath
  // it, then WHAT CHANGED.
  const body = document.createElement('div');
  body.className = 'panel-body';
  body.tabIndex = 0;
  body.setAttribute('aria-label', 'Review');

  // WP-19 · the permission card, above WHAT IT SAID because a question the
  // runtime is holding a socket open for outranks anything it already said.
  // Built once, hidden until `pendingPermission` appears on the snapshot.
  const permissionSection = document.createElement('section');
  permissionSection.className = 'permission-card';
  permissionSection.setAttribute('role', 'group');
  permissionSection.setAttribute('aria-label', 'Permission request');
  permissionSection.hidden = true;
  const permissionHeading = document.createElement('h3');
  permissionHeading.className = 'review-heading permission-heading';
  permissionHeading.textContent = 'Asking permission';
  const permissionTool = document.createElement('div');
  permissionTool.className = 'permission-tool';
  // The literal tool input, from a hook payload: `textContent`, never markup,
  // never a regex-to-HTML pass. It is `pre`-wrapped so a command reads as the
  // command it is.
  const permissionInput = document.createElement('pre');
  permissionInput.className = 'permission-input mono';
  const permissionActions = document.createElement('div');
  permissionActions.className = 'permission-actions';
  const permissionNote = document.createElement('p');
  permissionNote.className = 'permission-note';
  permissionSection.append(
    permissionHeading,
    permissionTool,
    permissionInput,
    permissionActions,
    permissionNote,
  );

  const saidSection = document.createElement('section');
  saidSection.className = 'review-section';
  const saidHeading = document.createElement('h3');
  saidHeading.className = 'review-heading';
  saidHeading.textContent = 'What it said';
  const saidEl = document.createElement('div');
  saidEl.className = 'review-said';

  // WP-09 · the reply arriving. While a turn is streaming this sits directly
  // under WHAT IT SAID and fills a word at a time; when the turn ends it is
  // emptied and the canonical, markdown-rendered message replaces it above.
  //
  // Everything in here is `textContent`. Deltas are the model's own prose
  // arriving a fragment at a time, so there is no complete markdown document
  // to parse — half a fenced block is not a fenced block — and building DOM
  // from a partial string is exactly the pass docs/plan/05-GUI-UX-SPEC.md
  // §4.2 forbids. The finished turn is re-rendered as markdown by
  // loadConversation(); the live view is plain text and says so.
  const liveSection = document.createElement('div');
  liveSection.className = 'review-live';
  liveSection.hidden = true;
  const liveRow = document.createElement('div');
  liveRow.className = 'msg msg--assistant';
  const liveWho = document.createElement('div');
  liveWho.className = 'msg-who';
  const liveBody = document.createElement('div');
  liveBody.className = 'msg-body msg-body--plain review-live-body';
  // Announced politely, once per turn boundary rather than per fragment: a
  // screen reader reading every delta aloud would be unusable.
  liveRow.setAttribute('aria-live', 'off');
  const liveTools = document.createElement('div');
  liveTools.className = 'review-live-tools';
  liveTools.hidden = true;
  liveRow.append(liveWho, liveBody, liveTools);
  liveSection.appendChild(liveRow);

  saidSection.append(saidHeading, saidEl, liveSection);

  const threadDetails = document.createElement('details');
  threadDetails.className = 'review-thread';
  const threadSummary = document.createElement('summary');
  threadSummary.className = 'review-thread-summary';
  const threadEl = document.createElement('div');
  threadEl.className = 'panel-thread';
  threadEl.setAttribute('aria-label', 'Earlier in this conversation');
  threadDetails.append(threadSummary, threadEl);

  const changedSection = document.createElement('section');
  changedSection.className = 'review-section';
  const changedHeadRow = document.createElement('div');
  changedHeadRow.className = 'review-heading-row';
  const changedHeading = document.createElement('h3');
  changedHeading.className = 'review-heading';
  const changedTotals = document.createElement('span');
  changedTotals.className = 'review-totals num';
  changedHeadRow.append(changedHeading, changedTotals);
  const changedEl = document.createElement('div');
  changedEl.className = 'review-changes';
  // `[ expand all ]`, where `05` §4.1's mockup drew `[ open the diff ]`.
  // Appended by renderChanges() only when there are rows to expand.
  const changedFoot = document.createElement('div');
  changedFoot.className = 'review-changes-foot';
  const expandAllBtn = document.createElement('button');
  expandAllBtn.type = 'button';
  expandAllBtn.className = 'review-expand-all';
  expandAllBtn.textContent = '[ expand all ]';
  expandAllBtn.addEventListener('click', () => {
    const open = fileRows.some((r) => r.head.getAttribute('aria-expanded') !== 'true');
    for (const row of fileRows) setFileExpanded(row, open);
  });
  changedFoot.appendChild(expandAllBtn);
  changedSection.append(changedHeadRow, changedEl);

  body.append(permissionSection, saidSection, threadDetails, changedSection);

  // Actions: three weighted buttons on 1/2/3, everything else behind ⋯ more.
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'panel-actions-wrap';
  const actionsEl = document.createElement('div');
  actionsEl.className = 'panel-actions';
  const moreMenu = document.createElement('div');
  moreMenu.className = 'panel-more-menu';
  moreMenu.setAttribute('role', 'group');
  moreMenu.setAttribute('aria-label', 'More actions');
  moreMenu.hidden = true;
  actionsWrap.append(actionsEl, moreMenu);

  const form = document.createElement('form');
  form.className = 'panel-composer';
  const inputLabel = document.createElement('label');
  inputLabel.className = 'sr-only';
  inputLabel.setAttribute('for', 'panel-input');
  inputLabel.textContent = 'Message this session';
  const textarea = document.createElement('textarea');
  textarea.id = 'panel-input';
  textarea.rows = 2;
  textarea.placeholder = 'Reply to this session…';
  const composerRow = document.createElement('div');
  composerRow.className = 'composer-row';
  const hintEl = document.createElement('span');
  hintEl.className = 'composer-hint';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  // Plain, not primary: `2 Approve` is the only filled button on the screen.
  sendBtn.className = 'btn';
  sendBtn.textContent = 'Send';
  composerRow.append(hintEl, sendBtn);
  form.append(inputLabel, textarea, composerRow);

  // Costs, one quiet line at the bottom, and the resume links beneath it.
  const foot = document.createElement('div');
  foot.className = 'panel-foot';
  const costEl = document.createElement('div');
  costEl.className = 'panel-cost num';
  const resumeEl = document.createElement('div');
  resumeEl.className = 'panel-resume';
  foot.append(costEl, resumeEl);

  root.append(top, body, actionsWrap, form, foot);

  loadRenderModules();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCloseUp();
    else if (currentId && displayedAgent) startCloseUp(displayedAgent);
  });
  document.addEventListener('click', (e) => {
    // Clicking anywhere outside the ⋯ menu closes it.
    if (moreMenu.hidden) return;
    const t = /** @type {Node|null} */ (e.target);
    if (t && actionsWrap.contains(t)) return;
    setMoreOpen(false);
  });

  // ------------------------------------------------------------ rendering

  /**
   * Passive re-render of everything except the conversation and the diff.
   * Called from open() and refresh() and after an optimistic patch. Never
   * issues any network write — read-only, by construction.
   */
  function renderChrome() {
    if (!displayedAgent) return;
    const a = displayedAgent;
    titleEl.textContent = a.title;

    mkChip.textContent = '';
    const mk = a.mk || a.id;
    // Since WP-20 an agent has a name from the moment it is first seen, so
    // this is nearly always a name over a tag rather than a bare tag. The tag
    // stays underneath as the sub-label: it is what makes the session
    // locatable by project, and a name never replaces it.
    const name = a.displayName || a.givenName || null;
    if (name) {
      const nameEl = document.createElement('span');
      nameEl.className = 'mk-chip-label';
      nameEl.textContent = name;
      const tagEl = document.createElement('span');
      tagEl.className = 'mk-chip-tag';
      tagEl.textContent = mk;
      mkChip.append(nameEl, tagEl);
    } else {
      const tagEl = document.createElement('span');
      tagEl.className = 'mk-chip-tag';
      tagEl.textContent = mk;
      mkChip.appendChild(tagEl);
    }
    // One quiet word for an uncommon-or-better agent, and nothing at all for
    // the ~74% that are common. Never a number, never a rank, never a count of
    // how many the user has "collected" — the agents have faces, the human is
    // never scored (docs/plan/08 §1.1 rule 6).
    const word = rarityWordFor(a);
    if (word) {
      const rarityEl = document.createElement('span');
      rarityEl.className = 'mk-chip-rarity';
      rarityEl.dataset.tier = word;
      rarityEl.textContent = word;
      // A real space as well as the flex gap: a screen reader reads the text,
      // and "MK2.2rare" is one word to it.
      mkChip.append(' ', rarityEl);
    }
    renderDraftChip();
    renderRecordLine();

    // The state line: "✓ FOR REVIEW · orbital-api · main · opus-5".
    metaEl.textContent = '';
    const chip = document.createElement('span');
    chip.className = 'state-chip';
    const icon = document.createElement('span');
    icon.className = 'state-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = STATE_ICON_GLYPH[a.activityState] || '●';
    // The icon carries the colour; the text label right beside it is the
    // non-colour channel (style.css's "never colour alone" discipline).
    icon.style.color = stateColor(a.activityState);
    const label = document.createElement('span');
    label.textContent = STATE_LABELS[a.activityState] || a.activityState;
    chip.append(icon, label);
    metaEl.appendChild(chip);
    for (const part of [a.projectName, a.gitBranch, shortModel(a.model)]) {
      if (!part) continue;
      metaEl.appendChild(separator());
      metaEl.appendChild(textNode(part));
    }
    if (a.ackState === 'benched') {
      metaEl.appendChild(separator());
      metaEl.appendChild(textNode('benched'));
    }
    if (a.ackState === 'let_go') {
      metaEl.appendChild(separator());
      metaEl.appendChild(textNode('let go'));
    }
    renderWaiting();
    renderDoing();
    renderPermission();

    changedHeading.textContent = `What changed in ${a.projectName || 'this project'}`;
    textarea.placeholder = `Reply to ${who(a)}…`;

    // Costs are context, not the subject: one line, at the bottom, and the
    // cost is a list-price estimate for comparing projects, NEVER a bill.
    costEl.textContent = '';
    for (const [i, part] of [
      `${formatNumber(a.tokens)} tok`,
      `${formatCompact(a.cacheTokens)} cache`,
      ...costLineParts(a, getSnapshot()?.rateCardVersion),
    ].entries()) {
      if (i) costEl.appendChild(separator());
      costEl.appendChild(textNode(part));
    }

    renderActions(a);
    renderResume();
    startCloseUp(a);
  }

  /** The live "waiting …" line. Reads the clock; writes nothing. */
  function renderWaiting() {
    const a = displayedAgent;
    const since = a?.ackState === 'active' ? (a.reviewSince ?? a.needsInputSince) : null;
    if (!since) {
      waitingEl.hidden = true;
      waitingEl.textContent = '';
      return;
    }
    waitingEl.hidden = false;
    waitingEl.textContent = `waiting ${formatElapsed(Date.now() - since)}`;
  }

  /**
   * The live "doing: …" line (WP-52). Reads the snapshot's `currentTool`;
   * writes nothing, and touches no ack state — a tool starting or finishing
   * is an observation, never an acknowledgement.
   */
  function renderDoing() {
    const tool = displayedAgent && displayedAgent.currentTool;
    const summary = tool && typeof tool.summary === 'string' ? tool.summary.trim() : '';
    if (!summary) {
      doingEl.hidden = true;
      doingEl.textContent = '';
      return;
    }
    doingEl.hidden = false;
    doingEl.textContent = `doing: ${summary}`;
  }

  function renderDraftChip() {
    draftChip.hidden = !(currentId && drafts.has(currentId));
  }

  /**
   * The pending permission on the displayed agent, or null. Read-only.
   * @returns {any|null}
   */
  function pendingPermission() {
    const p = displayedAgent && displayedAgent.pendingPermission;
    return p && typeof p === 'object' && p.id ? p : null;
  }

  /**
   * WP-19 · the permission card. A read of `pendingPermission` off the
   * snapshot, rendered as text. It writes nothing: rendering a question is
   * not answering it, and this function must never reach performAction(),
   * /api/ack or /api/permission/decide — only an explicit button or its
   * explicit key does that, through answerPermission().
   *
   * Four states, per `docs/DEVIATIONS.md` §86.5: waiting with three buttons,
   * waiting with two when the runtime offered no rule to add, "answer in the
   * terminal" for the tools whose approval card IS the interaction surface,
   * and — by simply disappearing — answered or withdrawn, which the daemon
   * reports by clearing the field.
   */
  function renderPermission() {
    const p = pendingPermission();
    if (!p) {
      permissionSection.hidden = true;
      permissionActions.textContent = '';
      permissionInput.textContent = '';
      announcedPermissionId = null;
      return;
    }
    permissionSection.hidden = false;
    permissionTool.textContent = String(p.tool || 'A tool');
    permissionInput.textContent = String(p.summary || '');
    permissionActions.textContent = '';

    if (p.requiresUserInteraction) {
      // A hook allow is discarded for these, so offering a button would be
      // offering something that does not work.
      permissionNote.textContent =
        `${p.tool} has to be answered in the session itself — this one cannot be answered ` +
        'from here. Open the terminal running it and answer there.';
      maybeAnnouncePermission(p, `${p.tool}: answer in the terminal`);
      return;
    }

    const suggestions = Array.isArray(p.suggestions) ? p.suggestions : [];
    permissionActions.append(
      permissionButton('A', 'Allow', 'btn btn--primary', 'allow'),
      permissionButton('D', 'Deny', 'btn', 'deny'),
    );
    if (suggestions.length > 0) {
      const btn = permissionButton('S', 'Allow for session', 'btn', 'session');
      const label = suggestions
        .map((s) => (s && typeof s.label === 'string' ? s.label : ''))
        .filter(Boolean)
        .join(', ');
      btn.title = label
        ? `Adds ${label} for this session only — nothing is written to your settings files`
        : 'For this session only — nothing is written to your settings files';
      permissionActions.appendChild(btn);
    }
    permissionNote.textContent =
      'The same prompt is open in the terminal. Whichever answers first wins, and DeckHQ ' +
      'never answers on its own.';
    maybeAnnouncePermission(p, `${p.tool} is asking permission: ${p.summary || ''}`);
  }

  /**
   * Say a new permission card once, for a screen reader. Guarded on the
   * request id so a snapshot per second does not repeat it.
   * @param {any} p @param {string} text
   */
  function maybeAnnouncePermission(p, text) {
    if (announcedPermissionId === p.id) return;
    announcedPermissionId = p.id;
    announce(text);
  }

  /**
   * @param {string} key @param {string} label @param {string} className
   * @param {'allow'|'deny'|'session'} decision
   */
  function permissionButton(key, label, className, decision) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${className} btn--weighted`;
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    btn.append(kbd, textNode(label));
    btn.setAttribute('aria-keyshortcuts', key);
    btn.disabled = answering;
    btn.addEventListener('click', () => answerPermission(decision));
    return btn;
  }

  /** @param {string} text */
  function textNode(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  function separator() {
    const s = document.createElement('span');
    s.className = 'sep';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '·';
    return s;
  }

  /**
   * The weighted actions. `2 Approve` is the one filled button on the
   * screen; `1 Reply` only moves focus; the third slot is the ack action
   * that moves this agent (bench / recall / rehire). The rest live behind ⋯.
   * @param {any} a
   */
  function renderActions(a) {
    actionsEl.textContent = '';
    moreMenu.textContent = '';
    setMoreOpen(false);

    actionsEl.appendChild(weightedButton('1', 'Reply', 'btn', () => focusComposer()));
    // `2 Approve` is normally the one filled button on the screen (`05` §4.2).
    // It yields the fill while a permission card is up: that card is the only
    // thing on this panel with a socket and a deadline behind it, and two
    // accent-filled buttons is exactly the "which one is the action?" problem
    // the single-fill rule exists to prevent. It keeps its key and its place.
    const approveClass = pendingPermission() ? 'btn' : 'btn btn--primary';
    const approveBtn = weightedButton('2', 'Approve', approveClass, () => approve());
    approveBtn.title = `Sends “${approveText()}”`;
    actionsEl.appendChild(approveBtn);
    const third = thirdAction(a);
    // The only wiring for /api/ack in the weighted row: an explicit click on
    // a button that is only ever shown when the action is legal.
    actionsEl.appendChild(
      weightedButton('3', ACTION_LABELS[third], 'btn', () => performAction(third)),
    );

    const spacer = document.createElement('span');
    spacer.className = 'panel-actions-spacer';
    actionsEl.appendChild(spacer);

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'btn btn--quiet panel-more-btn';
    moreBtn.textContent = '⋯ more';
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-haspopup', 'true');
    moreBtn.addEventListener('click', () => setMoreOpen(moreMenu.hidden));
    actionsEl.appendChild(moreBtn);

    // Everything else, as plain buttons. Each ack action here is still an
    // explicit click and still funnels through performAction().
    for (const action of legalActions(a)) {
      if (action === third) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action === 'let_go' ? 'btn btn--danger' : 'btn';
      btn.textContent = ACTION_LABELS[action];
      btn.addEventListener('click', () => performAction(action));
      moreMenu.appendChild(btn);
    }
    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'btn';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
      setMoreOpen(false);
      if (displayedAgent) onRename?.(displayedAgent);
    });
    moreMenu.appendChild(renameItem);
    // WP15 task C.2: creating a sibling session is not a review action, so it
    // is wired through onNewAgent, never through performAction()/ack.
    const newAgentBtn = document.createElement('button');
    newAgentBtn.type = 'button';
    newAgentBtn.className = 'btn';
    newAgentBtn.textContent = '+ New agent';
    newAgentBtn.addEventListener('click', () => {
      setMoreOpen(false);
      onNewAgent?.(a.projectId);
    });
    moreMenu.appendChild(newAgentBtn);
  }

  /**
   * @param {string} key the number the button answers to
   * @param {string} label
   * @param {string} className
   * @param {() => void} onClick
   */
  function weightedButton(key, label, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${className} btn--weighted`;
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    btn.append(kbd, textNode(label));
    btn.setAttribute('aria-keyshortcuts', key);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** @param {boolean} open */
  function setMoreOpen(open) {
    moreMenu.hidden = !open;
    const btn = actionsEl.querySelector('.panel-more-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  /**
   * The resume links in the footer. Picking either both resumes right now
   * AND becomes the saved default (see resumeSession()). "resume in app"
   * only appears once the daemon has confirmed a claude:// handler exists —
   * see loadResumeTargets(); it is never guessed on the client.
   */
  function renderResume() {
    resumeEl.textContent = '';
    const preference = getSnapshot()?.settings?.resumeIn === 'app' ? 'app' : 'terminal';
    resumeEl.appendChild(resumeLink('terminal', 'resume in terminal', preference));
    if (resumeAppAvailable) {
      resumeEl.appendChild(separator());
      resumeEl.appendChild(resumeLink('app', 'resume in app', preference));
    }
  }

  /**
   * `aria-pressed` reflects the user's current saved default — not disabled
   * state; both targets stay clickable regardless of which is the default.
   * @param {'app'|'terminal'} target
   * @param {string} label
   * @param {'app'|'terminal'} preference
   */
  function resumeLink(target, label, preference) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn panel-resume-link';
    btn.textContent = label;
    btn.title =
      'Resuming with the full session, instead of a summary, re-sends its history as context and uses more tokens.';
    btn.setAttribute('aria-pressed', String(target === preference));
    btn.addEventListener('click', () => resumeSession(target));
    return btn;
  }

  /**
   * Fetch and render the real conversation. This is a passive GET — reading
   * it, and the rendering below, must never touch ack state. See the
   * module-level invariant note.
   * @param {string} id
   */
  async function loadConversation(id) {
    const token = ++conversationToken;
    messages = null;
    saidEl.textContent = '';
    saidEl.appendChild(threadSkeleton());
    threadDetails.hidden = true;
    // An actor on the empty-machine floor (WP-13) has no transcript on disk,
    // and the third coach mark says "Click anyone" — so clicking one has to
    // land somewhere sensible rather than on `Unknown runtime "demo"`. Its
    // one line is shown, and the panel says plainly what it is looking at.
    if (getSnapshot()?.demo) {
      messages = [];
      saidEl.textContent = '';
      if (displayedAgent?.lastText) {
        saidEl.appendChild(renderMarkdown(displayedAgent.lastText, document));
      }
      const note = document.createElement('div');
      note.className = 'msg-empty';
      note.textContent = 'An actor. A real session shows its whole conversation here.';
      saidEl.appendChild(note);
      return;
    }
    try {
      const res = await fetch(`/api/conversation?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (token !== conversationToken) return; // a newer open() superseded this fetch
      messages = body.messages || [];
      renderSaid();
      renderThread();
    } catch (err) {
      if (token !== conversationToken) return;
      messages = [];
      saidEl.textContent = '';
      // The scan's own excerpt still tells the reader something while the
      // full conversation is unavailable.
      if (displayedAgent?.lastRole === 'assistant' && displayedAgent.lastText) {
        saidEl.appendChild(renderMarkdown(displayedAgent.lastText, document));
      }
      const msg = document.createElement('div');
      msg.className = 'msg-empty';
      msg.textContent = `Could not load the conversation: ${err.message}`;
      saidEl.appendChild(msg);
      threadDetails.hidden = true;
    }
  }

  function threadSkeleton() {
    const wrap = document.createElement('div');
    wrap.className = 'thread-skeleton';
    for (let i = 0; i < 4; i++) {
      const line = document.createElement('div');
      line.className = 'sk-line';
      wrap.appendChild(line);
    }
    return wrap;
  }

  /** The last assistant message, rendered as markdown. */
  function renderSaid() {
    saidEl.textContent = '';
    const list = messages || [];
    let last = null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role !== 'user') {
        last = list[i];
        break;
      }
    }
    if (!last) {
      const empty = document.createElement('div');
      empty.className = 'msg-empty';
      empty.textContent = list.length ? 'Nothing from the agent yet.' : 'No messages yet.';
      saidEl.appendChild(empty);
      return;
    }
    // Untrusted daemon data → token tree → textContent. Never innerHTML.
    saidEl.appendChild(renderMarkdown(last.text, document));
  }

  /**
   * Everything before the last assistant message, folded under a summary so
   * the card leads with what matters and the history is one click away.
   * Scrolling and expanding this are passive — no ack call here.
   */
  function renderThread() {
    threadEl.textContent = '';
    const list = messages || [];
    let lastIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role !== 'user') {
        lastIdx = i;
        break;
      }
    }
    const earlier = lastIdx === -1 ? list : list.slice(0, lastIdx);
    if (earlier.length === 0) {
      threadDetails.hidden = true;
      return;
    }
    threadDetails.hidden = false;
    threadDetails.open = false;
    threadSummary.textContent = `earlier in this conversation · ${earlier.length} ${
      earlier.length === 1 ? 'message' : 'messages'
    }`;
    for (const m of earlier) {
      const wrap = document.createElement('div');
      wrap.className = `msg msg--${m.role === 'user' ? 'user' : 'assistant'}`;
      const who = document.createElement('div');
      who.className = 'msg-who';
      who.textContent = m.role === 'user' ? 'You' : 'Agent';
      const body = document.createElement('div');
      body.className = 'msg-body';
      if (m.role === 'user') {
        // What the user typed is shown exactly as typed.
        body.classList.add('msg-body--plain');
        body.textContent = m.text;
      } else {
        body.appendChild(renderMarkdown(m.text, document));
      }
      wrap.append(who, body);
      threadEl.appendChild(wrap);
    }
  }

  /**
   * "What changed in <project>": the working-tree summary from
   * GET /api/changes. A passive read of the disk, cached per scan by the
   * daemon; it never touches ack state. Re-fetched only when a new scan has
   * happened, so a snapshot per second costs nothing here.
   * @param {string} id
   * @param {number|null} scannedAt
   */
  async function loadChanges(id, scannedAt) {
    if (scannedAt === changesScannedAt) return;
    changesScannedAt = scannedAt;
    const token = ++changesToken;
    if (!changedEl.childElementCount) {
      changedEl.textContent = '';
      changedEl.appendChild(threadSkeleton());
    }
    if (getSnapshot()?.demo) {
      changedEl.textContent = '';
      changedTotals.textContent = '';
      const note = document.createElement('div');
      note.className = 'review-note';
      note.textContent = 'An actor has no working tree. A real session shows what changed here.';
      changedEl.appendChild(note);
      return;
    }
    try {
      const res = await fetch(`/api/changes?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (token !== changesToken) return;
      renderChanges(body);
    } catch (err) {
      if (token !== changesToken) return;
      changesScannedAt = undefined; // try again on the next snapshot
      changedEl.textContent = '';
      changedTotals.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'review-note';
      msg.textContent = `Could not read the working tree: ${err.message}`;
      changedEl.appendChild(msg);
    }
  }

  /**
   * The section never disappears: a clean tree, a missing repository, a
   * missing git and a missing directory are each a sentence, because "no
   * changes" is itself review-relevant.
   * @param {any} c
   */
  function renderChanges(c) {
    changedEl.textContent = '';
    changedTotals.textContent = '';
    fileRows = [];
    const note = (text) => {
      const n = document.createElement('div');
      n.className = 'review-note';
      n.textContent = text;
      changedEl.appendChild(n);
    };
    switch (c.status) {
      case 'missing':
        note('the directory no longer exists');
        return;
      case 'no-git':
        note('git is not installed, so nothing here can be read');
        return;
      case 'no-repo':
        note('not a git repository');
        return;
      default:
        break;
    }
    const ahead = c.ahead && c.ahead.count > 0 ? c.ahead : null;
    if (c.status === 'clean') {
      note(
        ahead
          ? `nothing uncommitted · ${ahead.count} ${ahead.count === 1 ? 'commit' : 'commits'} ahead of ${ahead.base}`
          : 'nothing uncommitted',
      );
      return;
    }
    const t = c.totals || { files: 0, added: 0, removed: 0 };
    changedTotals.textContent = `+${formatNumber(t.added)}  −${formatNumber(t.removed)}  ${t.files} ${
      t.files === 1 ? 'file' : 'files'
    }`;
    const table = document.createElement('div');
    table.className = 'review-files';
    for (const [list, staged] of [
      [c.files || [], false],
      [c.staged || [], true],
    ]) {
      for (const f of list) {
        // The row is a button so that "click or Enter" is the platform's own
        // behaviour rather than a keydown handler that would also have to
        // reimplement Space, focus and the disclosure's ARIA.
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'review-file-head';
        head.setAttribute('aria-expanded', 'false');
        const p = document.createElement('span');
        p.className = 'review-file-path';
        p.textContent = f.path;
        head.title = staged ? `${f.path} (staged)` : f.path;
        const add = document.createElement('span');
        add.className = 'review-file-num num';
        add.textContent = f.binary ? 'bin' : `+${f.added}`;
        const rem = document.createElement('span');
        rem.className = 'review-file-num num';
        rem.textContent = f.binary ? '' : `−${f.removed}`;
        if (staged) {
          const s = document.createElement('span');
          s.className = 'review-file-staged';
          s.textContent = 'staged';
          p.appendChild(s);
        }
        head.append(p, add, rem);

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'review-file-open';
        openBtn.textContent = '↗';
        openBtn.title = 'Open in editor';
        openBtn.setAttribute('aria-label', `Open ${f.path} in your editor`);

        const diffEl = document.createElement('div');
        diffEl.className = 'review-file-diff';
        diffEl.id = `review-diff-${fileRows.length}`;
        diffEl.hidden = true;
        head.setAttribute('aria-controls', diffEl.id);

        const row = document.createElement('div');
        row.className = 'review-file';
        const rowTop = document.createElement('div');
        rowTop.className = 'review-file-row';
        rowTop.append(head, openBtn);
        row.append(rowTop, diffEl);
        table.appendChild(row);

        const entry = {
          key: (staged ? 'S:' : 'U:') + f.path,
          path: f.path,
          staged,
          head,
          diffEl,
          loaded: false,
          line: 1,
        };
        fileRows.push(entry);
        head.addEventListener('click', () => setFileExpanded(entry, !isFileExpanded(entry)));
        openBtn.addEventListener('click', () => openFileInEditor(entry));
        if (expandedFiles.has(entry.key)) setFileExpanded(entry, true);
      }
    }
    changedEl.appendChild(table);
    if (fileRows.length) {
      changedEl.appendChild(changedFoot);
      syncExpandAll();
    }
    if (ahead) {
      note(`${ahead.count} ${ahead.count === 1 ? 'commit' : 'commits'} ahead of ${ahead.base}`);
    }
  }

  /** @param {any} entry */
  function isFileExpanded(entry) {
    return entry.head.getAttribute('aria-expanded') === 'true';
  }

  /** `[ expand all ]` becomes `[ collapse all ]` once everything is open. */
  function syncExpandAll() {
    const allOpen = fileRows.length > 0 && fileRows.every(isFileExpanded);
    expandAllBtn.textContent = allOpen ? '[ collapse all ]' : '[ expand all ]';
  }

  /**
   * Open or close one file's diff. Collapsed by default (`08` §8.1): a review
   * card that opened six diffs at once would bury the message the section
   * exists to support.
   * @param {any} entry @param {boolean} on
   */
  function setFileExpanded(entry, on) {
    entry.head.setAttribute('aria-expanded', String(on));
    entry.diffEl.hidden = !on;
    if (on) {
      expandedFiles.add(entry.key);
      loadDiff(entry);
    } else {
      expandedFiles.delete(entry.key);
    }
    syncExpandAll();
  }

  /**
   * GET /api/diff for one file. Passive, like loadChanges(): a read of the
   * disk that never touches ack state. Cached per scan by the daemon, and
   * fetched at most once per rendered row here.
   * @param {any} entry
   */
  async function loadDiff(entry) {
    if (entry.loaded) return;
    entry.loaded = true;
    const id = currentId;
    const note = (text) => {
      entry.diffEl.textContent = '';
      const n = document.createElement('div');
      n.className = 'review-note';
      n.textContent = text;
      entry.diffEl.appendChild(n);
    };
    note('reading the diff…');
    try {
      const res = await fetch(
        `/api/diff?id=${encodeURIComponent(id)}&file=${encodeURIComponent(entry.path)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (id !== currentId) return;
      const part = (entry.staged ? body.staged : body.unstaged) || {};
      const text = String(part.text || '');
      if (!text) {
        note('no textual diff — a binary file, or the change is no longer there');
        return;
      }
      // Aim "open in editor" at the first changed line rather than line 1.
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/m.exec(text);
      if (hunk) entry.line = Number(hunk[1]) || 1;
      entry.diffEl.textContent = '';
      entry.diffEl.appendChild(renderDiff(text, document));
      if (part.truncated) {
        const n = document.createElement('div');
        n.className = 'review-note';
        n.textContent = 'the rest of this diff is too large to show here';
        entry.diffEl.appendChild(n);
      }
    } catch (err) {
      if (id !== currentId) return;
      entry.loaded = false; // so closing and reopening the row tries again
      note(`could not read the diff: ${err.message}`);
    }
  }

  /**
   * POST /api/open-in-editor. The client sends a path and a line, never a
   * command: which program that means is the daemon's decision, taken from an
   * allowlist (src/core/editor.mjs).
   * @param {any} entry
   */
  async function openFileInEditor(entry) {
    const id = currentId;
    if (!id) return;
    try {
      const res = await fetch('/api/open-in-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, file: entry.path, line: entry.line }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Opened ${entry.path} in ${body.label || 'your editor'}`);
    } catch (err) {
      toast(`Could not open in editor: ${err.message}`, { isError: true });
    }
  }

  // ------------------------------------------------------------ close-up

  async function loadRenderModules() {
    try {
      rig = await import('./render/rig.js');
    } catch (err) {
      console.debug('[deckhq] render/rig.js not available yet', err);
    }
    try {
      clips = await import('./render/clips.js');
    } catch (err) {
      console.debug('[deckhq] render/clips.js not available yet', err);
    }
    try {
      palette = await import('./render/palette.js');
      paletteModule = palette;
    } catch (err) {
      console.debug('[deckhq] render/palette.js not available yet', err);
    }
    renderModulesLoaded = true;
    if (currentId && displayedAgent) startCloseUp(displayedAgent);
  }

  function stopCloseUp() {
    if (closeUpRaf) cancelAnimationFrame(closeUpRaf);
    closeUpRaf = null;
  }

  /**
   * The animated L2 close-up, 44 px beside the identity line: renders the
   * selected agent at LOD 2 always, regardless of the floor's own zoom
   * (docs/03-VISUAL-SPEC.md §1.1). Purely decorative/read-only — never a
   * source of ack calls.
   * @param {any} a
   */
  function startCloseUp(a) {
    stopCloseUp();
    if (!renderModulesLoaded || !rig?.drawCharacter || !clips?.sampleClip) return;
    if (document.hidden) return;
    const ctx = closeupCanvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clipName =
      (clips.clipForState && clips.clipForState(visualState(a))) ||
      (a.activityState === 'needs_input' ? 'hand_raise' : 'type');
    const color = stateColor(visualState(a));
    const icon =
      a.activityState === 'needs_input'
        ? 'hand'
        : a.activityState === 'stalled'
          ? 'hourglass'
          : a.activityState === 'for_review'
            ? 'check'
            : null;
    // The canvas is drawn at 2× and shown at 44 px, so the figure stays crisp
    // on a high-density display; `u` scales with the canvas.
    const u = closeupCanvas.width / 4;
    const cx = closeupCanvas.width / 2;
    const cy = closeupCanvas.height / 2;
    // The same hair, accent and glyph the floor draws (CONTRACTS-WP15.md §2),
    // so the close-up is recognisably the same person.
    const identity = palette?.identityFor ? palette.identityFor(a.projectMk, a.avatar) : undefined;
    // And the same face (WP-20): hair style, skin, outfit accent, glasses,
    // build and any rarity trait. The close-up is where a rare agent is
    // actually legible, so it must not be the one place that omits it.
    const appearance = palette?.appearanceFor ? palette.appearanceFor(a.id) : undefined;

    const draw = (elapsedSeconds) => {
      ctx.clearRect(0, 0, closeupCanvas.width, closeupCanvas.height);
      let t = elapsedSeconds;
      const def = clips.CLIPS?.[clipName];
      if (def?.duration) t = elapsedSeconds % def.duration;
      let pose;
      try {
        pose = clips.sampleClip(clipName, t, reduced);
      } catch (err) {
        console.debug('[deckhq] sampleClip failed', err);
        return;
      }
      try {
        rig.drawCharacter(ctx, pose, {
          x: cx,
          y: cy,
          u,
          lod: 2,
          color,
          label: null,
          icon,
          badge: null,
          selected: false,
          identity,
          appearance,
        });
      } catch (err) {
        console.debug('[deckhq] drawCharacter failed', err);
      }
    };

    if (reduced) {
      // Reduced motion: one representative static pose, no animation loop.
      draw(0);
      return;
    }
    closeUpStartTs = performance.now();
    const frame = (ts) => {
      draw((ts - closeUpStartTs) / 1000);
      closeUpRaf = requestAnimationFrame(frame);
    };
    closeUpRaf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- actions

  /**
   * The agent a targeted key or action is about. The panel's own displayed
   * copy when it is that one (so an optimistic patch is honoured), otherwise
   * the authoritative row from the latest snapshot. WP-10's deck acts on the
   * row under its cursor, which is very often not the row the panel is on.
   * @param {string|null|undefined} id
   */
  function agentFor(id) {
    if (!id || id === currentId) return displayedAgent;
    return getSnapshot()?.agents?.find((a) => a.id === id) || null;
  }

  /**
   * The single funnel for the six user-owned actions (docs/02-ARCHITECTURE
   * §5.1). This is the ONLY function in the client that calls POST
   * /api/ack. It is invoked exclusively from:
   *   - an explicit click on a button built in renderActions() above,
   *   - the `3` number key, via pressNumberKey() below, or
   *   - app.js's keydown handler for the explicit 'A'/'B' shortcuts, which
   *     since WP-10 may name the deck's cursor row instead of the open one.
   * It is never called from open(), refresh(), or any rendering/selection
   * path. Optimistic update with rollback on failure, per WP9.
   *
   * `targetId` acts on a row the panel is not showing — the deck's `3` key
   * clears an item without opening it (docs/plan/05-GUI-UX-SPEC.md §3.2).
   * There is still exactly one request here, and it still only happens
   * because somebody pressed something.
   * @param {string} action
   * @param {string|null} [targetId]
   */
  async function performAction(action, targetId) {
    const id = targetId || currentId;
    const agent = agentFor(id);
    if (!id || !agent) return;
    if (!legalActions(agent).includes(action)) return;
    // The actors on an empty machine's floor (WP-13) are not sessions and are
    // not in the registry, so every one of these would come back "No such
    // agent". Say the true and useful thing instead. This holds for a deck
    // row as much as for the panel's own: the whole floor is actors.
    if (getSnapshot()?.demo) return toast(DEMO_REFUSAL);

    // Only the panel's own row has anything to patch optimistically; a deck
    // row's feedback is the next snapshot, which is 250 ms away.
    const inPanel = id === currentId && Boolean(displayedAgent);
    const rollback = displayedAgent;
    if (inPanel) {
      displayedAgent = optimisticPatch(displayedAgent, action);
      renderChrome();
    }

    try {
      const res = await fetch('/api/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // A control says what happens (docs/plan/05 §11): the toast names the
      // outcome, in the panel's compact voice (display name, else MK tag).
      const name = who(inPanel ? displayedAgent : agent);
      toast(
        action === 'bench'
          ? `Benched. ${name} is in the lounge.`
          : action === 'recall'
            ? `Recalled. ${name} is back on the floor.`
            : `${ACTION_LABELS[action]} — done`,
      );
      announce(`${name}: ${ACTION_LABELS[action].toLowerCase()}`);
    } catch (err) {
      if (inPanel) {
        displayedAgent = rollback;
        renderChrome();
      }
      toast(`Could not ${ACTION_LABELS[action].toLowerCase()}: ${err.message}`, { isError: true });
    }
  }

  /**
   * WP-19 · answer the permission prompt this daemon is holding open.
   *
   * The single funnel for POST /api/permission/decide, and deliberately NOT
   * part of performAction(): a permission decision says something about one
   * tool call, and `ackState` says whether the user is done with the session.
   * Routing one through the other would let a tool approval clear a review
   * debt, which is the `08` §1.1 rule 1 invariant. Nothing in this function
   * touches ack state, the review queue, or the agent's activity state, and
   * there is an `INVARIANT:` test that says so.
   *
   * Reached only from an explicit button built in renderPermission() or from
   * its explicit A / D / S key. Never from a render, a refresh or a timer.
   * @param {'allow'|'deny'|'session'} decision
   */
  async function answerPermission(decision) {
    const p = pendingPermission();
    if (!p || answering) return;
    if (p.requiresUserInteraction) return;
    if (decision === 'session' && !(Array.isArray(p.suggestions) && p.suggestions.length > 0)) {
      return;
    }
    answering = true;
    for (const b of permissionActions.querySelectorAll('button')) b.disabled = true;
    try {
      const res = await fetch('/api/permission/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // A control says what happens (docs/plan/05 §11).
      toast(
        decision === 'deny'
          ? `Denied. ${p.tool} did not run.`
          : decision === 'session'
            ? `Allowed for this session. ${p.tool} may run again without asking, until this session ends.`
            : `Allowed. ${p.tool} is running.`,
      );
      announce(`${p.tool}: ${decision === 'session' ? 'allowed for this session' : decision}ed`);
    } catch (err) {
      toast(`Could not answer: ${err.message}`, { isError: true });
      answering = false;
      renderPermission();
      return;
    }
    answering = false;
    // The daemon clears `pendingPermission` as it answers the socket, so the
    // card goes on the next snapshot. Re-render now so the buttons do not sit
    // there looking live in the meantime.
    renderPermission();
  }

  /**
   * A / D / S, while the panel is open and the composer is not focused.
   *
   * This listener is registered when the panel is built, which is before
   * app.js registers its own — and app.js binds `A` to acknowledge and `S` to
   * the office snapshot. So while a permission card is up, `A` answers the
   * card and `stopImmediatePropagation` keeps it from also acknowledging the
   * session; `S` allows for the session rather than photographing the office.
   * Whenever `permissionKeyDecision()` says null this handler touches nothing
   * and app.js's bindings fire exactly as they do with no card on screen —
   * which is every press of `Shift+S`, card or no card.
   *
   * All of that rule lives in `permissionKeyDecision()` above; this reads the
   * four DOM facts it needs and acts on the answer.
   */
  document.addEventListener('keydown', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const tag = t?.tagName;
    const decision = permissionKeyDecision(e, {
      panelOpen: !root.hidden && Boolean(currentId) && Boolean(displayedAgent),
      typing: tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(t?.isContentEditable),
      dialogOpen: Boolean(document.querySelector('dialog[open]')),
      pending: pendingPermission(),
    });
    if (!decision) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    answerPermission(decision);
  });

  /**
   * The number keys, 1/2/3, from app.js's keydown handler — which already
   * stays inert while focus is in the composer or any text control. `1` only
   * moves focus, `2` is a send, and `3` is the one that reaches
   * performAction(), as an explicit keystroke equivalent to its button.
   *
   * `targetId` is WP-10's deck and queue strip: the same three keys, on the
   * row under the cursor, without opening it first. `1` is the exception and
   * has to open — a reply needs somewhere to type, and the composer is in the
   * panel.
   * @param {string} key
   * @param {string|null} [targetId]
   */
  function pressNumberKey(key, targetId) {
    const id = targetId || currentId;
    const agent = agentFor(id);
    if (!id || !agent) return;
    if (!targetId && root.hidden) return;
    switch (String(key)) {
      case '1':
        if (id !== currentId) open(id);
        focusComposer();
        break;
      case '2':
        approve(id);
        break;
      case '3':
        performAction(thirdAction(agent), id);
        break;
      default:
        break;
    }
  }

  function focusComposer() {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function approveText() {
    const s = getSnapshot()?.settings?.approveText;
    return typeof s === 'string' && s.trim() ? s.trim() : DEFAULT_APPROVE_TEXT;
  }

  /**
   * `2 Approve`: send the configurable affirmative, exactly as if it had been
   * typed. A send, not an ack — see the module note. `id` is WP-10's deck
   * row, which need not be the row the panel is showing.
   * @param {string|null} [id]
   */
  function approve(id) {
    return sendText(approveText(), { approve: true, id });
  }

  /**
   * Resume the current session through POST /api/resume. Picking either
   * target also saves it as the new default for next time (POST
   * /api/settings) — see renderResume() above. The saved-default POST is
   * fire-and-forget: the next snapshot carries the daemon's own copy of the
   * setting regardless, so there is nothing here to await or roll back.
   * @param {'app'|'terminal'} target
   */
  async function resumeSession(target) {
    const id = currentId;
    if (!id) return;
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(target === 'app' ? 'Opened in the desktop app' : 'Opened in terminal');
    } catch (err) {
      toast(`Could not resume: ${err.message}`, { isError: true });
      return;
    }

    const preference = getSnapshot()?.settings?.resumeIn === 'app' ? 'app' : 'terminal';
    if (target === preference) return;
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeIn: target }),
    }).catch((err) => console.debug('[deckhq] could not save resume preference', err));
  }

  /**
   * Whether "resume in app" should be offered for this agent, from the
   * daemon's own registry-backed check (GET /api/resume-targets) — never
   * guessed client-side. Purely decorative on failure: if the check itself
   * fails, the app option just stays hidden, same as if it had reported
   * unavailable.
   * @param {string} id
   */
  async function loadResumeTargets(id) {
    const token = ++resumeTargetsToken;
    let available = false;
    try {
      const res = await fetch(`/api/resume-targets?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      available = Boolean(res.ok && body.appAvailable);
    } catch {
      available = false;
    }
    if (token !== resumeTargetsToken) return; // a newer open() superseded this fetch
    resumeAppAvailable = available;
    if (currentId && displayedAgent) renderResume();
  }

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

  /** @param {boolean} busy @param {string} [label] */
  function setComposerBusy(busy, label) {
    textarea.disabled = busy;
    sendBtn.disabled = busy;
    for (const b of actionsEl.querySelectorAll('.btn--weighted')) b.disabled = busy;
    hintEl.textContent = busy ? label || 'Sending…' : '';
    hintEl.classList.remove('is-warn');
  }

  /**
   * One send path for the composer and for `2 Approve`.
   *
   * WP-09. `POST /api/send` answers **202** as soon as the daemon has the
   * turn, so the composer is held only for as long as that round trip takes
   * — not for the whole turn, which is up to ten minutes and which the user
   * used to spend looking at a disabled box reading "Sending…". The reply
   * itself arrives afterwards on the panel's SSE connection and fills the
   * live region under WHAT IT SAID (`onSendEvent` below).
   *
   * On failure the composer's own text is restored so nothing is lost —
   * whether the failure is the request itself or a `send` event that arrives
   * seconds later saying the runtime refused. An approval that fails simply
   * reports it.
   *
   * `o.id` sends to a row the panel is not showing — WP-10's `2 Approve`
   * from the deck. The composer belongs to the open row, so it is neither
   * cleared nor held busy in that case; the toast is the feedback.
   *
   * Passive with respect to ack state, like everything else here: this
   * reaches /api/send and nothing else. `2 Approve` is a send, never an ack.
   * @param {string} text
   * @param {{approve?: boolean, id?: string|null}} [o]
   */
  async function sendText(text, o = {}) {
    if (sending) return;
    const id = o.id || currentId;
    const agent = agentFor(id);
    if (!id || !agent) return;
    if (!text.trim()) return;
    if (getSnapshot()?.demo) return toast(DEMO_REFUSAL);
    const inPanel = id === currentId && !root.hidden;

    // Mid-turn means actively producing output. A finished turn standing for
    // review, or a hand up waiting for an answer, is exactly when a reply is
    // wanted — no second keystroke there.
    if (agent.live && agent.activityState === 'working') {
      const proceed = window.confirm(
        'This session is currently live and may be mid-turn. Send anyway?',
      );
      if (!proceed) return;
    }

    const fromComposer = !o.approve;
    sending = true;
    if (inPanel) setComposerBusy(true, o.approve ? `Sending “${text}”…` : 'Sending…');
    if (fromComposer) {
      textarea.value = '';
      drafts.clear(id);
      renderDraftChip();
      onDraftChange?.(id, false);
    }

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(o.approve ? `Approved — sent “${text}” to ${who(agent)}` : 'Message sent');
      if (o.approve) announce(`${who(agent)}: approved`);
      // The turn is accepted, not finished. Hold on to what was sent so the
      // stream's own failure can still put it back, and start the live row.
      if (body.sendId) {
        streaming = { sendId: String(body.sendId), id, text, fromComposer };
        if (currentId === id) beginLive();
      }
    } catch (err) {
      restoreComposer(id, text, fromComposer);
      if (inPanel) {
        hintEl.textContent = `Could not send: ${err.message}`;
        hintEl.classList.add('is-warn');
      }
      toast(`Could not send: ${err.message}`, { isError: true });
    } finally {
      // The composer comes back the moment the turn is ACCEPTED. This is the
      // whole point of the package.
      sending = false;
      if (inPanel) setComposerBusy(false);
      if (hintEl.textContent === '' && !sending) hintEl.classList.remove('is-warn');
    }
  }

  /**
   * Put a failed send's text back where the user typed it. Only for the
   * composer's own sends: `2 Approve` never took anything out of the box, so
   * it has nothing to give back.
   * @param {string} id
   * @param {string} text
   * @param {boolean} fromComposer
   */
  function restoreComposer(id, text, fromComposer) {
    if (!fromComposer || currentId !== id) return;
    // Never overwrite something typed since. The reply that failed is the
    // one being restored; a newer draft is the user's more recent intent.
    if (textarea.value.trim()) return;
    textarea.value = text;
    drafts.save(id, text);
    renderDraftChip();
    onDraftChange?.(id, true);
  }

  // ------------------------------------------------------------- streaming

  /** Show the live row, empty, with the typing state on it. */
  function beginLive() {
    liveBody.textContent = '';
    liveTools.textContent = '';
    liveTools.hidden = true;
    liveWho.textContent = displayedAgent ? who(displayedAgent) : 'Agent';
    liveRow.classList.add('is-typing');
    liveSection.hidden = false;
  }

  /** Take the live row down. */
  function endLive() {
    liveRow.classList.remove('is-typing');
    liveSection.hidden = true;
    liveBody.textContent = '';
    liveTools.textContent = '';
    liveTools.hidden = true;
  }

  /**
   * One `send` event off the SSE channel. Everything it writes to the DOM is
   * `textContent`; see the live region's own note for why the streamed half
   * of a reply is deliberately not put through the markdown renderer.
   * @param {any} event
   */
  function onSendEvent(event) {
    if (!streaming || !event || event.sendId !== streaming.sendId) return;
    const id = streaming.id;
    switch (event.type) {
      case 'accepted':
      case 'status':
        return;
      case 'delta':
        if (typeof event.text === 'string') liveBody.textContent += event.text;
        return;
      case 'text':
        // A runtime that gave whole messages rather than fragments. Same
        // region, same rule.
        if (typeof event.text === 'string') {
          liveBody.textContent += (liveBody.textContent ? '\n\n' : '') + event.text;
        }
        return;
      case 'tool':
        if (typeof event.summary === 'string' && event.summary) {
          const line = document.createElement('div');
          line.className = 'review-live-tool';
          line.textContent = event.summary;
          liveTools.appendChild(line);
          liveTools.hidden = false;
        }
        return;
      case 'turn':
        liveBody.textContent += '\n\n';
        return;
      case 'error':
        restoreComposer(id, streaming.text, streaming.fromComposer);
        if (currentId === id && !root.hidden) {
          hintEl.textContent = `Could not send: ${event.error || 'the turn failed'}`;
          hintEl.classList.add('is-warn');
        }
        toast(`Could not send: ${event.error || 'the turn failed'}`, { isError: true });
        return;
      case 'result':
        if (!event.ok) return; // the `error` event above carries the reason
        return;
      case 'done':
        streaming = null;
        endLive();
        // The canonical text, rendered as markdown from the transcript the
        // runtime actually wrote. A passive GET; it touches no ack state.
        if (currentId === id) loadConversation(id);
        return;
      default:
        return;
    }
  }

  /**
   * Re-read the conversation because the transcript moved. Debounced, and
   * suppressed while a turn is streaming — the live region is the truth for
   * those seconds, and `done` re-reads once at the end anyway.
   * @param {string} id
   */
  function onTranscriptChange(id) {
    if (id !== currentId || streaming) return;
    if (tailTimer) clearTimeout(tailTimer);
    tailTimer = setTimeout(() => {
      tailTimer = null;
      // Reading a conversation is passive. THE INVARIANT: no ack call here.
      if (currentId === id) loadConversation(id);
    }, 120);
  }

  /**
   * The panel's own SSE connection: send progress, and the transcript tail
   * for the session on screen.
   *
   * It is a second connection to the SAME endpoint app.js already uses, with
   * `?stream=send`. That filter is why it is affordable: without it the
   * daemon would serialise the whole floor snapshot twice on every scan for a
   * listener that reads neither copy. app.js owns the snapshot connection and
   * is another package's file this one may not edit (WP-57), so the panel
   * opens its own rather than reaching into it.
   * @param {string|null} id
   */
  function watchLive(id) {
    if (id === liveWatching && liveSource) return;
    closeLive();
    liveWatching = id;
    if (!id) return;
    openLive();
  }

  function openLive() {
    if (!liveWatching || typeof EventSource !== 'function') return;
    const url = `/api/events?stream=send&watch=${encodeURIComponent(liveWatching)}`;
    const es = new EventSource(url);
    liveSource = es;
    es.addEventListener('send', (ev) => {
      liveBackoff = 1000;
      try {
        onSendEvent(JSON.parse(/** @type {MessageEvent} */ (ev).data));
      } catch (err) {
        console.debug('[deckhq] malformed send event', err);
      }
    });
    es.addEventListener('transcript', (ev) => {
      liveBackoff = 1000;
      try {
        const data = JSON.parse(/** @type {MessageEvent} */ (ev).data);
        onTranscriptChange(String(data.id || ''));
      } catch (err) {
        console.debug('[deckhq] malformed transcript event', err);
      }
    });
    es.onerror = () => {
      // Quietly, with backoff, exactly like app.js's own connection. A panel
      // that cannot hold this open still works: it just stops being live.
      es.close();
      if (liveSource === es) liveSource = null;
      if (liveRetryTimer) clearTimeout(liveRetryTimer);
      liveRetryTimer = setTimeout(openLive, liveBackoff);
      liveBackoff = Math.min(liveBackoff * 2, 30000);
    };
  }

  function closeLive() {
    if (liveRetryTimer) clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveBackoff = 1000;
    if (tailTimer) clearTimeout(tailTimer);
    tailTimer = null;
    try {
      liveSource?.close();
    } catch (err) {
      console.debug('[deckhq] could not close the live stream', err);
    }
    liveSource = null;
    liveWatching = null;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendText(textarea.value);
  });

  // Every keystroke in the composer is a draft. Saving is local and cheap;
  // the chip and the client-state flag follow it.
  textarea.addEventListener('input', () => {
    const id = currentId;
    if (!id) return;
    const had = drafts.has(id);
    drafts.save(id, textarea.value);
    const has = drafts.has(id);
    renderDraftChip();
    if (had !== has) onDraftChange?.(id, has);
  });

  // --------------------------------------------------------------- public

  /**
   * Open the panel on an agent. Purely a read/render operation: it fetches
   * the conversation and the working-tree summary (both GETs) and renders
   * current facts. It must never call /api/ack — opening a conversation is
   * exactly the passive interaction the invariant forbids from clearing
   * reviewSince.
   * @param {string} id
   */
  function open(id) {
    const snapshot = getSnapshot();
    const agent = snapshot?.agents?.find((a) => a.id === id);
    if (!agent) return;
    const switching = currentId !== id;
    currentId = id;
    displayedAgent = agent;
    root.hidden = false;
    textarea.value = drafts.load(id);
    hintEl.textContent = '';
    hintEl.classList.remove('is-warn');
    // Unknown again until loadResumeTargets() below resolves — cleared here
    // so a previous agent's "resume in app" never flashes onto this one.
    resumeAppAvailable = false;
    if (switching) {
      changesScannedAt = undefined;
      changedEl.textContent = '';
      changedTotals.textContent = '';
      // Which diffs are open belongs to the session being reviewed, not to
      // the panel: another agent's expanded rows are not this one's.
      expandedFiles.clear();
      fileRows = [];
      // A reply streaming into the row we just left keeps running on the
      // daemon; what it must not do is keep writing into a card showing
      // somebody else.
      endLive();
    }
    // WP-09 · watch this session's transcript so a reply typed in a terminal
    // appears here without a poll, and receive send progress on the same
    // connection. Passive: it reads a file and pushes a digest.
    watchLive(id);
    renderChrome();
    loadConversation(id);
    loadChanges(id, snapshot?.scannedAt ?? null);
    loadResumeTargets(id);
    loadTeamRecords();
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = setInterval(renderWaiting, WAITING_TICK_MS);
  }

  function close() {
    currentId = null;
    displayedAgent = null;
    messages = null;
    // The card belongs to the daemon's hold, not to this panel: closing the
    // panel neither answers it nor withdraws it. Only the local view resets.
    answering = false;
    announcedPermissionId = null;
    permissionSection.hidden = true;
    changesScannedAt = undefined;
    expandedFiles.clear();
    fileRows = [];
    stopCloseUp();
    // Close the tail watch with the card. The daemon stops watching the file
    // the moment this connection drops, so a closed panel costs nothing.
    closeLive();
    endLive();
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = null;
    setMoreOpen(false);
    root.hidden = true;
    onClosed?.();
  }

  /**
   * Called by app.js on every new snapshot. Purely re-renders from the
   * latest authoritative data — it never issues a write. If the daemon's
   * real state has caught up with (or diverged from) our optimistic guess,
   * the authoritative snapshot always wins here.
   */
  function refresh() {
    if (!currentId || root.hidden) return;
    const snapshot = getSnapshot();
    const fresh = snapshot?.agents?.find((a) => a.id === currentId);
    if (!fresh) {
      // The agent is no longer on the floor (e.g. let_go with "show let go"
      // off). Keep showing what we last knew rather than yanking the panel
      // away mid-read.
      return;
    }
    displayedAgent = fresh;
    renderChrome();
    // A new scan may mean a new diff; the daemon answers from cache otherwise.
    loadChanges(currentId, snapshot?.scannedAt ?? null);
  }

  function getSelectedId() {
    return currentId;
  }

  /** @param {string} id */
  function hasDraft(id) {
    return drafts.has(id);
  }

  function destroy() {
    stopCloseUp();
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = null;
  }

  return {
    open,
    close,
    refresh,
    performAction,
    pressNumberKey,
    getSelectedId,
    hasDraft,
    teamRecords,
    destroy,
  };
}

// ------------------------------------------------------------- utilities

/** The compact name for toasts and placeholders: display name, else MK tag. */
function who(a) {
  return a?.displayName || a?.label || a?.mk || a?.title || 'this session';
}

/** "claude-opus-5" reads as "opus-5" on a line that already says Claude Code. */
function shortModel(model) {
  if (!model) return null;
  return String(model).replace(/^claude-/, '');
}

/** @param {number} n */
function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/** 1,440,000 → "1.44M"; 12,300 → "12.3k"; small numbers stay whole. */
function formatCompact(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

/** @param {number} n */
function formatCost(n) {
  return `≈ $${Number(n || 0).toFixed(2)}`;
}

/**
 * The bottom line of the review card, as the parts the renderer joins with
 * `·` (WP-26).
 *
 * Three obligations, and none of them is optional:
 *
 *   1. **It names its source.** `rate card 2026-09-04` is the dated table in
 *      `src/data/rates.json` — or the user's own `~/.deckhq/rates.json`, in
 *      which case the version carries their date or `+local`. A cost figure
 *      whose table nobody can name is a figure nobody can check.
 *   2. **It says what kind of number it is.** `list price`, and `not a bill`
 *      in as many words. `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 7.
 *   3. **It refuses to invent one.** A model the rate card has no row for
 *      reads `no rate for this model`, never `$0.00`. Zero is a claim about
 *      the money and we do not have one.
 *
 * Exported for `test/unit/rates.test.mjs`, which asserts every branch of it
 * carries "list price" or "estimate" and never "bill" without "not a".
 *
 * @param {{costEstimate?:number|null}} agent
 * @param {string|null|undefined} version
 * @returns {string[]}
 */
export function costLineParts(agent, version) {
  const card = `rate card ${version || 'unknown'}`;
  const usd = agent ? agent.costEstimate : null;
  if (usd == null || !Number.isFinite(Number(usd))) {
    return ['no rate for this model', card, 'estimate unavailable'];
  }
  return [formatCost(usd), `list price, ${card}`, 'not a bill'];
}

/**
 * The same three obligations, for a whole room rather than one session: the
 * project board's cost strings (WP-26).
 *
 * It lives beside {@link costLineParts} rather than in `app.js` because the
 * copy rule is the thing being shared, not the DOM — one definition of "what a
 * cost figure must say about itself", read by both surfaces and scanned as
 * text by `test/unit/rates.test.mjs`. The board sums per-session estimates, so
 * `cost` is `null` when NOTHING in the room could be priced: a room of unknown
 * models sums to zero, and zero is a claim about the money nobody has.
 *
 * Three strings because the board reads them in three places, and two of them
 * travel alone:
 *
 *   - `tile` sits under its own `Est. cost` label in the tile grid;
 *   - `total` is the board's bottom line, beside the token total;
 *   - `note` is the sentence under the whole board, and is the one that names
 *     the dated table every figure above it came from.
 *
 * @param {number|null|undefined} cost the room's summed estimate, or null
 * @param {string|null|undefined} version the snapshot's `rateCardVersion`
 * @returns {{tile:string, total:string, note:string}}
 */
export function boardCostParts(cost, version) {
  const card = `rate card ${version || 'unknown'}`;
  if (cost == null || !Number.isFinite(Number(cost))) {
    return {
      tile: 'no rate',
      total: 'no rate · estimate unavailable',
      note: `No model in this room is in the ${card}, so there is no cost estimate here. Esc closes.`,
    };
  }
  return {
    tile: formatCost(cost),
    total: `${formatCost(cost)} · list price`,
    note: `Cost is an estimate at public list prices, not a bill · ${card}. Esc closes.`,
  };
}

/** @param {number} ms */
function formatElapsed(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** @param {string} state */
function stateColor(state) {
  return paletteModule?.STATE_COLORS?.[state] || FALLBACK_STATE_COLORS[state] || '#888888';
}

/**
 * The rarity word for one agent, or null — for a common agent, and for as
 * long as `render/palette.js` has not loaded (it is a dynamic, defensive
 * import; see the file header). Absent rather than wrong is the right failure
 * here: the word is a grace note, not information the user needs.
 * @param {any} agent
 * @returns {string|null}
 */
function rarityWordFor(agent) {
  if (!agent || !paletteModule?.appearanceFor || !paletteModule?.rarityWord) return null;
  try {
    return paletteModule.rarityWord(paletteModule.appearanceFor(agent.id).tier);
  } catch (err) {
    console.debug('[deckhq] rarityWord failed', err);
    return null;
  }
}
