/**
 * THE LOOK, PERSISTED AND CARRIED (WP-88a). §4 of
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md`.
 *
 * Four surfaces, one document, and one rule over all of them: **a refusal
 * changes nothing.** `layout-io.test.mjs`'s shape, applied to a look — eleven
 * bad files, each refused with its reason, each leaving the floor exactly as it
 * found it.
 *
 * The fifth surface, `?look=`, is the one that must never write: a URL is a
 * thing strangers send, and the worst it may do here is nothing.
 */

// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';

import { pickSessionLook } from '../../public/url-options.js';
import { DEFAULT_LOOK, presetById, sameLook } from '../../public/render/look-options.js';
import {
  LOOK_KIND,
  LOOK_VERSION,
  MAX_LOOK_BYTES,
  buildLookDocument,
  lookWarning,
  parseLookDocument,
  sanitizeLook,
  validateLookDocument,
} from '../../src/core/look.mjs';
import { DEFAULT_SETTINGS } from '../../src/core/store.mjs';
import { LOOK_HELP, runLook } from '../../src/cli/look.mjs';

/** The document for a preset, whole. @param {string} id */
const docFor = (id) => buildLookDocument({ look: /** @type {any} */ (presetById(id)).look });

// ------------------------------------------------------------- the document

test('§4: the document is a fixed point — export, import, export is the same bytes', () => {
  for (const id of ['studio-oak', 'night-lab', 'garden-floor']) {
    const first = docFor(id);
    const parsed = validateLookDocument(first);
    assert.ok('ok' in parsed, `${id}: ${/** @type {any} */ (parsed).error}`);
    assert.deepEqual(parsed.look, first);
    const again = buildLookDocument({ look: parsed.look });
    assert.equal(JSON.stringify(again), JSON.stringify(first));
  }
});

test('a look names no project, no path and no session — it is anonymous', () => {
  const text = JSON.stringify(docFor('workshop'));
  // `rooms` is not on this list, and that is not an oversight: it is one of §1.a's
  // four ZONES — *"the office, the corridor, the project rooms, the lounge"* —
  // and naming a use is not naming a project. What a layout carries and a look
  // may not is the project SLUGS, which come from folder paths.
  for (const forbidden of ['projectId', 'sessionId', 'cwd', 'archivedRooms', 'ackState']) {
    assert.ok(!text.includes(forbidden), `a look document carries ${forbidden}`);
  }
  assert.equal(docFor('workshop').kind, LOOK_KIND);
  assert.equal(docFor('workshop').version, LOOK_VERSION);
});

test('eleven bad documents are each refused with a reason, and none is half-applied', () => {
  const good = docFor('studio-oak');
  /** @type {Array<[string, unknown]>} */
  const bad = [
    ['not an object', 'a look'],
    ['no kind', { ...good, kind: undefined }],
    ['the wrong kind', { ...good, kind: 'deckhq.layout' }],
    ['a version this build does not read', { ...good, version: 99 }],
    ['a key a look may not carry', { ...good, projectId: 'secret-project' }],
    [
      'a floor material that does not exist',
      { ...good, floors: { ...good.floors, office: 'lava' } },
    ],
    [
      'a floor material that exists but not in that zone',
      { ...good, floors: { ...good.floors, corridor: 'herringbone-oak' } },
    ],
    ['a scheme that does not exist', { ...good, scheme: 'neon' }],
    [
      'a rug tone that does not exist',
      { ...good, rugs: { ...good.rugs, task: { tone: 'plaid', pattern: 'plain' } } },
    ],
    ['a lounge with no place to sit', { ...good, lounge: { ...good.lounge, sitting: false } }],
    [
      'a combination the guards refuse',
      {
        ...good,
        floors: { ...good.floors, office: 'wide-ash', lounge: 'polished-concrete' },
        rugs: {
          wool: { tone: 'sage', pattern: 'plain' },
          task: { tone: 'sage', pattern: 'plain' },
        },
      },
    ],
  ];
  assert.equal(bad.length, 11);
  for (const [what, doc] of bad) {
    const result = validateLookDocument(doc);
    assert.ok('error' in result, `${what} was accepted`);
    assert.ok(result.error.length > 20, `${what}: the reason is a code, not a sentence`);
  }
  // The last one is the interesting one: every id in it is real, and it is
  // refused anyway, WITH the problems list the section renders row by row.
  const refused = /** @type {any} */ (validateLookDocument(bad[10][1]));
  assert.ok(Array.isArray(refused.problems) && refused.problems.length > 0);
  assert.equal(refused.problems[0].picker, 'rug.wool');
});

