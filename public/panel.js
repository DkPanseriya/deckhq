/**
 * DeckHQ session side panel.
 *
 * docs/01-PRODUCT.md §2 (THE INVARIANT), docs/02-ARCHITECTURE.md §5.1,
 * docs/03-VISUAL-SPEC.md §8, docs/04-BUILD-PLAN.md WP9.
 *
 * ============================================================================
 * THE INVARIANT: opening this panel, reading the conversation, hovering,
 * scrolling and selecting must NEVER clear `reviewSince`/`needsInputSince`
 * or send any /api/ack request. Only an explicit button press (or the
 * equivalent explicit keyboard shortcut in app.js, routed through
 * performAction below) may do that. Every function in this file that
 * touches rendering, fetching, or scrolling carries a reminder comment
 * where it would be tempting to "helpfully" wire an ack call in.
 * ============================================================================
 *
 * `performAction()` is the ONLY place in this module — and, together with
 * app.js's keydown handler for A/B, the only place in the whole client —
 * that calls POST /api/ack. It is invoked exclusively from explicit button
 * click handlers built below and from app.js's explicit keyboard shortcuts.
 * It is never called from open(), refresh(), render*(), or any scroll/hover
 * listener.
 *
 * All conversation text is rendered with `textContent`, never `innerHTML` —
 * a hard security requirement (docs/02-ARCHITECTURE.md §9).
 */

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
 */
