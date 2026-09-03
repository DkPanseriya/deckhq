/**
 * DeckHQ command palette — `⌘K` / `Ctrl+K`.
 *
 * docs/plan/05-GUI-UX-SPEC.md §5.3, WP-07.
 *
 * The header used to be a toolbar of ten equal-weight buttons. It is now a
 * headline, and this is where everything else went: every agent, every
 * project, the actions that are legal on the current selection, and every
 * command that used to be a button. One list, fuzzy-matched, keyboard-first.
 *
 * ============================================================================
 * THE INVARIANT (docs/01-PRODUCT.md §2). Nothing in this file calls
 * `/api/ack`. The six acknowledgement actions are offered here as entries
 * whose `run()` calls back into `panel.performAction()` — the single funnel
 * in the client — and they are reached only by an explicit Enter or click on
 * a highlighted row. Opening the palette, typing in it, and moving the
 * selection with the arrow keys change nothing on the daemon.
 * ============================================================================
 *
 * This module is split so the parts worth testing need no DOM:
 * `fuzzyScore`, `buildEntries` and `rankEntries` are pure and are what
 * `test/unit/palette.test.mjs` drives; `createPalette` is the only function
 * that touches an element.
 *
 * Every string that comes from a session — a name, a title, a project — is
 * written with `textContent`. There is no `innerHTML` in this file.
 */

/** The four kinds of thing in the list, in the order they are offered. */
export const GROUPS = /** @type {const} */ ({
  selection: 'On the selection',
  command: 'Commands',
  agent: 'Agents',
  project: 'Projects',
});

/**
 * How much an exact single-character accelerator is worth. It has to dominate
 * every fuzzy score outright, because the promise WP-07 is accepted against is
 * "every action previously in the header is reachable in ≤ 2 keystrokes":
 * one character, then Enter. `test/unit/palette.test.mjs` asserts both that
 * the accelerators are unique and that each one lands its command first
 * against a populated floor.
 */
export const ACCEL_BONUS = 1_000_000;

/** How many rows are built into the DOM at once. The list scrolls. */
const MAX_ROWS = 60;

/**
 * Which of the six acknowledgement actions are legal from an agent's current
 * state. docs/02-ARCHITECTURE.md §5.1.
 *
 * This deliberately repeats the rule in `public/panel.js`'s `legalActions()`
 * rather than importing it: panel.js reaches `localStorage` through
 * ./drafts.js at module scope, which would drag a browser-only dependency
 * into a Node unit test for a ten-line pure function. `app.js` duplicates
 * `STATE_LABELS` and the state colours for the same reason. The table is
 * pinned by test/unit/palette.test.mjs so the two copies cannot drift
 * silently.
 * @param {any} agent
 * @returns {string[]}
 */
