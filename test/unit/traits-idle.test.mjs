/**
 * WP-28's one mechanical effect: the desk idle director, and the trait
 * weighting on it.
 *
 * §4.1 has asked since the clips landed for `drink` "occasionally during
 * working" and `stretch` as an "occasional idle variation", and
 * `IDLE_VARIATIONS` has named the three the whole time without anything ever
 * playing them. This is that director, plus the only thing a trait does
 * anywhere in the product outside two lines of text.
 *
 * What the tests here are actually protecting:
 *
 *   - **it can never introduce a clip.** Everything it can name is `type` or
 *     one of `IDLE_VARIATIONS`.
 *   - **any real state change cancels it.** A hand going up, a stall, a walk
 *     to the office — the state's own clip wins immediately and the variation
 *     is discarded, not queued behind.
 *   - **reduced motion is untouched.** The director sits below `step`'s
 *     reduced-motion return, so under `prefers-reduced-motion` no variation is
 *     ever picked.
 *   - **a tendency is a weighting, not a script.** A shell-heavy agent plays
 *     the coffee clip more often than an agent with no tendency; it still
 *     plays the other two, and it still mostly types.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIPS,
  IDLE_VARIATIONS,
  IDLE_TYPE_MIN_S,
  IDLE_TYPE_MAX_S,
  IDLE_WEIGHTS,
  TENDENCY_CLIP,
  TENDENCY_WEIGHT,
  makeIdleRotation,
} from '../../public/render/clips.js';
import {
  IDLE_TYPE_MIN_S as CORE_MIN_S,
  IDLE_TYPE_MAX_S as CORE_MAX_S,
} from '../../public/render/agents-core.js';
import { buildPlan } from '../../public/render/plan.js';
import { AgentRuntime, assignSeats } from '../../public/render/agents.js';

const NOW = 1_800_000_000_000;

/** A deterministic stand-in for `Math.random`, so a distribution is a fact. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` picks from one director, as a tally by clip name. */
function tally(tendency, n = 4000, seed = 1) {
  const rng = seeded(seed);
  /** @type {Record<string, number>} */
  const out = {};
  for (let i = 0; i < n; i++) {
    const { clip } = makeIdleRotation(rng, { tendency }).pick();
    out[clip] = (out[clip] || 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The director itself
// ---------------------------------------------------------------------------

test('the director can only ever name a clip that already exists', () => {
  for (const tendency of [null, 'coffee', 'thinking', 'typing', 'nonsense']) {
    for (const clip of Object.keys(tally(tendency, 400))) {
      assert.ok(clip === 'type' || IDLE_VARIATIONS.includes(clip), `invented clip "${clip}"`);
      assert.ok(CLIPS[clip], `"${clip}" is not in CLIPS`);
    }
  }
});

test('a working agent mostly works: `type` is the majority of every distribution', () => {
  for (const tendency of [null, 'coffee', 'thinking', 'typing']) {
    const t = tally(tendency);
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    assert.ok(t.type / total > 0.5, `${tendency}: type is only ${t.type}/${total}`);
  }
});

test('a tendency raises its own clip and removes none of the others', () => {
  /** The share each clip should hold, straight out of the weights. */
  const expected = (tendency) => {
    const favoured = TENDENCY_CLIP[tendency] || null;
    const w = Object.fromEntries(
      Object.entries(IDLE_WEIGHTS).map(([c, n]) => [c, c === favoured ? n * TENDENCY_WEIGHT : n]),
    );
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    return Object.fromEntries(Object.entries(w).map(([c, n]) => [c, n / total]));
  };

  const baseShare = expected(null);
  for (const [tendency, clip] of Object.entries(TENDENCY_CLIP)) {
    const t = tally(tendency);
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    const want = expected(tendency);

    // The lean is real: the favoured clip holds a larger share than it does
    // with no tendency at all.
    assert.ok(
      want[clip] > baseShare[clip] + 0.05,
      `${tendency}: ${clip} is not actually favoured by the weights`,
    );
    assert.ok(
      t[clip] / total > baseShare[clip] + 0.03,
      `${tendency}: ${clip} came out at ${(t[clip] / total).toFixed(3)}, base ${baseShare[clip].toFixed(3)}`,
    );

    // Everything else is still reachable, and every share is the one the
    // weights promise. A tendency that silenced the other two would be a
    // script, and a floor of scripted agents all doing one thing is the
    // opposite of what a trait is for.
    for (const other of ['type', ...IDLE_VARIATIONS]) {
      assert.ok(t[other] > 0, `${tendency}: ${other} became unreachable`);
      assert.ok(
        Math.abs(t[other] / total - want[other]) < 0.03,
        `${tendency}: ${other} at ${(t[other] / total).toFixed(3)}, expected ${want[other].toFixed(3)}`,
      );
    }
  }
});

test('an unknown tendency is ignored rather than guessed at', () => {
  assert.deepEqual(tally('nonsense', 2000, 7), tally(null, 2000, 7));
  assert.deepEqual(tally(undefined, 2000, 7), tally(null, 2000, 7));
});

test('a typing burst is held for tens of seconds; a variation for its own length', () => {
  const rng = seeded(9);
  for (let i = 0; i < 500; i++) {
    const { clip, holdS } = makeIdleRotation(rng, { tendency: null }).pick();
    if (clip === 'type') {
      assert.ok(holdS >= IDLE_TYPE_MIN_S && holdS <= IDLE_TYPE_MAX_S, `type held ${holdS}s`);
    } else {
      const { duration, loop } = CLIPS[clip];
      assert.equal(holdS, loop ? duration * 2 : duration, `${clip} held ${holdS}s`);
    }
  }
});

test('the two copies of the typing-burst window agree', () => {
  // `agents.js` cannot import `./clips.js` (see its header), so the constants
  // exist twice. If they drift, an agent's first variation lands at a
  // different time from every later one.
  assert.equal(CORE_MIN_S, IDLE_TYPE_MIN_S);
  assert.equal(CORE_MAX_S, IDLE_TYPE_MAX_S);
  assert.ok(IDLE_WEIGHTS.type > IDLE_WEIGHTS.drink, 'typing must outweigh any one variation');
});

// ---------------------------------------------------------------------------
// The director inside the runtime
// ---------------------------------------------------------------------------

function agent(id, over = {}) {
  return {
    id,
    projectId: 'p0',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: NOW - 60_000,
    ...over,
  };
}

const PROJECTS = [{ id: 'p0', name: 'p0', sessionCount: 3, tokens: 100, needsYou: 0 }];

function seatedFloor(agents) {
  const plan = buildPlan(PROJECTS, agents, { targetAspect: 2.06, now: NOW });
  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));
  return { plan, runtime };
}

/** Step `seconds` in one-second frames. */
function run(runtime, plan, seconds, opts = {}) {
  for (let i = 0; i < seconds; i++) {
    runtime.step(1, { plan, makeIdleRotation, ...opts });
  }
}

test('a working agent types for a while, then plays a variation, then types again', () => {
  const agents = [agent('p0-0'), agent('p0-1'), agent('p0-2')];
  const { plan, runtime } = seatedFloor(agents);
  for (const rec of runtime.all())
    assert.equal(rec.clip, 'type', 'everyone starts at the keyboard');

  // Nothing but `type` inside the shortest possible burst. This is also what
  // keeps a capture honest: `npm run demo:capture` settles for 8 s.
  run(runtime, plan, IDLE_TYPE_MIN_S - 1);
  for (const rec of runtime.all()) {
    assert.equal(rec.clip, 'type', `${rec.id} varied inside the first burst`);
  }

  // Over five minutes at least one of the three has varied, and every clip
  // seen is one that already existed.
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    runtime.step(1, { plan, makeIdleRotation });
    for (const rec of runtime.all()) seen.add(rec.clip);
  }
  assert.ok(seen.size > 1, 'nobody ever varied');
  for (const clip of seen) {
    assert.ok(clip === 'type' || IDLE_VARIATIONS.includes(clip), `invented clip "${clip}"`);
  }
});

