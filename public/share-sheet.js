/**
 * "Share picture of the floor…" — the sheet, and the second floor behind it.
 *
 * `X`, the palette row, or the button on a snapshot's toast. A small sheet: a
 * live preview, three switches, a frame, then a PNG in `~/.deckhq/snapshots/`
 * and, if asked, on the clipboard.
 *
 * NOTHING IS SENT ANYWHERE. "Share" here means a file and the clipboard. This
 * module talks to the daemon on this machine and to nothing else: it posts the
 * PNG to the route `S` already uses, and asks for the folder to be opened.
 *
 * HOW THE PICTURE IS MADE, and why it is not a screenshot. The floor you are
 * looking at is the wrong size, the wrong shape and has real names on it. So
 * the sheet keeps a SECOND scene — the same `Scene` class, the same painters,
 * the same theme and look, because those are module state the two share — on
 * a canvas of its own, off screen, exactly the frame's size at 2x. That scene
 * is only ever given the REDACTED snapshot (`share-redact.js`). The real one
 * never reaches it, so there is no moment at which a real name is on the
 * canvas the picture is copied from, and nothing to paint over.
 *
 * The live floor is not touched: it is not stopped, not handed another state,
 * not resized. (`Shift+S` does all three, which is right for a photograph of
 * the window and wrong for a preview that stays open.)
 *
 * THE INVARIANT (docs/01-PRODUCT.md §2) is out of reach from here by
 * construction: nothing in this file calls `/api/ack` or the panel, and the
 * second scene has no click handler wired to anything.
 */

import { el, latestSnapshot, sceneModule, toast } from './app-state.js';
import { pngBytes, stripColors } from './snapshot.js';
import { redactForShare } from './share-redact.js';
import {
  SHARE_MARGIN,
  SHARE_SCALE,
  SHARE_SHAPES,
  composeSharePicture,
  shareFooterModel,
  shareLayout,
} from './share-picture.js';
import { setDeviceScale } from './render/device-px.js';

/** The one line the sheet says about where the picture goes. */
export const SHARE_NOTE =
  'Nothing is uploaded: the picture is saved as a PNG on this machine and, if you ask, copied ' +
  'to your clipboard. DeckHQ makes no network call.';

/** The three switches, in order, with what each one means in a sentence. */
export const SHARE_SWITCHES = Object.freeze([
  {
    key: 'hideProjects',
    label: 'Hide project names',
    note: 'Rooms get neutral names; a worktree’s bench reads “branch 1”.',
  },
  {
    key: 'hideDetails',
    label: 'Hide session details',
    note: 'No titles, tool text or model. Robot names and wait times stay.',
  },
  {
    key: 'footer',
    label: 'Add the footer',
    note: 'The DeckHQ mark, the floor’s own numbers and deckhq.dev.',
  },
]);

/**
 * What the sheet opens with, EVERY time. The switches are not remembered: a
 * person who turned hiding off for one picture must not find it off for the
 * next one, a week later, without having looked.
 */
export const SHARE_DEFAULTS = Object.freeze({
  hideProjects: true,
  hideDetails: true,
  footer: true,
  shape: 'wide',
});

/** @type {{hideProjects:boolean, hideDetails:boolean, footer:boolean, shape:string}} */
let options = { ...SHARE_DEFAULTS };
/** @type {any} the sheet's elements, built on first use */
let ui = null;
/** @type {any} the second scene, alive only while the sheet is open */
let picScene = null;
/** @type {HTMLCanvasElement|null} the composed picture the preview shows */
let picture = null;
/** @type {Uint8Array<ArrayBuffer>|null} its PNG, encoded once per picture */
let pictureBytes = null;
/** The snapshot the picture was last drawn from, to notice a newer one. */
let drawnFrom = null;
let watcher = 0;

