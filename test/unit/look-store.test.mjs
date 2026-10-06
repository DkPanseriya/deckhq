/**
 * The look store — every transition, with nothing drawn.
 *
 * `public/look-ui-store.js` is the one place the client keeps "what the floor
 * looks like", and both surfaces read it. Its rule is one line: **a control
 * shows the value the daemon last accepted, moved optimistically on the click
 * and put back only by a refusal, with the reason beside it.** This file is
 * that line, a transition at a time, against the real catalogue and the real
 * guard and a daemon that is two variables — what it HOLDS and what it last
 * PUSHED — because the defect this store replaced lived in the gap between them.
 *
 * `look-selection.test.mjs` proves the same thing through the real shell and
 * both surfaces. This one is where a transition can be held still.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as catalogue from '../../public/render/look-options.js';
import {
  DEFAULT_LOOK,
  LOOK_PICKERS,
  PRESETS,
  lookForPreset,
  normalizeLook,
  sameLook,
} from '../../public/render/look-options.js';
import { validateLook } from '../../public/render/look-guards.js';
import {
  LOOK_DEBOUNCE_MS,
  advancedGroupOf,
  changedPaths,
  createLookStore,
  densityLevels,
  densityOf,
  styleChanges,
  styleEdited,
  withDensity,
  withPath,
  withPreset,
} from '../../public/look-ui-store.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A store over a daemon a test can hold still.
 *
 * @param {object} [opts]
 * @param {any} [opts.look]                 what the daemon starts with
 * @param {(next:any) => any} [opts.answer] what it says to a look
 * @param {boolean} [opts.hold]             keep every answer until released
 * @param {number} [opts.debounceMs]
 * @param {(patch:any) => any} [opts.save]  what the settings route says
 */
function daemon(opts = {}) {
  const posted = [];
  const painted = [];
  /** @type {Array<() => void>} */
  const held = [];
  let stored = normalizeLook(opts.look || DEFAULT_LOOK);
  /** What the tab was last pushed. Replaced, not mutated, by `push()`. */
  let pushed = { look: stored, theme: 'default' };
  let notified = 0;
  const port = {
    catalogue: () => catalogue,
    validate: validateLook,
    theme: () => 'default',
    apply: async (/** @type {any} */ next) => {
      posted.push(next);
      if (opts.hold) await new Promise((resolve) => held.push(() => resolve(undefined)));
      const answer = opts.answer ? opts.answer(next) : { ok: true };
      if (!answer.ok) return answer;
      stored = normalizeLook(next);
      return { ok: true, look: stored };
    },
  };
  const store = createLookStore({
    port,
    read: () => pushed,
    debounceMs: opts.debounceMs ?? 0,
    theming: {
      list: () => [{ name: 'default' }, { name: 'night shift' }],
      apply: (/** @type {string} */ name) => void painted.push(name),
      swatches: () => [],
    },
    saveSetting: async (/** @type {any} */ patch) =>
      opts.save ? opts.save(patch) : { ...pushed, ...patch },
  });
  store.subscribe(() => notified++);
  store.refresh();
  notified = 0;
  return {
    store,
    port,
    posted,
    painted,
    held,
    stored: () => stored,
    notified: () => notified,
    /** The daemon pushes a state: a NEW settings object. @param {any} [settings] */
    push(settings) {
      pushed = { look: stored, theme: pushed.theme, ...settings };
      store.refresh();
    },
    /** The shell stamps an answer onto the snapshot it already has. @param {any} patch */
    stamp(patch) {
      Object.assign(pushed, patch);
      store.refresh();
    },
  };
}

// ----------------------------------------------- what a control shows, when

