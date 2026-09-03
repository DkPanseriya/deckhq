/**
 * Three sounds, synthesised in the browser.
 *
 * WP-15, `docs/plan/05-GUI-UX-SPEC.md` §8. `settings.sound` has existed since
 * v1 and has never been wired to anything; this is what makes it real.
 *
 * | Event | Sound |
 * |---|---|
 * | `for_review` entry | a low wooden door-close — two quick filtered noise bursts, 180 ms |
 * | `needs_input` entry | two soft knocks, ~140 ms apart |
 * | office cleared | a rising two-note chime, 400 ms |
 *
 * **No asset files, no fetches, nothing to bundle.** Every one of these is
 * built from an oscillator, a noise buffer and a filter, which is also the
 * only implementation compatible with the free core's rule that there are no
 * CDN assets and no network calls of any kind.
 *
 * §8's closing line is the constraint the whole module is shaped by: *"Three
 * sounds, a handful of times a day. Any more and it becomes a thing people
 * turn off, and a sound that is off is worse than no sound because it took a
 * setting to get there."* So the scheduler is deliberately stingy, and its
 * rules are a pure function (`decide`) that can be asserted without a browser
 * — an audio bug is otherwise the hardest kind of bug to see in a test.
 */

/**
 * The notification coalescing window (`app.js`'s `NOTIFY_COALESCE_MS`).
 * Sound is rate-limited to the same window on purpose: the two channels are
 * reporting the same events, and a floor that goes quiet for ten seconds
 * between toasts but keeps clicking is worse than either alone.
 */
export const SOUND_COALESCE_MS = 10_000;

/** What each event is called, and what it is allowed to do. */
export const SOUNDS = /** @type {const} */ (['door', 'knock', 'chime']);

/** Volume when `soundVolume` is missing. Matches `DEFAULT_SETTINGS.soundVolume`. */
export const DEFAULT_VOLUME = 0.3;

/**
 * Whether a sound may be played, and if not, why not.
 *
 * The four rules, in the order they are checked:
 *
 *  1. **Muted.** `settings.sound` is the master switch and one palette
 *     keystroke away (`⌘K` → `u`). Off means off, for every sound.
 *  2. **Volume zero.** Nothing to hear, so nothing to schedule.
 *  3. **The OS already said it.** §8: silent when the tab is hidden *and* the
 *     OS notification is doing the work. Both halves matter — a hidden tab
 *     with no notification (permission denied, or a state that does not
 *     interrupt) is exactly when the sound is the only signal there is.
 *  4. **The coalescing window.** At most one sound per window, whatever fired
 *     it. Three sessions finishing together is one door, not three.
 *
 * @param {{lastPlayedAt: number}} state
 * @param {{kind: string, now: number, hidden?: boolean, notified?: boolean,
 *          settings?: {sound?: boolean, soundVolume?: number},
 *          coalesceMs?: number}} ctx
 * @returns {{play: boolean, reason: string, volume: number}}
 */
export function decide(state, ctx) {
  const settings = ctx.settings || {};
  const volume = clampVolume(settings.soundVolume);
  if (settings.sound !== true) return { play: false, reason: 'muted', volume };
  if (volume <= 0) return { play: false, reason: 'volume-zero', volume };
  if (ctx.hidden && ctx.notified) return { play: false, reason: 'os-notified', volume };
  const window_ = ctx.coalesceMs ?? SOUND_COALESCE_MS;
  if (ctx.now - state.lastPlayedAt < window_) return { play: false, reason: 'coalesced', volume };
  return { play: true, reason: 'ok', volume };
}

/** @param {unknown} v */
function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, n));
}

// ------------------------------------------------------------- the synths
//
// Each takes an AudioContext, a start time and a peak gain, and returns the
// time it finishes. Nothing here reads global state, so the three can be
// rendered offline and their envelopes measured.

/**
 * Makeup gain for the two noise sounds.
 *
 * Measured, not guessed. Rendered through a real `OfflineAudioContext` at
 * `soundVolume` 0.4, the door and the knocks peaked at **0.069** and
 * **0.093** against the chime's **0.396** — about 15 dB down, because a
 * lowpass at 380–1600 Hz throws away most of white noise's energy while an
 * oscillator loses none of its own. Left uncompensated the door would have
 * been inaudible beside the celebration, which is exactly backwards: the
 * door is the sound that happens several times an hour.
 *
 * At ×3 the three land at roughly 0.21, 0.28 and 0.40 — all audible, the
 * chime still plainly the loudest, which is the ordering §8 wants.
 */
const NOISE_MAKEUP = 3;

/**
 * A short burst of filtered noise: the body of a knock, and half a door.
 * @param {BaseAudioContext} ac
 * @param {AudioNode} dest
 * @param {{at:number, ms:number, gain:number, cutoff:number, q?:number}} o
 */
function noiseBurst(ac, dest, o) {
  const frames = Math.max(1, Math.round((ac.sampleRate * o.ms) / 1000));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  // A deterministic pseudo-random source rather than Math.random: two door
  // closes a second apart should be the same door.
  let seed = 0x9e3779b9;
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = o.cutoff;
  filter.Q.value = o.q ?? 0.9;

  const gain = ac.createGain();
  const t = o.at;
  const dur = o.ms / 1000;
  // Not clamped to 1: this is the gain *before* a lowpass that throws most of
  // it away, and clamping it made the volume slider stop doing anything to
  // the door above about a third — measured, the door peaked at 0.187 at
  // volume 1.0 against 0.164 at 0.4. The output is checked for clipping
  // instead, at the top of the slider, where it peaks near 0.5.
  const peak = o.gain * NOISE_MAKEUP;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filter).connect(gain).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
  return t + dur;
}

