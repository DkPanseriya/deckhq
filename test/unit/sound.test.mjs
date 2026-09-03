/**
 * WP-15's three sounds, and the scheduler that decides whether to make one.
 *
 * The whole risk with audio is that it is the hardest thing in a product to
 * see going wrong: a sound that plays when it should not is a defect nobody
 * files, they just turn the setting off — and `docs/plan/05-GUI-UX-SPEC.md` §8
 * is explicit that a sound which is off is worse than no sound at all,
 * because it took a setting to get there.
 *
 * So the rules are a pure function and they are asserted one at a time, and
 * the synths are rendered into a recording stub so the envelopes and
 * durations can be measured rather than listened to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_VOLUME,
  SOUNDS,
  SOUND_COALESCE_MS,
  SYNTHS,
  createSounds,
  decide,
} from '../../public/sound.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const ON = { sound: true, soundVolume: 0.4 };
const fresh = () => ({ lastPlayedAt: -Infinity });

// --------------------------------------------------------- the scheduler

test('nothing plays unless the master switch is on', () => {
  assert.equal(decide(fresh(), { kind: 'door', now: 0, settings: {} }).reason, 'muted');
  assert.equal(
    decide(fresh(), { kind: 'door', now: 0, settings: { sound: false } }).reason,
    'muted',
  );
  // Not "truthy": the setting is a boolean in the store and a string arriving
  // here would be a bug somewhere else, not permission to make noise.
  assert.equal(
    decide(fresh(), { kind: 'door', now: 0, settings: { sound: 'yes' } }).reason,
    'muted',
  );
  assert.equal(decide(fresh(), { kind: 'door', now: 0, settings: ON }).play, true);
});

test('volume comes from the setting, and zero is silence rather than a quiet noise', () => {
  assert.equal(decide(fresh(), { kind: 'door', now: 0, settings: ON }).volume, 0.4);
  const zero = decide(fresh(), { kind: 'door', now: 0, settings: { sound: true, soundVolume: 0 } });
  assert.equal(zero.play, false);
  assert.equal(zero.reason, 'volume-zero');
  // Out of range, and absent, both land somewhere sane.
  assert.equal(
    decide(fresh(), { kind: 'door', now: 0, settings: { sound: true } }).volume,
    DEFAULT_VOLUME,
  );
  assert.equal(
    decide(fresh(), { kind: 'door', now: 0, settings: { sound: true, soundVolume: 9 } }).volume,
    1,
  );
  assert.equal(
    decide(fresh(), { kind: 'door', now: 0, settings: { sound: true, soundVolume: 'loud' } })
      .volume,
    DEFAULT_VOLUME,
  );
});

test('a hidden tab is silent only when the OS notification actually fired', () => {
  // §8: "silent when the tab is hidden and the OS notification is doing the
  // work". Both halves. A hidden tab with no notification — permission
  // denied, or notifications turned off — is exactly when the sound is the
  // only signal there is.
  const base = { kind: 'door', now: 0, settings: ON };
  assert.equal(decide(fresh(), { ...base, hidden: true, notified: true }).reason, 'os-notified');
  assert.equal(decide(fresh(), { ...base, hidden: true, notified: false }).play, true);
  assert.equal(decide(fresh(), { ...base, hidden: false, notified: true }).play, true);
});

test('one sound per coalescing window, whatever fired it', () => {
  // The two channels report the same events; a floor that stays quiet for ten
  // seconds between toasts but keeps clicking is worse than either alone.
  const state = fresh();
  assert.equal(decide(state, { kind: 'door', now: 1000, settings: ON }).play, true);
  state.lastPlayedAt = 1000;
  assert.equal(decide(state, { kind: 'door', now: 1500, settings: ON }).reason, 'coalesced');
  // A *different* sound is still inside the same window: three sessions
  // finishing together is one door, not three.
  assert.equal(decide(state, { kind: 'knock', now: 5000, settings: ON }).reason, 'coalesced');
  assert.equal(
    decide(state, { kind: 'chime', now: 1000 + SOUND_COALESCE_MS - 1, settings: ON }).reason,
    'coalesced',
  );
  assert.equal(
    decide(state, { kind: 'chime', now: 1000 + SOUND_COALESCE_MS, settings: ON }).play,
    true,
  );
});

test('the window matches the notification coalescing window', () => {
  // Not a coincidence and not allowed to drift: `app.js`'s
  // NOTIFY_COALESCE_MS is the same 10s, and the two are the same rule.
  assert.equal(SOUND_COALESCE_MS, 10_000);
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const match = app.match(/NOTIFY_COALESCE_MS\s*=\s*([0-9_]+)/);
  assert.ok(match, 'app.js no longer declares NOTIFY_COALESCE_MS');
  assert.equal(
    Number(match[1].replace(/_/g, '')),
    SOUND_COALESCE_MS,
    'the sound window and the notification window have drifted apart',
  );
});

// ------------------------------------------------------------ the synths

/**
 * A WebAudio stub that records what was built. Enough for the three synths,
 * and nothing more — the point is to measure their shape, not to reimplement
 * the audio graph.
 */
