/**
 * The copy of the floor a share picture is drawn from.
 *
 * A real floor shows real project names, branch names and what an agent is
 * running. A picture meant to be posted must show none of them unless the
 * person asked for it, and "painted over" is not good enough: a label drawn
 * and then covered is one layout change away from showing again. So the
 * picture is never drawn from the real snapshot at all. It is drawn from the
 * object this file returns, and nothing else in the product uses it.
 *
 * THE RULE IS AN ALLOW-LIST, the one `deckhq doctor --share` works by: the
 * copy is assembled only from counts, states, times and DeckHQ's own invented
 * names. Field by field —
 *
 *   - a number, a boolean or a null is copied: it cannot carry a name;
 *   - a string is copied only where this file names the field, and then only
 *     if it is one of a fixed set of words or one of the two classes a switch
 *     lets through;
 *   - an object or a list is copied only where this file rebuilds it;
 *   - everything else is left behind, so a field added to the snapshot next
 *     year is absent from the picture until somebody decides otherwise.
 *
 * TWO SWITCHES, both on unless turned off:
 *
 *   `hideProjects`  repository names, worktree names and git branches. A room
 *                   is renamed from the demo floor's invented repositories and
 *                   a worktree's bench reads `branch 1`.
 *   `hideDetails`   the session title, what it last said, the tool it is
 *                   running and that tool's text, the model, a junior's type
 *                   and task, and a name a person typed for a robot.
 *
 * NEVER COPIED, whatever the switches say: a directory (`cwd`, a repository's
 * root, a worktree's path), a project id (it is a slug of that directory), a
 * session id, a pending permission, settings, hook state.
 *
 * A robot's own name stays, and so do its state, its wait and its seat: they
 * are the picture. The names are DeckHQ's (`names.js`), not the user's.
 *
 * Pure: no DOM, no clock, no I/O. Same snapshot and options, same copy.
 */

import { worktreeKey } from './floor-worktrees.js';
import { JUNIOR_MARK, SHORT_NAMES, bareName } from './names.js';
import { toolIconKind } from './render/rig-bubble.js';

/**
 * The names a hidden repository is given: the demo populations' own invented
 * ones (`scripts/demo-populations.mjs`) and a run of plain words. None of them
 * is anybody's project, which is why they are safe to print over one.
 */
export const COVER_NAMES = Object.freeze([
  'orbital-api',
  'checkout-flow',
  'design-system',
  'data-pipeline',
  'mobile-app',
  'infra-terraform',
  'atlas',
  'birch',
  'cedar',
  'delta',
  'ember',
  'platform-api',
  'web-console',
  'billing-service',
  'search-indexer',
  'auth-gateway',
  'design-tokens',
  'docs-site',
  'status-page',
  'payments-ledger',
  'feature-flags',
  'email-renderer',
  'image-resizer',
  'geo-service',
  'chat-widget',
  'admin-portal',
  'pricing-engine',
  'audit-trail',
  'webhooks-relay',
  'search-ui',
  'job-board',
  'fjord',
  'garnet',
  'harbor',
  'indigo',
  'juniper',
  'kestrel',
  'lumen',
  'maple',
  'nimbus',
  'onyx',
  'pebble',
  'quartz',
  'sable',
  'tundra',
  'umber',
  'willow',
  'zephyr',
]);

/** What a worktree's bench reads when project names are hidden, before its number. */
export const BRANCH_WORD = 'branch';

/** The runtimes a session can belong to; anything else is drawn as the first. */
const RUNTIMES = new Set(['claude-code', 'codex', 'gemini-cli', 'opencode']);
const ACTIVITY = new Set(['working', 'needs_input', 'stalled', 'for_review', 'ended']);
const ACK = new Set(['active', 'benched', 'let_go']);

/**
 * The junior types the runtime ships. A crew of them is labelled by its type
 * on the floor (`Explore ×4`); a type somebody defined themselves is a name
 * they chose, so with details hidden those juniors wear their own names.
 */
const BUILT_IN_JUNIOR_TYPES = new Set(['Explore', 'general-purpose', 'Plan']);

/**
 * What a tool bubble says when the tool's own text is hidden: the class of
 * work, never the call. The name is the plainest tool of that class, so the
 * icon the floor draws at a distance is the one it would have drawn anyway.
 */
const TOOL_CLASS = Object.freeze({
  file: { name: 'Read', summary: 'files' },
  shell: { name: 'Bash', summary: 'shell' },
  web: { name: 'WebFetch', summary: 'web' },
  other: { name: 'Task', summary: 'tool' },
});

