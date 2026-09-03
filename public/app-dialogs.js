/**
 * Every modal that CREATES something: a new project, a new agent, and the
 * rename/re-avatar sheet — plus the name and avatar pickers all three share.
 *
 * Split out of `app.js` by WP-22. These are the only surfaces in the client
 * that build a `<dialog>`'s contents from scratch, and they are here together
 * because they build them the same way: one picker helper, one set of glyph
 * paths, one submit shape (disable, POST, toast, close).
 *
 * The listeners moved with the code they call. Every one of them is on an
 * element of its own — a button, an input — so nothing about the order they
 * are registered in can matter; the document-level listeners, where order IS
 * the rule, all stayed in `app.js`.
 */

import { availableNames } from './names.js';
import { FALLBACK_AVATAR_GLYPHS, el, latestSnapshot, palette, toast } from './app-state.js';

//
// The three flows in CONTRACTS-WP15.md §6 / WP15 task C, all in the GUI, all
// keyboard-usable. None of them ever touch /api/ack — creating or renaming
// an agent is not a review action.

/** @param {HTMLButtonElement} button @param {boolean} pressed */
export function setToggle(button, pressed) {
  button.setAttribute('aria-pressed', String(pressed));
  button.textContent = pressed ? 'On' : 'Off';
}

/** @param {HTMLButtonElement} button */
export function toggleIsOn(button) {
  return button.getAttribute('aria-pressed') === 'true';
}

el.newProjectCreateToggle.addEventListener('click', () => {
  setToggle(el.newProjectCreateToggle, !toggleIsOn(el.newProjectCreateToggle));
});
el.newProjectGitInitToggle.addEventListener('click', () => {
  setToggle(el.newProjectGitInitToggle, !toggleIsOn(el.newProjectGitInitToggle));
});

export function openNewProject() {
  el.newProjectError.hidden = true;
  el.newProjectPath.value = '';
  el.newProjectName.value = '';
  el.newProjectInstructions.value = '';
  setToggle(el.newProjectCreateToggle, false);
  setToggle(el.newProjectGitInitToggle, false);
  el.newProjectDialog.showModal();
  el.newProjectPath.focus();
}

async function submitNewProject() {
  const path = el.newProjectPath.value.trim();
  if (!path) {
    el.newProjectError.textContent = 'Give it a directory to start in.';
    el.newProjectError.hidden = false;
    return;
  }
  el.newProjectGo.disabled = true;
  try {
    // CONTRACTS-WP15.md §6 names this endpoint /api/project, but
    // src/http/routes/actions.mjs — the real endpoint this client
    // consumes — kept the original /api/new-project URL and extended its
    // body to accept `path` (as well as the old `cwd`), `create`,
    // `gitInit`, `name` and `instructions`. The live route wins over the
    // doc; see the WP15 report for this note.
    const res = await fetch('/api/new-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path,
        create: toggleIsOn(el.newProjectCreateToggle),
        gitInit: toggleIsOn(el.newProjectGitInitToggle),
        name: el.newProjectName.value.trim() || undefined,
        instructions: el.newProjectInstructions.value.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    el.newProjectDialog.close();
    toast(`Opening a session in ${body.cwd || path}`);
  } catch (err) {
    el.newProjectError.textContent = err.message;
    el.newProjectError.hidden = false;
  } finally {
    el.newProjectGo.disabled = false;
  }
}

el.newProjectGo.addEventListener('click', submitNewProject);
el.newProjectPath.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitNewProject();
  }
});

// -------------------------------------------------------- name/avatar pickers
//
// Shared by "New agent" and "Rename / re-avatar" (WP15 task C.2, C.3). A
// row of toggle buttons rather than a <select>: a native select's popup is
// OS-drawn, and on several platforms that is an unavoidable white box —
// exactly what the restraint pass (task A) removes everywhere else.

