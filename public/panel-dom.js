/**
 * Every element the review card is made of (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged, and built once: the panel is a
 * singleton by construction — it registers a `document` keydown listener and
 * gives its composer the fixed id `panel-input`, so a second one was never
 * possible — and the nodes stay detached until `panel.js` appends them to the
 * root it was handed.
 *
 * The three listeners that reach back into the panel's own behaviour are NOT
 * here: rename and close are registered by `panel.js`, `[ expand all ]` by
 * `panel-changes.js`. Each is a listener on an element of its own, where
 * nothing about registration order can matter (docs/DEVIATIONS.md §122,
 * rule 1). Everything here is `document.createElement` and `textContent`;
 * no string in this file is ever treated as markup.
 */

import { CLOSEUP_PX } from './panel-rules.js';

/**
 * Builds the card. Called once by `createPanel()`: the panel is a singleton
 * by construction — it registers a `document` keydown listener and gives its
 * composer the fixed id `panel-input`, so a second one was never possible —
 * and every node stays detached until `panel.js` appends the five roots to
 * the element it was handed.
 *
 * The elements are handed to the parts as their `ctx`, which is why nothing
 * here runs at import time: `public/panel.js` is imported under `node --test`
 * by three suites that want its pure re-exports and have no DOM at all.
 */
export function buildPanelDom() {
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

  // WP-28 · the agent's traits, as one quiet line under the identity area:
  // "asks often · shell-heavy · terse · opus-5 · since 1 Sep". Read-only,
  // inferred from real behaviour, never trained and never affecting anything
  // (docs/plan/04 §4). Every word in it is about the AGENT; the person
  // reading it is never described, scored or counted (docs/plan/08 §1.1
  // rule 6). The strings come off the daemon and are set with `textContent`.
  const traitEl = document.createElement('div');
  traitEl.className = 'panel-traits';
  traitEl.hidden = true;

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

  top.append(identityRow, titleEl, metaEl, traitEl, waitingEl, doingEl, recordEl);

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

  return {
    top,
    identityRow,
    closeupWrap,
    closeupCanvas,
    mkChip,
    draftChip,
    identitySpacer,
    renameBtn,
    closeBtn,
    titleEl,
    metaEl,
    traitEl,
    waitingEl,
    doingEl,
    recordEl,
    body,
    permissionSection,
    permissionHeading,
    permissionTool,
    permissionInput,
    permissionActions,
    permissionNote,
    saidSection,
    saidHeading,
    saidEl,
    liveSection,
    liveRow,
    liveWho,
    liveBody,
    liveTools,
    threadDetails,
    threadSummary,
    threadEl,
    changedSection,
    changedHeadRow,
    changedHeading,
    changedTotals,
    changedEl,
    changedFoot,
    expandAllBtn,
    actionsWrap,
    actionsEl,
    moreMenu,
    form,
    inputLabel,
    textarea,
    composerRow,
    hintEl,
    sendBtn,
    foot,
    costEl,
    resumeEl,
  };
}

// --------------------------------------------------------- small builders
//
// Three element factories the parts share. They read nothing and decide
// nothing, so they are plain module functions rather than anything a part has
// to be handed.

/** @param {string} text */
export function textNode(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

export function separator() {
  const s = document.createElement('span');
  s.className = 'sep';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = '·';
  return s;
}

export function threadSkeleton() {
  const wrap = document.createElement('div');
  wrap.className = 'thread-skeleton';
  for (let i = 0; i < 4; i++) {
    const line = document.createElement('div');
    line.className = 'sk-line';
    wrap.appendChild(line);
  }
  return wrap;
}