test('a file is size-bounded before it is parsed, and a non-JSON file says so', () => {
  assert.ok('error' in parseLookDocument('x'.repeat(MAX_LOOK_BYTES + 1)));
  assert.match(/** @type {any} */ (parseLookDocument('{')).error, /not JSON/);
  const good = parseLookDocument(JSON.stringify(docFor('paper-office')));
  assert.ok('ok' in good);
});

// ------------------------------------------------------------ the settings

test('§4: `settings.look` ships as Studio oak, which is the floor as it ships', () => {
  assert.ok(sameLook(DEFAULT_SETTINGS.look, DEFAULT_LOOK));
  assert.equal(/** @type {any} */ (DEFAULT_SETTINGS.look).preset, 'studio-oak');
});

test('a hand-edited look is coerced rather than refused, and doctor says what was lost', () => {
  const edited = { ...DEFAULT_LOOK, floors: { ...DEFAULT_LOOK.floors, office: 'lava' } };
  const clean = sanitizeLook(edited);
  assert.equal(clean.floors.office, DEFAULT_LOOK.floors.office);
  assert.match(/** @type {any} */ (lookWarning(edited)), /floors\.office "lava"/);
  // A look whose ids are all real but whose combination is refused falls back to
  // the default rather than painting a floor the guards said no to.
  const refused = {
    ...DEFAULT_LOOK,
    floors: { ...DEFAULT_LOOK.floors, office: 'wide-ash', lounge: 'polished-concrete' },
    rugs: { wool: { tone: 'sage', pattern: 'plain' }, task: { tone: 'sage', pattern: 'plain' } },
  };
  assert.ok(sameLook(sanitizeLook(refused), DEFAULT_LOOK));
  assert.match(/** @type {any} */ (lookWarning(refused)), /refused/);
  // And a look that is simply fine says nothing at all.
  assert.equal(lookWarning(DEFAULT_LOOK), null);
  assert.equal(lookWarning(undefined), null);
});

// ------------------------------------------------------------------- the URL

test('§4: `?look=` paints a preset for this tab, and an unknown value does nothing', () => {
  const setting = /** @type {any} */ (presetById('workshop')).look;
  const night = pickSessionLook('?look=night-lab', setting, presetById);
  assert.equal(/** @type {any} */ (night).id, 'night-lab');
  // Case and separator are the preset lookup's, exactly as `?theme=`'s are.
  assert.equal(
    /** @type {any} */ (pickSessionLook('?look=Night_Lab', setting, presetById)).id,
    'night-lab',
  );
  // An unknown value is IGNORED — the setting is painted, never the default.
  assert.equal(pickSessionLook('?look=not-a-preset', setting, presetById), setting);
  assert.equal(pickSessionLook('?look=', setting, presetById), setting);
  assert.equal(pickSessionLook('', setting, presetById), setting);
  // And a lookup that throws cannot stop the floor loading.
  assert.equal(
    pickSessionLook('?look=night-lab', setting, () => {
      throw new Error('nope');
    }),
    setting,
  );
});

test('a URL is never written back: `?look=` reaches no settings patch', () => {
  // The property, stated where it can be checked: the only thing `pickSessionLook`
  // returns is one of its own two arguments, so there is no path from a query
  // string into a document that could be POSTed.
  const setting = DEFAULT_LOOK;
  const picked = pickSessionLook('?look=garden-floor', setting, presetById);
  assert.notEqual(picked, setting);
  // …and the thing it returned is a frozen preset, not a document the caller
  // could mutate into a patch.
  assert.ok(Object.isFrozen(picked));
});