/**
 * @param {HTMLElement} host
 * @param {{value:string|null, label:string, node?:Node}[]} options
 * @param {string|null} initial
 * @returns {() => string|null} reads the currently selected value
 */
export function buildPicker(host, options, initial) {
  host.textContent = '';
  /** @type {string|null} */
  let selected = initial;
  /** @type {HTMLButtonElement[]} */
  const buttons = [];

  function paint() {
    for (const btn of buttons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === String(selected)));
    }
  }

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-btn';
    btn.dataset.value = String(opt.value);
    if (opt.node) btn.appendChild(opt.node);
    const label = document.createElement('span');
    label.textContent = opt.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      selected = opt.value;
      paint();
    });
    buttons.push(btn);
    host.appendChild(btn);
  }
  paint();
  return () => selected;
}

/**
 * @param {HTMLElement} host
 * @param {Iterable<string>} taken names already in use elsewhere on the floor
 * @param {string|null} current the agent's own current name, always offered
 */
export function buildNamePicker(host, taken, current) {
  const names = availableNames(taken);
  if (current && !names.includes(current)) names.unshift(current);
  const options = [
    { value: null, label: 'No name (MK tag)' },
    ...names.map((n) => ({ value: n, label: n })),
  ];
  return buildPicker(host, options, current);
}

/** Minimal line-icon per glyph name, text-labelled so an unmapped name is
 * still identifiable — the vocabulary is render/palette.js's, not ours to
 * pin down further than "draw something recognisable". */
const GLYPH_PATHS = {
  hex: 'M10 1 L18 5.5 L18 14.5 L10 19 L2 14.5 L2 5.5 Z',
  triangle: 'M10 2 L18 17 L2 17 Z',
  square: 'M3 3 H17 V17 H3 Z',
  diamond: 'M10 1 L19 10 L10 19 L1 10 Z',
  drop: 'M10 1 C14 6 17 10 17 13.5 A7 7 0 0 1 3 13.5 C3 10 6 6 10 1 Z',
  star: 'M10 1 L12.4 7.2 L19 7.6 L13.8 11.9 L15.6 18.3 L10 14.6 L4.4 18.3 L6.2 11.9 L1 7.6 L7.6 7.2 Z',
  cross: 'M8 1 H12 V8 H19 V12 H12 V19 H8 V12 H1 V8 H8 Z',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

/** @param {string} name */
export function glyphIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const d = GLYPH_PATHS[name];
  if (d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  } else {
    // 'ring' and anything not in the hand-authored set above: an unfilled
    // circle, since every icon in this picker is stroke-only already.
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '10');
    circle.setAttribute('cy', '10');
    circle.setAttribute('r', '8');
    svg.appendChild(circle);
  }
  return svg;
}

/**
 * @param {HTMLElement} host
 * @param {string[]} glyphs the known vocabulary (render/palette.js's AVATAR_GLYPHS)
 * @param {string|null} current the agent's own current avatar, always offered
 *   even if it falls outside `glyphs` (e.g. a stale value from before the
 *   vocabulary changed) — same defensiveness as buildNamePicker.
 */
export function buildAvatarPicker(host, glyphs, current) {
  const list = current && !glyphs.includes(current) ? [current, ...glyphs] : glyphs;
  const options = [
    { value: null, label: 'Default' },
    ...list.map((name) => ({ value: name, label: name, node: glyphIcon(name) })),
  ];
  const getValue = buildPicker(host, options, current);
  for (const btn of host.querySelectorAll('.picker-btn')) btn.classList.add('avatar-btn');
  return getValue;
}

// ------------------------------------------------------------- new agent
//
// Opened from the floor's in-room "+" ({ kind: 'new-agent', id: projectId }
// via Scene's onSelect, CONTRACTS-WP15.md §5) and from the panel when an
// agent — and so a project — is in view (WP15 task C.2).

let newAgentProjectId = null;
let getNewAgentName = () => null;
let getNewAgentAvatar = () => null;

