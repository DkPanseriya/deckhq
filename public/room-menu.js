/**
 * THE ROOM'S OWN SETTINGS — the popover a project room's title bar opens.
 *
 * The owner, 11 October: "keep the project room title bar / repo name
 * clickable, so that one can open the settings for that repo, like pin this
 * project room, or remove the pin, or add agent to it, change room colour or
 * agent theme or type for this project room, etc. So all project specific
 * settings can be done there."
 *
 * So a press on a room's bar — or the palette's "Room settings: <name>" —
 * opens this, anchored under the bar it belongs to, in the Look popover's own
 * language (its rows, its segmented control, its foot):
 *
 *   Show only this room   what a press on the old plate did; it lives here now
 *   New agent here        the new-agent sheet, for this project
 *   Pin this room / Unpin
 *   Room colour           Auto, or one of the six zone hues — for THIS room
 *   [the slot]            a build's own per-room rows (`roomExtraRows`): this
 *                         build has one way to draw an agent, so it has none
 *   Open the board · Open folder
 *
 * A ROOM'S CHOICES ARE SETTINGS, NOT THE LOOK. They are written to the
 * daemon's `rooms` map through the settings route, which validates them
 * (`src/core/room-settings.mjs`); a look document names no project and none of
 * this ever goes into one.
 *
 * It is a popover and not a view: no scrim, Escape closes it and gives the
 * keyboard back to whatever had it, a press anywhere else closes it, and while
 * the keyboard is inside it the floor's single-letter keys stand down.
 *
 * Nothing here imports the renderer or touches a global: the document, the
 * shell and every action arrive as parameters, so a test drives it with a stub.
 * Every string that reaches the page goes through `textContent`.
 */

import { createLookParts } from './look-ui-parts.js';

/** The word for "let the floor decide", and what the six hues are called. */
export const ROOM_AUTO = 'auto';
export const ROOM_COLOUR_LABELS = Object.freeze({
  auto: 'Auto',
  sage: 'Sage',
  powder: 'Powder',
  lilac: 'Lilac',
  mint: 'Mint',
  straw: 'Straw',
  rose: 'Rose',
});

/** The six hue ids, in the floor's order: `look-ambience.js`'s `ZONE_HUES`, by name. */
export const ROOM_COLOUR_IDS = Object.freeze(
  Object.keys(ROOM_COLOUR_LABELS).filter((id) => id !== ROOM_AUTO),
);

/**
 * A build's own per-room rows, between Room colour and the room's places.
 * `{id, label, note?, node}` each, built with `ctx.parts`; this build has none.
 * @param {{project:any, room:Record<string,string>, parts:any,
 *   setRoom:(field:string, value:string) => Promise<any>}} _ctx
 * @returns {Array<{id:string, label:string, note?:string, node:any}>}
 */
export function roomExtraRows(_ctx) {
  return [];
}

/**
 * @param {object} opts
 * @param {any} opts.doc          `document`, or a stub
 * @param {any} opts.hostEl       the empty popover shell
 * @param {() => any} opts.getSnapshot
 * @param {(projectId:string) => {x:number, y:number, w:number, h:number}|null} opts.anchorFor
 *   where that room's title bar is, in the window's own pixels
 * @param {Record<string, Function>} opts.actions `filterToProject`, `newAgent`,
 *   `pinProject`, `showWhiteboard`, `revealFolder`
 * @param {(patch:Record<string, unknown>) => Promise<any>} opts.saveSetting
 * @param {ReadonlyArray<string>} opts.colours the hue ids, in the floor's order
 * @param {(id:string) => string} [opts.swatchOf] a hue's own colour, for its dot
 * @param {() => boolean} [opts.coloursShown] are rooms coloured at all right now
 * @param {(ctx:any) => any[]} [opts.extraRows]
 */