// ------------------------------------------------------------------- the CLI

test('`deckhq look` prints its help, lists the presets, and exports the document', async () => {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const write = (/** @type {string} */ s) => out.push(s);
  const error = (/** @type {string} */ s) => err.push(s);

  assert.equal(await runLook([], { write, error }), 2);
  assert.ok(out.join('').includes('deckhq look'));
  assert.ok(LOOK_HELP.includes('anonymous'));

  out.length = 0;
  assert.equal(await runLook(['presets'], { write, error }), 0);
  for (const id of ['studio-oak', 'night-lab', 'workshop']) {
    assert.ok(out.join('').includes(id), `presets did not list ${id}`);
  }

  out.length = 0;
  err.length = 0;
  assert.equal(
    await runLook(['export'], {
      write,
      error,
      read: async () => ({ look: docFor('garden-floor'), source: 'state' }),
    }),
    0,
  );
  const exported = JSON.parse(out.join(''));
  assert.equal(exported.kind, LOOK_KIND);
  assert.equal(exported.preset, 'garden-floor');
  assert.ok(err.join('').includes('anonymous'), 'export does not say a look is anonymous');
});

test('`deckhq look import` refuses a bad file with its reason, and sends nothing', async () => {
  /** @type {string[]} */
  const err = [];
  let posted = 0;
  const code = await runLook(['import', 'bad.json'], {
    write: () => {},
    error: (s) => err.push(s),
    readFile: () => JSON.stringify({ ...docFor('studio-oak'), scheme: 'neon' }),
    find: async () => ({ port: 4317, snapshot: {} }),
    post: async () => {
      posted++;
      return { ok: true, status: 200, body: {} };
    },
  });
  assert.equal(code, 1);
  assert.equal(posted, 0, 'a refused file was sent to the daemon anyway');
  assert.match(err.join(''), /Nothing was changed/);
});

test('`deckhq look import` prints the problems list when the ids are real and the floor is not', async () => {
  /** @type {string[]} */
  const err = [];
  const refused = {
    ...docFor('studio-oak'),
    floors: { ...docFor('studio-oak').floors, office: 'wide-ash', lounge: 'polished-concrete' },
    rugs: { wool: { tone: 'sage', pattern: 'plain' }, task: { tone: 'sage', pattern: 'plain' } },
  };
  const code = await runLook(['import', 'refused.json'], {
    write: () => {},
    error: (s) => err.push(s),
    readFile: () => JSON.stringify(refused),
    find: async () => ({ port: 4317, snapshot: {} }),
    post: async () => ({ ok: true, status: 200, body: {} }),
  });
  assert.equal(code, 1);
  assert.match(err.join(''), /rug\.wool/);
  assert.match(err.join(''), /would not read/);
});

test('`deckhq look import` needs a daemon, and says so rather than editing state.json', async () => {
  /** @type {string[]} */
  const err = [];
  const code = await runLook(['import', 'good.json'], {
    write: () => {},
    error: (s) => err.push(s),
    readFile: () => JSON.stringify(docFor('night-lab')),
    find: async () => null,
  });
  assert.equal(code, 2);
  assert.match(err.join(''), /start deckhq/);
});

test('`deckhq look import` applies a good file, and `--yes` is accepted', async () => {
  /** @type {any} */
  let sent = null;
  const code = await runLook(['import', 'good.json', '--yes'], {
    write: () => {},
    error: () => {},
    readFile: () => JSON.stringify(docFor('terrazzo-hall')),
    find: async () => ({ port: 4317, snapshot: {} }),
    post: async (_port, body) => {
      sent = body;
      return { ok: true, status: 200, body: { ok: true } };
    },
  });
  assert.equal(code, 0);
  assert.equal(sent.preset, 'terrazzo-hall');
  assert.equal(sent.kind, LOOK_KIND);
});
