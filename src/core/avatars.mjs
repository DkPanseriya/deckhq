/**
 * Avatar sets, from the Node side — WP-45.
 *
 * The same shape and the same reason as `src/core/themes.mjs`: the DATA and
 * the code that paints with it live in `public/render/palette.js`, because the
 * floor is drawn in the browser and the renderer owns its own materials, and
 * this module imports that file rather than restating its tables. `public/`
 * may never import from `src/`; `src/` may import from `public/`, and this is
 * the fifth module that does (`docs/DEVIATIONS.md` §122).
 *
 * What is here is what the Node half needs: the registry the store sanitises
 * a setting against, and the registration `src/core/packs.mjs` performs when
 * it loads a pack. No I/O — a sanitizer that had to read a directory would be
 * a sanitizer that could fail.
 */
export {
  applyAvatarSet,
  avatarPools,
  avatarSetByName,
  avatarSets,
  clearPackAvatarSets,
  registerPackAvatarSets,
  sanitizeAvatarSetName,
} from '../../public/render/palette.js';
