/**
 * THE LOOK STORE — the one place the client keeps "what the floor looks like".
 *
 * The owner, using his own floor: *"Option toggles are not working well: the
 * highlight box goes back to the default option although after changing
 * something."* There were three copies of the look in this client, and that
 * sentence is what three copies sound like from the outside:
 *
 *   - the shell's snapshot, which `postLook` stamped with the daemon's answer;
 *   - the settings sheet's own `current`, copied from that snapshot when the
 *     sheet was opened and never touched by a look write again — so the Look
 *     section drew every answer from the look the sheet was OPENED on, and
 *     built the next change on top of it, which undid the last one;
 *   - each surface's private "pending" look, cleared by whichever answer came
 *     back first.
 *
 * So there is one store now and both surfaces — the sheet's Look section and
 * the header's Look bar — read it and subscribe to it. Its rule is one line:
 *
 *   **a control shows the value the daemon last accepted, moved optimistically
 *   on the click and put back ONLY by a refusal, with the reason beside it.**
 *
 * ============================================================================
 * WHAT IT HOLDS
 *
 *   confirmed   the look the daemon last accepted. It changes in exactly two
 *               ways: the daemon ANSWERS a write, or the daemon PUSHES a
 *               state. Re-reading a push that was already heard changes
 *               nothing — which is what the old arrangement got wrong: it
 *               redrew every answer from settings nobody had updated, and the
 *               answer lost to them.
 *   pending     the look somebody just chose, shown at once and not yet
 *               answered. Cleared by the answer to THAT choice and by no
 *               earlier one.
 *   refusal     the last "no", the guard's own sentence, and which control the
 *               hand was on.
 *
 * The theme rides along, for the same reason and with the same three states: it
 * is one of the four things on the outside of both surfaces, and it had the same
 * disease — the sheet stored it in one place and the bar read it from another.
 *
 * Nothing here touches a global, a document or the renderer: the catalogue, the
 * guard, the two writes and the daemon's last word all arrive as parameters,
 * which is what lets `test/unit/look-store.test.mjs` drive every transition.
 * ============================================================================
 */

/**
 * How long a change waits before it is posted.
 *
 * Arrow keys walk a picker, and a user holding one down would otherwise post —
 * and re-bake the floor behind the sheet — once per option crossed. 140 ms is
 * long enough to swallow a walk and short enough that a single click feels
 * immediate; the controls move on the keystroke either way, because they show
 * the pending look rather than the confirmed one.
 *
 * Tests pass 0, which applies synchronously — a debounce is a property of a
 * hand on a keyboard, not of the thing being posted.
 */
export const LOOK_DEBOUNCE_MS = 140;

/** Read `a.b.c` off a look. @param {any} obj @param {string} path */
export function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * A look with one path set — a copy, never a mutation. The look a surface is
 * showing came from the store; writing into it would make a refused change
 * permanent in the one place the refusal was supposed to leave alone.
 *
 * @param {any} look @param {string} path @param {unknown} value
 */
export function withPath(look, path, value) {
  const keys = path.split('.');
  const out = { ...look };
  let node = out;
  for (let i = 0; i < keys.length - 1; i++) {
    node[keys[i]] = { ...node[keys[i]] };
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
  return out;
}

// --------------------------------------------- a style, and what is not one

/**
 * AGENT SIZE IS NOT PART OF A STYLE.
 *
 * A preset is a floor: materials, a colour scheme, furniture, rugs, plants. How
 * big the people on it are drawn is a preference about the person looking —
 * their screen, their eyes, how many sessions they run — and it used to be
 * reset by every preset card, which is the second way a highlight "went back
 * to the default": choose Large, choose Night lab, and Medium was lit again.
 *
 * So choosing a preset keeps the size, and "edited" is a statement about the
 * style alone. The catalogue's presets still carry a size, because `?look=` and
 * the goldens photograph them whole; it is this client that stopped applying it.
 *
 * @param {any} c the catalogue @param {any} look @param {string} presetId
 */
export function withPreset(c, look, presetId) {
  return { ...c.lookForPreset(presetId), agentSize: c.normalizeLook(look).agentSize };
}

/** Every leaf of a look's STYLE as `path → value`. @param {any} c @param {any} look */
function styleLeaves(c, look) {
  /** @type {Record<string, unknown>} */
  const out = {};
  /** @param {any} node @param {string} prefix */
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') walk(value, path);
      else out[path] = value;
    }
  };
  const { preset: _preset, agentSize: _size, ...style } = c.normalizeLook(look);
  walk(style, '');
  return out;
}

