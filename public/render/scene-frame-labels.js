/**
 * WHICH NAME EVERY FIGURE CARRIES THIS FRAME, AND WHERE IT GOES.
 *
 * Moved out of `scene-draw.js`'s `_draw()` so the rule can be asked of a plan
 * and a set of seats with no canvas: the floor builds the obstacles and the
 * labels exactly as it always did, and a test over a 150-agent floor asks the
 * same function the same question.
 *
 * Three rules, all from the live-floor audit of 24 September:
 *
 *   1. **Names are drawn at every level of detail.** At the owner's window the
 *      floor fell to L0 and not one of 62 bodies carried a name. A label is held
 *      to 11 px (`labelFontSize`) whatever the floor's scale, so there was never
 *      a size reason to drop it.
 *   2. **A room plate is an obstacle.** A name hung below the office's bottom
 *      row landed on the Lounge plate's title; the plates are pinned here beside
 *      the bodies, the badges and a crew's hand and chip.
 *   3. **A crew says its types once.** Five `general-purpose` labels round one
 *      arc were five copies of one fact drawn over each other. Members of one
 *      formation that share a type carry ONE label, under whichever of them has room,
 *      `general-purpose ×5`.
 *
 * And one from the owner's office of sixteen: **a wait badge and its name are
 * one unit.** The badge is over the head, the name under the feet (or, where
 * the next person's badge is there, beside the body), and the floor between
 * the two belongs to that figure: nobody else's name is set in it.
 *
 * A LIVE agent's name (anyone at a desk or waiting on you) is tried at every
 * spot `resolveLabelCollisions` knows before it is given up; only a resting
 * figure's name in the lounge is dropped when its floor is full.
 */

import { characterBox, labelBox } from './rig.js';
import {
  BODY_HEIGHT_U,
  CHROME_BADGE_U,
  labelFontSize,
  LABEL_MIN_PX,
  SELECTION_RING_R,
} from './rig-metrics.js';
import { worldToScreen } from './agents.js';
import { crewChipAt } from './crew.js';
import { abbreviateName, resolveLabelCollisions } from './label-spots.js';
import { placeClouds, placedLabelBoxes } from './cloud-spots.js';
import { JUNIOR_MARK, bareName, roleWordFor } from '../names.js';
import { ROLE_CHIP_GAP } from './name-tag.js';
import { agentLabelFor, isNeedsYouAgent } from './scene-agent.js';

/** A session at a desk or waiting on the user: its name is never dropped. */
const LIVE = new Set(['working', 'needs_input', 'for_review', 'stalled']);

/** @param {any} agent */
export function isLiveAgent(agent) {
  return !!agent && agent.ackState === 'active' && LIVE.has(agent.activityState);
}

/**
 * The text under every figure that carries one, by record id. A crew member
 * with an observed type is labelled by its TYPE (WP-89 §3.2), once per type
 * per formation; the others of that type carry none. Everything else is its
 * name (`agentLabelFor`).
 * @param {Iterable<any>} records
 * @param {Map<string, any>} agentsById
 * @returns {Map<string, string>}
 */
export function frameLabelTexts(records, agentsById) {
  return labelGroups(records, agentsById).texts;
}

/**
 * `frameLabelTexts`, plus which other figures each crew type label may hang
 * under instead (the rest of that type), for the collision pass.
 * @param {Iterable<any>} records @param {Map<string, any>} agentsById
 */
function labelGroups(records, agentsById) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {Map<string, string>} the role word over each sub-agent's label */
  const roles = new Map();
  /** @type {Map<string, string[]>} */
  const members = new Map();
  /** @type {Map<string, {id:string, n:number, type:string, at:number, ids:string[]}>} */
  const groups = new Map();
  for (const rec of records) {
    const agent = agentsById.get(rec.id) || rec.agent;
    if (!agent) continue;
    const seat = rec.targetSeat;
    // WP-99 · a sub-agent's tag is two rows: its role, then its name. Whatever
    // the second row turns out to be — its own name, or its formation's type —
    // the first is the same word the panels use (`roleWordFor`).
    const role = roleWordFor(agent);
    if (role) roles.set(rec.id, role);
    if (seat && seat.crew === true && agent.subagentType) {
      const type = String(agent.subagentType);
      const key = `${seat.crewOf}\u0000${type}`;
      const at = seat.crewIndex ?? 0;
      const g = groups.get(key);
      if (!g) groups.set(key, { id: rec.id, n: 1, type, at, ids: [rec.id] });
      else {
        g.n++;
        g.ids.push(rec.id);
        if (at < g.at) Object.assign(g, { id: rec.id, at });
      }
      continue;
    }
    // Under a role chip the junior mark has already been said: `Marta·jr`
    // is `Junior` over `Marta`.
    const text = role ? bareName(agentLabelFor(agent)) : agentLabelFor(agent);
    if (text) out.set(rec.id, text);
  }
  for (const g of groups.values()) {
    out.set(g.id, g.n > 1 ? `${g.type} ×${g.n}` : g.type);
    members.set(
      g.id,
      g.ids.filter((id) => id !== g.id),
    );
  }
  return { texts: out, members, roles };
}