test('INVARIANT: for every option of every picker, the choice is what the store shows — after the answer, and after the next push', async () => {
  let chosen = 0;
  for (const picker of LOOK_PICKERS) {
    const tables = [catalogue.RUG_TONE_IDS, catalogue.RUG_PATTERN_IDS];
    for (const option of picker.options) {
      // The path one option is chosen at: a rug and the planting are two
      // dimensions in one picker, and the option's own table says which.
      let path = picker.path;
      if (picker.id.startsWith('rug.')) {
        path += tables[0].includes(option.id) ? '.tone' : '.pattern';
      } else if (picker.id === 'plants') {
        path += catalogue.PLANT_FAMILY_IDS.includes(option.id) ? '.family' : '.density';
      }
      const d = daemon();
      const at = () => path.split('.').reduce((o, k) => o[k], d.store.look());
      const before = at();
      if (before === option.id) continue;
      const where = `${picker.id} → ${option.id}`;

      await d.store.choosePath(path, option.id, picker.id);
      if (d.posted.length === 0) {
        // Refused by the guard: nothing moved, and the reason is the control's.
        assert.equal(at(), before, `${where}: a refused choice moved the control`);
        assert.ok(d.store.refusalsFor(picker.id).length > 0, `${where}: refused without a reason`);
        continue;
      }
      chosen++;
      assert.equal(at(), option.id, `${where}: went back once the daemon answered`);
      // The settings this tab was pushed have NOT changed — nobody stamped
      // them — and reading them again must not put the choice back.
      d.store.refresh();
      assert.equal(at(), option.id, `${where}: went back on a re-read of the old push`);
      d.push();
      assert.equal(at(), option.id, `${where}: went back on the next state push`);
      assert.equal(d.store.refusal(), null);
    }
  }
  assert.ok(chosen > 20, `only ${chosen} options were accepted`);
});

test('the control moves on the click, before the daemon has answered', async () => {
  const d = daemon({ hold: true });
  void d.store.choosePath('scheme', 'cool', 'scheme');
  assert.equal(d.store.look().scheme, 'cool', 'the choice waited for the daemon');
  assert.equal(d.store.confirmedLook().scheme, 'warm');
  assert.equal(d.store.isPending(), true);
  assert.equal(d.notified(), 1);
  await tick();
  d.held.shift()();
  await tick();
  assert.equal(d.store.confirmedLook().scheme, 'cool');
  assert.equal(d.store.isPending(), false);
  assert.equal(d.notified(), 2);
});

test('a late answer to an earlier choice does not put a later choice back', async () => {
  const d = daemon({ hold: true });
  void d.store.choosePath('agentSize', 'small', 'agentSize');
  await tick();
  void d.store.choosePath('agentSize', 'large', 'agentSize');
  await tick();
  assert.equal(d.held.length, 2);
  d.held.shift()();
  await tick();
  assert.equal(d.store.look().agentSize, 'large', 'the answer to Small put Large back');
  d.held.shift()();
  await tick();
  assert.equal(d.store.look().agentSize, 'large');
  assert.equal(d.stored().agentSize, 'large');
});

test('a second choice is built on the first, pending or confirmed', async () => {
  const d = daemon({ hold: true });
  void d.store.choosePath('agentSize', 'large', 'agentSize');
  void d.store.choosePath('scheme', 'cool', 'scheme');
  await tick();
  assert.deepEqual(
    d.posted.map((p) => [p.agentSize, p.scheme]),
    [
      ['large', 'warm'],
      ['large', 'cool'],
    ],
  );
});

// ----------------------------------------------------------------- refusals

test('the guard’s refusal changes nothing, sends nothing, and names the control', async () => {
  const d = daemon();
  d.store.choosePath('floors.office', 'terrazzo', 'floor.office');
  assert.deepEqual(d.posted, []);
  assert.equal(d.store.look().floors.office, DEFAULT_LOOK.floors.office);
  // Under the control the hand was on — not under the corridor, which is the
  // row the guard says the problem belongs to.
  const reasons = d.store.refusalsFor('floor.office');
  assert.equal(reasons.length > 0, true);
  assert.match(reasons[0].reason, /Terrazzo/);
  assert.deepEqual(d.store.refusalsFor('floor.corridor'), []);
  // The next accepted choice clears it.
  await d.store.choosePath('scheme', 'cool', 'scheme');
  assert.equal(d.store.refusal(), null);
});

test('a refusal does not undo a choice that was accepted a moment ago and is still on its way', async () => {
  const d = daemon({ hold: true });
  void d.store.choosePath('scheme', 'cool', 'scheme');
  d.store.choosePath('floors.office', 'terrazzo', 'floor.office');
  assert.equal(d.store.look().scheme, 'cool');
  assert.equal(d.store.refusalsFor('floor.office').length > 0, true);
});

test('the daemon’s refusal puts the control back and says why, beside the control', async () => {
  const d = daemon({
    answer: () => ({
      ok: false,
      problems: [{ picker: 'floor.rooms', reason: 'not on night shift' }],
    }),
  });
  await d.store.choosePath('scheme', 'cool', 'scheme');
  assert.equal(d.posted.length, 1);
  assert.equal(d.store.look().scheme, 'warm');
  assert.deepEqual(
    d.store.refusalsFor('scheme').map((p) => p.reason),
    ['not on night shift'],
  );
  // A failure with no problems list still says something.
  const net = daemon({ answer: () => ({ ok: false, error: 'Failed to fetch' }) });
  await net.store.choosePath('scheme', 'cool', 'scheme');
  assert.deepEqual(
    net.store.refusalsFor('scheme').map((p) => p.reason),
    ['Failed to fetch'],
  );
});