export function createPanel(opts) {
  const { root, getSnapshot, toast, announce, onClosed, onNewAgent, onRename } = opts;

  /** @type {string|null} */
  let currentId = null;
  /** @type {any} the agent object currently displayed, possibly optimistic */
  let displayedAgent = null;
  let sending = false;
  let conversationToken = 0; // guards against a slow fetch clobbering a newer one
  // Whether the daemon has confirmed a claude:// handler exists, for the
  // agent currently open — set only from loadResumeTargets(), never guessed
  // client-side. Starts false so "Resume in app" never flashes on before
  // that check has actually come back positive.
  let resumeAppAvailable = false;
  let resumeTargetsToken = 0; // guards against a slow fetch clobbering a newer one
  let closeUpRaf = null;
  let closeUpStartTs = 0;
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

  const titleRow = document.createElement('div');
  titleRow.className = 'panel-title-row';
  // The identity chip: the literal MK tag always, plus the display name
  // when the user has set one — "the panel keeps the full title as its
  // heading, with the MK tag beside it" (WP15 task B). When there is no
  // display name, agent.label === agent.mk, so this reads as just the tag.
  const mkChip = document.createElement('span');
  mkChip.className = 'mk-chip';
  const titleEl = document.createElement('h2');
  titleEl.className = 'panel-title';
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
  titleRow.append(mkChip, titleEl, renameBtn, closeBtn);

  const metaEl = document.createElement('div');
  metaEl.className = 'panel-meta';

  const factsEl = document.createElement('div');
  factsEl.className = 'panel-facts';

  const closeupWrap = document.createElement('div');
  closeupWrap.className = 'panel-closeup';
  const closeupCanvas = document.createElement('canvas');
  closeupCanvas.width = 160;
  closeupCanvas.height = 160;
  closeupCanvas.setAttribute('aria-hidden', 'true');
  const closeupNote = document.createElement('div');
  closeupNote.className = 'panel-closeup-note';
  closeupNote.textContent = 'Renderer loading…';
  closeupNote.hidden = true;
  closeupWrap.append(closeupCanvas, closeupNote);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'panel-actions';

  // One factual line near the resume control (task: be honest about cost).
  // Reuses .composer-hint's small-muted-mono styling; it is not scoped to
  // the composer row, just a generic "quiet note" look.
  const resumeHintEl = document.createElement('div');
  resumeHintEl.className = 'composer-hint';
  resumeHintEl.textContent =
    'Resuming with the full session, instead of a summary, re-sends its history as context and uses more tokens.';

  top.append(titleRow, metaEl, factsEl, closeupWrap, actionsEl, resumeHintEl);

  const threadEl = document.createElement('div');
  threadEl.className = 'panel-thread';
  threadEl.tabIndex = 0;
  threadEl.setAttribute('aria-label', 'Conversation');

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
  sendBtn.className = 'btn btn--primary';
  sendBtn.textContent = 'Send';
  composerRow.append(hintEl, sendBtn);
  form.append(inputLabel, textarea, composerRow);

  root.append(top, threadEl, form);

  loadRenderModules();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCloseUp();
    else if (currentId && displayedAgent) startCloseUp(displayedAgent);
  });

  // ------------------------------------------------------------ rendering

  /**
   * Passive re-render of everything except the conversation thread. Called
   * from open() and refresh() and after an optimistic patch. Never issues
   * any network write — read-only, by construction.
   */
  function renderChrome() {
    if (!displayedAgent) return;
    const a = displayedAgent;
    titleEl.textContent = a.title;

    // See the module-level note by titleRow's construction: the literal MK
    // tag always shows; the display name (if set) is the label that
    // actually replaced it on the floor, shown alongside the tag rather
    // than instead of it.
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

    metaEl.textContent = '';
    const chip = document.createElement('span');
    chip.className = 'state-chip';
    const icon = document.createElement('span');
    icon.className = 'state-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = STATE_ICON_GLYPH[a.activityState] || '●';
    // No box left to carry the colour as a border (restraint pass), so the
    // icon itself carries it — the text label right beside it is still the
    // non-colour channel (style.css's "never colour alone" discipline).
    icon.style.color = stateColor(a.activityState);
    const label = document.createElement('span');
    label.textContent = STATE_LABELS[a.activityState] || a.activityState;
    chip.append(icon, label);
    metaEl.appendChild(chip);
    metaEl.appendChild(textNode(a.projectName));
    if (a.model) metaEl.appendChild(textNode(a.model));
    if (a.gitBranch) metaEl.appendChild(textNode(a.gitBranch));
    if (a.ackState === 'benched') metaEl.appendChild(textNode('Benched'));
    if (a.ackState === 'let_go') metaEl.appendChild(textNode('Let go'));
    if (a.reviewSince) {
      metaEl.appendChild(textNode(`Waiting ${formatElapsed(Date.now() - a.reviewSince)}`));
    }

    factsEl.textContent = '';
    factsEl.appendChild(factTile(formatNumber(a.tokens), 'tokens'));
    factsEl.appendChild(factTile(formatNumber(a.cacheTokens), 'cache tokens'));
    // Cost is a list-price estimate for comparing projects, NEVER a bill.
    // The label carries that caveat permanently, regardless of the number.
    factsEl.appendChild(factTile(formatCost(a.costEstimate), 'list price · not a bill'));

    renderActions(a);
    startCloseUp(a);
  }

  /** @param {string} text */
  function textNode(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  /** @param {string} value @param {string} key */
  function factTile(value, key) {
    const fact = document.createElement('div');
    fact.className = 'fact';
    const v = document.createElement('div');
    v.className = 'fact-v num';
    v.textContent = value;
    const k = document.createElement('div');
    k.className = 'fact-k';
    k.textContent = key;
    fact.append(v, k);
    return fact;
  }

  /** @param {any} a */
  function renderActions(a) {
    actionsEl.textContent = '';
    for (const action of legalActions(a)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action === 'let_go' ? 'btn btn--danger' : 'btn';
      btn.textContent = ACTION_LABELS[action];
      // The only wiring for /api/ack: an explicit click on a button that is
      // only ever shown when the action is legal for the current state.
      btn.addEventListener('click', () => performAction(action));
      actionsEl.appendChild(btn);
    }
    // Resume control: both targets are buttons, not a settings toggle plus
    // a separate "go" button — clicking one both resumes right now AND
    // becomes the new saved default (see resumeSession()), so there is
    // nothing else to configure here. "Resume in app" only ever appears
    // once the daemon has actually confirmed a claude:// handler exists —
    // see loadResumeTargets(); it is never guessed on the client.
    const preference = getSnapshot()?.settings?.resumeIn === 'app' ? 'app' : 'terminal';
    actionsEl.appendChild(resumeButton('terminal', 'Resume in terminal', preference));
    if (resumeAppAvailable) {
      actionsEl.appendChild(resumeButton('app', 'Resume in app', preference));
    }

    // WP15 task C.2: reachable "from the panel when a project is selected"
    // — every agent shown here belongs to a project, so this is always on.
    // Creating a sibling session is not a review action, so it is wired
    // through onNewAgent, never through performAction()/ack.
    const newAgentBtn = document.createElement('button');
    newAgentBtn.type = 'button';
    newAgentBtn.className = 'btn';
    newAgentBtn.textContent = '+ New agent';
    newAgentBtn.addEventListener('click', () => onNewAgent?.(a.projectId));
    actionsEl.appendChild(newAgentBtn);
  }

  /**
   * One button of the resume control built in renderActions() above.
   * `aria-pressed` reflects the user's current saved default, same
   * vocabulary as the header's "Show let go" toggle — not disabled state,
   * both targets stay clickable regardless of which is the default.
   * @param {'app'|'terminal'} target
   * @param {string} label
   * @param {'app'|'terminal'} preference the currently saved default
   */
  function resumeButton(target, label, preference) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(target === preference));
    btn.addEventListener('click', () => resumeSession(target));
    return btn;
  }

  /**
   * Fetch and render the real conversation. This is a passive GET — reading
   * it, and the scroll-to-bottom below, must never touch ack state. See the
   * module-level invariant note.
   * @param {string} id
   */
  async function loadConversation(id) {
    const token = ++conversationToken;
    threadEl.textContent = '';
    threadEl.appendChild(threadSkeleton());
    try {
      const res = await fetch(`/api/conversation?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (token !== conversationToken) return; // a newer open() superseded this fetch
      renderConversation(body.messages || []);
    } catch (err) {
      if (token !== conversationToken) return;
      threadEl.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'msg-empty';
      msg.textContent = `Could not load the conversation: ${err.message}`;
      threadEl.appendChild(msg);
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

  /** @param {{role:string,text:string,at:number}[]} messages */
  function renderConversation(messages) {
    threadEl.textContent = '';
    if (messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'msg-empty';
      empty.textContent = 'No messages yet.';
      threadEl.appendChild(empty);
      return;
    }
    for (const m of messages) {
      const wrap = document.createElement('div');
      wrap.className = `msg msg--${m.role === 'user' ? 'user' : 'assistant'}`;
      const who = document.createElement('div');
      who.className = 'msg-who';
      who.textContent = m.role === 'user' ? 'You' : 'Assistant';
      const body = document.createElement('div');
      body.className = 'msg-body';
      // Hard security requirement: conversation text is untrusted daemon
      // data and is ALWAYS rendered as text. Never assign to innerHTML.
      body.textContent = m.text;
      wrap.append(who, body);
      threadEl.appendChild(wrap);
    }
    // Scrolling to the newest message is a passive visual convenience. It
    // must never be confused with an acknowledgement — no ack call here.
    threadEl.scrollTop = threadEl.scrollHeight;
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
   * The animated L2 close-up: renders the selected agent at LOD 2 always,
   * regardless of the floor's own zoom (docs/03-VISUAL-SPEC.md §1.1). Purely
   * decorative/read-only — never a source of ack calls.
   * @param {any} a
   */
  function startCloseUp(a) {
    stopCloseUp();
    if (!renderModulesLoaded || !rig?.drawCharacter || !clips?.sampleClip) {
      closeupNote.hidden = false;
      return;
    }
    closeupNote.hidden = true;
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
    const u = 40;
    const cx = closeupCanvas.width / 2;
    const cy = closeupCanvas.height / 2;

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
          selected: true,
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
   *   - an explicit click on a button built in renderActions() above, or
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
      toast(`${ACTION_LABELS[action]} — done`);
      // A spoken confirmation is a compact place too: the label (display
      // name if set, else the MK tag) reads shorter than the full title.
      const who = displayedAgent.label || displayedAgent.mk || displayedAgent.title;
      announce(`${who}: ${ACTION_LABELS[action].toLowerCase()}`);
    } catch (err) {
      displayedAgent = rollback;
      renderChrome();
      toast(`Could not ${ACTION_LABELS[action].toLowerCase()}: ${err.message}`, { isError: true });
    }
  }

  /**
   * Resume the current session through POST /api/resume. Picking either
   * target also saves it as the new default for next time (POST
   * /api/settings) — see the module note by renderActions() above. The
   * saved-default POST is fire-and-forget: the next snapshot carries the
   * daemon's own copy of the setting regardless, so there is nothing here
   * to await or roll back.
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
   * Whether "Resume in app" should be offered for this agent, from the
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
    if (currentId && displayedAgent) renderActions(displayedAgent);
  }

  function setComposerBusy(busy) {
    textarea.disabled = busy;
    sendBtn.disabled = busy;
    hintEl.textContent = busy ? 'Sending…' : '';
    hintEl.classList.remove('is-warn');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const id = currentId;
    const agent = displayedAgent;
    if (!id || !agent) return;
    const text = textarea.value;
    if (!text.trim()) return;

    if (agent.live) {
      const proceed = window.confirm(
        'This session is currently live and may be mid-turn. Send anyway?',
      );
      if (!proceed) return;
    }

    sending = true;
    setComposerBusy(true);
    textarea.value = '';

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast('Message sent');
      if (currentId === id) await loadConversation(id);
    } catch (err) {
      // On failure, restore the composer content so nothing is lost.
      textarea.value = text;
      hintEl.textContent = `Could not send: ${err.message}`;
      hintEl.classList.add('is-warn');
      toast(`Could not send: ${err.message}`, { isError: true });
    } finally {
      sending = false;
      setComposerBusy(false);
    }
  });

  // --------------------------------------------------------------- public

  /**
   * Open the panel on an agent. Purely a read/render operation: it fetches
   * the conversation (a GET) and renders current facts. It must never call
   * /api/ack — opening a conversation is exactly the passive interaction
   * the invariant forbids from clearing reviewSince.
   * @param {string} id
   */
  function open(id) {
    const agent = getSnapshot()?.agents?.find((a) => a.id === id);
    if (!agent) return;
    currentId = id;
    displayedAgent = agent;
    root.hidden = false;
    textarea.value = '';
    hintEl.textContent = '';
    hintEl.classList.remove('is-warn');
    // Unknown again until loadResumeTargets() below resolves — cleared here
    // so a previous agent's "Resume in app" never flashes onto this one.
    resumeAppAvailable = false;
    renderChrome();
    loadConversation(id);
    loadResumeTargets(id);
  }

  function close() {
    currentId = null;
    displayedAgent = null;
    stopCloseUp();
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
    const fresh = getSnapshot()?.agents?.find((a) => a.id === currentId);
    if (!fresh) {
      // The agent is no longer on the floor (e.g. let_go with "show let go"
      // off). Keep showing what we last knew rather than yanking the panel
      // away mid-read.
      return;
    }
    displayedAgent = fresh;
    renderChrome();
  }

  function getSelectedId() {
    return currentId;
  }

  function destroy() {
    stopCloseUp();
  }

  return { open, close, refresh, performAction, getSelectedId, destroy };
}

// ------------------------------------------------------------- utilities

/** @param {number} n */
function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
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