/** `MK3`, `MK3.2`, `MK3.2·jr`: the tags the daemon hands out, and nothing else. */
const MK_TAG = /^MK\d{1,6}(\.\d{1,6})?(·jr|j\d{1,4})?$/;
/** A glyph from the avatar picker: one short word. */
const AVATAR_WORD = /^[a-z][a-z0-9-]{0,15}$/;

const NAME_POOL = new Set(SHORT_NAMES);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** The prime's inverse modulo 2^32, by Newton's iteration: five steps double the bits to 32. */
const FNV_PRIME_INVERSE = (() => {
  let x = FNV_PRIME;
  for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(FNV_PRIME, x));
  return x >>> 0;
})();

/**
 * FNV-1a, 32-bit, continued from `h`. The same function the floor seats and
 * faces people by (`hashString` in `render/agents-core.js`, `appearanceHash`
 * in `render/palette.js`).
 * @param {string} text
 * @param {number} [h]
 * @returns {number} unsigned
 */
export function fnv1a(text, h = FNV_OFFSET) {
  let out = h;
  for (let i = 0; i < text.length; i++) {
    out ^= text.charCodeAt(i);
    out = Math.imul(out, FNV_PRIME);
  }
  return out >>> 0;
}

const TWIN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** Twins already found, by prefix and hash. Bounded; the search is a pure function either way. */
const twins = new Map();

/**
 * A different string with the SAME 32-bit hash as `original`, starting with `prefix`.
 *
 * WHY A SESSION ID IS REPLACED BY ITS TWIN RATHER THAN BY A NUMBER. The floor
 * hashes an agent's id to choose its desk, its lounge spot and its face. Swap
 * the id for `agent-7` and the picture is a different office: the same people
 * in other chairs, wearing other faces. A twin keeps every one of those
 * choices, because FNV-1a's state is its hash — two strings that hash alike
 * still hash alike with the same text appended — while carrying none of the
 * id: it is built from the prefix and thirty-two bits, and thirty-two bits of a
 * hash do not give back the string that was hashed.
 *
 * Four characters are walked and the fifth is solved for: the last step of the
 * hash is `(state ^ c) * prime`, so `c` is `state ^ (hash * prime⁻¹)` wherever
 * that is one printable character. About one walk in eighty thousand is.
 * @param {string} prefix
 * @param {string} original
 * @returns {string}
 */
export function hashTwin(prefix, original) {
  const target = fnv1a(String(original));
  const key = `${prefix}\u0000${target}`;
  const kept = twins.get(key);
  if (kept !== undefined) return kept;
  const want = Math.imul(target, FNV_PRIME_INVERSE) >>> 0;
  const step = (h, ch) => Math.imul(h ^ ch.charCodeAt(0), FNV_PRIME);
  const s0 = fnv1a(prefix);
  // If no twin exists in the walk (odds of about one in a billion) the cover
  // is the hash itself: that agent sits somewhere else, and nothing leaks.
  let out = `${prefix}${target.toString(36)}`;
  search: for (const a of TWIN_ALPHABET) {
    const s1 = step(s0, a);
    for (const b of TWIN_ALPHABET) {
      const s2 = step(s1, b);
      for (const c of TWIN_ALPHABET) {
        const s3 = step(s2, c);
        for (const d of TWIN_ALPHABET) {
          const last = (step(s3, d) ^ want) >>> 0;
          if (last > 0xd7ff || last < 0x21 || (last > 0x7e && last < 0xa1)) continue;
          out = prefix + a + b + c + d + String.fromCharCode(last);
          break search;
        }
      }
    }
  }
  if (twins.size > 4096) twins.clear();
  twins.set(key, out);
  return out;
}

/** `7` → `0007`. Covers are compared as text, so their numbers are padded. */
const pad = (n, width = 4) => String(n).padStart(width, '0');

/** The strings of a list that are worth comparing a cover against. */
function wordsOf(list) {
  const out = new Set();
  for (const v of list) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (s.length >= 3) out.add(s);
  }
  return out;
}

/** Does a cover name repeat, or sit inside, something real on this floor? */
function clashes(cover, real) {
  for (const word of real) if (word.includes(cover) || cover.includes(word)) return true;
  return false;
}

/**
 * The cover name of every project, by its real id.
 *
 * STABLE PER PROJECT: a project starts looking at `hash(id) % pool`, so the
 * same repository is the same room name in every picture taken of it. Two
 * projects that start at the same name are settled in the order the daemon
 * first met them (`projectMk`, which is persisted and never reassigned), so an
 * older project keeps its name when a newer one arrives.
 *
 * NEVER A NAME THAT IS REAL HERE. A cover that matched one of this floor's own
 * repositories, branches or worktrees would print a real name in a picture
 * that promises none, so those are walked past as if taken.
 *
 * @param {{id:string, projectMk?:number}[]} projects
 * @param {Set<string>} real lower-cased names that may not be used
 * @returns {Map<string, string>}
 */