// --------------------------------------------------------- hearing the daemon

test('a push is heard; re-reading the same push is not; a stamp on it is', async () => {
  const d = daemon();
  // Another tab changed the look: a new push.
  d.push({ look: lookForPreset('night-lab') });
  assert.equal(d.store.look().preset, 'night-lab');
  assert.equal(d.notified(), 1);
  // A push that says the same thing redraws nothing.
  d.push({ look: lookForPreset('night-lab') });
  assert.equal(d.notified(), 1);
  // The palette saved a theme: the shell stamps the snapshot it has.
  d.stamp({ theme: 'night shift' });
  assert.equal(d.store.theme(), 'night shift');
  assert.equal(d.notified(), 2);
  // A surface that is already drawing hears quietly.
  d.stamp({ theme: 'default' });
  assert.equal(d.notified(), 3);
  const quiet = daemon();
  quiet.stamp({});
  assert.equal(quiet.store.refresh({ silent: true }), false);
});

test('a push while a choice is unanswered does not take the choice off the screen', async () => {
  const d = daemon({ hold: true });
  void d.store.choosePath('scheme', 'cool', 'scheme');
  await tick();
  d.push(); // the daemon has stored `cool` by now, but say it pushed the old look
  d.push({ look: normalizeLook(DEFAULT_LOOK) });
  assert.equal(d.store.look().scheme, 'cool');
  d.held.shift()();
  await tick();
  assert.equal(d.store.look().scheme, 'cool');
});

// ------------------------------------------------------------- the debounce

test('a walk across a picker is one write, and a surface that shuts sends what was shown', async () => {
  assert.equal(LOOK_DEBOUNCE_MS, 140);
  const d = daemon({ debounceMs: 30 });
  d.store.choosePath('scheme', 'cool', 'scheme');
  d.store.choosePath('scheme', 'mono', 'scheme');
  d.store.choosePath('scheme', 'forest', 'scheme');
  assert.equal(d.store.look().scheme, 'forest', 'the control waited for the debounce');
  assert.deepEqual(d.posted, []);
  await tick(60);
  assert.deepEqual(
    d.posted.map((p) => p.scheme),
    ['forest'],
  );

  d.store.choosePath('scheme', 'clay', 'scheme');
  await d.store.flush();
  assert.deepEqual(
    d.posted.map((p) => p.scheme),
    ['forest', 'clay'],
  );
  await tick(60);
  assert.equal(d.posted.length, 2, 'the flushed write was sent again by its timer');
  assert.equal(d.store.flush(), undefined, 'nothing waiting, nothing sent');
});

// ------------------------------------------------- a style, and what is not

test('a preset is a style: the agent size is kept, and is not an edit', async () => {
  // Two presets ship at a size of their own; this client no longer applies it.
  assert.deepEqual(
    PRESETS.filter((p) => p.look.agentSize !== DEFAULT_LOOK.agentSize).map((p) => p.id),
    ['garden-floor', 'workshop'],
  );
  for (const preset of PRESETS) {
    for (const size of catalogue.AGENT_SIZES) {
      const from = normalizeLook({ ...DEFAULT_LOOK, agentSize: size });
      const next = withPreset(catalogue, from, preset.id);
      assert.equal(next.agentSize, size, `${preset.id} reset the size from ${size}`);
      assert.equal(next.preset, preset.id);
      assert.ok(sameLook({ ...next, agentSize: preset.look.agentSize }, preset.look));
      assert.equal(styleEdited(catalogue, next), false, `${preset.id} at ${size} reads as edited`);
      assert.equal(styleChanges(catalogue, next), 0);
    }
  }
  const d = daemon({ look: { ...DEFAULT_LOOK, agentSize: 'large' } });
  await d.store.choosePreset('workshop');
  assert.equal(d.stored().agentSize, 'large');
  assert.equal(d.stored().preset, 'workshop');
  assert.equal(d.store.styleEdited(), false);
  assert.equal(d.store.presetLabel(), 'Workshop');

  // An edit is counted, by path, and Reset takes it back without the size.
  await d.store.choosePath('scheme', 'cool', 'scheme');
  await d.store.choosePath('lounge.games', false, 'lounge');
  assert.deepEqual(d.store.changedPaths().sort(), ['lounge.games', 'scheme']);
  assert.deepEqual(changedPaths(catalogue, d.stored()).sort(), d.store.changedPaths().sort());
  await d.store.resetStyle();
  assert.equal(d.store.styleChanges(), 0);
  assert.equal(d.stored().agentSize, 'large');
});

