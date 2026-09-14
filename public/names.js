/**
 * Short names an agent can be given instead of its MK tag.
 *
 * Chosen to be quick to read at a glance and quick to say out loud: at most
 * six letters, no two starting with the same three characters, no two that
 * rhyme closely, and nothing that reads as a status word ("Ready", "Done") or
 * as one of the six state names. The floor already carries state; a name must
 * never look like it is carrying state too.
 *
 * An agent always has an MK tag. A name only ever replaces it on the floor —
 * the tag stays in the hover card, so a renamed agent is still locatable by
 * the project it belongs to.
 *
 * ============================================================================
 * TWO BLOCKS, AND WHY THE FIRST ONE IS FROZEN (WP-84, docs/DEVIATIONS.md §156)
 *
 * The pool held sixty names. The machine this product was reported from holds
 * ninety-two conversations, so `Identity.givenName`'s "<base> N" fallback —
 * the thing that produced `Greta 2` and `Sena 3` in §155 — had been engaged
 * permanently for months. It was never a defect in the rule; the rule was
 * being asked for more names than the pool had.
 *
 * So the pool grew. It grew by APPENDING: the first `ORIGINAL_POOL` entries
 * below are byte for byte the sixty this file shipped with, in their original
 * order, and nothing may reorder, rename or remove one. Two reasons, and they
 * are both about people rather than about code. An identity is persisted the
 * first time an agent is seen and never reassigned, so a name already handed
 * out is a name somebody has learned; and `src/core/identity.mjs` starts its
 * walk at `nameHash(id) % ORIGINAL_POOL`, so a floor rebuilt from scratch —
 * the goldens' demo fixture is exactly that — hands out the same names it did
 * before the pool grew. Growth is additive at the START of the walk as well as
 * at the end of the array: the new names are what the walk REACHES once the
 * old ones are spoken for, which is precisely the case that was broken.
 * ============================================================================
 */

/**
 * How many of the names below predate WP-84. `identity.mjs` starts its walk
 * inside this block so that growing the pool never renames anybody; see the
 * header. Never lower this, and only ever raise it deliberately.
 */
export const ORIGINAL_POOL = 60;

export const SHORT_NAMES = Object.freeze([
  'Marco',
  'Tai',
  'Nova',
  'Wren',
  'Kobe',
  'Ines',
  'Dov',
  'Juno',
  'Rafi',
  'Sena',
  'Bex',
  'Otto',
  'Livia',
  'Cassio',
  'Mira',
  'Hugo',
  'Zola',
  'Piet',
  'Anouk',
  'Tomas',
  'Elif',
  'Boris',
  'Yara',
  'Dmitri',
  'Faye',
  'Ravi',
  'Suki',
  'Milos',
  'Greta',
  'Nadir',
  'Bruna',
  'Oskar',
  'Vera',
  'Idris',
  'Lotte',
  'Amir',
  'Sonia',
  'Emeka',
  'Tessa',
  'Bruno',
  'Kaia',
  'Viggo',
  'Neve',
  'Casper',
  'Ludo',
  'Freya',
  'Enzo',
  'Maud',
  'Tariq',
  'Ilse',
  'Bodhi',
  'Roma',
  'Silas',
  'Nell',
  'Arlo',
  'Petra',
  'Ronan',
  'Isla',
  'Timo',
  'Greer',
  // ---------------------------------------------------------------- WP-84
  // Everything from here down is new, and everything above it is frozen. Same
  // rules as the first block — at most six letters, sayable, no two sharing
  // their first three letters, nothing that is also an ordinary English word
  // and nothing that is one of the state words the interface speaks ("ready",
  // "done", "working", "stalled", "benched", "fired") — applied against the
  // first block as well as against each other. Grouped roughly by where the
  // name is common, because a pool that is ninety percent one alphabet reads
  // as one office rather than as anybody's.
  'Anja',
  'Eero',
  'Aino',
  'Bjorn',
  'Lars',
  'Nils',
  'Sanna',
  'Runa',
  'Alva',
  'Iver',
  'Hilda',
  'Stine',
  'Sigrid',
  'Frida',
  'Ingrid',
  'Malin',
  'Tove',
  'Vidar',
  'Zoran',
  'Vlada',
  'Lenka',
  'Radek',
  'Sasha',
  'Katya',
  'Pavel',
  'Anika',
  'Danko',
  'Vesna',
  'Igor',
  'Olya',
  'Bojan',
  'Nuno',
  'Luca',
  'Matteo',
  'Nico',
  'Vito',
  'Rocco',
  'Dario',
  'Flavia',
  'Giulia',
  'Chiara',
  'Aldo',
  'Ennio',
  'Fabio',
  'Renzo',
  'Noemi',
  'Paloma',
  'Iker',
  'Nerea',
  'Aitor',
  'Unai',
  'Vasco',
  'Tiago',
  'Emilia',
  'Camilo',
  'Ximena',
  'Joana',
  'Celso',
  'Nikos',
  'Elena',
  'Thalia',
  'Yannis',
  'Kostas',
  'Irini',
  'Dimos',
  'Sofia',
  'Alexi',
  'Zoe',
  'Layla',
  'Omar',
  'Rania',
  'Zaid',
  'Yusuf',
  'Samir',
  'Farah',
  'Hakim',
  'Karim',
  'Basma',
  'Dalia',
  'Hamza',
  'Jamal',
  'Salma',
  'Zahra',
  'Aziz',
  'Reza',
  'Sahar',
  'Kian',
  'Roya',
  'Arash',
  'Emre',
  'Deniz',
  'Ceren',
  'Kaan',
  'Sibel',
  'Ozan',
  'Aylin',
  'Berk',
  'Mert',
  'Selin',
  'Zeynep',
  'Arjun',
  'Meera',
  'Rohan',
  'Kavya',
  'Priya',
  'Varun',
  'Diya',
  'Aarav',
  'Tanvi',
  'Rhea',
  'Kiran',
  'Manav',
  'Neha',
  'Zoya',
  'Nisha',
  'Kabir',
  'Mei',
  'Hana',
  'Yuki',
  'Sora',
  'Kenji',
  'Aiko',
  'Haru',
  'Rina',
  'Riku',
  'Yuna',
  'Minho',
  'Jisoo',
  'Jiho',
  'Wei',
  'Lian',
  'Linh',
  'Trang',
  'Quan',
  'Tuan',
  'Dewi',
  'Putri',
  'Wayan',
  'Bayu',
  'Intan',
  'Citra',
  'Amara',
  'Zuri',
  'Kwame',
  'Ayo',
  'Femi',
  'Naledi',
  'Sipho',
  'Lerato',
  'Kofi',
  'Nkechi',
  'Uche',
  'Dayo',
  'Imani',
  'Jabari',
  'Kamau',
  'Makena',
  'Nandi',
  'Noa',
  'Eitan',
  'Tamar',
  'Yael',
  'Shira',
  'Lior',
  'Maya',
  'Adina',
  'Omer',
  'Sivan',
  'Niamh',
  'Eoin',
  'Cian',
  'Maeve',
  'Rhys',
  'Bryn',
  'Gwen',
  'Iona',
  'Fiona',
  'Callum',
  'Orla',
  'Sean',
  'Declan',
  'Carys',
  'Eira',
]);

/**
 * Names not already taken by another agent, so the picker never offers a
 * collision. Order is preserved.
 * @param {Iterable<string>} taken
 * @returns {string[]}
 */
export function availableNames(taken) {
  const used = new Set([...taken].filter(Boolean).map((n) => String(n).toLowerCase()));
  return SHORT_NAMES.filter((n) => !used.has(n.toLowerCase()));
}
