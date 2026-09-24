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
  POPULATIONS,
  WAITING_CREW_JUNIORS,
  WAITING_CREW_PARENT,
} from '../../scripts/demo-populations.mjs';
import { SHORT_NAMES } from '../../public/names.js';

export const LARGE_NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

/**
 * @returns {{projects:any[], agents:any[]}}
 */
export function largeFloor(now = LARGE_NOW) {
  const rows = POPULATIONS.large();
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
    if (title === WAITING_CREW_PARENT) parentId = id;
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
  WAITING_CREW_JUNIORS.forEach((j, i) => {
    agents.push({
      id: `claude-code:j${String(i).padStart(2, '0')}`,
      projectId: parent.projectId,
      label: `${parent.label}.j${i + 1}`,
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
