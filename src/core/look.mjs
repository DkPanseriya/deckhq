/**
 * THE LOOK DOCUMENT — WP-88a's second half.
 *
 *     deckhq look export > my-floor.json
 *     deckhq look import my-floor.json
 *
 * A look is what the building is made of, separated from what is on it and from
 * where anything is: nine floor materials over four zones, a colour scheme, a
 * furniture set, two rugs, the planting, the prop density and the lounge kit.
 *
 * ## Why the schema is here and the tables are not
 *
 * `public/render/look-options.js` holds the catalogue and the code that paints
 * with it, because the floor is drawn in the browser and the renderer owns its
 * own materials. This module imports that file rather than restating it — the
 * same direction `src/core/themes.mjs` already imports `public/render/themes.js`
 * (`docs/DEVIATIONS.md` §122). The reverse would be the layering violation:
 * `public/` may never import from `src/`.
 *
 * ## Unlike a layout, it is anonymous
 *
 * A layout names your project folders, and `deckhq layout export` says so on
 * stderr because it is not a file you can safely post. A look names no project,
 * no path, no session and no name — it is nine option ids and a handful of
 * flags — so it can be posted, and this is the document the Look centre's
 * *"share your floor"* is built on.
 *
 * ## Whole, or one error
 *
 * `layout-io`'s discipline, unchanged: `validateLookDocument` returns the whole
 * document or ONE reason, and the applier writes nothing until it has the whole
 * document. An unknown option is REFUSED rather than dropped — a file that
 * silently became a different floor would look like it had been accepted, and
 * the author would send it to somebody else.
 *
 * The one place that drops rather than refuses is `sanitizeLook`, and it has a
 * different job: it coerces a hand-edited `state.json` into something paintable,
 * because a daemon that would not start over a typo in a floor material is worse
 * than a daemon that paints the default and says so.
 */

import {
  AGENT_SIZES,
  DEFAULT_LOOK,
  FLOOR_OPTIONS,
  LOOK_OPTION_COUNT,
  LOOK_PICKERS,
  LOOK_ZONES,
  LOUNGE_KIT_BAYS,
  LOUNGE_KIT_REQUIRED,
  PRESETS,
  PRESET_IDS,
  PLANT_DENSITY_IDS,
  PLANT_FAMILY_IDS,
  PROP_DENSITY_IDS,
  RUG_PATTERN_IDS,
  RUG_ROLES,
  SCHEME_IDS,
  FURNITURE_SET_IDS,
  normalizeLook,
  presetById,
  sameLook,
} from '../../public/render/look-options.js';
import { RUG_TONE_IDS, THEMES } from '../../public/render/themes.js';
import { resolveLook } from '../../public/render/look-derive.js';
import { validateLook } from '../../public/render/look-guards.js';

export {
  AGENT_SIZES,
  DEFAULT_LOOK,
  FLOOR_OPTIONS,
  LOOK_OPTION_COUNT,
  LOOK_PICKERS,
  LOOK_ZONES,
  LOUNGE_KIT_BAYS,
  PRESETS,
  PRESET_IDS,
  presetById,
  resolveLook,
  sameLook,
  validateLook,
};

/** The document's `kind`. Present so a file dropped on the importer by mistake fails on line one. */
export const LOOK_KIND = 'deckhq.look';

/** The document version this build writes and reads. */
export const LOOK_VERSION = 1;

/** Longest document we will even look at, in bytes. A look is well under 2 kB. */
export const MAX_LOOK_BYTES = 16 * 1024;

/** The keys a look document may carry, and nothing else. */
const DOCUMENT_KEYS = Object.freeze([
  'kind',
  'version',
  'preset',
  'floors',
  'scheme',
  'furniture',
  'rugs',
  'plants',
  'props',
  'lounge',
  'agentSize',
]);

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>} a type predicate, so the checker narrows
 *   `unknown` the same way the code below already reads
 */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @typedef {object} LookDocument
 * @property {string} kind
 * @property {number} version
 * @property {string} preset
 * @property {Record<string,string>} floors
 * @property {string} scheme
 * @property {string} furniture
 * @property {Record<string,{tone:string, pattern:string}>} rugs
 * @property {{family:string, density:string}} plants
 * @property {{density:string}} props
 * @property {Record<string,boolean>} lounge
 * @property {string} agentSize
 */

/**
 * The look a settings object is painting, as a document.
 * Pure: it reads, it never writes.
 * @param {{look?: unknown}} settings
 * @returns {LookDocument}
 */