/**
 * Which options differ from the preset this look started from, as the paths of
 * the leaves that moved (`floors.office`, `rugs.wool.tone`, `lounge.games`).
 * Agent size is never one of them: it is not part of a style.
 * @param {any} c @param {any} look
 * @returns {string[]}
 */
export function changedPaths(c, look) {
  const mine = styleLeaves(c, look);
  const theirs = styleLeaves(c, c.lookForPreset(c.normalizeLook(look).preset));
  return Object.keys(mine).filter((path) => mine[path] !== theirs[path]);
}

/**
 * How many options differ from the preset — the number the closed Advanced
 * disclosure reads out.
 * @param {any} c @param {any} look
 */
export const styleChanges = (c, look) => changedPaths(c, look).length;

/** Has the style been changed since its preset was chosen? @param {any} c @param {any} look */
export const styleEdited = (c, look) => styleChanges(c, look) > 0;

/** The preset a look started from: its label, or its id. @param {any} c @param {any} look */
export function presetLabel(c, look) {
  const id = c.normalizeLook(look).preset;
  return (c.PRESETS || []).find((/** @type {any} */ p) => p.id === id)?.label || id;
}

// ----------------------------------------------------------------- density

/**
 * ONE DENSITY, OVER TWO.
 *
 * The catalogue has a planting density and a prop density, three steps each,
 * and nobody outside this repository thinks of them as two things: a room is
 * calm or it is lively. So the outside of both surfaces offers ONE control with
 * three steps, and each step is the pair at that position in the catalogue's
 * own two tables — sparse with quiet, normal with normal, lush with busy. The
 * ids are never written here; only the three words are.
 */
const DENSITY_WORDS = Object.freeze([
  { id: 'calm', label: 'Calm' },
  { id: 'normal', label: 'Normal' },
  { id: 'lively', label: 'Lively' },
]);

/**
 * The steps this catalogue can offer, each with the two options it stands for.
 * @param {any} c
 * @returns {Array<{id:string, label:string, plants:string, props:string}>}
 */
export function densityLevels(c) {
  const plants = c.PLANT_DENSITY_IDS || [];
  const props = c.PROP_DENSITY_IDS || [];
  // Two tables of different lengths have no shared scale to offer; the two
  // pickers under Advanced are then the only honest controls.
  if (plants.length !== DENSITY_WORDS.length || props.length !== DENSITY_WORDS.length) return [];
  return DENSITY_WORDS.map((word, i) => ({ ...word, plants: plants[i], props: props[i] }));
}

/**
 * Which step a look is on, or `''` when its two densities are not a pair — set
 * apart under Advanced, which is allowed and is then shown as no step at all
 * rather than as the nearest one.
 * @param {any} c @param {any} look
 */
export function densityOf(c, look) {
  const now = c.normalizeLook(look);
  const level = densityLevels(c).find(
    (l) => l.plants === now.plants.density && l.props === now.props.density,
  );
  return level ? level.id : '';
}

/** A look with both densities moved to one step. @param {any} c @param {any} look @param {string} id */
export function withDensity(c, look, id) {
  const level = densityLevels(c).find((l) => l.id === id);
  if (!level) return look;
  return withPath(withPath(look, 'plants.density', level.plants), 'props.density', level.props);
}

// ------------------------------------------------- outside, and under Advanced

/**
 * The catalogue pickers drawn on the OUTSIDE of both surfaces. One: the others
 * out there — theme, style, density — are not catalogue pickers.
 */
export const OUTSIDE_PICKER_IDS = Object.freeze(['agentSize']);

/** The three headings under Advanced, in the order they are drawn. */
export const ADVANCED_GROUPS = Object.freeze([
  { id: 'floors', label: 'Floors' },
  { id: 'furniture', label: 'Furniture and textiles' },
  { id: 'plants', label: 'Plants and props' },
]);

/**
 * Which heading a picker belongs under.
 *
 * A RULE over the picker's id rather than a list of ids, and the last line is
 * the point: a picker the catalogue grows tomorrow lands under a heading
 * without anybody editing this file, so it cannot be offered by the catalogue
 * and missing from the sheet.
 * @param {string} pickerId
 */
export function advancedGroupOf(pickerId) {
  if (pickerId.startsWith('floor.') || pickerId === 'scheme') return 'floors';
  if (pickerId === 'plants' || pickerId === 'props') return 'plants';
  return 'furniture';
}

/**
 * Everything under Advanced: every catalogue picker that is not on the
 * outside, under its heading, in catalogue order.
 * @param {any} c
 * @returns {Array<{id:string, label:string, pickers:any[]}>}
 */