/**
 * A soft sine with a plucked envelope: the chime's two notes.
 * @param {BaseAudioContext} ac
 * @param {AudioNode} dest
 * @param {{at:number, ms:number, gain:number, hz:number}} o
 */
function tone(ac, dest, o) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = o.hz;

  const gain = ac.createGain();
  const t = o.at;
  const dur = o.ms / 1000;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return t + dur;
}

/**
 * §8's door-close: "two quick filtered noise bursts, 180 ms". The first is
 * the latch, the second the frame — low, wooden, and over before anyone has
 * decided whether they heard it.
 * @param {BaseAudioContext} ac
 * @param {AudioNode} dest
 * @param {number} at
 * @param {number} gain
 */
export function door(ac, dest, at, gain) {
  noiseBurst(ac, dest, { at, ms: 55, gain: gain * 0.55, cutoff: 900 });
  noiseBurst(ac, dest, { at: at + 0.09, ms: 90, gain, cutoff: 380, q: 1.2 });
  return at + 0.18;
}

/**
 * §8's two soft knocks, 140 ms apart. Higher and drier than the door, because
 * a hand going up is a question and a door closing is a fact.
 * @param {BaseAudioContext} ac
 * @param {AudioNode} dest
 * @param {number} at
 * @param {number} gain
 */
export function knock(ac, dest, at, gain) {
  noiseBurst(ac, dest, { at, ms: 45, gain, cutoff: 1600, q: 1.4 });
  noiseBurst(ac, dest, { at: at + 0.14, ms: 45, gain: gain * 0.85, cutoff: 1600, q: 1.4 });
  return at + 0.19;
}

/**
 * §8's rising two-note chime, 400 ms. A perfect fifth up (A5 to E6): the
 * shortest interval that unambiguously reads as *resolved* rather than as
 * another alert. This is the product's one celebration, so it is the only
 * one of the three with any pitch in it at all.
 * @param {BaseAudioContext} ac
 * @param {AudioNode} dest
 * @param {number} at
 * @param {number} gain
 */
export function chime(ac, dest, at, gain) {
  tone(ac, dest, { at, ms: 220, gain: gain * 0.8, hz: 880 });
  tone(ac, dest, { at: at + 0.15, ms: 250, gain, hz: 1318.5 });
  return at + 0.4;
}

/** The three, by the name the scheduler uses. */
export const SYNTHS = { door, knock, chime };

/**
 * The player.
 *
 * The `AudioContext` is created on first use rather than at load, and it is
 * never created just to be suspended: a browser that has had no user gesture
 * yet will refuse to start one, and an autoplay warning in the console for a
 * product that has made no sound is noise. `unlock()` is what a real gesture
 * calls.
 *
 * @param {object} opts
 * @param {() => any} opts.getSettings
 * @param {() => boolean} [opts.isHidden]
 * @param {() => number} [opts.now]
 * @param {() => (AudioContext|null)} [opts.makeContext]  injectable for tests
 */
export function createSounds(opts) {
  const getSettings = opts.getSettings;
  const isHidden = opts.isHidden || (() => typeof document !== 'undefined' && document.hidden);
  const now = opts.now || (() => Date.now());
  const makeContext =
    opts.makeContext ||
    (() => {
      const Ctor =
        typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      return Ctor ? new Ctor() : null;
    });

  /** @type {AudioContext|null} `BaseAudioContext` has no `resume()`, which is
   * the one method the suspended-context path calls (WP-22). */
  let ac = null;
  const state = { lastPlayedAt: -Infinity };

  function context() {
    if (ac) return ac;
    try {
      ac = makeContext();
    } catch {
      ac = null;
    }
    return ac;
  }

  return {
    /**
     * Try to play one sound. Returns the scheduler's decision either way, so
     * the caller (and the test suite) can see *why* nothing happened.
     * @param {'door'|'knock'|'chime'} kind
     * @param {{notified?: boolean}} [o]
     */
    play(kind, o = {}) {
      const verdict = decide(state, {
        kind,
        now: now(),
        hidden: isHidden(),
        notified: Boolean(o.notified),
        settings: getSettings() || {},
      });
      if (!verdict.play) return verdict;

      const ctx = context();
      if (!ctx) return { ...verdict, play: false, reason: 'no-audio' };
      // A context the browser has suspended (no gesture yet) is asked once and
      // never nagged; the sound is simply lost, which is the correct outcome
      // for a product whose sounds are ambient.
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try {
          ctx.resume();
        } catch {
          /* nothing to do about it */
        }
      }
      state.lastPlayedAt = now();
      try {
        const master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        SYNTHS[kind](ctx, master, ctx.currentTime + 0.01, verdict.volume);
      } catch {
        return { ...verdict, play: false, reason: 'synth-failed' };
      }
      return verdict;
    },

    /**
     * Called from a real user gesture so the context is allowed to start.
     * Creating it here rather than on the first sound is what makes the first
     * door audible instead of swallowed.
     */
    unlock() {
      const ctx = context();
      if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
    },

    /** For tests: what the scheduler currently thinks. */
    _state: state,
  };
}