/**
 * The role word over every sub-agent's label, by record id (WP-99): the first
 * row of its two-row tag. A lead has none and keeps one row.
 * @param {Iterable<any>} records @param {Map<string, any>} agentsById
 * @returns {Map<string, string>}
 */
export function frameLabelRoles(records, agentsById) {
  return labelGroups(records, agentsById).roles;
}

/**
 * The building's rect on screen: the `bounds` no name may leave.
 * @param {{width:number, height:number}} plan
 * @param {{zoom:number, panX:number, panY:number, U:number}} camera
 */
export function buildingRect(plan, camera) {
  const a = worldToScreen({ x: 0, y: 0 }, camera);
  const b = worldToScreen({ x: plan.width, y: plan.height }, camera);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/**
 * Every obstacle a name must clear this frame, then every name, through the
 * frame's collision pass.
 *
 * @param {{font:string, measureText:(t:string)=>{width:number}}} ctx
 * @param {{records:any[], agentsById:Map<string,any>, camera:any, charU:number,
 *   crewCounts:Map<string,number>, badgeBoxes?:any[], plateBoxes?:any[],
 *   selectedId?:string|null, uOf?:(rec:any)=>number,
 *   bounds?:{x:number,y:number,w:number,h:number}}} view `records` in paint order;
 *   `uOf` is the scale a figure is DRAWN at (a junior's is smaller), `charU` by default;
 *   `bounds` is the building's screen rect (`resolveLabelCollisions`)
 * @returns {{plan:Map<string,{offsetY:number, offsetX?:number}|null>,
 *   texts:Map<string,string>, roles:Map<string,string>, obstacles:any[], labels:any[],
 *   clouds:Map<string, 1|-1|0>}} `clouds`: which side of its head each figure's
 *   thought cloud hangs on this frame, `0` for none
 */
export function planFrameLabels(ctx, view) {
  const { records, camera, charU } = view;
  const obstacles = [];
  for (const rec of records) {
    const s = worldToScreen(rec, camera);
    // The body as it is DRAWN: a junior's is a ladder step smaller (WP-99).
    const box = characterBox(s.x, s.y, view.uOf ? view.uOf(rec) : charU);
    obstacles.push({ id: `body:${rec.id}`, ...box, pin: true });
    // WP-89 · a crew parent's raised hand and its chip are pinned too: §4, a
    // junior's name is never drawn over either. Measured generously — an
    // obstacle may claim more than it uses.
    if (view.crewCounts && view.crewCounts.has(rec.id)) {
      obstacles.push({
        id: `hand:${rec.id}`,
        x: box.x,
        y: s.y - charU * CHROME_BADGE_U,
        w: box.w,
        h: charU * (CHROME_BADGE_U - BODY_HEIGHT_U),
        pin: true,
      });
      if (rec.targetSeat) {
        const chip = worldToScreen(crewChipAt(rec.targetSeat), camera);
        const cw = charU * 3.4;
        const ch = charU * 0.8;
        obstacles.push({
          id: `chip:${rec.id}`,
          x: chip.x - cw / 2,
          y: chip.y - ch / 2,
          w: cw,
          h: ch,
          pin: true,
        });
      }
    }
  }
  const screenOf = new Map(records.map((rec) => [String(rec.id), rec]));
  /** @type {Set<string>} the figures drawn under a wait badge of their own */
  const badged = new Set();
  for (const box of view.badgeBoxes || []) {
    obstacles.push({ ...box, pin: true });
    const id = /^badge:/.test(String(box.id)) ? String(box.id).slice(6) : '';
    const rec = screenOf.get(id);
    if (!rec) continue;
    badged.add(id);
    // The slot between a badge and the head under it, where the state icon is
    // drawn: pinned, so no name is set between a figure and its own badge.
    const u = view.uOf ? view.uOf(rec) : charU;
    const head = worldToScreen(rec, camera).y - u * BODY_HEIGHT_U;
    const under = box.y + box.h;
    if (head > under) {
      obstacles.push({
        id: `slot:${id}`,
        x: box.x,
        y: under,
        w: box.w,
        h: head - under,
        pin: true,
      });
    }
  }
  for (const [i, box] of (view.plateBoxes || []).entries()) {
    obstacles.push({ id: `plate:${i}`, x: box.x, y: box.y, w: box.w, h: box.h, pin: true });
  }

  const { texts, members, roles } = labelGroups(records, view.agentsById);
  const at = new Map(records.map((rec) => [rec.id, worldToScreen(rec, camera)]));
  /** @type {any[][]} needs-you first, then the rest of the live, then the lounge */
  const tiers = [[], [], []];
  for (const rec of records) {
    const text = texts.get(rec.id);
    if (!text) continue;
    const agent = view.agentsById.get(rec.id) || rec.agent;
    const s = at.get(rec.id);
    const alts = (members.get(rec.id) || []).map((id) => [at.get(id).x - s.x, at.get(id).y - s.y]);
    // Measured at the scale this figure is DRAWN at, because that is the scale
    // `drawLabel` hangs it at: a crew member's name sits under a smaller body.
    const u = view.uOf ? view.uOf(rec) : charU;
    // A sub-agent's two rows are measured as ONE box (`name-tag.js`), so every
    // rule below — the near ring, the smaller forms, the leader, the drop —
    // moves the chip and the name together.
    const role = roles.get(rec.id) || null;
    const box = labelBox(ctx, s.x, s.y, u, text, undefined, role);
    const live = isLiveAgent(agent);
    // The same name smaller, in the order it may shrink before it may leave
    // its figure (`label-spots.js`): the minimum size, then the abbreviation.
    const variants = [];
    if (labelFontSize(u) > LABEL_MIN_PX + 0.01) {
      variants.push({ ...labelBox(ctx, s.x, s.y, u, text, LABEL_MIN_PX, role), px: LABEL_MIN_PX });
    }
    // A formation's TYPE is not a name and is never cut to four letters:
    // `code.` and `gene.` say nothing (`abbreviateName`'s own rule for
    // `general-purpose ×3`, which a type on its own slipped past). Under a
    // role chip the tag is a row deeper and would be cut far more often.
    const short = members.has(rec.id) ? text : abbreviateName(text, JUNIOR_MARK);
    if (short !== text) {
      variants.push({ ...labelBox(ctx, s.x, s.y, u, short, LABEL_MIN_PX, role), px: LABEL_MIN_PX });
    }
    const item = {
      id: rec.id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      pin: rec.id === view.selectedId,
      keep: live,
      unit: badged.has(String(rec.id)),
      // On a cushion between two taken ones: the second level (`label-spots.js`).
      lower: !!(rec.targetSeat && rec.targetSeat.nameRow === 1),
      alts,
      // Over the head, clear of the icon-and-badge slot: where a name goes when
      // the floor under its feet is a wall, a plate or somebody else's name.
      up: s.y - u * CHROME_BADGE_U - box.h - box.y,
      // The near ring is measured from here: the feet, the body's height and
      // its half-width, at the scale this figure is drawn at.
      feet: { x: s.x, y: s.y },
      // NEAR IS ONE DISTANCE FOR THE WHOLE FLOOR (WP-99): a lead's body height,
      // whoever the name belongs to. A junior is drawn a ladder step smaller,
      // and measured in its own height the ring round a 12.8 px junior was
      // 15 px — nothing fitted in it, and its name was cut and sent away on a
      // leader. How far a name may stand off is about the reader's eye.
      bh: charU * BODY_HEIGHT_U,
      side: u * SELECTION_RING_R,
      // A two-row tag is as far from its feet as its near row is.
      lift: box.chip ? (box.chip.h + ROLE_CHIP_GAP) / 2 : 0,
      variants,
    };
    tiers[live ? (isNeedsYouAgent(agent) ? 0 : 1) : 2].push(item);
  }
  const labels = tiers.flat();
  const plan = resolveLabelCollisions([...obstacles, ...labels], view.bounds);
  // THE CLOUDS, LAST, AND BELOW EVERYTHING ABOVE: a thought cloud goes beside
  // its head where no name, role chip, wait badge or crew's chip already is —
  // the other side if its own is taken, and nowhere if both are
  // (`cloud-spots.js`). Decided here because it is a function of the same
  // things the names are, so it is laid out when they are and not per frame.
  const taken = [
    ...placedLabelBoxes(labels, plan),
    ...obstacles.filter((o) => /^(badge|pill|chip):/.test(String(o.id))),
  ];
  const clouds = placeClouds(
    records.map((rec) => ({
      id: rec.id,
      x: at.get(rec.id).x,
      y: at.get(rec.id).y,
      u: view.uOf ? view.uOf(rec) : charU,
    })),
    taken,
  );
  return { plan, texts, roles, obstacles, labels, clouds };
}