function stubAudio() {
  const nodes = [];
  const events = [];
  // `kind`, not `type`: an OscillatorNode and a BiquadFilterNode both have a
  // real `type` property that the synths set, and recording the node's
  // identity in the same field would have made every assertion about filters
  // vacuously true — which is exactly what the first version of this stub did.
  const node = (kind, extra = {}) => {
    const n = {
      kind,
      connect(dest) {
        events.push(['connect', kind]);
        return dest;
      },
      ...extra,
    };
    nodes.push(n);
    return n;
  };
  const param = (name) => ({
    setValueAtTime: (v, t) => events.push(['set', name, v, t]),
    exponentialRampToValueAtTime: (v, t) => events.push(['ramp', name, v, t]),
    value: 0,
  });
  return {
    ctx: {
      sampleRate: 48000,
      currentTime: 0,
      state: 'running',
      destination: node('destination'),
      createBuffer: (ch, frames, rate) => ({
        length: frames,
        sampleRate: rate,
        getChannelData: () => new Float32Array(frames),
      }),
      createBufferSource: () =>
        node('bufferSource', {
          buffer: null,
          start: (t) => events.push(['start', 'noise', t]),
          stop: (t) => events.push(['stop', 'noise', t]),
        }),
      createOscillator: () =>
        node('oscillator', {
          type: 'sine',
          frequency: { value: 0 },
          start: (t) => events.push(['start', 'tone', t]),
          stop: (t) => events.push(['stop', 'tone', t]),
        }),
      createBiquadFilter: () =>
        node('filter', { type: '', frequency: { value: 0 }, Q: { value: 0 } }),
      createGain: () => node('gain', { gain: param('gain') }),
    },
    nodes,
    events,
  };
}

test('the door is two filtered noise bursts inside 180 ms', () => {
  const { ctx, nodes, events } = stubAudio();
  const end = SYNTHS.door(ctx, ctx.destination, 0, 0.4);
  assert.equal(Math.round(end * 1000), 180, '§8 says 180 ms');
  assert.equal(nodes.filter((n) => n.kind === 'bufferSource').length, 2);
  assert.equal(nodes.filter((n) => n.kind === 'oscillator').length, 0, 'a door is not a note');
  // Low and wooden: both bursts are lowpassed under a kilohertz.
  for (const f of nodes.filter((n) => n.kind === 'filter')) {
    assert.equal(f.type, 'lowpass');
    assert.ok(f.frequency.value <= 900, `the door is not low (${f.frequency.value} Hz)`);
  }
  assert.ok(events.some(([e]) => e === 'start'));
});

test('the knocks are two, about 140 ms apart, and higher than the door', () => {
  const { ctx, nodes, events } = stubAudio();
  const end = SYNTHS.knock(ctx, ctx.destination, 0, 0.4);
  assert.equal(nodes.filter((n) => n.kind === 'bufferSource').length, 2);
  const starts = events
    .filter(([e, what]) => e === 'start' && what === 'noise')
    .map(([, , t]) => t);
  assert.equal(starts.length, 2);
  assert.equal(Math.round((starts[1] - starts[0]) * 1000), 140, '§8 says ~140 ms apart');
  assert.ok(end < 0.25);
  for (const f of nodes.filter((n) => n.kind === 'filter')) {
    assert.ok(f.frequency.value > 900, 'a knock should sit above the door');
  }
});

test('the chime is a rising two-note figure inside 400 ms', () => {
  const { ctx, nodes, events } = stubAudio();
  const end = SYNTHS.chime(ctx, ctx.destination, 0, 0.4);
  assert.equal(Math.round(end * 1000), 400, '§8 says 400 ms');
  const oscs = nodes.filter((n) => n.kind === 'oscillator');
  assert.equal(oscs.length, 2);
  assert.ok(oscs[1].frequency.value > oscs[0].frequency.value, 'the chime falls instead of rising');
  assert.equal(nodes.filter((n) => n.kind === 'bufferSource').length, 0, 'a chime is not noise');
  assert.ok(events.some(([e, what]) => e === 'start' && what === 'tone'));
});

