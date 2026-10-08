/**
 * THE PRESET DEFINITIONS — the six of WP-88a and the five of G6a.
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §3, `docs/plan/graphics/04-options.md` §1.
 *
 * Each is a PARTIAL look: only what differs from the floor as it ships. The
 * catalogue (`look-options.js`) fills every one out with `normalizeLook`, and
 * that is why this file imports nothing — it is the list the catalogue is built
 * from, so it cannot ask the catalogue what an option is called.
 *
 * It lives apart from the catalogue for the plain reason the materials do: the
 * table alone would put that file over the line ceiling.
 *
 * Every one of the eleven is measured against `validateLook` on all three
 * shipped themes by `look-guards.test.mjs`, with the ratios printed. Three of
 * the five new ones did not pass as first drawn, and what was changed is in
 * that test as three refusals: a guard that never said no to its own author
 * would not have been tested.
 *
 * Pure data.
 */

/**
 * @type {ReadonlyArray<{id:string, label:string, blurb:string, look:any}>}
 */
export const PRESET_DEFS = Object.freeze(
  [
    {
      id: 'studio-oak',
      label: 'Studio oak',
      blurb: 'Warm oak, wool rugs, everything on. The floor exactly as it ships.',
      // Nothing differs from the floor as it ships, because this IS the floor as
      // it ships: every key is filled from `DEFAULT_LOOK`.
      look: {},
    },
    {
      id: 'night-lab',
      label: 'Night lab',
      blurb: 'Polished concrete under an ink wash, industrial frames, no games bay.',
      look: {
        floors: {
          office: 'polished-concrete',
          corridor: 'ceramic-tile',
          rooms: 'loop-pile',
          lounge: 'polished-concrete',
        },
        scheme: 'ink',
        furniture: 'industrial',
        rugs: {
          wool: { tone: 'wool', pattern: 'banded' },
          task: { tone: 'wool', pattern: 'plain' },
        },
        plants: { family: 'architectural', density: 'sparse' },
        props: { density: 'normal' },
        lounge: { sitting: true, quiet: true, cafe: true, games: false },
      },
    },
    {
      id: 'paper-office',
      label: 'Paper office',
      blurb:
        'Mono over ash boards; every surface a neutral, so the only colour left is the people.',
      look: {
        floors: {
          office: 'wide-ash',
          corridor: 'poured-screed',
          rooms: 'wide-ash',
          lounge: 'wide-ash',
        },
        scheme: 'mono',
        furniture: 'scandi',
        rugs: {
          wool: { tone: 'sand', pattern: 'plain' },
          task: { tone: 'sand', pattern: 'banded' },
        },
        plants: { family: 'dry', density: 'sparse' },
        props: { density: 'quiet' },
      },
    },
    {
      id: 'terrazzo-hall',
      label: 'Terrazzo hall',
      blurb: 'A civic building — terrazzo, ceramic tile, soft silhouettes, busy shelves.',
      look: {
        floors: {
          office: 'terrazzo',
          corridor: 'ceramic-tile',
          rooms: 'polished-concrete',
          lounge: 'terrazzo',
        },
        scheme: 'warm',
        furniture: 'soft',
        rugs: {
          wool: { tone: 'wool', pattern: 'banded' },
          task: { tone: 'sage', pattern: 'banded' },
        },
        plants: { family: 'leafy', density: 'normal' },
        props: { density: 'busy' },
      },
    },
    {
      id: 'garden-floor',
      label: 'Garden floor',
      blurb: 'Cork and ash under a forest wash, planted as far as the density rules allow.',
      look: {
        floors: {
          office: 'wide-ash',
          corridor: 'loop-pile',
          rooms: 'cork',
          lounge: 'wide-ash',
        },
        scheme: 'forest',
        furniture: 'soft',
        rugs: {
          wool: { tone: 'sage', pattern: 'plain' },
          task: { tone: 'sage', pattern: 'banded' },
        },
        plants: { family: 'leafy', density: 'lush' },
        props: { density: 'normal' },
        agentSize: 'large',
      },
    },
    {
      id: 'workshop',
      label: 'Workshop',
      blurb: 'Clay over concrete, industrial frames — a hundred sessions in a shed.',
      look: {
        floors: {
          office: 'polished-concrete',
          corridor: 'ceramic-tile',
          rooms: 'polished-concrete',
          lounge: 'polished-concrete',
        },
        scheme: 'clay',
        furniture: 'industrial',
        rugs: {
          wool: { tone: 'sand', pattern: 'banded' },
          task: { tone: 'wool', pattern: 'plain' },
        },
        plants: { family: 'dry', density: 'sparse' },
        props: { density: 'busy' },
        agentSize: 'small',
      },
    },

    // ---- G6a. Five more, and each names the light, the partitions and the
    // room tint as well as the finishes.
    {
      id: 'daylight-studio',
      label: 'Daylight studio',
      blurb: 'Pale ash and white at noon, with glass between the rooms.',
      look: {
        floors: {
          office: 'wide-ash',
          corridor: 'poured-screed',
          rooms: 'wide-ash',
          lounge: 'wide-ash',
        },
        scheme: 'warm',
        furniture: 'scandi',
        rugs: {
          wool: { tone: 'sand', pattern: 'plain' },
          task: { tone: 'sage', pattern: 'plain' },
        },
        plants: { family: 'leafy', density: 'normal' },
        props: { density: 'normal' },
        light: 'noon',
        partitions: 'glass',
        roomTint: 'subtle',
      },
    },
    {
      id: 'graphite-loft',
      label: 'Graphite loft',
      blurb: 'Concrete and loop pile in a neutral wash, dark frames, long evening shadows.',
      look: {
        floors: {
          office: 'polished-concrete',
          corridor: 'ceramic-tile',
          rooms: 'loop-pile',
          lounge: 'polished-concrete',
        },
        scheme: 'mono',
        furniture: 'industrial',
        rugs: {
          wool: { tone: 'wool', pattern: 'plain' },
          task: { tone: 'wool', pattern: 'banded' },
        },
        plants: { family: 'architectural', density: 'sparse' },
        props: { density: 'quiet' },
        light: 'evening',
        partitions: 'glass',
        roomTint: 'off',
      },
    },
    {
      id: 'nordic-wool',
      label: 'Nordic wool',
      blurb: 'Cool ash, cork and broadloom, soft seating behind low dividers, morning light.',
      look: {
        floors: {
          office: 'wide-ash',
          corridor: 'polished-concrete',
          rooms: 'wool-broadloom',
          lounge: 'cork',
        },
        scheme: 'cool',
        furniture: 'soft',
        rugs: {
          wool: { tone: 'wool', pattern: 'banded' },
          task: { tone: 'wool', pattern: 'plain' },
        },
        plants: { family: 'architectural', density: 'normal' },
        props: { density: 'quiet' },
        light: 'morning',
        partitions: 'low',
        roomTint: 'subtle',
      },
    },
    {
      id: 'colour-plan',
      label: 'Colour plan',
      blurb: 'A neutral building where every project room has a calm colour of its own.',
      look: {
        floors: {
          office: 'polished-concrete',
          corridor: 'ceramic-tile',
          rooms: 'wool-broadloom',
          lounge: 'terrazzo',
        },
        scheme: 'mono',
        furniture: 'scandi',
        rugs: {
          wool: { tone: 'wool', pattern: 'plain' },
          task: { tone: 'sage', pattern: 'plain' },
        },
        plants: { family: 'leafy', density: 'sparse' },
        props: { density: 'normal' },
        light: 'noon',
        partitions: 'solid',
        roomTint: 'zoned',
      },
    },
    {
      id: 'walnut-executive',
      label: 'Walnut executive',
      blurb: 'Herringbone and cork in a clay wash, soft seating, evening light.',
      look: {
        floors: {
          office: 'herringbone-oak',
          corridor: 'ceramic-tile',
          rooms: 'cork',
          lounge: 'herringbone-oak',
        },
        scheme: 'clay',
        furniture: 'soft',
        rugs: {
          wool: { tone: 'sand', pattern: 'banded' },
          task: { tone: 'wool', pattern: 'plain' },
        },
        plants: { family: 'leafy', density: 'normal' },
        props: { density: 'normal' },
        light: 'evening',
        partitions: 'solid',
        roomTint: 'off',
      },
    },
  ].map((p) => Object.freeze(p)),
);