/**
 * The four things the sheet does not do itself: put bytes on the clipboard,
 * post them to the daemon, read the chrome's fonts, and hold the one capture
 * guard `S` holds. They are `app-snapshot.js`'s, and they are HANDED IN when
 * the sheet opens rather than imported: that module is what loads this one, on
 * first use, and importing it back would close a cycle
 * (`test/unit/client-graph.test.mjs`).
 * @typedef {object} ShareIo
 * @property {(bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>} copyPng
 * @property {(bytes: Uint8Array<ArrayBuffer>) => Promise<string|null>} saveSnapshot
 * @property {() => {fontSans?: string, fontMono?: string}} snapshotFonts
 * @property {() => boolean} busy
 * @property {(v: boolean) => void} setBusy
 */
/** @type {ShareIo} */
let io;

/** @type {any} `PictureScene`, made once the renderer's `Scene` is known */
let PictureSceneClass = null;

/** The box the building is fitted to: the frame, less the margin on every side. */
function insetBox(w, h) {
  return { w: Math.max(1, w - SHARE_MARGIN * 2), h: Math.max(1, h - SHARE_MARGIN * 2) };
}

/**
 * The floor's own `Scene`, with the three things a picture needs different.
 *
 * It is a subclass rather than a second renderer on purpose: every painter,
 * the plan, the seats and the label pass are inherited untouched, so the
 * picture cannot drift from the floor. What changes is where the SIZE comes
 * from, and two things a picture has no use for.
 * @param {any} Scene `public/render/scene.js`'s class
 */
function pictureSceneClass(Scene) {
  return class PictureScene extends Scene {
    /**
     * The frame's size and `SHARE_SCALE`, not this window's box and this
     * display's pixel ratio. The canvas says how big it is meant to be; a 1x
     * laptop and a 3x phone make the same 3520 x 1980 picture.
     */
    _resizeCanvasBacking() {
      const w = Number(this.canvas.dataset.w) || SHARE_SHAPES.wide.w;
      const h = Number(this.canvas.dataset.h) || SHARE_SHAPES.wide.h;
      this._dpr = SHARE_SCALE;
      setDeviceScale(this.ctx, this._dpr);
      // Kept here as well as measured by the camera: a background tab reports
      // no layout at all, and then these are the only size there is.
      this._viewW = w;
      this._viewH = h;
      const pw = Math.round(w * SHARE_SCALE);
      const ph = Math.round(h * SHARE_SCALE);
      if (this.canvas.width !== pw) this.canvas.width = pw;
      if (this.canvas.height !== ph) this.canvas.height = ph;
    }

    /**
     * The building is fitted to the frame LESS A MARGIN, and centred in it.
     *
     * On screen the floor runs to the edge of its stage, which is right for a
     * window and wrong for a picture: a room plate that sits on the top wall
     * is cut by the edge, and a floor with no ground round it reads as a crop.
     * So the scale is the one that fits the frame inset by `SHARE_MARGIN`, and
     * the camera — which centres any floor smaller than its stage — does the
     * rest. The margin is the floor's own ground and the building's own
     * shadow, painted by the painter that paints them on screen.
     */
    _recomputeFitScale() {
      super._recomputeFitScale();
      if (!this._plan) return;
      const { computeFill, snapScaleToDevice } = sceneModule;
      const inner = insetBox(this._viewW, this._viewH);
      const fit = computeFill(this._plan.width, this._plan.height, inner.w, inner.h).scale;
      this._fitScale = snapScaleToDevice(fit, this._plan.width, this._dpr);
      this._clampCamera();
    }

    /** The building is planned for the shape it will be fitted to: the inset one. */
    _rebuildPlan() {
      const inner = insetBox(this._viewW, this._viewH);
      super._rebuildPlan(sceneModule.computeTargetAspect(inner.w, inner.h));
    }

    /** A frame never changes size, so there is no settled resize to re-plan for. */
    _checkAspectRebuild() {}

    /** The in-room "+" is a control. A picture has nothing to click. */
    _drawPlusAffordance() {}

    /**
     * Put everybody where they are going, and draw.
     *
     * This scene's loop never runs, so an agent whose state changed between
     * two snapshots would be given a path and never walk it. A still picture
     * wants the seat, not the walk: one step with motion reduced snaps each
     * walker to the end of its path (`stepAgent`), and nothing else moves.
     */
    settle() {
      this._runtime.step(0, { reduced: true, plan: this._plan, now: sceneModule.animMs() });
      this._draw();
    }
  };
}