export function coverProjectNames(projects, real) {
  const mk = (p) => (Number.isFinite(p.projectMk) ? Number(p.projectMk) : Number.MAX_SAFE_INTEGER);
  const order = [...projects].sort(
    (a, b) => mk(a) - mk(b) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0),
  );
  const usable = COVER_NAMES.some((n) => !clashes(n, real));
  /** @type {Map<string, string>} */
  const out = new Map();
  const taken = new Set();
  for (const p of order) {
    const id = String(p.id);
    if (out.has(id)) continue;
    const start = fnv1a(id) % COVER_NAMES.length;
    let name = usable ? null : `room ${out.size + 1}`;
    for (let lap = 1; name === null; lap++) {
      for (let i = 0; i < COVER_NAMES.length && name === null; i++) {
        const base = COVER_NAMES[(start + i) % COVER_NAMES.length];
        const candidate = lap === 1 ? base : `${base}-${lap}`;
        if (!taken.has(candidate) && !clashes(base, real)) name = candidate;
      }
    }
    taken.add(name);
    out.set(id, name);
  }
  return out;
}

/** Is this one of DeckHQ's own names for a robot: a pool name, or an MK tag? */
function isOwnName(value) {
  if (typeof value !== 'string' || !value) return false;
  if (MK_TAG.test(value)) return true;
  // `Greta 2` is what the pool hands out once it has run dry (`identity.mjs`).
  const base = bareName(value).replace(/ \d{1,3}$/, '');
  return NAME_POOL.has(base);
}

/**
 * What is written under a robot when a name somebody typed may not be: its
 * given name, a junior's name with its mark, or its tag. Always one of ours.
 */
function ownLabel(agent) {
  const junior = typeof agent.juniorName === 'string' ? `${agent.juniorName}${JUNIOR_MARK}` : null;
  for (const candidate of [agent.label, agent.givenName, junior, agent.mk]) {
    if (isOwnName(candidate)) return candidate;
  }
  return 'MK';
}

/** Every own property that is a number, a boolean or null: the fields that cannot carry a name. */
function plainFields(source) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

const textOrNull = (v) => (typeof v === 'string' ? v : null);

/**
 * A cover for every session id on the floor, by the real one.
 *
 * `s0007-` and then the twin's five characters. The number is the id's place
 * among the real ids in the order the floor itself sorts them (`localeCompare`
 * in `assignSeats`, `crewsFrom` and the worktree benches), so every "by id"
 * tie on the floor breaks the way it did.
 * @param {any[]} agents
 * @returns {Map<string, string>}
 */
function coverSessionIds(agents) {
  const real = new Set();
  for (const a of agents) {
    if (a.id != null) real.add(String(a.id));
    if (a.parentId != null) real.add(String(a.parentId));
  }
  const ordered = [...real].sort((x, y) => x.localeCompare(y));
  return new Map(ordered.map((id, i) => [id, hashTwin(`s${pad(i + 1)}-`, id)]));
}

/**
 * A cover for every project id, by the real one. A project id is a slug of
 * its directory, so it is covered whether or not names are shown.
 * @param {any[]} projects @param {any[]} agents
 * @returns {Map<string, string>}
 */
function coverProjectIds(projects, agents) {
  const real = new Set();
  for (const p of projects) if (p.id != null) real.add(String(p.id));
  for (const a of agents) {
    if (a.projectId != null) real.add(String(a.projectId));
    if (a.repoId != null) real.add(String(a.repoId));
  }
  return new Map([...real].sort().map((id, i) => [id, `room-${pad(i + 1)}`]));
}

/**
 * Where each worktree's bench stands in its room, by `room cover + worktree
 * key`: the benches of a room are laid in key order (`benchesFor`), so the
 * covers are numbered in that order and the benches do not swap.
 * @param {any[]} agents @param {Map<string, string>} rooms
 * @returns {Map<string, number>} 1-based
 */
function numberWorktrees(agents, rooms) {
  /** @type {Map<string, Set<string>>} */
  const byRoom = new Map();
  for (const a of agents) {
    const key = worktreeKey(a);
    if (!key) continue;
    const room = rooms.get(String(a.projectId)) || '';
    byRoom.set(room, (byRoom.get(room) || new Set()).add(key));
  }
  const out = new Map();
  for (const [room, keys] of byRoom) {
    [...keys].sort().forEach((key, i) => out.set(`${room}\u0000${key}`, i + 1));
  }
  return out;
}

