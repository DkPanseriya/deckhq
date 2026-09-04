/**
 * The card's header, and the close-up on it (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged: the passive re-render of everything
 * above the scrolling body, the two live lines under it, the draft chip, and
 * the 44 px animated close-up plus the dynamic imports that draw it.
 *
 * INVARIANT (docs/01-PRODUCT.md §2): every function here is a read. None of
 * them calls `performAction()` or reaches `/api/ack`, and
 * `test/unit/panel-invariant.test.mjs` reads this file to say so.
 */

import { drafts } from './drafts.js';
import { STATE_LABELS, STATE_ICON_GLYPH, visualState } from './panel-rules.js';
import {
  who,
  juniorMetaFor,
  shortModel,
  formatNumber,
  formatCompact,
  formatElapsed,
  costLineParts,
} from './panel-format.js';
import { currentId, displayedAgent } from './panel-state.js';
import { textNode, separator } from './panel-dom.js';

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
 * Set once `render/palette.js` loads. It was declared as carrying only
 * `STATE_COLORS` while `rarityWordFor()` calls two more of its exports (WP-22).
 * @type {{STATE_COLORS?: Record<string,string>,
 *   appearanceFor?: (id: string) => {tier: string},
 *   rarityWord?: (tier: string) => string|null}|null}
 */
let paletteModule = null;

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

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {getSnapshot: () => any}} ctx
 */
export function createHeaderPart(ctx) {
  const {
    getSnapshot,
    mkChip,
    draftChip,
    titleEl,
    metaEl,
    waitingEl,
    doingEl,
    changedHeading,
    textarea,
    costEl,
    closeupCanvas,
  } = ctx;
  /** Late-bound: the other parts' renderers, wired once panel.js has built
   * them all. Same identifiers the bodies below already used when they were
   * siblings inside one closure (docs/DEVIATIONS.md §122, rule 3). */
  let renderPermission, renderActions, renderResume, renderRecordLine, renderTraitLine;

  let closeUpRaf = null;
  let closeUpStartTs = 0;
  /** @type {any} */
  let rig = null;
  /** @type {any} */
  let clips = null;
  /** @type {any} */
  let palette = null;
  let renderModulesLoaded = false;

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
    // WP-28. One quiet line about the AGENT, under the identity area and above
    // the live lines. Never about the reader (docs/plan/08 §1.1 rule 6).
    renderTraitLine();

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
    // WP-41. Which way the relationship runs, said in words on whichever end
    // of it the user is looking at: "junior of Rosa" on the junior, and
    // "3 juniors" on the senior that spawned them.
    const juniorLine = juniorMetaFor(a, getSnapshot());
    if (juniorLine) {
      metaEl.appendChild(separator());
      metaEl.appendChild(textNode(juniorLine));
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

  return {
    renderChrome,
    renderWaiting,
    renderDoing,
    renderDraftChip,
    loadRenderModules,
    startCloseUp,
    stopCloseUp,
    wire: (o) => {
      ({ renderPermission, renderActions, renderResume, renderRecordLine, renderTraitLine } = o);
    },
  };
}
