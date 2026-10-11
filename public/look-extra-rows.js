/**
 * THE LOOK POPOVER'S EXTRA ROWS — a slot, and on this build an empty one.
 *
 * The popover behind the header's Look button draws its rows in a fixed order:
 * Agent size, then whatever this module answers with, then Light, Style,
 * Density and Room colours. The slot is where a build that carries more than
 * one way to draw a session puts its "Agent style" row — between how large the
 * agents are and how the floor is lit — WITHOUT editing the popover again.
 *
 * This build has one agent, so it answers with nothing: no row, no heading and
 * no gap are drawn (`look-ui-bar.js` asks, and draws exactly what it is given).
 *
 * THE CONTRACT. A row is `{ id, label, note?, node }`:
 *
 *   id     its key, for focus across a redraw and for a refusal's `from`
 *   label  the row's name, drawn where "Agent size" is drawn
 *   note   a few quiet words beside it, or nothing
 *   node   the control itself, already built — a radio group made with
 *          `ctx.parts.radioGroup` keeps the popover's keyboard rules for free
 *
 * `ctx` is everything a row could need and nothing it must import: the look
 * store (`look()`, `choosePath(path, value, from)`, `refusalsFor(id)`), the
 * shared control builders, the look port (`picture(spec)`) and `el`.
 *
 * Total, and never throws for a caller: the popover draws without the slot
 * rather than not at all.
 */

/**
 * @param {{store:any, parts:any, port:any, el:(tag:string, className?:string,
 *   text?:string) => any}} _ctx
 * @returns {Array<{id:string, label:string, note?:string, node:any}>}
 */
export function lookExtraRows(_ctx) {
  return [];
}
