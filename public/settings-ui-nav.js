/**
 * The settings sheet's section nav: one row of names, stuck to the top of the
 * sheet, each one click from its section.
 *
 * The sheet is seven sections in one scroll, and the one people open it for —
 * Look — is the fifth. Before this the only ways to it were to scroll past
 * four sections that are not it, or to know that the palette had a row for it.
 *
 * **THE NAV IS DERIVED FROM THE SHEET, NEVER WRITTEN DOWN.** It is built after
 * the sections are, from the sections that are actually there: their own
 * headings, in their own order. The Look section is absent on a build whose
 * renderer did not load, and so is its entry; a package that adds an eighth
 * section gets an eighth entry without anybody opening this file. A list here
 * would be a second copy of `render()`'s order, and the first thing to drift.
 *
 * No DOM at module scope and no global: the document and the sheet's body are
 * parameters, so `test/unit/look-bar.test.mjs` builds one from a stub.
 */

/** The class every section carries (`settings-ui-widgets.js`'s `section()`). */
const SECTION_CLASS = 'settings-section';
const HEADING_CLASS = 'settings-heading';

/** @param {any} node @param {string} cls */
const hasClass = (node, cls) =>
  String(node?.className || '')
    .split(/\s+/)
    .includes(cls);

/** `Notifications` → `settings-notifications`. @param {string} title */
export const sectionId = (title) =>
  `settings-${String(title)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

/**
 * Every section in the sheet, as the sheet drew it.
 *
 * A section with no id is given one from its heading, so "jump to a section"
 * is one mechanism for all of them — `settings-look` and `settings-hooks` were
 * the only two that had one, and they keep theirs.
 *
 * @param {any} bodyEl the sheet's scrolling body
 * @returns {Array<{el:any, id:string, title:string}>}
 */
export function sectionsOf(bodyEl) {
  /** @type {Array<{el:any, id:string, title:string}>} */
  const out = [];
  for (const node of Array.from(bodyEl?.children || [])) {
    if (!hasClass(node, SECTION_CLASS)) continue;
    const heading = Array.from(node.children || []).find((c) => hasClass(c, HEADING_CLASS));
    const title = String(heading?.textContent || '').trim();
    if (!title) continue;
    if (!node.id) node.id = sectionId(title);
    out.push({ el: node, id: node.id, title });
  }
  return out;
}

/**
 * Fill the nav from the sections that follow it.
 *
 * Real `<button>`s in a `<nav>`, in the tab order, each named for its section.
 * A jump scrolls the section to the top of the sheet and moves focus to it, so
 * the next Tab lands on that section's first control rather than back at the
 * top of the sheet.
 *
 * @param {any} doc    `document`, or a stub
 * @param {any} navEl  an empty `<nav>`, already the sheet body's first child
 * @param {any} bodyEl the sheet's scrolling body
 * @returns {Array<{id:string, title:string, button:any}>}
 */
export function fillSectionNav(doc, navEl, bodyEl) {
  navEl.textContent = '';
  navEl.className = 'settings-nav';
  navEl.setAttribute('aria-label', 'Settings sections');
  const entries = sectionsOf(bodyEl).map((section) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'settings-nav-btn';
    button.textContent = section.title;
    button.addEventListener('click', () => {
      section.el.scrollIntoView?.({ block: 'start' });
      // Focusable by script only: a section is not a control, but it is where
      // the keyboard should be standing after a jump to it.
      section.el.setAttribute('tabindex', '-1');
      section.el.focus?.({ preventScroll: true });
      markCurrentSection(entries, section.id);
    });
    navEl.appendChild(button);
    return { id: section.id, title: section.title, button };
  });
  // A sheet with one section has nowhere to jump to.
  navEl.hidden = entries.length < 2;
  return entries;
}

/**
 * Say which section the sheet is standing on.
 * @param {Array<{id:string, button:any}>} entries @param {string} id
 */
export function markCurrentSection(entries, id) {
  for (const entry of entries) {
    if (entry.id === id) entry.button.setAttribute('aria-current', 'true');
    else entry.button.removeAttribute('aria-current');
  }
}

/**
 * Which section is at the top of the sheet right now: the last one whose
 * heading has scrolled up to the nav. Reads layout, so it is called from a
 * scroll handler and never from inside a render.
 *
 * @param {any} navEl @param {Array<{id:string}>} entries
 * @param {(id:string) => any} byId
 * @returns {string} a section id, or `''`
 */
export function currentSection(navEl, entries, byId) {
  const line = (navEl.getBoundingClientRect?.().bottom ?? 0) + 12;
  let current = entries[0]?.id || '';
  for (const entry of entries) {
    const top = byId(entry.id)?.getBoundingClientRect?.().top;
    if (typeof top === 'number' && top <= line) current = entry.id;
  }
  return current;
}