export function buildLookDocument(settings) {
  return { kind: LOOK_KIND, version: LOOK_VERSION, ...normalizeLook(settings?.look) };
}

/**
 * Validate a parsed look document.
 *
 * Returns a result rather than throwing, because every caller has something
 * better to do with the reason than print a stack: the CLI prints one line, the
 * HTTP route returns a 400 with it, and the test suite asserts on it.
 *
 * The second half of the check is the interesting one: a document whose ids are
 * all real can still be a floor nobody may paint, so the whole look is measured
 * against EVERY SHIPPED THEME. A user who imports a look and then switches to
 * night shift must not arrive at a floor `validateLook` would have refused.
 *
 * @param {unknown} doc
 * @returns {{ok:true, look:LookDocument}
 *   | {error:string, problems?:import('../../public/render/look-guards.js').LookProblem[]}}
 */
export function validateLookDocument(doc) {
  if (!isPlainObject(doc)) return { error: 'a look must be a JSON object' };
  if (doc.kind !== LOOK_KIND) {
    return {
      error: `a look document has "kind": "${LOOK_KIND}"; this one has ${JSON.stringify(doc.kind)}`,
    };
  }
  if (doc.version !== LOOK_VERSION) {
    return {
      error: `this look is version ${JSON.stringify(doc.version)}; this build reads version ${LOOK_VERSION}`,
    };
  }
  const extra = Object.keys(doc).filter((k) => !DOCUMENT_KEYS.includes(k));
  if (extra.length) {
    return {
      error:
        `a look carries ${extra.join(', ')}, which a look may not. A look is what the ` +
        'building is made of: floors, a scheme, a set, rugs, planting, props, the lounge kit ' +
        'and an agent size. It names no project, no path and no session.',
    };
  }

  /** @param {string} where @param {unknown} v @param {ReadonlyArray<string>} allowed */
  const one = (where, v, allowed) => {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      return `${where} is ${JSON.stringify(v)}; this build has ${allowed.join(', ')}`;
    }
    return null;
  };

  if (!isPlainObject(doc.floors)) return { error: 'a look has no "floors" object' };
  for (const zone of LOOK_ZONES) {
    const bad = one(`floors.${zone}`, doc.floors[zone], FLOOR_OPTIONS[zone]);
    if (bad) return { error: bad };
  }
  const floorExtra = Object.keys(doc.floors).filter((k) => !LOOK_ZONES.includes(k));
  if (floorExtra.length) {
    return {
      error: `floors carries ${floorExtra.join(', ')}; the zones are ${LOOK_ZONES.join(', ')}`,
    };
  }

  for (const [where, value, allowed] of /** @type {const} */ ([
    ['scheme', doc.scheme, SCHEME_IDS],
    ['furniture', doc.furniture, FURNITURE_SET_IDS],
    ['agentSize', doc.agentSize, AGENT_SIZES],
    ['preset', doc.preset, PRESET_IDS],
  ])) {
    const bad = one(where, value, allowed);
    if (bad) return { error: bad };
  }

  if (!isPlainObject(doc.rugs)) return { error: 'a look has no "rugs" object' };
  for (const role of RUG_ROLES) {
    const rug = doc.rugs[role];
    if (!isPlainObject(rug)) return { error: `rugs.${role} is missing` };
    const bad =
      one(`rugs.${role}.tone`, rug.tone, RUG_TONE_IDS) ||
      one(`rugs.${role}.pattern`, rug.pattern, RUG_PATTERN_IDS);
    if (bad) return { error: bad };
  }

  if (!isPlainObject(doc.plants)) return { error: 'a look has no "plants" object' };
  const plantBad =
    one('plants.family', doc.plants.family, PLANT_FAMILY_IDS) ||
    one('plants.density', doc.plants.density, PLANT_DENSITY_IDS);
  if (plantBad) return { error: plantBad };

  if (!isPlainObject(doc.props)) return { error: 'a look has no "props" object' };
  const propBad = one('props.density', doc.props.density, PROP_DENSITY_IDS);
  if (propBad) return { error: propBad };

  if (!isPlainObject(doc.lounge)) return { error: 'a look has no "lounge" object' };
  for (const bay of LOUNGE_KIT_BAYS) {
    if (typeof doc.lounge[bay] !== 'boolean') {
      return { error: `lounge.${bay} is ${JSON.stringify(doc.lounge[bay])}; it is true or false` };
    }
  }
  const bayExtra = Object.keys(doc.lounge).filter((k) => !LOUNGE_KIT_BAYS.includes(k));
  if (bayExtra.length) {
    return {
      error: `lounge carries ${bayExtra.join(', ')}; the bays are ${LOUNGE_KIT_BAYS.join(', ')}`,
    };
  }
  if (doc.lounge[LOUNGE_KIT_REQUIRED] !== true) {
    return {
      error: `lounge.${LOUNGE_KIT_REQUIRED} may not be turned off: a lounge with no place to sit is a field again`,
    };
  }

  // Every id is real. Now: is this a floor anybody may paint, on every theme
  // this build ships?
  const look = normalizeLook(doc);
  for (const theme of THEMES) {
    const result = validateLook(look, theme.name);
    if (!result.ok) {
      const first = result.problems[0];
      return {
        error: `on the "${theme.name}" theme, ${first.reason} (${first.rule})`,
        problems: result.problems,
      };
    }
  }

  return { ok: true, look: { kind: LOOK_KIND, version: LOOK_VERSION, ...look } };
}