/**
 * @param {string} tag @param {Record<string, any>} [props]
 * @param {(Node|string)[]} [children]
 * @returns {any}
 */
function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

/** One `On`/`Off` button, in the vocabulary every other toggle here uses. */
function setPressed(button, on, words = ['On', 'Off']) {
  button.setAttribute('aria-pressed', String(on));
  if (words) button.textContent = on ? words[0] : words[1];
}

/** Build the sheet. Once; it is reused, and reset, on every open. */
function build() {
  const preview = h('canvas', { class: 'share-preview-canvas', role: 'img' });
  const status = h('p', { class: 'share-status', role: 'status', 'aria-live': 'polite' });
  /** @type {Record<string, HTMLButtonElement>} */
  const switches = {};
  const rows = SHARE_SWITCHES.map((s) => {
    const button = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'true' });
    button.addEventListener('click', () => {
      options = { ...options, [s.key]: !options[s.key] };
      say('');
      refresh();
    });
    switches[s.key] = button;
    const label = h('span', { class: 'share-switch-text' }, [
      h('span', { class: 'field-label', text: s.label }),
      h('span', { class: 'field-note', text: s.note }),
    ]);
    return h('div', { class: 'toggle-row share-switch' }, [label, button]);
  });

  /** @type {Record<string, HTMLButtonElement>} */
  const shapes = {};
  const shapeRow = h('div', { class: 'toggle-row share-switch' }, [
    h('span', { class: 'field-label', text: 'Frame' }),
    h(
      'span',
      { class: 'share-shapes', role: 'group', 'aria-label': 'Frame' },
      Object.values(SHARE_SHAPES).map((shape) => {
        const button = h('button', { type: 'button', class: 'btn', text: shape.label });
        button.addEventListener('click', () => {
          options = { ...options, shape: shape.id };
          say('');
          refresh();
        });
        shapes[shape.id] = button;
        return button;
      }),
    ),
  ]);

  const reveal = h('button', { type: 'button', class: 'btn', text: 'Reveal file', hidden: '' });
  const copy = h('button', { type: 'button', class: 'btn', text: 'Copy image' });
  const save = h('button', { type: 'button', class: 'btn btn--primary', text: 'Save picture' });
  reveal.addEventListener('click', revealFile);
  copy.addEventListener('click', copyPicture);
  save.addEventListener('click', savePicture);

  const close = h('button', { type: 'submit', class: 'icon-btn', 'aria-label': 'Close' });
  close.textContent = '×';
  const dialog = h(
    'dialog',
    { id: 'share-dialog', class: 'dialog dialog--share', 'aria-labelledby': 'share-title' },
    [
      h('form', { method: 'dialog', class: 'dialog-head' }, [
        h('h2', { id: 'share-title', text: 'Share picture of the floor' }),
        close,
      ]),
      h('div', { class: 'dialog-body' }, [
        h('div', { class: 'share-preview' }, [preview]),
        ...rows,
        shapeRow,
        h('p', { class: 'share-note', text: SHARE_NOTE }),
        status,
      ]),
      h('div', { class: 'dialog-foot' }, [reveal, copy, save]),
    ],
  );
  // Where the second scene's canvas lives: laid out at its real size so the
  // renderer measures a real box, and never seen.
  const stage = h('div', { class: 'share-stage', 'aria-hidden': 'true' });
  dialog.addEventListener('close', teardown);
  document.body.append(dialog, stage);
  ui = { dialog, preview, status, switches, shapes, reveal, copy, save, stage };
}

