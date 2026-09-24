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
 * A LIVE agent's name (anyone at a desk or waiting on you) is tried at every
 * spot `resolveLabelCollisions` knows before it is given up; only a resting
 * figure's name in the lounge is dropped when its floor is full.
 */

import { characterBox, labelBox } from './rig.js';
import { BODY_HEIGHT_U, CHROME_BADGE_U } from './rig-metrics.js';
import { worldToScreen } from './agents.js';
import { crewChipAt } from './crew.js';
import { resolveLabelCollisions } from './scene-labels.js';
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
  /** @type {Map<string, string[]>} */
  const members = new Map();
  /** @type {Map<string, {id:string, n:number, type:string, at:number, ids:string[]}>} */
  const groups = new Map();
  for (const rec of records) {
    const agent = agentsById.get(rec.id) || rec.agent;
    if (!agent) continue;
    const seat = rec.targetSeat;
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
    const text = agentLabelFor(agent);
    if (text) out.set(rec.id, text);
  }
  for (const g of groups.values()) {
    out.set(g.id, g.n > 1 ? `${g.type} ×${g.n}` : g.type);
    members.set(
      g.id,
      g.ids.filter((id) => id !== g.id),
    );
  }
  return { texts: out, members };
}

/**
 * Every obstacle a name must clear this frame, then every name, through the
 * frame's collision pass.
 *
 * @param {{font:string, measureText:(t:string)=>{width:number}}} ctx
 * @param {{records:any[], agentsById:Map<string,any>, camera:any, charU:number,
 *   crewCounts:Map<string,number>, badgeBoxes?:any[], plateBoxes?:any[],
 *   selectedId?:string|null, uOf?:(rec:any)=>number}} view `records` in paint order;
 *   `uOf` is the scale a figure is DRAWN at (a junior's is smaller), `charU` by default
 * @returns {{plan:Map<string,{offsetY:number, offsetX?:number}|null>,
 *   texts:Map<string,string>, obstacles:any[], labels:any[]}}
 */
export function planFrameLabels(ctx, view) {
  const { records, camera, charU } = view;
  const obstacles = [];
  for (const rec of records) {
    const s = worldToScreen(rec, camera);
    const box = characterBox(s.x, s.y, charU);
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
  for (const box of view.badgeBoxes || []) obstacles.push({ ...box, pin: true });
  for (const [i, box] of (view.plateBoxes || []).entries()) {
    obstacles.push({ id: `plate:${i}`, x: box.x, y: box.y, w: box.w, h: box.h, pin: true });
  }

  const { texts, members } = labelGroups(records, view.agentsById);
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
    const box = labelBox(ctx, s.x, s.y, view.uOf ? view.uOf(rec) : charU, text);
    const live = isLiveAgent(agent);
    const item = {
      id: rec.id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      pin: rec.id === view.selectedId,
      keep: live,
      alts,
    };
    tiers[live ? (isNeedsYouAgent(agent) ? 0 : 1) : 2].push(item);
  }
  const labels = tiers.flat();
  const plan = resolveLabelCollisions([...obstacles, ...labels]);
  return { plan, texts, obstacles, labels };
}
