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
/** The close-up's on-screen size, docs/plan/05-GUI-UX-SPEC.md §4.2. */
const CLOSEUP_PX = 44;
/** How often the "waiting …" line re-reads the clock while the panel is open. */
const WAITING_TICK_MS = 30_000;

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

  top.append(identityRow, titleEl, metaEl, waitingEl, doingEl);

  // The scrolling body: WHAT IT SAID, the rest of the thread folded beneath
  // it, then WHAT CHANGED.
  const body = document.createElement('div');
  body.className = 'panel-body';
  body.tabIndex = 0;
  body.setAttribute('aria-label', 'Review');

  const saidSection = document.createElement('section');
  saidSection.className = 'review-section';
  const saidHeading = document.createElement('h3');
  saidHeading.className = 'review-heading';
  saidHeading.textContent = 'What it said';
  const saidEl = document.createElement('div');
  saidEl.className = 'review-said';
  saidSection.append(saidHeading, saidEl);

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

  body.append(saidSection, threadDetails, changedSection);

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
    if (a.displayName) {
      const nameEl = document.createElement('span');
      nameEl.className = 'mk-chip-label';
      nameEl.textContent = a.displayName;
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
    renderDraftChip();

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

    changedHeading.textContent = `What changed in ${a.projectName || 'this project'}`;
    textarea.placeholder = `Reply to ${who(a)}…`;

    // Costs are context, not the subject: one line, at the bottom, and the
    // cost is a list-price estimate for comparing projects, NEVER a bill.
    costEl.textContent = '';
    for (const [i, part] of [
      `${formatNumber(a.tokens)} tok`,
      `${formatCompact(a.cacheTokens)} cache`,
      `${formatCost(a.costEstimate)} list price · not a bill`,
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
    const approveBtn = weightedButton('2', 'Approve', 'btn btn--primary', () => approve());
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
   * The single funnel for the six user-owned actions (docs/02-ARCHITECTURE
   * §5.1). This is the ONLY function in the client that calls POST
   * /api/ack. It is invoked exclusively from:
   *   - an explicit click on a button built in renderActions() above,
   *   - the `3` number key, via pressNumberKey() below, or
   *   - app.js's keydown handler for the explicit 'A'/'B' shortcuts.
   * It is never called from open(), refresh(), or any rendering/selection
   * path. Optimistic update with rollback on failure, per WP9.
   * @param {string} action
   */
  async function performAction(action) {
    const id = currentId;
    if (!id || !displayedAgent) return;
    if (!legalActions(displayedAgent).includes(action)) return;

    const rollback = displayedAgent;
    displayedAgent = optimisticPatch(displayedAgent, action);
    renderChrome();

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
      const name = who(displayedAgent);
      toast(
        action === 'bench'
          ? `Benched. ${name} is in the lounge.`
          : action === 'recall'
            ? `Recalled. ${name} is back on the floor.`
            : `${ACTION_LABELS[action]} — done`,
      );
      announce(`${name}: ${ACTION_LABELS[action].toLowerCase()}`);
    } catch (err) {
      displayedAgent = rollback;
      renderChrome();
      toast(`Could not ${ACTION_LABELS[action].toLowerCase()}: ${err.message}`, { isError: true });
    }
  }

  /**
   * The number keys, 1/2/3, from app.js's keydown handler — which already
   * stays inert while focus is in the composer or any text control. `1` only
   * moves focus, `2` is a send, and `3` is the one that reaches
   * performAction(), as an explicit keystroke equivalent to its button.
   * @param {string} key
   */
  function pressNumberKey(key) {
    if (root.hidden || !currentId || !displayedAgent) return;
    switch (String(key)) {
      case '1':
        focusComposer();
        break;
      case '2':
        approve();
        break;
      case '3':
        performAction(thirdAction(displayedAgent));
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
   * typed. A send, not an ack — see the module note.
   */
  function approve() {
    return sendText(approveText(), { approve: true });
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

  /** @param {boolean} busy @param {string} [label] */
  function setComposerBusy(busy, label) {
    textarea.disabled = busy;
    sendBtn.disabled = busy;
    for (const b of actionsEl.querySelectorAll('.btn--weighted')) b.disabled = busy;
    hintEl.textContent = busy ? label || 'Sending…' : '';
    hintEl.classList.remove('is-warn');
  }

  /**
   * One send path for the composer and for `2 Approve`. Runs the turn
   * through POST /api/send; the composer is held while it runs (WP-09 will
   * stream instead). On failure the composer's own text is restored so
   * nothing is lost; an approval that fails simply reports it.
   * @param {string} text
   * @param {{approve?: boolean}} [o]
   */
  async function sendText(text, o = {}) {
    if (sending) return;
    const id = currentId;
    const agent = displayedAgent;
    if (!id || !agent) return;
    if (!text.trim()) return;

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
    setComposerBusy(true, o.approve ? `Sending “${text}”…` : 'Sending…');
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
      if (currentId === id) await loadConversation(id);
    } catch (err) {
      if (fromComposer && currentId === id) {
        // On failure, restore the composer content so nothing is lost.
        textarea.value = text;
        drafts.save(id, text);
        renderDraftChip();
        onDraftChange?.(id, true);
      }
      hintEl.textContent = `Could not send: ${err.message}`;
      hintEl.classList.add('is-warn');
      toast(`Could not send: ${err.message}`, { isError: true });
    } finally {
      sending = false;
      setComposerBusy(false);
      if (hintEl.textContent === '' && !sending) hintEl.classList.remove('is-warn');
    }
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
    }
    renderChrome();
    loadConversation(id);
    loadChanges(id, snapshot?.scannedAt ?? null);
    loadResumeTargets(id);
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = setInterval(renderWaiting, WAITING_TICK_MS);
  }

  function close() {
    currentId = null;
    displayedAgent = null;
    messages = null;
    changesScannedAt = undefined;
    expandedFiles.clear();
    fileRows = [];
    stopCloseUp();
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

  return { open, close, refresh, performAction, pressNumberKey, getSelectedId, hasDraft, destroy };
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