/**
 * The second scene, at this frame's size. Made when the sheet opens and again
 * when the frame changes; it is the one costly thing here (a plan and a bake).
 *
 * AND WHEN A SWITCH CHANGES. A room's name is written into the plan when the
 * plan is built, and a plan is rebuilt only when the building changes — which
 * hiding a name does not. A scene that had drawn real names would go on
 * drawing them from its plan after the switch said otherwise. So a scene
 * belongs to ONE setting of the switches: change one and the scene is thrown
 * away, and the next is built from nothing but the new copy.
 * @param {{w:number, floorH:number}} layout
 */
function sceneFor(layout) {
  const { w, floorH } = layout;
  const made = `${w}x${floorH}|${options.hideProjects}|${options.hideDetails}`;
  if (picScene && picScene.canvas.dataset.made === made) return picScene;
  dropScene();
  const canvas = h('canvas', { 'data-w': w, 'data-h': floorH, 'data-made': made });
  canvas.style.width = `${w}px`;
  canvas.style.height = `${floorH}px`;
  ui.stage.style.width = `${w}px`;
  ui.stage.style.height = `${floorH}px`;
  ui.stage.append(canvas);
  if (!PictureSceneClass) PictureSceneClass = pictureSceneClass(sceneModule.Scene);
  picScene = new PictureSceneClass(canvas);
  return picScene;
}

function dropScene() {
  if (picScene) {
    try {
      picScene.destroy();
    } catch (err) {
      console.debug('[deckhq] share scene did not shut down cleanly', err);
    }
  }
  picScene = null;
  if (ui) ui.stage.textContent = '';
}

/** How many project rooms the scene's plan has: what the band may call "rooms". */
function roomsDrawn(scene) {
  const plan = scene.frame().plan;
  const rooms = plan && Array.isArray(plan.rooms) ? plan.rooms : [];
  return rooms.filter((room) => room.kind === 'project').length;
}

/**
 * Draw the picture again from the floor as it is now, and show it.
 *
 * The order is the whole safety argument, so it is spelled out: the snapshot
 * is redacted FIRST, and the redacted copy is the only thing the scene, the
 * band and the preview are ever given.
 */
function refresh() {
  if (!ui || !ui.dialog.open || !latestSnapshot) return;
  for (const s of SHARE_SWITCHES) setPressed(ui.switches[s.key], options[s.key]);
  for (const [id, button] of Object.entries(ui.shapes)) {
    setPressed(button, id === options.shape, null);
  }
  const layout = shareLayout(options.shape, options.footer);
  try {
    const safe = redactForShare(latestSnapshot, {
      hideProjects: options.hideProjects,
      hideDetails: options.hideDetails,
    });
    const scene = sceneFor(layout);
    scene.setState(safe);
    scene.settle();
    picture = composeSharePicture({
      floor: scene.canvas,
      layout,
      footer: options.footer ? shareFooterModel(safe, { rooms: roomsDrawn(scene) }) : null,
      colors: stripColors(document),
      ...io.snapshotFonts(),
    });
  } catch (err) {
    console.warn('[deckhq] could not draw the share picture', err);
    picture = null;
    say('The picture could not be drawn, so there is nothing to save.', true);
  }
  pictureBytes = null;
  drawnFrom = latestSnapshot;
  ui.copy.disabled = !picture;
  ui.save.disabled = !picture;
  paintPreview(layout);
}

/** The picture, scaled into the sheet. What you see is what is saved. */
function paintPreview(layout) {
  const canvas = ui.preview;
  canvas.style.aspectRatio = `${layout.w} / ${layout.h}`;
  canvas.style.setProperty('--share-ratio', String(layout.w / layout.h));
  const cssW = canvas.clientWidth || 560;
  const k = Math.min(SHARE_SCALE, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * k);
  canvas.height = Math.round((cssW * k * layout.h) / layout.w);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!picture) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const hidden = [
    options.hideProjects ? 'project names hidden' : 'project names shown',
    options.hideDetails ? 'session details hidden' : 'session details shown',
  ];
  canvas.setAttribute('aria-label', `Preview of the picture: ${hidden.join(', ')}.`);
}