test('the noise sounds carry makeup gain, and the volume setting reaches all of it', () => {
  // Rendered through a real OfflineAudioContext at volume 0.4, the three peak
  // at 0.195 / 0.265 / 0.396 — the door quietest, the chime loudest, which is
  // the ordering §8 wants. Without makeup gain the door measured 0.069, about
  // 15 dB under the chime, because a lowpass at 380–1600 Hz throws away most
  // of white noise's energy while an oscillator loses none of its own.
  // `docs/DEVIATIONS.md` §98 carries the measured table.
  const peaks = (kind) => {
    const { ctx, events } = stubAudio();
    SYNTHS[kind](ctx, ctx.destination, 0, 0.4);
    return events.filter(([e, , v]) => e === 'ramp' && v > 0.01).map(([, , v]) => v);
  };
  for (const p of peaks('door')) assert.ok(p > 0.4, `a door burst asks for only ${p}`);
  for (const p of peaks('knock')) assert.ok(p > 0.4, `a knock asks for only ${p}`);
  // The chime is an oscillator and needs none.
  for (const p of peaks('chime')) assert.ok(p <= 0.4 + 1e-9, `the chime was given makeup gain`);

  // And the setting reaches the whole range: clamping the burst envelope to 1
  // made the slider stop doing anything to the door above about a third.
  const at = (kind, vol) => {
    const { ctx, events } = stubAudio();
    SYNTHS[kind](ctx, ctx.destination, 0, vol);
    return Math.max(...events.filter(([e]) => e === 'ramp').map(([, , v]) => v));
  };
  assert.ok(at('door', 1) > at('door', 0.4), 'the volume slider is capped for the door');
});

test('a burst never ramps gain to exactly zero, which is silence in an exponential ramp', () => {
  const { ctx, events } = stubAudio();
  SYNTHS.door(ctx, ctx.destination, 0, 0);
  for (const [kind, , value] of events) {
    if (kind !== 'ramp' && kind !== 'set') continue;
    assert.ok(value > 0, 'exponentialRampToValueAtTime(0) throws in a real AudioContext');
  }
});

test('the same sound twice is byte-identical: no Math.random in the noise', () => {
  const grab = () => {
    const { ctx } = stubAudio();
    const seen = [];
    const real = ctx.createBuffer;
    ctx.createBuffer = (ch, frames, rate) => {
      const buf = real(ch, frames, rate);
      seen.push(buf);
      return buf;
    };
    SYNTHS.door(ctx, ctx.destination, 0, 0.4);
    return seen.map((b) => Array.from(b.getChannelData(0).slice(0, 8)));
  };
  assert.deepEqual(grab(), grab(), 'two door closes a second apart are not the same door');
});

// ------------------------------------------------------------ the player

test('createSounds honours the settings it is given, live', () => {
  let settings = { sound: false, soundVolume: 0.5 };
  let clock = 0;
  const built = [];
  const { ctx } = stubAudio();
  const sounds = createSounds({
    getSettings: () => settings,
    isHidden: () => false,
    now: () => clock,
    makeContext: () => {
      built.push('made');
      return ctx;
    },
  });

  assert.equal(sounds.play('door').reason, 'muted');
  assert.deepEqual(built, [], 'an AudioContext was created for a muted product');

  settings = { sound: true, soundVolume: 0.5 };
  assert.equal(sounds.play('door').play, true);
  assert.deepEqual(built, ['made'], 'the context is made on first use, once');

  clock += 1000;
  assert.equal(sounds.play('knock').reason, 'coalesced');
  clock += SOUND_COALESCE_MS;
  assert.equal(sounds.play('knock').play, true);
  assert.deepEqual(built, ['made'], 'a second context was created');
});

test('a browser with no WebAudio at all degrades to silence, not to an error', () => {
  const sounds = createSounds({
    getSettings: () => ({ sound: true, soundVolume: 0.5 }),
    isHidden: () => false,
    now: () => 0,
    makeContext: () => null,
  });
  assert.equal(sounds.play('door').reason, 'no-audio');
});

// ----------------------------------------------------------- the package

test('there are exactly three sounds, and no asset file anywhere', () => {
  // WP-15's acceptance: "no network request and no bundled audio file".
  assert.deepEqual([...SOUNDS], ['door', 'knock', 'chime']);
  assert.deepEqual(Object.keys(SYNTHS).sort(), ['chime', 'door', 'knock']);

  const src = fs.readFileSync(path.join(ROOT, 'public', 'sound.js'), 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'new Audio', '.mp3', '.wav', '.ogg']) {
    assert.ok(!src.includes(forbidden), `sound.js reaches for ${forbidden}`);
  }
  // And no audio files were added to the package.
  const media = fs.readdirSync(path.join(ROOT, 'docs', 'media'));
  for (const name of media) {
    assert.doesNotMatch(name, /\.(mp3|wav|ogg|m4a|aac|flac)$/i, `${name} is a bundled audio file`);
  }
});