/**
 * One agent, rebuilt. `c` is the floor's covers and the two switches.
 * @param {any} a
 * @param {{ids:Map<string,string>, rooms:Map<string,string>, names:Map<string,string>,
 *   worktrees:Map<string,number>, workflows:Map<string,string>,
 *   hideProjects:boolean, hideDetails:boolean}} c
 */
function redactAgent(a, c) {
  const out = plainFields(a);
  const realRoom = String(a.projectId ?? '');
  const room = c.rooms.get(realRoom) || '';

  // --- never copied: the ids and the directories ---
  out.id = c.ids.get(String(a.id));
  if (a.identityId != null) {
    const own = String(a.identityId) === String(a.id);
    out.identityId = own ? out.id : hashTwin('f-', String(a.identityId));
  }
  if (a.parentId != null) out.parentId = c.ids.get(String(a.parentId));
  if (a.workflowId != null) out.workflowId = c.workflows.get(String(a.workflowId)) || null;
  out.projectId = room;
  if (a.repoId != null) out.repoId = c.rooms.get(String(a.repoId)) || room;
  out.cwd = '';

  // --- fixed words ---
  out.runtime = RUNTIMES.has(a.runtime) ? a.runtime : 'claude-code';
  out.activityState = ACTIVITY.has(a.activityState) ? a.activityState : 'ended';
  out.ackState = ACK.has(a.ackState) ? a.ackState : 'active';
  out.lastRole = a.lastRole === 'user' || a.lastRole === 'assistant' ? a.lastRole : null;
  if (a.mk != null) out.mk = MK_TAG.test(a.mk) ? a.mk : 'MK';
  out.avatar = typeof a.avatar === 'string' && AVATAR_WORD.test(a.avatar) ? a.avatar : null;

  // --- project names: the repository, the branch, the worktree ---
  const cover = c.names.get(realRoom) || '';
  out.projectName = c.hideProjects ? cover : String(a.projectName ?? '');
  if (a.repoName != null) {
    const repoCover = c.names.get(String(a.repoId ?? realRoom)) || cover;
    out.repoName = c.hideProjects ? repoCover : String(a.repoName);
  }
  out.gitBranch = c.hideProjects ? null : textOrNull(a.gitBranch);
  const key = worktreeKey(a);
  if (key) {
    const n = c.worktrees.get(`${room}\u0000${key}`) || 1;
    out.worktree = {
      name: c.hideProjects ? `${BRANCH_WORD} ${n}` : String(a.worktree.name ?? ''),
      // The path is where the worktree is on disk. It only ever keyed a bench.
      path: `wt-${pad(n, 2)}`,
      branch: c.hideProjects ? null : textOrNull(a.worktree.branch),
    };
  } else {
    out.worktree = null;
  }

  // --- session details: what it is called, said, runs, and runs on ---
  const tool = a.currentTool && typeof a.currentTool === 'object' ? a.currentTool : null;
  const since = tool && Number.isFinite(tool.since) ? tool.since : null;
  if (c.hideDetails) {
    out.title = '';
    out.lastText = '';
    out.model = null;
    out.currentTool = tool ? { ...TOOL_CLASS[toolIconKind(tool.name)], since } : null;
    out.subagentType = BUILT_IN_JUNIOR_TYPES.has(a.subagentType) ? a.subagentType : null;
    out.subagentDescription = null;
    out.displayName = null;
    out.givenName = isOwnName(a.givenName) ? a.givenName : null;
    out.juniorName = isOwnName(a.juniorName) ? a.juniorName : null;
    out.label = ownLabel(a);
  } else {
    out.title = String(a.title ?? '');
    out.lastText = String(a.lastText ?? '');
    out.model = textOrNull(a.model);
    out.currentTool = tool
      ? { name: String(tool.name ?? ''), summary: String(tool.summary ?? ''), since }
      : null;
    out.subagentType = textOrNull(a.subagentType);
    out.subagentDescription = textOrNull(a.subagentDescription);
    out.displayName = textOrNull(a.displayName);
    out.givenName = textOrNull(a.givenName);
    out.juniorName = textOrNull(a.juniorName);
    out.label = String(a.label ?? a.mk ?? 'MK');
  }
  return out;
}

/**
 * The snapshot a share picture is drawn from. See the file header for the rule.
 *
 * @param {any} snapshot a `GET /api/state` body
 * @param {{hideProjects?: boolean, hideDetails?: boolean}} [options] both true unless `false`
 * @returns {any} a snapshot the floor can draw, holding nothing it was not given leave to
 */
