/**
 * The office snapshot: `S` photographs the floor, `Shift+S` redacts it first.
 *
 * Split out of `app.js` by WP-22. WP-14's rule is that the picture is composed
 * from the same model the floor was drawn from, never scraped off the screen,
 * so everything here goes through `snapshot.js` and the only DOM it touches is
 * the canvas it copies and the computed styles it reads.
 */

import {
  MAX_PNG_BYTES,
  MIN_SCALE,
  composite,
  nextScaleDown,
  pngBytes,
  snapshotModel,
  stripColors,
} from './snapshot.js';
import { el, latestSnapshot, scene, toast } from './app-state.js';

/**
 * Whether `S` redacts. A property of this tab, not of the machine — the same
 * reasoning as `letGoVisible`: "am I about to screenshot this for people who
 * cannot see my project names" is a decision about the next keystroke, not a
 * preference to persist. `Shift+S` toggles it and says so.
 */
export let redactSnapshots = false;

/** Cached `/api/about`. The hostname is the only field `S` needs, and it never changes. */
export let aboutCache = null;
export async function about() {
  if (aboutCache) return aboutCache;
  try {
    const res = await fetch('/api/about');
    if (res.ok) aboutCache = await res.json();
  } catch (err) {
    console.debug('[deckhq] /api/about unavailable', err);
  }
  return aboutCache || {};
}

/** True while a capture is running, so holding `S` down cannot start twenty. */
export let capturing = false;
/**
 * One capture at a time, whichever surface asked. WP-22 put the snapshot and
 * the day's card in two files; the guard stayed one guard.
 * @param {boolean} v
 */
export function setCapturing(v) {
  capturing = v;
}

/**
 * `S` — composite the floor and a stat strip into a PNG, put it on the
 * clipboard, and save it. WP-14 /
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.2.
 *
 * The redaction path is the interesting part. Project names are on the room
 * plates, which the renderer paints from the snapshot it was last given — and
 * `public/render/**` belongs to another package, so there is no "give me a
 * redacted frame" entry point to call. There is, however, `Scene.setState`,
 * which is public and is exactly "draw this". So: stop the loop, hand the
 * renderer the redacted snapshot (which it draws synchronously while stopped),
 * capture, hand back the real one, restart. Redaction therefore covers the
 * plates as well as the strip, which is what §3.2 asks for and what a control
 * called "redact" has to mean.
 *
 * Stopping the loop first is also what makes this work in a backgrounded tab:
 * a stopped Scene draws on `setState` rather than on the next frame, and
 * `pngBytes` is synchronous, so no part of the capture waits for a
 * `requestAnimationFrame` that a hidden tab will never fire.
 */
export async function takeSnapshot() {
  if (capturing) return;
  if (!latestSnapshot) return;
  if (el.canvas.hidden) {
    toast('There is no floor to photograph yet.', { isError: true });
    return;
  }
  capturing = true;
  const wasRunning = Boolean(scene) && !document.hidden;
  try {
    const { hostname } = await about();
    const model = snapshotModel(latestSnapshot, { hostname, redact: redactSnapshots });

    if (scene && redactSnapshots) {
      try {
        scene.stop();
        scene.setState(model.source);
      } catch (err) {
        console.warn('[deckhq] could not redact the floor for the snapshot', err);
        // Never ship a picture that claims to be redacted and is not.
        toast('Could not redact the floor, so nothing was captured.', { isError: true });
        return;
      }
    }

    const colors = stripColors(document);
    // The floor's own backing scale. Read here rather than inside the
    // compositor because a hidden tab reports no layout at all, so the
    // backing store plus this ratio is the only description of the floor's
    // size that survives being backgrounded.
    const dpr = window.devicePixelRatio || 1;
    let scale = Math.max(MIN_SCALE, Math.round(dpr));
    let bytes = null;
    for (;;) {
      const out = composite({ floor: el.canvas, model, scale, dpr, colors, ...snapshotFonts() });
      bytes = pngBytes(out);
      if (bytes.length <= MAX_PNG_BYTES) break;
      const next = nextScaleDown(scale);
      if (next === null || next === scale) break;
      scale = next;
    }

    const oversize = bytes.length > MAX_PNG_BYTES;
    const copied = await copyPng(bytes);
    const saved = await saveSnapshot(bytes);
    reportSnapshot({ copied, saved, oversize, bytes: bytes.length });
  } finally {
    // Whatever happened, the floor goes back to showing the truth.
    if (scene && redactSnapshots) {
      try {
        scene.setState(latestSnapshot);
        if (wasRunning) scene.start();
      } catch (err) {
        console.warn('[deckhq] could not restore the floor after a snapshot', err);
      }
    }
    capturing = false;
  }
}

/** The two faces the strip uses, taken from the stylesheet rather than restated. */
export function snapshotFonts() {
  let style;
  try {
    style = getComputedStyle(document.documentElement);
  } catch {
    return {};
  }
  return {
    fontSans: style.getPropertyValue('--font-sans').trim() || undefined,
    fontMono: style.getPropertyValue('--font-mono').trim() || undefined,
  };
}

/**
 * Put the PNG on the clipboard. Refused permission, an unfocused tab and a
 * browser without `ClipboardItem` all degrade to `false` rather than throwing:
 * the file on disk is the durable half, and the toast says which half landed.
 * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: a `Blob` cannot be
 * built from a view over a `SharedArrayBuffer`, and the PNG encoder never
 * produces one (WP-22).
 * @param {Uint8Array<ArrayBuffer>} bytes
 */
export async function copyPng(bytes) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem !== 'function') return false;
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (err) {
    console.debug('[deckhq] clipboard write refused', err);
    return false;
  }
}

/**
 * POST the bytes to the daemon, which names the file and writes it.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<string|null>} the path written, or null
 */
export async function saveSnapshot(bytes) {
  try {
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.file || null;
  } catch (err) {
    console.debug('[deckhq] snapshot save failed', err);
    return null;
  }
}

/** One toast that says exactly what happened, in the order the user cares about. */
export function reportSnapshot({ copied, saved, oversize, bytes }) {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const what = redactSnapshots ? 'Redacted snapshot' : 'Snapshot';
  if (!copied && !saved) {
    toast(`${what} could not be copied or saved.`, { isError: true });
    return;
  }
  const parts = [];
  if (copied) parts.push('on the clipboard');
  if (saved) parts.push(`saved to ${saved}`);
  const tail = oversize ? ` It is ${mb} MB, over the 2 MB target.` : '';
  toast(`${what} ${parts.join(' and ')}.${tail}`);
}

/** `Shift+S`. A toggle that says which way it went, because the next `S` acts on it. */
export function toggleRedaction() {
  redactSnapshots = !redactSnapshots;
  toast(
    redactSnapshots
      ? 'Redaction on. S swaps every project name for its MK tag, on the floor and in the strip.'
      : 'Redaction off. S shows project names.',
  );
}