export function advancedGroups(c) {
  const inside = (c.LOOK_PICKERS || []).filter(
    (/** @type {any} */ p) => !OUTSIDE_PICKER_IDS.includes(p.id),
  );
  return ADVANCED_GROUPS.map((g) => ({
    ...g,
    pickers: inside.filter((/** @type {any} */ p) => advancedGroupOf(p.id) === g.id),
  }));
}

// --------------------------------------------------------------- the store

/**
 * @param {object} opts
 * @param {any} opts.port   the look port: `catalogue()`, `validate(look, theme)`,
 *   `theme()` and `apply(look)`, which resolves `{ok, look?, problems?, error?}`
 * @param {() => any} [opts.read]  the settings the daemon last PUSHED, or null
 * @param {{list?:() => any[], apply?:(name:string) => any,
 *   swatches?:(theme:any) => string[]}} [opts.theming]
 * @param {(patch:Record<string, unknown>) => Promise<any>} [opts.saveSetting]
 *   the settings route; resolves the stored settings, or null on a failure
 * @param {number} [opts.debounceMs]
 */
export function createLookStore(opts) {
  const { port, theming } = opts;
  const read = opts.read || (() => null);
  const saveSetting = opts.saveSetting || (async () => null);
  let debounceMs = opts.debounceMs ?? LOOK_DEBOUNCE_MS;

  /** @type {any} */
  let confirmed = null;
  /** @type {any} */
  let pending = null;
  /** @type {string|null} */
  let confirmedTheme = null;
  /** @type {string|null} */
  let themePending = null;
  /** @type {{from:string|null, problems:any[]}|null} */
  let refusal = null;
  /**
   * What the daemon last pushed — the settings object it arrived in, and each
   * key's value — so a repeat is recognised as one.
   * @type {{from:any, look:string, theme:string}}
   */
  const heard = { from: null, look: '', theme: '' };
  /** Counts the choices, so an answer knows whether it is still the latest. */
  let chosen = 0;
  let themeChosen = 0;
  /** @type {any} */
  let timer = null;
  /** The write the timer is holding. @type {null|(() => Promise<void>)} */
  let waiting = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const cat = () => port?.catalogue?.() || null;
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  /**
   * Hear the daemon's last push. Only what is NEW is adopted — see `confirmed`
   * in the header. Returns whether anything changed.
   */
  function pull() {
    const s = read();
    if (!s) return false;
    // A NEW settings object is a new push, and a push is always heard. The
    // same object again is heard only where its value moved — which is the
    // shell stamping an answer onto the snapshot it already had.
    const fresh = s !== heard.from;
    heard.from = s;
    let changed = false;
    const look = JSON.stringify(s.look ?? null);
    if (fresh || look !== heard.look) {
      changed = JSON.stringify(confirmed ?? null) !== look;
      confirmed = s.look ?? null;
    }
    heard.look = look;
    const theme = String(s.theme ?? '');
    if (fresh || theme !== heard.theme) {
      changed = changed || (confirmedTheme ?? '') !== theme;
      confirmedTheme = theme || null;
    }
    heard.theme = theme;
    return changed;
  }

  /**
   * Measure a look, then either show it and send it, or refuse it and change
   * nothing. The guard runs first, on the theme the floor is painted in; only a
   * look that passes is ever shown.
   *
   * @param {any} next
   * @param {string|null} [from] the control the hand was on
   * @returns {Promise<void>|undefined} the write, when it was sent at once
   */
  function choose(next, from = null) {
    if (!cat()) return undefined;
    const verdict = port.validate ? port.validate(next, port.theme?.()) : { ok: true };
    if (!verdict.ok) {
      // Refused before it was shown: nothing moves, including a change that was
      // accepted a moment ago and is still on its way.
      refusal = { from, problems: verdict.problems || [] };
      notify();
      return undefined;
    }
    refusal = null;
    pending = next;
    const mine = ++chosen;
    notify();
    if (timer) clearTimeout(timer);
    const post = async () => {
      timer = null;
      waiting = null;
      const result = await port.apply(next);
      if (result && result.ok === false) {
        // The daemon measures against EVERY shipped theme, so this is the look
        // that reads here and would not on another one. It goes back — but only
        // if nothing newer has been chosen in the meantime.
        refusal = {
          from,
          problems: result.problems?.length
            ? result.problems
            : [{ picker: '', option: '', reason: result.error || 'That look was refused' }],
        };
      } else {
        confirmed = result?.look ?? next;
      }
      if (mine === chosen) pending = null;
      notify();
    };
    if (debounceMs <= 0) return post();
    waiting = post;
    timer = setTimeout(post, debounceMs);
    return undefined;
  }

  /**
   * Send a change that was shown and is still waiting out its debounce. A
   * surface calls this on its way shut: the person saw the control move.
   */
  function flush() {
    if (!timer || !waiting) return undefined;
    clearTimeout(timer);
    return waiting();
  }

  /**
   * Store a theme, then paint what was STORED — the store is the authority on
   * what landed, and a theme the route did not keep is not painted.
   * @param {string} name
   */
  async function chooseTheme(name) {
    if (refusal?.from === 'theme') refusal = null;
    themePending = name;
    const mine = ++themeChosen;
    notify();
    const saved = await saveSetting({ theme: name });
    if (saved) {
      confirmedTheme = saved.theme;
      theming?.apply?.(saved.theme);
    } else {
      refusal = { from: 'theme', problems: [{ reason: 'That theme could not be saved' }] };
    }
    if (mine === themeChosen) themePending = null;
    notify();
  }

  /** The look to DRAW: what was just chosen, or what the daemon last accepted. */
  const look = () => {
    const c = cat();
    return c ? c.normalizeLook(pending ?? confirmed) : null;
  };

  return {
    port,
    catalogue: cat,
    look,
    /** The look the daemon last accepted, whatever is pending. */
    confirmedLook() {
      const c = cat();
      return c ? c.normalizeLook(confirmed) : null;
    },
    /** True while a choice is shown and not yet answered. */
    isPending: () => pending !== null || themePending !== null,
    choose,
    flush,
    /** A preset, keeping the agent size. @param {string} id @param {string} [from] */
    choosePreset(id, from = 'preset') {
      const c = cat();
      return c ? choose(withPreset(c, look(), id), from) : undefined;
    },
    /** Every style option back to its preset's; the agent size stays. @param {string} [from] */
    resetStyle(from = 'preset') {
      const c = cat();
      return c ? choose(withPreset(c, look(), look().preset), from) : undefined;
    },
    /** One catalogue option, by its path. @param {string} path @param {unknown} value @param {string} from */
    choosePath(path, value, from) {
      return cat() ? choose(withPath(look(), path, value), from) : undefined;
    },
    /** Both densities, to one step. @param {string} id @param {string} [from] */
    chooseDensity(id, from = 'density') {
      const c = cat();
      return c ? choose(withDensity(c, look(), id), from) : undefined;
    },

    // What the surfaces say about the look they are drawing. Each is the pure
    // function above applied to `look()`, so the two surfaces cannot word the
    // same floor differently.
    /** The step both densities are on, or `''`. */
    density: () => (cat() ? densityOf(cat(), look()) : ''),
    densityLevels: () => (cat() ? densityLevels(cat()) : []),
    presetLabel: () => (cat() ? presetLabel(cat(), look()) : ''),
    changedPaths: () => (cat() ? changedPaths(cat(), look()) : []),
    styleChanges: () => (cat() ? styleChanges(cat(), look()) : 0),
    styleEdited: () => (cat() ? styleEdited(cat(), look()) : false),

    themes() {
      const list = theming?.list?.();
      return Array.isArray(list) ? list : [];
    },
    /** @param {any} theme */
    swatches: (theme) => theming?.swatches?.(theme) || [],
    /** The theme to DRAW as chosen. */
    theme: () => themePending ?? confirmedTheme ?? 'default',
    /** The theme the daemon last stored — what a preview is put back to. */
    storedTheme: () => confirmedTheme ?? 'default',
    chooseTheme,
    /** Paint a theme without storing it; `null` puts the stored one back. @param {string|null} name */
    previewTheme(name) {
      theming?.apply?.(name ?? (themePending || confirmedTheme || 'default'));
    },

    /** The reasons that belong under one control. @param {string} rowId */
    refusalsFor(rowId) {
      if (!refusal) return [];
      if (refusal.from) return refusal.from === rowId ? refusal.problems : [];
      return refusal.problems.filter((p) => p.picker === rowId);
    },
    /** The last refusal, whole — for a surface that must draw one it has no row for. */
    refusal: () => refusal,
    clearRefusal() {
      refusal = null;
    },

    /**
     * A state push arrived, or a surface is about to draw: hear what the daemon
     * last said. Subscribers are told only when it said something new, and not
     * at all by a surface that is already drawing (`silent`) — telling it would
     * start the redraw it is in the middle of.
     * @param {{silent?:boolean}} [how]
     * @returns {boolean} whether the daemon said something new
     */
    refresh(how = {}) {
      const changed = pull();
      if (changed && !how.silent) notify();
      return changed;
    },
    /** @param {() => void} fn @returns {() => void} */
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Tests pass 0. See `LOOK_DEBOUNCE_MS`. @param {number} ms */
    setDebounce(ms) {
      debounceMs = ms;
    },
  };
}