test('any real state change cancels the variation immediately', () => {
  const agents = [agent('p0-0'), agent('p0-1'), agent('p0-2')];
  const { plan, runtime } = seatedFloor(agents);

  // Drive until somebody is mid-variation.
  let varied = null;
  for (let i = 0; i < 600 && !varied; i++) {
    runtime.step(1, { plan, makeIdleRotation });
    varied = [...runtime.all()].find((r) => r.clip !== 'type') || null;
  }
  assert.ok(varied, 'no agent ever varied, so there is nothing to cancel');

  // A hand goes up on exactly that agent. `sync` is what the daemon's next
  // snapshot calls, and it must win.
  const raised = agents.map((a) =>
    a.id === varied.id ? { ...a, activityState: 'needs_input' } : a,
  );
  runtime.sync(raised, plan, assignSeats(plan, raised));
  assert.equal(runtime.get(varied.id).clip, 'hand_raise', 'a variation outlived a raised hand');
  assert.equal(runtime.get(varied.id).deskIdle.clip, null);

  // And it stays up: further frames must not put a variation back over it.
  run(runtime, plan, 400);
  assert.equal(runtime.get(varied.id).clip, 'hand_raise', 'a raised hand was animated over');
});

test('an unchanged state does NOT cancel the variation, however often it syncs', () => {
  const agents = [agent('p0-0'), agent('p0-1'), agent('p0-2')];
  const { plan, runtime } = seatedFloor(agents);
  let varied = null;
  for (let i = 0; i < 600 && !varied; i++) {
    runtime.step(1, { plan, makeIdleRotation });
    varied = [...runtime.all()].find((r) => r.clip !== 'type') || null;
  }
  assert.ok(varied);
  const clip = varied.clip;
  // The snapshot arrives several times a second and says nothing new.
  for (let i = 0; i < 20; i++) runtime.sync(agents, plan, assignSeats(plan, agents));
  assert.equal(
    runtime.get(varied.id).clip,
    clip,
    'a snapshot that changed nothing snapped the clip',
  );
});

