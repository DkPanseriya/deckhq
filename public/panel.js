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
 *
 * ============================================================================
 * WP-22 follow-up · this file is the composition root. It owns the panel's
 * lifecycle — open, close, refresh, destroy — and the two `document`-level
 * listeners whose registration ORDER is a rule (docs/DEVIATIONS.md §86 and
 * §122 rule 1): the A/D/S handler below is registered while the panel is
 * built, which is before app.js registers its own, and that is what lets a
 * permission card take those keys while it is up and lets them fall through
 * when it is not. Not one of them moved.
 *
 * The card itself is thirteen modules, each re-exported or wired from here:
 *
 *   panel-rules.js       the label tables and the four pure rules
 *   panel-format.js      how a name, a number and a cost are said
 *   panel-state.js       which session, and the agent being shown
 *   panel-dom.js         every element the card is made of
 *   panel-header.js      the header, its live lines, and the close-up
 *   panel-permission.js  WP-19's card and its own funnel
 *   panel-said.js        WHAT IT SAID and the thread under it
 *   panel-changes.js     WHAT CHANGED, the diffs, and the editor link
 *   panel-actions.js     the weighted buttons, ⋯ more, and 1/2/3
 *   panel-resume.js      resume in app / in terminal
 *   panel-records.js     WP-46's records line
 *   panel-traits.js      WP-28's trait line
 *   panel-composer.js    the composer and the one send path
 *   panel-live.js        WP-09's live region and the panel's SSE connection
 * ============================================================================
 */

import { drafts } from './drafts.js';
import { permissionKeyDecision } from './panel-rules.js';
import { WAITING_TICK_MS } from './panel-rules.js';
import { currentId, displayedAgent, setCurrentId, setDisplayedAgent } from './panel-state.js';
import { buildPanelDom } from './panel-dom.js';
import { createHeaderPart } from './panel-header.js';
import {
  createPermissionPart,
  setAnswering,
  setAnnouncedPermissionId,
} from './panel-permission.js';
import { createSaidPart, setMessages } from './panel-said.js';
import {
  createChangesPart,
  expandedFiles,
  setChangesScannedAt,
  setFileRows,
} from './panel-changes.js';
import { createActionsPart } from './panel-actions.js';
import { createResumePart, setResumeAppAvailable } from './panel-resume.js';
import { createRecordsPart } from './panel-records.js';
import { createTraitsPart } from './panel-traits.js';
import { createComposerPart } from './panel-composer.js';
import { createLivePart } from './panel-live.js';

// Everything the panel used to define itself, re-exported from where it now
// lives, so every existing import of this module resolves exactly as before.
export { permissionKeyDecision } from './panel-rules.js';
export { juniorMetaFor, costLineParts, boardCostParts } from './panel-format.js';

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
 * @param {(map:Record<string,string|null>) => void} [opts.onTendencies] WP-28.
 *   The floor's idle tendencies arrived with `GET /api/traits`. A hint about
 *   which existing idle clip an agent leans on, and nothing else.
 */
export function createPanel(opts) {
  const {
    root,
    getSnapshot,
    toast,
    announce,
    onClosed,
    onNewAgent,
    onRename,
    onDraftChange,
    onTendencies,
  } = opts;

  /** The clock behind the "waiting 1d 2h" line, while the panel is open. */
  let waitingTimer = null;

  // ---------------------------------------------------------------- build
  //
  // The elements themselves are `panel-dom.js`; what is here is the two
  // listeners that reach back into this file's own behaviour, and the append
  // that puts the card into the root the caller handed us.
  root.textContent = '';
  const dom = buildPanelDom();
  const {
    top,
    body,
    actionsWrap,
    form,
    foot,
    renameBtn,
    closeBtn,
    moreMenu,
    permissionSection,
    changedEl,
    changedTotals,
    textarea,
    hintEl,
  } = dom;

  renameBtn.addEventListener('click', () => {
    if (displayedAgent) onRename?.(displayedAgent);
  });
  closeBtn.addEventListener('click', () => close());

  root.append(top, body, actionsWrap, form, foot);

  // ------------------------------------------------------------ the parts

  const header = createHeaderPart({ ...dom, getSnapshot });
  const permission = createPermissionPart({ ...dom, toast, announce });
  const said = createSaidPart({ ...dom, getSnapshot });
  const changes = createChangesPart({ ...dom, getSnapshot, toast });
  const actions = createActionsPart({
    ...dom,
    root,
    getSnapshot,
    toast,
    announce,
    onNewAgent,
    onRename,
  });
  const resume = createResumePart({ ...dom, getSnapshot, toast });
  const records = createRecordsPart({ ...dom });
  const traits = createTraitsPart({ ...dom, onTendencies });
  const composer = createComposerPart({
    ...dom,
    root,
    getSnapshot,
    toast,
    announce,
    onDraftChange,
  });
  const live = createLivePart({ ...dom, root, toast });

  const {
    renderChrome,
    renderWaiting,
    renderDraftChip,
    loadRenderModules,
    startCloseUp,
    stopCloseUp,
  } = header;
  const { pendingPermission, renderPermission, answerPermission } = permission;
  const { loadConversation } = said;
  const { loadChanges } = changes;
  const { performAction, pressNumberKey, agentFor, setMoreOpen } = actions;
  const { loadResumeTargets } = resume;
  const { loadTeamRecords, teamRecords } = records;
  const { loadTraits, agentTraits } = traits;
  const { sendText, restoreComposer } = composer;
  const { beginLive, endLive, watchLive, closeLive } = live;

  // The one-way wiring of docs/DEVIATIONS.md §122 rule 3: where a part needs
  // a sibling's function it is handed in under the identifier the body
  // already used, never imported back.
  header.wire({
    renderPermission,
    renderActions: actions.renderActions,
    renderResume: resume.renderResume,
    renderRecordLine: records.renderRecordLine,
    renderTraitLine: traits.renderTraitLine,
  });
  actions.wire({ pendingPermission, renderChrome, sendText, open });
  composer.wire({ renderDraftChip, agentFor, beginLive });
  live.wire({ loadConversation, restoreComposer });

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
    setCurrentId(id);
    setDisplayedAgent(agent);
    root.hidden = false;
    textarea.value = drafts.load(id);
    hintEl.textContent = '';
    hintEl.classList.remove('is-warn');
    // Unknown again until loadResumeTargets() below resolves — cleared here
    // so a previous agent's "resume in app" never flashes onto this one.
    setResumeAppAvailable(false);
    if (switching) {
      setChangesScannedAt(undefined);
      changedEl.textContent = '';
      changedTotals.textContent = '';
      // Which diffs are open belongs to the session being reviewed, not to
      // the panel: another agent's expanded rows are not this one's.
      expandedFiles.clear();
      setFileRows([]);
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
    loadTraits();
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = setInterval(renderWaiting, WAITING_TICK_MS);
  }

  function close() {
    setCurrentId(null);
    setDisplayedAgent(null);
    setMessages(null);
    // The card belongs to the daemon's hold, not to this panel: closing the
    // panel neither answers it nor withdraws it. Only the local view resets.
    setAnswering(false);
    setAnnouncedPermissionId(null);
    permissionSection.hidden = true;
    setChangesScannedAt(undefined);
    expandedFiles.clear();
    setFileRows([]);
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
    setDisplayedAgent(fresh);
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
    agentTraits,
    destroy,
  };
}
