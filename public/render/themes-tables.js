/**
 * The theme TABLES: the allowlist a theme document is held to, the two
 * default documents, the themes this build ships, and the pack registry that
 * can add more.
 *
 * Split out of `public/render/themes.js` by WP-92n
 * (`docs/plan/13-ARCHITECTURE-AUDIT.md` A-12, `docs/DEVIATIONS.md` §183) at the
 * seam the audit drew: the tables in one module, the derivation and the guards
 * in another. §160 made the derivation the single source of the shipped floor,
 * so tables-out is the natural cut and it moves no derivation at all.
 *
 * IT IS THE BOTTOM OF THE THEME STACK and imports nothing — not the palette,
 * not the derivation, not `themes.js`. That is what makes it impossible for a
 * table to depend on the arithmetic that reads it.
 *
 * Pure data. No DOM at module scope, so this file is safe to import under
 * `node --test` and from `src/core/themes.mjs`.
 */

/** The theme every install starts on, and the one the goldens are shot in. */
export const DEFAULT_THEME_NAME = 'default';

/**
 * How close, in sRGB distance, a themed colour may come to the reserved
 * crimson. The same bar `palette.js` holds a shipped material to, and stated
 * as one number so the floor and the chrome cannot end up with two.
 */
export const CRIMSON_MIN_DISTANCE = 60;

/** The document version this build writes and reads. */
export const THEME_VERSION = 1;

/**
 * Every floor material a theme may name, and what it paints. This list IS the
 * allowlist — `src/core/themes.mjs` rejects a document with any other key.
 * @type {Readonly<Record<string, string>>}
 */
export const FLOOR_KEYS = Object.freeze({
  wood: 'the herringbone planks in the office and the lounge',
  carpet: 'the woven carpet in a project room',
  screed: 'the poured circulation between rooms',
  ground: 'the ground the building stands on',
  tile: 'the kitchen tile inside the lounge',
  wall: 'full-height walls',
  partition: 'waist-height partitions',
  desk: 'desks, benches and tables',
  seat: 'chairs, sofas and the soft furniture',
  plant: 'foliage',
  ink: 'the line work: room plates, labels, the in-room "+"',
});

/**
 * Every chrome token a theme may name. These are `public/style.css`'s `:root`
 * custom properties by the same names, minus every one that carries meaning:
 * `--accent`, `--accent-ink`, `--focus`, `--line-2` and the seven
 * `--state-*` are absent and unreachable.
 * @type {ReadonlyArray<string>}
 */
export const CHROME_KEYS = Object.freeze([
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'line',
  'ink',
  'ink-2',
  'muted',
]);

// ------------------------------------------------------------- shipped themes

/**
 * The default floor and chrome, stated as a theme document so the picker can
 * show it, `deckhq layout export` can name it, and a round trip through the
 * schema proves the schema can express what ships.
 *
 * These values are QUOTED from `palette.js` and `style.css`, and applying this
 * theme does not run the derivation above — see `applyTheme`, which restores
 * the shipped materials rather than re-deriving them.
 *
 * WP-85a CLOSED THE GAP THAT USED TO SIT HERE. Until this package the default
 * herringbone's four tones were hand-tuned and no single-colour derivation
 * reproduced them, so "the default floor" and "the derivation" were two
 * different statements of the same floor that were allowed to disagree. §3.1
 * says three themes are one system, so they are: `DEFAULT_PALETTE` now holds
 * exactly `materialTokensFor(THEMES[0])`, byte for byte, and the guard at the
 * bottom of this file proves it for EVERY derived token rather than for the
 * eleven anchors. The reset stays because it is faster and because it puts the
 * props a theme does not touch back as well.
 */
export const DEFAULT_FLOOR = Object.freeze({
  wood: '#DCC9AE',
  carpet: '#E7E2D7',
  screed: '#D2CDC1',
  ground: '#DFDAD0',
  tile: '#E3DFD6',
  wall: '#F4F1EA',
  partition: '#E0DACD',
  desk: '#C8AC84',
  seat: '#DCD5C6',
  plant: '#6C8F63',
  ink: '#32281D',
});

export const DEFAULT_CHROME = Object.freeze({
  bg: '#131419',
  surface: '#1a1c23',
  'surface-2': '#23262f',
  'surface-3': '#2d313c',
  line: '#333846',
  ink: '#eceef3',
  'ink-2': '#b8bdc9',
  muted: '#8a92a3',
});

/**
 * The themes this build ships. Two beside the default, both free and neither
 * gated — the Supporter pack (`docs/plan/03-BUSINESS-MODEL.md` §5) sells MORE
 * themes later and gates nothing here.
 *
 * @type {ReadonlyArray<{name:string, version:number, blurb:string,
 *   floor:Record<string,string>, chrome:Record<string,string>}>}
 */
export const THEMES = Object.freeze(
  [
    {
      name: DEFAULT_THEME_NAME,
      version: THEME_VERSION,
      blurb: 'Warm wood on a cold studio ground. The floor as it ships.',
      floor: { ...DEFAULT_FLOOR },
      chrome: { ...DEFAULT_CHROME },
    },
    {
      name: 'night shift',
      version: THEME_VERSION,
      blurb: 'The same office after hours: cooler, dimmer, lights low.',
      floor: {
        // WP-85a §3.1. The wood goes UNDER the carpet rather than over it: on a
        // dark theme the boards are the thing a working desk's pool of light is
        // read against, and a floor that started brighter than the room it runs
        // into had the value hierarchy the same way round as the day theme's.
        wood: '#40454D',
        carpet: '#31353D',
        screed: '#2A2E35',
        ground: '#22262D',
        tile: '#373C44',
        wall: '#4E545D',
        partition: '#3C414A',
        desk: '#4A4F58',
        // Measured, not chosen: at `#666C75` this theme's own ink was 4.43:1
        // on a chair, and an agent's name is drawn where the agent sits.
        // `assertThemeContrast` refused it at import.
        seat: '#4F555F',
        plant: '#6E9E86',
        ink: '#E8EBF1',
      },
      chrome: {
        bg: '#0e0f13',
        surface: '#15161b',
        'surface-2': '#1d1f26',
        'surface-3': '#262932',
        line: '#2e323d',
        ink: '#e9ebf1',
        'ink-2': '#b4bac7',
        muted: '#8a92a3',
      },
    },
    {
      name: 'blueprint',
      version: THEME_VERSION,
      blurb: 'The floor as a drawing: drafting-table blue, white line work.',
      floor: {
        wood: '#1C3D5F',
        carpet: '#173553',
        screed: '#132C47',
        ground: '#112941',
        tile: '#20466C',
        wall: '#2C5885',
        partition: '#1F4265',
        desk: '#245079',
        seat: '#2A5580',
        plant: '#7FB8A2',
        ink: '#F2F6FB',
      },
      chrome: {
        bg: '#0a1421',
        surface: '#101e2e',
        'surface-2': '#182a40',
        'surface-3': '#21374f',
        line: '#2c4763',
        ink: '#eef3fa',
        'ink-2': '#b6c4d6',
        muted: '#8fa0b8',
      },
    },
  ].map((t) =>
    Object.freeze({ ...t, floor: Object.freeze(t.floor), chrome: Object.freeze(t.chrome) }),
  ),
);

/** Every shipped theme's name, in picker order. @type {ReadonlyArray<string>} */
export const THEME_NAMES = Object.freeze(THEMES.map((t) => t.name));