export function legalAckActions(agent) {
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

const ACTION_LABELS = {
  acknowledge: 'Acknowledge',
  review: 'Mark for review',
  bench: 'Bench',
  recall: 'Recall',
  let_go: 'Let go',
  rehire: 'Rehire',
};

/** What the person calls each state (docs/plan/05-GUI-UX-SPEC.md §11). */
const STATE_LABELS = {
  working: 'Working',
  needs_input: 'Hands up',
  stalled: 'Stalled',
  for_review: 'For review',
  benched: 'Benched',
  let_go: 'Let go',
  ended: 'Ended',
};

/** @param {string} s */
function normalise(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Subsequence match with a positional score, or `null` when the query's
 * characters do not appear in order. Higher is better. No dependency, and
 * deliberately simple: the corpus here is a few hundred short strings, so
 * cleverness would buy nothing and cost readability.
 *
 * The shape of the score: a character that continues an unbroken run, or that
 * starts a word, is worth much more than one found ten characters later. That
 * is what makes "oa" find "orbital-api" ahead of "Backfill the events table".
 *
 * @param {string} query
 * @param {string} text
 * @returns {number|null}
 */
export function fuzzyScore(query, text) {
  const q = normalise(query);
  const t = String(text ?? '').toLowerCase();
  if (!q) return 0;
  if (!t) return null;

  // Greedy leftmost matching alone is wrong here, and wrong in a way a user
  // would notice: typing "notifier" against "Rune · MK5.1 · orbital-api ·
  // Refactor the notifier" would consume the `n` in "Rune", then scatter the
  // rest across the project name, and score the contiguous hit at the end as
  // if it were noise. So the scan is re-run from every place the first
  // character occurs and the best result wins. The corpus is a few hundred
  // short strings; the starts are capped so a pathological one still cannot
  // cost anything.
  let best = null;
  let starts = 0;
  for (let from = t.indexOf(q[0]); from !== -1; from = t.indexOf(q[0], from + 1)) {
    const s = scanFrom(q, t, from);
    if (s !== null && (best === null || s > best)) best = s;
    if (++starts >= 24) break;
  }
  if (best === null) return null;
  // A hit in a short label beats the same hit buried in a long one.
  return best + Math.max(0, 24 - t.length / 4);
}

/**
 * One greedy pass, beginning at `from`. Returns `null` when the query does
 * not fit as a subsequence from there.
 * @param {string} q
 * @param {string} t
 * @param {number} from
 * @returns {number|null}
 */
function scanFrom(q, t, from) {
  let cursor = from;
  let score = 0;
  let run = 0;
  for (let i = 0; i < q.length; i++) {
    const at = t.indexOf(q[i], cursor);
    if (at === -1) return null;
    if (at === cursor && i > 0) {
      run += 1;
      score += 8 + run * 2;
    } else {
      run = 0;
      score -= Math.min(at - cursor, 12) * 0.5;
    }
    if (at === 0 || /[\s·:/\-_.,()[\]]/.test(t[at - 1])) score += 10;
    cursor = at + 1;
  }
  return score;
}

/** The haystack one entry is matched against. @param {any} entry */
function searchTextOf(entry) {
  return [entry.label, entry.hint, ...(entry.keywords || [])].filter(Boolean).join(' ');
}

/**
 * Filter and order entries for a query. With an empty query the list keeps
 * the order it was built in, which is the order of §5.3: what you can do to
 * the thing you have selected, then commands, then agents, then projects.
 *
 * @param {any[]} entries
 * @param {string} query
 * @returns {any[]}
 */
export function rankEntries(entries, query) {
  const q = normalise(query);
  if (!q) return entries.slice(0, MAX_ROWS);
  /** @type {{entry:any, score:number, at:number}[]} */
  const scored = [];
  entries.forEach((entry, at) => {
    const accel = entry.accel && q === normalise(entry.accel) ? ACCEL_BONUS : 0;
    const fuzzy = fuzzyScore(q, searchTextOf(entry));
    if (fuzzy === null && !accel) return;
    scored.push({ entry, score: accel + (fuzzy ?? 0), at });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, MAX_ROWS).map((s) => s.entry);
}

/**
 * Commands: everything that used to be a header button, plus the surfaces
 * §5.3 names. Pure — it reads a context object and returns entries, so the
 * whole table can be asserted in a unit test without a browser.
 *
 * Each `accel` is one character that ranks its command first, so the command
 * costs one keystroke plus Enter. They are unique by assertion, not by
 * inspection.
 *
 * @param {{snapshot:any, letGoVisible:boolean, redactSnapshots?:boolean,
 *          actions:Record<string, Function>}} ctx
 */
export function buildCommandEntries(ctx) {
  const { snapshot, letGoVisible, actions } = ctx;
  const settings = snapshot?.settings || {};
  const soundOn = Boolean(settings.sound);
  const notifyOn = settings.notifications !== false;
  const redacting = Boolean(ctx.redactSnapshots);

  return [
    {
      id: 'cmd:new-agent',
      group: 'command',
      label: 'New agent',
      hint: 'start another session in a project',
      accel: 'a',
      keywords: ['session', 'start', 'spawn'],
      run: () => actions.newAgent(),
    },
    {
      id: 'cmd:new-project',
      group: 'command',
      label: 'New project',
      hint: 'open a session in a directory',
      accel: 'p',
      keywords: ['repo', 'directory', 'folder', 'room'],
      run: () => actions.newProject(),
    },
    {
      id: 'cmd:settle',
      group: 'command',
      label: 'Settle floor',
      hint: 'send every idle agent to the lounge',
      accel: 's',
      keywords: ['bench', 'all', 'lounge', 'tidy'],
      run: () => actions.settleFloor(),
    },
    {
      id: 'cmd:hooks',
      group: 'command',
      label: 'Install hooks',
      hint: 'exact state the moment it changes',
      accel: 'h',
      keywords: ['consent', 'claude', 'codex', 'events'],
      run: () => actions.openHooks(),
    },
    {
      id: 'cmd:refresh',
      group: 'command',
      label: 'Refresh',
      hint: 'rescan every session now',
      accel: 'r',
      keywords: ['rescan', 'reload', 'poll'],
      run: () => actions.refresh(),
    },
    {
      // §5.3 lists "Snapshot the office" among the commands. It carries no
      // accelerator on purpose: it already has a one-key shortcut of its own
      // (`S`), and spending a palette accelerator on it would mean either a
      // second way to type the same thing or taking `s` off Settle floor.
      id: 'cmd:snapshot',
      group: 'command',
      label: 'Snapshot the office',
      hint: 'floor plus stats, on the clipboard — S',
      keywords: ['screenshot', 'png', 'share', 'capture', 'clipboard', 'image'],
      run: () => actions.snapshot(),
    },
    {
      id: 'cmd:redact',
      group: 'command',
      label: redacting ? 'Redact project names — turn off' : 'Redact project names',
      hint: redacting
        ? 'currently on; every snapshot shows MK tags'
        : 'MK tags instead of names in the next snapshot — Shift S',
      keywords: ['privacy', 'anonymise', 'anonymize', 'hide', 'mk', 'nda'],
      run: () => actions.toggleRedaction(),
    },
    {
      id: 'cmd:settings',
      group: 'command',
      label: 'Settings',
      hint: 'stall window, notifications, resume, floor, data, hooks',
      accel: ',',
      keywords: ['preferences', 'options', 'configure'],
      run: () => actions.openSettings(),
    },
    {
      id: 'cmd:onboarding',
      group: 'command',
      label: 'Onboarding again',
      hint: 'the three coach marks, from the top',
      accel: 'o',
      keywords: ['help', 'guide', 'intro', 'tour', 'coach'],
      run: () => actions.openOnboarding(),
    },
    {
      id: 'cmd:notifications',
      group: 'command',
      label: notifyOn ? 'Notifications — turn off' : 'Notifications — turn on',
      hint: notifyOn ? 'currently on' : 'currently off',
      accel: 'n',
      keywords: ['notify', 'alerts', 'desktop', 'os', 'enable'],
      run: () => actions.setNotifications(!notifyOn),
    },
    {
      id: 'cmd:sound',
      group: 'command',
      label: soundOn ? 'Sound — turn off' : 'Sound — turn on',
      hint: soundOn ? 'currently on' : 'currently off',
      accel: 'u',
      keywords: ['audio', 'mute', 'chime', 'volume'],
      run: () => actions.setSound(!soundOn),
    },
    {
      // A view toggle, not a stored setting. The old header wrote
      // `settings.showLetGo` and nothing ever read it (docs/DEVIATIONS.md
      // §58); "am I looking at let-go agents right now" is a property of this
      // tab, not of the machine, so it lives in memory and resets on reload.
      id: 'cmd:show-let-go',
      group: 'command',
      label: letGoVisible ? 'Hide let-go agents' : 'Show let-go agents',
      hint: letGoVisible ? 'currently shown' : 'off the floor, reachable from here',
      accel: 'l',
      keywords: ['archived', 'removed', 'letgo', 'let go'],
      run: () => actions.toggleLetGoVisible(),
    },
  ];
}

/**
 * Actions on the current selection: the six acknowledgement actions that are
 * legal right now, resume, rename, and a new agent in the same project.
 * @param {{snapshot:any, selectedId:string|null, actions:Record<string, Function>}} ctx
 */
function buildSelectionEntries(ctx) {
  const { snapshot, selectedId, actions } = ctx;
  if (!selectedId) return [];
  const agent = (snapshot?.agents || []).find((a) => a.id === selectedId);
  if (!agent) return [];
  const who = agent.displayName || agent.label || agent.mk || agent.title || agent.id;
  const state = STATE_LABELS[agent.ackState === 'active' ? agent.activityState : agent.ackState];

  /** @type {any[]} */
  const out = [];
  for (const action of legalAckActions(agent)) {
    out.push({
      id: `sel:${action}`,
      group: 'selection',
      label: `${ACTION_LABELS[action]} ${who}`,
      hint: `${state} · ${agent.projectName || ''}`.trim(),
      keywords: [action, agent.mk, agent.projectName],
      // The one route to /api/ack in the whole client, reached only from an
      // explicit Enter or click on this row. See the header of this file.
      run: () => actions.ack(action),
    });
  }
  out.push(
    {
      id: 'sel:resume-terminal',
      group: 'selection',
      label: `Resume ${who} in a terminal`,
      hint: 'and make that the default',
      keywords: ['open', 'continue', 'shell'],
      run: () => actions.resume('terminal'),
    },
    {
      id: 'sel:resume-app',
      group: 'selection',
      label: `Resume ${who} in the desktop app`,
      hint: 'and make that the default',
      keywords: ['open', 'continue', 'claude'],
      run: () => actions.resume('app'),
    },
    {
      id: 'sel:rename',
      group: 'selection',
      label: `Rename ${who}`,
      hint: 'name and avatar on the floor',
      keywords: ['avatar', 'identity', 'call'],
      run: () => actions.rename(agent),
    },
    {
      id: 'sel:new-agent-here',
      group: 'selection',
      label: `New agent in ${agent.projectName || 'this project'}`,
      hint: 'another session in the same repo',
      keywords: ['start', 'session'],
      run: () => actions.newAgent(agent.projectId),
    },
  );
  return out;
}

/**
 * @param {{snapshot:any, letGoVisible:boolean, actions:Record<string, Function>}} ctx
 */
function buildAgentEntries(ctx) {
  const { snapshot, letGoVisible, actions } = ctx;
  const agents = snapshot?.agents || [];
  return agents
    .filter((a) => letGoVisible || a.ackState !== 'let_go')
    .map((a) => {
      const state = STATE_LABELS[a.ackState === 'active' ? a.activityState : a.ackState] || '';
      return {
        id: `agent:${a.id}`,
        group: 'agent',
        label: a.displayName || a.label || a.mk || a.title || a.id,
        hint: [a.mk, a.projectName, state].filter(Boolean).join(' · '),
        keywords: [a.title, a.mk, a.projectName, a.gitBranch, a.model].filter(Boolean),
        run: () => actions.selectAgent(a.id),
      };
    });
}

/**
 * @param {{snapshot:any, actions:Record<string, Function>}} ctx
 */
function buildProjectEntries(ctx) {
  const { snapshot, actions } = ctx;
  /** @type {any[]} */
  const out = [];
  for (const p of snapshot?.projects || []) {
    const name = p.name || p.id;
    const base = { group: 'project', keywords: [p.mk, p.cwd, p.id].filter(Boolean) };
    out.push(
      {
        ...base,
        id: `proj:jump:${p.id}`,
        label: `Jump to ${name}`,
        hint: 'go to that room on the floor',
        run: () => actions.jumpToProject(p.id),
      },
      {
        ...base,
        id: `proj:filter:${p.id}`,
        label: `Filter to ${name}`,
        hint: 'scope the queue and the panel to it',
        run: () => actions.filterToProject(p.id),
      },
      {
        ...base,
        id: `proj:board:${p.id}`,
        label: `Whiteboard for ${name}`,
        hint: 'sessions, tokens, estimated cost',
        run: () => actions.showWhiteboard(p.id),
      },
      {
        ...base,
        id: `proj:reveal:${p.id}`,
        label: `Reveal ${name} on disk`,
        hint: 'open the folder',
        run: () => actions.revealFolder(p.id),
      },
      {
        ...base,
        id: `proj:run:${p.id}`,
        label: `Run the dashboard for ${name}`,
        hint: 'its dev server or dashboard action',
        run: () => actions.runDashboard(p.id),
      },
      {
        // The header's one primary action needs a project, and with nothing
        // selected there is no honest guess at which. So "+ New agent" opens
        // this list instead of picking for you.
        ...base,
        id: `proj:new-agent:${p.id}`,
        label: `New agent in ${name}`,
        hint: 'another session in that repo',
        run: () => actions.newAgent(p.id),
      },
    );
    // Archiving is offered only for a room nobody is working in — the same
    // honesty rule the header chip follows: a repo with an active agent stays
    // on the floor regardless, so the control would be a lie.
    const idle = (p.activeCount ?? 0) === 0;
    if (p.archived) {
      out.push({
        ...base,
        id: `proj:restore:${p.id}`,
        label: `Restore ${name} to the floor`,
        hint: 'undo archiving this room',
        run: () => actions.archiveProject(p.id, false),
      });
    } else if (idle) {
      out.push({
        ...base,
        id: `proj:archive:${p.id}`,
        label: `Archive ${name}`,
        hint: 'take this idle room off the floor',
        run: () => actions.archiveProject(p.id, true),
      });
    }
  }
  return out;
}

/**
 * The whole list, in §5.3's order.
 * @param {{snapshot:any, selectedId:string|null, letGoVisible:boolean, actions:Record<string, Function>}} ctx
 */
export function buildEntries(ctx) {
  return [
    ...buildSelectionEntries(ctx),
    ...buildCommandEntries(ctx),
    ...buildAgentEntries(ctx),
    ...buildProjectEntries(ctx),
  ];
}

// ---------------------------------------------------------------- the UI

/**
 * @param {object} opts
 * @param {HTMLDialogElement} opts.dialogEl
 * @param {HTMLInputElement} opts.inputEl
 * @param {HTMLElement} opts.listEl
 * @param {HTMLElement} opts.emptyEl
 * @param {() => any} opts.getSnapshot
 * @param {() => string|null} opts.getSelectedId
 * @param {() => boolean} opts.getLetGoVisible
 * @param {() => boolean} [opts.getRedactSnapshots]
 * @param {Record<string, Function>} opts.actions
 */
export function createPalette(opts) {
  const {
    dialogEl,
    inputEl,
    listEl,
    emptyEl,
    getSnapshot,
    getSelectedId,
    getLetGoVisible,
    getRedactSnapshots,
    actions,
  } = opts;

  /** @type {any[]} the currently rendered, ranked entries */
  let rows = [];
  let active = 0;

  function context() {
    return {
      snapshot: getSnapshot(),
      selectedId: getSelectedId(),
      letGoVisible: getLetGoVisible(),
      redactSnapshots: getRedactSnapshots ? getRedactSnapshots() : false,
      actions,
    };
  }

  function render() {
    const entries = buildEntries(context());
    rows = rankEntries(entries, inputEl.value);
    active = 0;
    listEl.textContent = '';
    emptyEl.hidden = rows.length > 0;

    let lastGroup = null;
    rows.forEach((entry, index) => {
      if (entry.group !== lastGroup) {
        lastGroup = entry.group;
        const head = document.createElement('li');
        head.className = 'palette-group';
        head.setAttribute('role', 'presentation');
        head.textContent = GROUPS[entry.group] || entry.group;
        listEl.appendChild(head);
      }
      listEl.appendChild(rowNode(entry, index));
    });
    paintActive();
  }

  /** @param {any} entry @param {number} index */
  function rowNode(entry, index) {
    const li = document.createElement('li');
    li.className = 'palette-row';
    li.id = `palette-row-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.setAttribute('aria-posinset', String(index + 1));
    li.setAttribute('aria-setsize', String(rows.length));
    li.dataset.index = String(index);

    const label = document.createElement('span');
    label.className = 'palette-row-label';
    label.textContent = entry.label;
    li.appendChild(label);

    if (entry.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette-row-hint';
      hint.textContent = entry.hint;
      li.appendChild(hint);
    }
    if (entry.accel) {
      const kbd = document.createElement('kbd');
      kbd.className = 'palette-row-accel';
      kbd.setAttribute('aria-hidden', 'true');
      kbd.textContent = entry.accel;
      li.appendChild(kbd);
    }

    // A screen reader gets the group, the label and the hint as one phrase —
    // "Command: Refresh, rescan every session now" — rather than three
    // fragments whose relationship it has to infer from the layout.
    li.setAttribute(
      'aria-label',
      [GROUPS[entry.group] || entry.group, entry.label, entry.hint].filter(Boolean).join(': '),
    );

    li.addEventListener('click', () => run(index));
    // Keep focus in the input: a mousedown on a row would otherwise blur it
    // and take the arrow keys with it.
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('mousemove', () => {
      if (active !== index) {
        active = index;
        paintActive();
      }
    });
    return li;
  }

  function paintActive() {
    const nodes = listEl.querySelectorAll('.palette-row');
    nodes.forEach((node, i) => {
      const on = i === active;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-selected', String(on));
    });
    const current = /** @type {HTMLElement|null} */ (nodes[active] || null);
    inputEl.setAttribute('aria-activedescendant', current ? current.id : '');
    current?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {number} delta */
  function move(delta) {
    if (rows.length === 0) return;
    active = (active + delta + rows.length) % rows.length;
    paintActive();
  }

  /** @param {number} index */
  function run(index) {
    const entry = rows[index];
    if (!entry) return;
    // Close first: every action either opens a surface of its own or changes
    // the floor, and a palette left hanging over the result is noise.
    close();
    try {
      entry.run();
    } catch (err) {
      console.error('[deckhq] palette action failed', err);
    }
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        active = 0;
        paintActive();
        break;
      case 'End':
        active = Math.max(0, rows.length - 1);
        paintActive();
        break;
      case 'Enter':
        run(active);
        break;
      case 'Tab':
        // A modal <dialog> traps Tab inside itself anyway; stopping it here
        // keeps the caret in the field, which is the only useful place for it.
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  inputEl.addEventListener('keydown', onKeydown);
  inputEl.addEventListener('input', render);

  // Clicking the backdrop closes, the way every other overlay in the product
  // does. `close` fires however it closed — button, Esc, backdrop — and the
  // browser returns focus to whatever opened it.
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) close();
  });

  /** @param {string} [initialQuery] */
  function open(initialQuery = '') {
    if (dialogEl.open) return;
    inputEl.value = initialQuery;
    render();
    if (typeof dialogEl.showModal === 'function') dialogEl.showModal();
    else dialogEl.setAttribute('open', '');
    inputEl.focus();
    inputEl.select();
  }

  function close() {
    if (!dialogEl.open) return;
    dialogEl.close();
  }

  return { open, close, isOpen: () => dialogEl.open, refresh: () => dialogEl.open && render() };
}
