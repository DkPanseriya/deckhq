/**
 * The theme schema — WP-30.
 *
 * A theme is a JSON document. This is the layer that decides whether a
 * particular document is one, and it is deliberately the strictest thing in
 * the package: everything downstream (the palette, the chrome, the settings
 * sanitizer, the layout importer) is allowed to assume a theme that got past
 * here is a theme.
 *
 * ## Why the schema is here and the colours are not
 *
 * `public/render/themes.js` holds the theme DATA and the code that paints with
 * it, because the floor is drawn in the browser and the renderer owns its own
 * materials. This module imports that file rather than restating its tables —
 * the same direction `src/core/identity.mjs` already imports `public/names.js`
 * (`docs/DEVIATIONS.md` §122: three `public/` modules are reachable from the
 * Node side, and this is the fourth). The reverse would be the layering
 * violation: `public/` may never import from `src/`, because `public/` is
 * served as static files and `src/` is not.
 *
 * ## What the schema refuses, and why each refusal exists
 *
 *   - **An unknown key.** Refused, not dropped. A theme that carried
 *     `state.for_review` and had it silently ignored would look like it had
 *     been accepted, and the author would ship it.
 *   - **Anything that is not `#rrggbb`.** No `url(...)`, no `var(...)`, no
 *     gradient, no font name, no number. A theme is colours and a name; it
 *     therefore cannot fetch anything (the free core makes no outbound
 *     request, ever) and cannot change a letterform.
 *   - **A theme that fails a contrast floor.** Checked by
 *     `assertThemeContrast`, so a theme that would make a state colour
 *     unreadable is refused at load rather than reported afterwards.
 *
 * The seven state colours, the crimson accent and the identity palette are not
 * refused — they are UNREACHABLE. There is no key in the allowlist that names
 * one.
 */

import {
  CHROME_KEYS,
  DEFAULT_THEME_NAME,
  FLOOR_KEYS,
  THEMES,
  THEME_NAMES,
  THEME_VERSION,
  allThemes,
  assertThemeContrast,
  clearPackThemes,
  registerPackThemes,
  themeByName,
  themeNames,
} from '../../public/render/themes.js';

export {
  CHROME_KEYS,
  DEFAULT_THEME_NAME,
  FLOOR_KEYS,
  THEMES,
  THEME_NAMES,
  THEME_VERSION,
  allThemes,
  clearPackThemes,
  registerPackThemes,
  themeByName,
  themeNames,
};

/** A theme name: printable, short, and nothing that could be a path or a flag. */
const NAME_RE = /^[a-z0-9][a-z0-9 _-]{0,31}$/;

/** The only value shape a theme may carry. */
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

/** Longest document we will even look at, in bytes. A theme is under 2 kB. */
export const MAX_THEME_BYTES = 16 * 1024;

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>} a type predicate, so the checker narrows
 *   `unknown` the same way the code below already reads
 */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @typedef {object} ThemeDocument
 * @property {string} name
 * @property {number} version
 * @property {Record<string,string>} floor
 * @property {Record<string,string>} chrome
 */

/**
 * Validate a parsed theme document.
 *
 * Returns a result rather than throwing, because every caller has something
 * better to do with the reason than print a stack: the CLI prints one line,
 * the HTTP route returns a 400 with it, and the test suite asserts on it.
 *
 * @param {unknown} doc
 * @returns {{ok:true, theme:ThemeDocument} | {ok:false, error:string}}
 */
export function validateTheme(doc) {
  if (!isPlainObject(doc)) return { ok: false, error: 'a theme must be a JSON object' };

  const name = typeof doc.name === 'string' ? doc.name.trim().toLowerCase() : '';
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      error:
        'a theme needs a "name": lower-case letters, digits, spaces, - or _, up to 32 characters',
    };
  }

  if (doc.version !== THEME_VERSION) {
    return {
      ok: false,
      error: `theme "${name}" is version ${JSON.stringify(doc.version)}; this build reads version ${THEME_VERSION}`,
    };
  }

  const sections = /** @type {const} */ ([
    ['floor', Object.keys(FLOOR_KEYS)],
    ['chrome', [...CHROME_KEYS]],
  ]);
  /** @type {any} */
  const out = { name, version: THEME_VERSION, floor: {}, chrome: {} };

  for (const [section, allowed] of sections) {
    const value = /** @type {any} */ (doc)[section];
    if (!isPlainObject(value)) {
      return { ok: false, error: `theme "${name}" has no "${section}" object` };
    }
    for (const [key, colour] of Object.entries(value)) {
      if (!allowed.includes(key)) {
        return {
          ok: false,
          error:
            `theme "${name}" sets ${section}.${key}, which is not themeable. ` +
            `${section} takes only: ${allowed.join(', ')}. State colours, the accent and the ` +
            'project identities are not themeable at all.',
        };
      }
      if (typeof colour !== 'string' || !COLOUR_RE.test(colour.trim())) {
        return {
          ok: false,
          error: `theme "${name}" sets ${section}.${key} to ${JSON.stringify(colour)}; a theme carries #rrggbb colours and nothing else`,
        };
      }
      out[section][key] = colour.trim();
    }
  }

  // Every key must be present: a half-stated theme would inherit the rest from
  // the default and read as a bug in whichever half the author forgot.
  for (const [section, allowed] of sections) {
    const missing = allowed.filter((k) => !(k in out[section]));
    if (missing.length) {
      return { ok: false, error: `theme "${name}" is missing ${section}.${missing.join(', ')}` };
    }
  }

  const extra = Object.keys(doc).filter(
    (k) => !['name', 'version', 'floor', 'chrome', 'blurb'].includes(k),
  );
  if (extra.length) {
    return {
      ok: false,
      error: `theme "${name}" carries ${extra.join(', ')}, which a theme may not: a theme is a name, a version and two colour tables`,
    };
  }

  try {
    assertThemeContrast(out);
  } catch (err) {
    return { ok: false, error: /** @type {Error} */ (err).message };
  }

  return { ok: true, theme: out };
}

/**
 * The `settings.theme` sanitizer's rule, in one place: only a theme this build
 * actually ships may be selected, and anything else falls back to the default.
 *
 * A theme name is not a path and is never opened, so a hand-edited
 * `state.json` naming `../../etc/passwd` reads back as `default`.
 * @param {unknown} v
 * @returns {string}
 */
export function sanitizeThemeName(v) {
  const theme = themeByName(v);
  return theme ? theme.name : DEFAULT_THEME_NAME;
}

/**
 * Is this a theme this build can paint — one it ships, or one an installed
 * asset pack registered (WP-45)? The HTTP route uses it to reject an unknown
 * name with a message instead of storing the default behind the caller's back.
 * @param {unknown} v
 */
export function isKnownTheme(v) {
  return themeByName(v) !== null;
}
