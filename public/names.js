/**
 * Short names an agent can be given instead of its MK tag.
 *
 * Chosen to be quick to read at a glance and quick to say out loud: four to
 * six letters, no two starting with the same three characters, no two that
 * rhyme closely, and nothing that reads as a status word ("Ready", "Done") or
 * as one of the six state names. The floor already carries state; a name must
 * never look like it is carrying state too.
 *
 * An agent always has an MK tag. A name only ever replaces it on the floor —
 * the tag stays in the hover card, so a renamed agent is still locatable by
 * the project it belongs to.
 */
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