export function redactForShare(snapshot, options = {}) {
  const hideProjects = options.hideProjects !== false;
  const hideDetails = options.hideDetails !== false;
  const src = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const isRecord = (v) => Boolean(v) && typeof v === 'object';
  const agentsIn = (Array.isArray(src.agents) ? src.agents : []).filter(isRecord);
  const projectsIn = (Array.isArray(src.projects) ? src.projects : []).filter(isRecord);

  const ids = coverSessionIds(agentsIn);
  const rooms = coverProjectIds(projectsIn, agentsIn);
  const worktrees = numberWorktrees(agentsIn, rooms);
  const workflows = new Map();
  for (const a of agentsIn) {
    const wf = a.workflowId == null ? '' : String(a.workflowId);
    if (wf && !workflows.has(wf)) workflows.set(wf, `wf-${pad(workflows.size + 1, 2)}`);
  }

  // Every project the floor knows of, whether the list or only an agent names it.
  /** @type {Map<string, {id:string, projectMk?:number}>} */
  const known = new Map();
  for (const p of projectsIn) known.set(String(p.id), { id: String(p.id), projectMk: p.projectMk });
  for (const a of agentsIn) {
    const id = String(a.projectId ?? '');
    if (!known.has(id)) known.set(id, { id, projectMk: a.projectMk });
  }
  const real = wordsOf([
    ...projectsIn.flatMap((p) => [p.id, p.name]),
    ...agentsIn.flatMap((a) => [
      a.projectId,
      a.projectName,
      a.repoName,
      a.gitBranch,
      a.worktree && a.worktree.name,
      a.worktree && a.worktree.branch,
    ]),
  ]);
  const names = coverProjectNames([...known.values()], real);

  const c = { ids, rooms, names, worktrees, workflows, hideProjects, hideDetails };
  const agents = agentsIn.map((a) => redactAgent(a, c));
  const byId = new Map(agents.map((a) => [a.id, a]));

  const projects = projectsIn.map((p) => {
    const out = plainFields(p);
    out.id = rooms.get(String(p.id));
    out.name = hideProjects ? names.get(String(p.id)) || '' : String(p.name ?? '');
    out.cwd = '';
    if (p.mk != null) out.mk = MK_TAG.test(p.mk) ? p.mk : 'MK';
    const members = Array.isArray(p.agentIds) ? p.agentIds : [];
    out.agentIds = members.map((id) => ids.get(String(id))).filter(Boolean);
    return out;
  });

  /** @type {Record<string, any>} */
  const out = {
    agents,
    projects,
    counts: plainFields(src.counts),
    settings: plainFields({
      goneHomeDays: src.settings && src.settings.goneHomeDays,
      showCost: src.settings && src.settings.showCost,
    }),
    shared: { hideProjects, hideDetails },
  };
  if (Number.isFinite(src.now)) out.now = src.now;
  if (typeof src.nowFixed === 'boolean') out.nowFixed = src.nowFixed;
  if (Array.isArray(src.crews)) out.crews = redactCrews(src.crews, ids, byId);
  return out;
}

/**
 * The daemon's crews (`crewsFrom`), with every member read back off the
 * REDACTED agents: a crew names its juniors and their types, and the only
 * copy of either allowed in here is the one `redactAgent` already made.
 * @param {any[]} crews
 * @param {Map<string, string>} ids real session id → cover
 * @param {Map<string, any>} byId cover → redacted agent
 */
function redactCrews(crews, ids, byId) {
  return crews
    .filter((crew) => crew && typeof crew === 'object')
    .map((crew) => {
      const members = (Array.isArray(crew.members) ? crew.members : [])
        .map((m) => {
          const agent = m ? byId.get(ids.get(String(m.id)) || '') : null;
          if (!agent) return null;
          return {
            id: agent.id,
            name: agent.label ?? null,
            agentType: agent.subagentType ?? null,
            workflowId: agent.workflowId ?? null,
            spawnedAt: agent.spawnedAt ?? null,
            active: m.active === true,
            lastGrowthAt: agent.lastGrowthAt ?? null,
          };
        })
        .filter(Boolean);
      const flows = new Set(members.map((m) => m && m.workflowId).filter(Boolean));
      return {
        parentId: ids.get(String(crew.parentId)) || '',
        count: Number.isFinite(crew.count) ? crew.count : members.length,
        workflowId: flows.size === 1 ? [...flows][0] : null,
        members,
      };
    });
}