/** @param {string} projectId */
export function openNewAgentDialog(projectId) {
  const project = latestSnapshot?.projects?.find((p) => p.id === projectId);
  if (!project) {
    toast('That project is not on the floor', { isError: true });
    return;
  }
  newAgentProjectId = projectId;
  el.newAgentIntro.textContent = `Starts another session in ${project.name}.`;
  el.newAgentInstructions.value = '';
  el.newAgentError.hidden = true;

  const taken = (latestSnapshot.agents || []).map((a) => a.displayName).filter(Boolean);
  getNewAgentName = buildNamePicker(el.newAgentNamePicker, taken, null);
  getNewAgentAvatar = buildAvatarPicker(
    el.newAgentAvatarPicker,
    palette?.AVATAR_GLYPHS || FALLBACK_AVATAR_GLYPHS,
    null,
  );

  el.newAgentDialog.showModal();
}

async function submitNewAgent() {
  const project = latestSnapshot?.projects?.find((p) => p.id === newAgentProjectId);
  if (!project) {
    el.newAgentError.textContent = 'That project is no longer on the floor.';
    el.newAgentError.hidden = false;
    return;
  }
  // "Take cwd from any agent already in that project, or from project.cwd"
  // (WP15 task C.2) — project.cwd is always present (src/core/model.mjs's
  // projects() sets it from the first agent seen), so that alone suffices.
  const cwd = project.cwd || latestSnapshot.agents.find((a) => a.projectId === project.id)?.cwd;
  if (!cwd) {
    el.newAgentError.textContent = 'Could not find a working directory for that project.';
    el.newAgentError.hidden = false;
    return;
  }
  el.newAgentGo.disabled = true;
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        name: getNewAgentName() || undefined,
        avatar: getNewAgentAvatar() || undefined,
        instructions: el.newAgentInstructions.value.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    el.newAgentDialog.close();
    toast(`Starting a new agent in ${project.name}`);
  } catch (err) {
    el.newAgentError.textContent = err.message;
    el.newAgentError.hidden = false;
  } finally {
    el.newAgentGo.disabled = false;
  }
}

el.newAgentGo.addEventListener('click', submitNewAgent);

// -------------------------------------------------- rename / re-avatar

let identityAgentId = null;
let getIdentityName = () => null;
let getIdentityAvatar = () => null;

/** @param {any} agent */
export function openIdentityDialog(agent) {
  identityAgentId = agent.id;
  el.identityIntro.textContent = `Sets what ${agent.mk || agent.title} is called on the floor.`;
  el.identityError.hidden = true;

  // Every OTHER agent's name is taken; this agent's own current name stays
  // offered so picking "the same name" is not treated as unavailable.
  const taken = (latestSnapshot?.agents || [])
    .filter((a) => a.id !== agent.id)
    .map((a) => a.displayName)
    .filter(Boolean);
  getIdentityName = buildNamePicker(el.identityNamePicker, taken, agent.displayName ?? null);
  getIdentityAvatar = buildAvatarPicker(
    el.identityAvatarPicker,
    palette?.AVATAR_GLYPHS || FALLBACK_AVATAR_GLYPHS,
    agent.avatar ?? null,
  );

  el.identityDialog.showModal();
}

async function submitIdentity() {
  if (!identityAgentId) return;
  el.identityGo.disabled = true;
  try {
    const res = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Explicit null, not omission: /api/identity treats null as "clear
      // this field" (CONTRACTS-WP15.md §6), which is exactly what choosing
      // "No name" / "Default" in the picker means.
      body: JSON.stringify({
        id: identityAgentId,
        name: getIdentityName(),
        avatar: getIdentityAvatar(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    el.identityDialog.close();
    toast('Saved');
  } catch (err) {
    el.identityError.textContent = err.message;
    el.identityError.hidden = false;
  } finally {
    el.identityGo.disabled = false;
  }
}

el.identityGo.addEventListener('click', submitIdentity);