test('Density is the pair at one position in the catalogue’s two tables', async () => {
  const levels = densityLevels(catalogue);
  assert.deepEqual(
    levels.map((l) => l.id),
    ['calm', 'normal', 'lively'],
  );
  for (const [i, level] of levels.entries()) {
    assert.equal(level.plants, catalogue.PLANT_DENSITY_IDS[i]);
    assert.equal(level.props, catalogue.PROP_DENSITY_IDS[i]);
    const next = withDensity(catalogue, DEFAULT_LOOK, level.id);
    assert.deepEqual([next.plants.density, next.props.density], [level.plants, level.props]);
    assert.equal(next.plants.family, DEFAULT_LOOK.plants.family, 'the plant family moved');
    assert.equal(densityOf(catalogue, next), level.id);
    assert.ok(validateLook(next, 'default').ok, `${level.id} is refused on the shipped floor`);
  }
  assert.equal(densityOf(catalogue, DEFAULT_LOOK), 'normal');
  // Set apart, they are no step at all rather than the nearest one.
  const apart = withPath(
    withPath(DEFAULT_LOOK, 'plants.density', 'lush'),
    'props.density',
    'quiet',
  );
  assert.equal(densityOf(catalogue, apart), '');
  // Two tables of different lengths have no shared scale to offer.
  assert.deepEqual(densityLevels({ ...catalogue, PROP_DENSITY_IDS: ['quiet', 'busy'] }), []);
  assert.equal(withDensity(catalogue, DEFAULT_LOOK, 'nonsense'), DEFAULT_LOOK);

  const d = daemon();
  await d.store.chooseDensity('lively');
  assert.deepEqual([d.stored().plants.density, d.stored().props.density], ['lush', 'busy']);
  assert.equal(d.store.density(), 'lively');
});

test('every picker has a heading under Advanced, by a rule rather than a list', () => {
  for (const picker of LOOK_PICKERS) {
    assert.match(advancedGroupOf(picker.id), /^(floors|furniture|plants)$/);
  }
  assert.equal(advancedGroupOf('floor.corridor'), 'floors');
  assert.equal(advancedGroupOf('scheme'), 'floors');
  assert.equal(advancedGroupOf('rug.wool'), 'furniture');
  assert.equal(advancedGroupOf('plants'), 'plants');
  assert.equal(advancedGroupOf('props'), 'plants');
  assert.equal(advancedGroupOf('something-new'), 'furniture');
});

// ----------------------------------------------------------------- the theme

test('a theme is shown on the click, painted when it is stored, and put back if it is not', async () => {
  const d = daemon();
  const going = d.store.chooseTheme('night shift');
  assert.equal(d.store.theme(), 'night shift');
  assert.equal(d.store.storedTheme(), 'default');
  assert.deepEqual(d.painted, [], 'painted before it was stored');
  await going;
  assert.equal(d.store.storedTheme(), 'night shift');
  assert.deepEqual(d.painted, ['night shift']);

  // A preview paints and stores nothing; `null` puts the stored one back.
  d.store.previewTheme('default');
  d.store.previewTheme(null);
  assert.deepEqual(d.painted, ['night shift', 'default', 'night shift']);
  assert.equal(d.store.storedTheme(), 'night shift');

  const failing = daemon({ save: () => null });
  await failing.store.chooseTheme('night shift');
  assert.equal(failing.store.theme(), 'default');
  assert.deepEqual(failing.painted, []);
  assert.deepEqual(
    failing.store.refusalsFor('theme').map((p) => p.reason),
    ['That theme could not be saved'],
  );
});

test('with no catalogue there is no look to choose, and nothing throws', () => {
  const store = createLookStore({ port: { catalogue: () => null } });
  assert.equal(store.look(), null);
  assert.equal(store.choosePreset('workshop'), undefined);
  assert.equal(store.chooseDensity('calm'), undefined);
  assert.equal(store.density(), '');
  assert.deepEqual(store.densityLevels(), []);
  assert.deepEqual(store.themes(), []);
  assert.equal(store.theme(), 'default');
  assert.equal(store.refresh(), false);
});