/** @param {string} message @param {boolean} [isError] */
function say(message, isError = false) {
  if (!ui) return;
  ui.status.textContent = message;
  ui.status.classList.toggle('is-error', isError);
}

/** Is the sheet up? */
export function shareSheetOpen() {
  return Boolean(ui && ui.dialog.open);
}

/**
 * Open the sheet over the floor. `X`, the palette, or a snapshot's toast.
 * Refuses, in a sentence, when there is no floor to draw.
 * @param {ShareIo} handed
 */
export function openShareSheet(handed) {
  if (shareSheetOpen()) return;
  io = handed;
  if (!latestSnapshot || el.canvas.hidden || !sceneModule || !sceneModule.Scene) {
    toast('There is no floor to photograph yet.', { isError: true });
    return;
  }
  if (!ui) build();
  options = { ...SHARE_DEFAULTS };
  ui.reveal.hidden = true;
  say('');
  ui.dialog.showModal();
  // A dialog focuses its first control, which here is the ✕: Enter would shut
  // the sheet somebody just opened. Focus goes to what they came to do.
  ui.save.focus();
  refresh();
  // The floor goes on changing under the sheet, and the preview is live: a
  // newer snapshot is a newer picture. Compared by identity, once a second —
  // the root replaces `latestSnapshot` on every push and mutates nothing.
  window.clearInterval(watcher);
  watcher = window.setInterval(() => {
    // Shut, and nobody has said so yet: see `teardown`.
    if (!ui.dialog.open) teardown();
    else if (latestSnapshot !== drawnFrom && !io.busy()) refresh();
  }, 1000);
}

/**
 * Closing the sheet lets go of the second floor and its bitmaps.
 *
 * Called on the dialog's `close` event and, as a backstop, by the watcher. The
 * backstop is not belt and braces: Chrome delivers `close` with the next
 * animation frame, and a tab in the background has none — measured, the event
 * had not arrived a second and a half after `close()`. Without the watcher the
 * second floor would stay in memory until the tab was looked at again; and the
 * event arriving late must not tear down a sheet that has since been reopened,
 * which is what the first line is for.
 */
function teardown() {
  if (ui && ui.dialog.open) return;
  window.clearInterval(watcher);
  watcher = 0;
  dropScene();
  picture = null;
  pictureBytes = null;
  drawnFrom = null;
}

/** The picture as PNG bytes, encoded once however many buttons ask for it. */
function bytesOfPicture() {
  if (!picture) return null;
  if (!pictureBytes) pictureBytes = /** @type {Uint8Array<ArrayBuffer>} */ (pngBytes(picture));
  return pictureBytes;
}

/** How big a PNG is, for the status line. */
const megabytes = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** `Save picture`: to `~/.deckhq/snapshots/`, by the route and the rules `S` uses. */
async function savePicture() {
  const bytes = bytesOfPicture();
  if (!bytes || io.busy()) return;
  io.setBusy(true);
  ui.save.disabled = true;
  try {
    const file = await io.saveSnapshot(bytes);
    if (file) {
      say(`Saved to ${file} (${megabytes(bytes.length)}).`);
      ui.reveal.hidden = false;
    } else {
      say('The picture could not be saved. Copy image still works.', true);
    }
  } finally {
    io.setBusy(false);
    ui.save.disabled = !picture;
  }
}

/** `Copy image`: the same bytes, on the clipboard. */
async function copyPicture() {
  const bytes = bytesOfPicture();
  if (!bytes) return;
  const copied = await io.copyPng(bytes);
  if (copied) say('The picture is on your clipboard.');
  else
    say(
      'This browser would not put an image on the clipboard. Save picture writes the file.',
      true,
    );
}

/** `Reveal file`: the snapshots folder, in the file manager. The daemon knows where it is. */
async function revealFile() {
  try {
    const res = await fetch('/api/snapshot/reveal', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.debug('[deckhq] reveal failed', err);
    say('The folder could not be opened. The path above is where the file is.', true);
  }
}
