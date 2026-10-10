/**
 * THE LARGE FLOOR, as the snapshot would carry it: the `large` demo population
 * (137 sessions across 40 repos, `scripts/demo-populations.mjs`) plus its
 * thirteen-member crew, 150 agents in all.
 *
 * The rows are the demo's own, so a test over this floor and a capture of
 * `node scripts/demo-floor.mjs --population large` describe the same machine.
 * Names come from the product's own pool, in order, the way a fresh install
 * deals them. Nothing here reads the clock.
 */

import {
  CREW_JUNIORS,
  CREW_PARENT,
  JUNIOR_PARENT,
  JUNIORS,
  LEAD_JUNIORS,
  LEAD_PARENT,
  POPULATIONS,
  WAITING_CREW_JUNIORS,
  WAITING_CREW_PARENT,
} from '../../scripts/demo-populations.mjs';
import { JUNIOR_MARK, SHORT_NAMES } from '../../public/names.js';

export const LARGE_NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

/**
 * @returns {{projects:any[], agents:any[]}}
 */
export function largeFloor(now = LARGE_NOW) {
  return floorOf(POPULATIONS.large(), now, WAITING_CREW_PARENT, WAITING_CREW_JUNIORS);
}

/**
 * THE AWAY FLOOR: the `away` demo population — sixteen waiting from five repos
 * nobody is at a desk in, one working repo with two juniors — as the snapshot
 * would carry it.
 * @returns {{projects:any[], agents:any[]}}
 */
export function awayFloor(now = LARGE_NOW) {
  return floorOf(POPULATIONS.away(), now, JUNIOR_PARENT, JUNIORS);
}

/**
 * THE CROWDED OFFICE: the `away` floor with somebody working in each of the
 * five repos, so all six keep a full room and the reception is laid narrow —
 * sixteen waiting on three sofa runs and a standing row in front of the top
 * one, the office the owner's floor of 6 October showed.
 * @returns {{projects:any[], agents:any[]}}
 */
export function crowdedOfficeFloor(now = LARGE_NOW) {
  const repos = [
    'orbital-api',
    'checkout-flow',
    'design-system',
    'data-pipeline',
    'infra-terraform',
  ];
  /** @type {Array<[string, string, string, number, number]>} */
  const working = repos.map((repo) => [repo, `At a desk in ${repo}`, 'working', 0.2, 0.5]);
  return floorOf([...POPULATIONS.away(), ...working], now, JUNIOR_PARENT, JUNIORS);
}

/** Whose juniors each demo population carries, as `demo-floor.mjs` attaches them. */
const CREWS = /** @type {Record<string, [string, ReadonlyArray<{agentType:string}>]>} */ ({
  demo: [JUNIOR_PARENT, JUNIORS],
  away: [JUNIOR_PARENT, JUNIORS],
  juniors: [JUNIOR_PARENT, JUNIORS],
  lead: [LEAD_PARENT, LEAD_JUNIORS],
  crew: [CREW_PARENT, CREW_JUNIORS],
  'crew-waiting': [WAITING_CREW_PARENT, WAITING_CREW_JUNIORS],
  large: [WAITING_CREW_PARENT, WAITING_CREW_JUNIORS],
});

/**
 * ANY DEMO POPULATION, as the snapshot would carry it. `pinned` is the `three`
 * floor with the repo `demo-floor.mjs` pins on it marked pinned.
 * @param {string} name a key of `POPULATIONS`
 * @returns {{projects:any[], agents:any[]}}
 */
export function populationFloor(name, now = LARGE_NOW) {
  const [parent, juniors] = CREWS[name] || ['', []];
  const floor = floorOf(POPULATIONS[name](), now, parent, juniors);
  if (name === 'pinned') {
    for (const p of floor.projects) if (p.id === 'data-pipeline') p.pinned = true;
  }
  return floor;
}

/**
 * A FLOOR THE SHAPE OF THE OWNER'S, with nobody's real names on it: the
 * `crowded` demo population. Five repos, one with two people at a desk and
 * four whose people are all waiting in the office; sixteen waiting,
 * seventy-nine resting, twenty-eight gone home.
 * @returns {{projects:any[], agents:any[]}}
 */
export function ownerShapedFloor(now = LARGE_NOW) {
  return floorOf(POPULATIONS.crowded(), now, '', []);
}

/**
 * @param {Array<[string, string, string, number, number]>} rows
 * @param {number} now
 * @param {string} parentTitle the row whose session the juniors hang off
 * @param {ReadonlyArray<{agentType:string}>} juniors
 * @returns {{projects:any[], agents:any[]}}
 */
function floorOf(rows, now, parentTitle, juniors) {
  /** @type {Map<string, any>} */
  const projects = new Map();
  const agents = [];
  let parentId = null;
  rows.forEach(([project, title, state, ageHours], i) => {
    const id = `claude-code:s${String(i).padStart(3, '0')}`;
    const at = now - ageHours * HOUR;
    const a = {
      id,
      projectId: project,
      label: SHORT_NAMES[i % SHORT_NAMES.length],
      title,
      ackState: 'active',
      activityState: 'ended',
      reviewSince: null,
      needsInputSince: null,
      lastActivityAt: at,
    };
    if (state === 'working' || state === 'stalled') {
      a.activityState = state;
      a.lastActivityAt = now - 60_000;
    } else if (state === 'for_review') {
      a.activityState = 'for_review';
      a.reviewSince = at;
    } else if (state === 'needs_input') {
      a.activityState = 'needs_input';
      a.needsInputSince = at;
    } else if (state === 'benched') a.ackState = 'benched';
    else if (state === 'let_go') a.ackState = 'let_go';
    if (title === parentTitle) parentId = id;
    agents.push(a);
    const p = projects.get(project) || {
      id: project,
      name: project,
      sessionCount: 0,
      activeCount: 0,
      needsYou: 0,
      working: 0,
      tokens: 1_200_000,
      todayTokens: 5_800_000,
      todayTokensIsToday: true,
    };
    p.sessionCount++;
    if (a.ackState === 'active' && a.activityState !== 'ended') p.activeCount++;
    if (a.ackState === 'active' && /for_review|needs_input|stalled/.test(a.activityState))
      p.needsYou++;
    if (a.ackState === 'active' && a.activityState === 'working') p.working++;
    projects.set(project, p);
  });
  const parent = agents.find((a) => a.id === parentId);
  juniors.forEach((j, i) => {
    agents.push({
      id: `claude-code:j${String(i).padStart(2, '0')}`,
      projectId: parent.projectId,
      // As the daemon labels a junior: a name from the pool and the junior mark.
      label: `${SHORT_NAMES[(rows.length + i) % SHORT_NAMES.length]}${JUNIOR_MARK}`,
      subagent: true,
      parentId: parent.id,
      subagentType: j.agentType,
      ackState: 'active',
      activityState: 'working',
      reviewSince: null,
      needsInputSince: null,
      lastActivityAt: now - 5_000,
      lastGrowthAt: now - 5_000,
    });
  });
  return { projects: [...projects.values()], agents };
}