/**
 * Parse and validate a look file's text. Size-bounded before it is parsed: a
 * file this code did not write must not be able to cost the process its heap.
 * @param {unknown} text
 */
export function parseLookDocument(text) {
  const raw = String(text ?? '');
  if (raw.length > MAX_LOOK_BYTES) {
    return { error: `that file is ${raw.length} bytes; a look is under ${MAX_LOOK_BYTES}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `that is not JSON: ${/** @type {any} */ (err)?.message || err}` };
  }
  return validateLookDocument(parsed);
}

/**
 * The `settings.look` sanitiser's rule, in one place.
 *
 * Coerces rather than refuses (see the header), and then measures: a look whose
 * ids are all real but whose combination is refused on the DEFAULT theme falls
 * back to Studio oak, because the alternative is painting a floor the guards
 * said no to. `lookWarning` is how `deckhq doctor` says so out loud.
 *
 * @param {unknown} v
 * @returns {import('../../public/render/look-options.js').Look}
 */
export function sanitizeLook(v) {
  const look = normalizeLook(v);
  return validateLook(look).ok ? look : normalizeLook(DEFAULT_LOOK);
}

/**
 * Which options a stored look named that the sanitiser had to throw away.
 *
 * Walks the paths the catalogue knows and compares what was asked for with what
 * survived, so the warning can NAME the setting rather than say "something".
 * A key that was simply absent is not a loss: a partial look is filled from the
 * default, which is what `normalizeLook` is for.
 *
 * @param {unknown} raw @param {import('../../public/render/look-options.js').Look} out
 * @returns {string[]}
 */
function droppedOptions(raw, out) {
  if (!isPlainObject(raw)) return [];
  /** @type {string[]} */
  const lost = [];
  /** @param {string} path @param {unknown} asked @param {string} got */
  const check = (path, asked, got) => {
    if (asked !== undefined && String(asked) !== got) lost.push(`${path} "${String(asked)}"`);
  };
  for (const zone of LOOK_ZONES) check(`floors.${zone}`, raw.floors?.[zone], out.floors[zone]);
  check('scheme', raw.scheme, out.scheme);
  check('furniture', raw.furniture, out.furniture);
  for (const role of RUG_ROLES) {
    check(`rugs.${role}.tone`, raw.rugs?.[role]?.tone, out.rugs[role].tone);
    check(`rugs.${role}.pattern`, raw.rugs?.[role]?.pattern, out.rugs[role].pattern);
  }
  check('plants.family', raw.plants?.family, out.plants.family);
  check('plants.density', raw.plants?.density, out.plants.density);
  check('props.density', raw.props?.density, out.props.density);
  check('agentSize', raw.agentSize, out.agentSize);
  return lost;
}

/**
 * What `deckhq doctor` should say about a stored look, or `null` when there is
 * nothing to say.
 *
 * Two different failures and one sentence each, because they mean different
 * things to the person reading: a look with an id this build does not have came
 * from a newer build or a hand edit, and a look that is refused is a floor
 * somebody chose that a guard will not paint.
 *
 * @param {unknown} v the raw `settings.look`, before sanitising
 * @returns {string|null}
 */
export function lookWarning(v) {
  if (v === undefined || v === null) return null;
  const normalised = normalizeLook(v);
  const dropped = droppedOptions(v, normalised);
  if (dropped.length) {
    return (
      `your saved look names ${dropped.join(', ')}, which this build does not have; ` +
      'the parts it knows were kept'
    );
  }
  const result = validateLook(normalised);
  if (!result.ok) {
    return `your saved look is refused — ${result.problems[0].reason} — so the floor is painted in ${DEFAULT_LOOK.preset}`;
  }
  return null;
}