export function createRoomMenu(opts) {
  const { doc, hostEl, getSnapshot, anchorFor, actions, saveSetting } = opts;
  const extraRows = opts.extraRows || roomExtraRows;
  /** @type {string|null} */
  let openFor = null;
  /** What had the keyboard before, to hand it back. @type {any} */
  let opener = null;
  let focusKey = '';
  /** @type {Map<string, any>} */
  const stops = new Map();
  const parts = createLookParts({ doc, stops, onPick: (key) => (focusKey = key) });
  const { el } = parts;

  const projectOf = (/** @type {string} */ id) =>
    (getSnapshot()?.projects || []).find((/** @type {any} */ p) => p.id === id) || null;
  const roomsOf = () => ({ ...(getSnapshot()?.settings?.rooms || {}) });

  /** Write one field of one room: the whole map goes, as every setting does. */
  async function setRoom(/** @type {string} */ field, /** @type {string} */ value) {
    if (!openFor) return null;
    const rooms = roomsOf();
    const mine = { ...(rooms[openFor] || {}) };
    if (value === ROOM_AUTO) delete mine[field];
    else mine[field] = value;
    if (Object.keys(mine).length) rooms[openFor] = mine;
    else delete rooms[openFor];
    const saved = await saveSetting({ rooms });
    if (openFor) render();
    return saved;
  }

  /** One row that is a single press. */
  function item(/** @type {any} */ host, key, label, hint, run) {
    const btn = el('button', 'room-menu-item');
    btn.type = 'button';
    btn.append(el('span', 'room-menu-label', label), el('span', 'room-menu-hint', hint));
    btn.addEventListener('click', () => {
      close();
      run();
    });
    host.appendChild(parts.stop(key, btn));
  }

  function render() {
    const project = openFor ? projectOf(openFor) : null;
    if (!project) return close();
    stops.clear();
    hostEl.textContent = '';
    hostEl.setAttribute('aria-label', `Room settings: ${project.name}`);
    const head = el('div', 'room-menu-head');
    head.append(
      el('span', 'room-menu-title', project.name),
      el('span', 'lookbar-note', 'this room'),
    );
    hostEl.appendChild(head);

    const id = project.id;
    item(hostEl, 'only', 'Show only this room', 'the queue and the panel', () =>
      actions.filterToProject(id),
    );
    item(hostEl, 'new', 'New agent here', 'another session in this project', () =>
      actions.newAgent(id),
    );
    if (project.pinned)
      item(hostEl, 'pin', 'Unpin', 'let it go when nobody is in it', () =>
        actions.pinProject(id, false),
      );
    else
      item(hostEl, 'pin', 'Pin this room', 'keep it when nobody is in it', () =>
        actions.pinProject(id, true),
      );

    // ROOM COLOUR: which of the six this room is, where rooms are coloured.
    const room = roomsOf()[id] || {};
    const shown = opts.coloursShown ? opts.coloursShown() : true;
    const row = el('div', 'lookbar-row');
    const rowHead = el('div', 'lookbar-row-head');
    rowHead.append(
      el('span', 'lookbar-label', 'Room colour'),
      el('span', 'lookbar-note', shown ? 'for this room' : 'shows when Room colours is on'),
    );
    const choice = parts.radioGroup({
      name: 'colour',
      label: 'Room colour',
      className: 'lookbar-seg room-menu-colours',
      itemClass: 'lookbar-seg-btn',
      options: [ROOM_AUTO, ...opts.colours].map((c) => {
        const dot = el('i', 'room-menu-dot');
        const tone = c === ROOM_AUTO ? '' : opts.swatchOf?.(c) || '';
        if (tone) dot.style.background = tone;
        dot.setAttribute('aria-hidden', 'true');
        return {
          id: c,
          label: ROOM_COLOUR_LABELS[/** @type {keyof typeof ROOM_COLOUR_LABELS} */ (c)] || c,
          parts: c === ROOM_AUTO ? [] : [dot],
        };
      }),
      value: room.colour || ROOM_AUTO,
      onChange: (/** @type {string} */ next) => void setRoom('colour', next),
    });
    row.append(rowHead, choice);
    hostEl.appendChild(row);

    // THE SLOT: a build's own per-room rows. Nothing returned, nothing drawn.
    let rows = [];
    try {
      rows = extraRows({ project, room, parts, setRoom }) || [];
    } catch {
      rows = [];
    }
    for (const r of rows) {
      if (!r || !r.node) continue;
      const wrap = el('div', 'lookbar-row');
      const h = el('div', 'lookbar-row-head');
      h.appendChild(el('span', 'lookbar-label', String(r.label || '')));
      if (r.note) h.appendChild(el('span', 'lookbar-note', String(r.note)));
      wrap.append(h, r.node);
      hostEl.appendChild(wrap);
    }

    item(hostEl, 'board', 'Open the board', 'who is in it, tokens today', () =>
      actions.showWhiteboard(id),
    );
    item(hostEl, 'folder', 'Open folder', 'this project on disk', () => actions.revealFolder(id));
    hostEl
      .appendChild(el('div', 'lookbar-foot room-menu-foot'))
      .appendChild(el('span', 'lookbar-foot-keys', 'Esc to close'));
    if (focusKey) stops.get(focusKey)?.focus?.();
  }

  function place() {
    const at = openFor ? anchorFor(openFor) : null;
    if (!at) return;
    const vw = Number(doc.documentElement?.clientWidth) || 1200;
    const left = Math.max(8, Math.min(at.x, vw - 340));
    hostEl.style.left = `${Math.round(left)}px`;
    hostEl.style.top = `${Math.round(at.y + at.h + 6)}px`;
  }

  /** @param {any} e */
  function onDocKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault?.();
    e.stopPropagation?.();
    close({ focus: true });
  }
  /** @param {any} e */
  function onDocPointerDown(e) {
    if (e.target && hostEl.contains?.(e.target)) return;
    close();
  }

  /** @param {string} projectId */
  function open(projectId) {
    if (!projectOf(projectId)) return false;
    if (openFor) close();
    openFor = projectId;
    opener = doc.activeElement || null;
    focusKey = '';
    hostEl.hidden = false;
    render();
    place();
    doc.addEventListener('keydown', onDocKeydown, true);
    doc.addEventListener('pointerdown', onDocPointerDown, true);
    stops.get('only')?.focus?.();
    return true;
  }

  /** @param {{focus?:boolean}} [how] */
  function close(how = {}) {
    if (!openFor) return;
    openFor = null;
    hostEl.hidden = true;
    hostEl.textContent = '';
    stops.clear();
    doc.removeEventListener('keydown', onDocKeydown, true);
    doc.removeEventListener('pointerdown', onDocPointerDown, true);
    if (how.focus) opener?.focus?.();
    opener = null;
  }

  hostEl.addEventListener('keydown', (/** @type {any} */ e) => {
    // A chord is the palette's and Tab is the browser's; every other key stops
    // here, so `B` with this open does not bench somebody.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || e.key === 'Escape') return;
    e.stopPropagation?.();
  });

  return {
    open,
    close,
    isOpen: () => openFor !== null,
    openFor: () => openFor,
    /** A snapshot arrived: the room may have gone, or been pinned elsewhere. */
    refresh() {
      if (openFor) render();
    },
  };
}