test('reduced motion never picks a variation', () => {
  const agents = [agent('p0-0'), agent('p0-1'), agent('p0-2')];
  const { plan, runtime } = seatedFloor(agents);
  run(runtime, plan, 1200, { reduced: true });
  for (const rec of runtime.all()) {
    assert.equal(rec.clip, 'type', `${rec.id} varied under prefers-reduced-motion`);
  }
});

test('a caller that passes no director gets the old behaviour exactly', () => {
  const agents = [agent('p0-0'), agent('p0-1'), agent('p0-2')];
  const { plan, runtime } = seatedFloor(agents);
  for (let i = 0; i < 1200; i++) runtime.step(1, { plan });
  for (const rec of runtime.all()) assert.equal(rec.clip, 'type');
});

test('a tendency reaches the record through `setTendencies`, and an unknown id is null', () => {
  const agents = [agent('p0-0'), agent('p0-1'), agent('p0-2')];
  const { runtime } = seatedFloor(agents);
  runtime.setTendencies({ 'p0-0': 'coffee', nobody: 'thinking' });
  assert.equal(runtime.get('p0-0').tendency, 'coffee');
  assert.equal(runtime.get('p0-1').tendency, null);
  runtime.setTendencies(null);
  assert.equal(runtime.get('p0-0').tendency, null);
});

test('only an agent at a desk is ever varied', () => {
  const agents = [
    agent('p0-0', { ackState: 'benched' }),
    agent('p0-1', { activityState: 'for_review', reviewSince: NOW - 1000 }),
    agent('p0-2'),
  ];
  const { plan, runtime } = seatedFloor(agents);
  run(runtime, plan, 900);
  for (const rec of runtime.all()) {
    if (rec.placement === 'desk') continue;
    assert.equal(rec.deskIdle.clip, null, `${rec.id} was varied off a desk`);
  }
});
