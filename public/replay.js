/**
 * Floor replay — "watch yesterday". WP-45, free, and read-only.
 *
 * ============================================================================
 * THE INVARIANT (docs/01-PRODUCT.md §2)
 *
 * Nothing in this file calls `/api/ack`, `/api/settings`, or any other writer.
 * It fetches two GETs, turns their numbers into snapshot-shaped objects, and
 * hands them to the SAME `Scene` the live floor uses. `handleSnapshot` keeps
 * running underneath — the deck, the panel and the queue strip stay live and
 * stay truthful — and the only thing replay takes over is what the canvas is
 * painting. `test/unit/replay.test.mjs` and `test/unit/ledger-invariant.test.mjs`
 * assert the daemon half; the client half is asserted by there being no
 * writer here to assert about.
 * ============================================================================
 *
 * ## What it draws, and what it deliberately does not
 *
 * A frame is `reconstructQueue(records, t)` — everything that NEEDED YOU at
 * that moment, exactly as the machine wrote it down. It is not a full
 * reconstruction of the floor: the ledger does not record where somebody sat,
 * and a replay that invented the working sessions around the queue would be a
 * replay you could not trust. So the copy says what it is — "the queue, as it
 * filled and emptied" — and the room plates are the projects those sessions
 * were in.
 *
 * ## 60x, and why there is a scrub bar at all
 *
 * One real second per ledger minute (`REPLAY_SPEED` in `src/core/replay.mjs`),
 * so a working day is about twenty minutes. Nobody watches twenty minutes of
 * anything, which is exactly why the bar is a scrub and not just a play
 * button: the interesting fact about yesterday is usually "when did that pile
 * up", and that is a question you answer by dragging.
 *
 * The frames are precomputed by the daemon and land on CHANGES, so scrubbing
 * is a binary search over an array rather than a fold per pixel.
 */

/** One real second per this many ledger ms. Mirrors `src/core/replay.mjs`. */
const DEFAULT_SPEED = 60;

/** How often the transport advances while playing. 10 fps: the floor animates itself. */
const TICK_MS = 100;

/**
 * A snapshot the `Scene` will accept, built from one replay frame.
 *
 * Every field the renderer reads is filled with something honest or something
 * neutral. A ledger record carries a session id, a project key, a state and a
 * timestamp; it does not carry a title, a model, a token count or a cost, so
 * those are empty rather than invented. `demo: true` is set for the reason the
 * actor floor sets it — nothing on this floor is a real session RIGHT NOW, so
 * nothing on it may fire a notification, play a sound, or count towards the
 * office-cleared moment.
 *
 * @param {{t:number, queue:Array<any>}} frame
 * @param {{projects:Record<string,string>, settings:any}} ctx
 */
export function frameToSnapshot(frame, ctx) {
  const names = ctx.projects || {};
  /** @type {any[]} */
  const agents = [];
  /** @type {Map<string, any>} */
  const projects = new Map();

  for (const entry of frame.queue || []) {
    const projectId = String(entry.projectKey || 'unknown');
    // A ledger record names a project by a HASH. If the registry could put a
    // display name to it, use that; otherwise show a short slice of the hash
    // and never a path — the same rule `/api/stats` follows.
    const projectName = names[projectId] || `project ${projectId.slice(0, 6)}`;
    agents.push({
      id: entry.sessionId,
      runtime: 'claude-code',
      title: '',
      hasCustomTitle: false,
      projectId,
      projectName,
      cwd: '',
      gitBranch: null,
      model: null,
      live: false,
      activityState: entry.activityState,
      ackState: 'active',
      reviewSince: entry.activityState === 'for_review' ? entry.since : null,
      needsInputSince: entry.activityState === 'needs_input' ? entry.since : null,
      lastOutputAt: entry.since,
      lastActivityAt: entry.since,
      tokens: 0,
      cacheTokens: 0,
      costEstimate: null,
      lastRole: null,
      lastText: '',
      juniorCount: 0,
    });
    let project = projects.get(projectId);
    if (!project) {
      project = {
        id: projectId,
        name: projectName,
        cwd: '',
        agentIds: [],
        sessionCount: 0,
        tokens: 0,
        cacheTokens: 0,
        costEstimate: 0,
        costRated: false,
        needsYou: 0,
        working: 0,
        activeCount: 0,
        juniors: 0,
      };
      projects.set(projectId, project);
    }
    project.agentIds.push(entry.sessionId);
    project.sessionCount += 1;
    project.needsYou += 1;
    project.activeCount += 1;
  }

  return {
    at: frame.t,
    scannedAt: frame.t,
    // The actor-floor flag. Nothing here is live, so nothing here interrupts.
    demo: true,
    agents,
    projects: [...projects.values()],
    counts: {
      total: agents.length,
      needsYou: agents.length,
      handsUp: agents.filter((a) => a.activityState === 'needs_input').length,
      stalled: agents.filter((a) => a.activityState === 'stalled').length,
      forReview: agents.filter((a) => a.activityState === 'for_review').length,
      working: 0,
    },
    // The live settings, so the replay is painted in the theme and the motion
    // preference the user actually chose. It is their floor either way.
    settings: ctx.settings || {},
  };
}

/**
 * The last frame at or before `t`, by binary search.
 * @param {Array<{t:number}>} frames
 * @param {number} t
 * @returns {number} the index, or -1 when `t` is before the first frame
 */
export function frameIndexAt(frames, t) {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** `14:07` from a timestamp, in the machine's own timezone — the ledger's. */
export function clockOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * One sentence about what is on the floor right now. The whole honesty budget
 * of this feature is spent here: it says the floor is the QUEUE, not the day.
 * @param {any} replay
 * @param {number} count
 */
export function noteFor(replay, count) {
  const parts = [
    count === 0
      ? 'Nobody was waiting on you.'
      : count === 1
        ? 'One session was waiting on you.'
        : `${count} sessions were waiting on you.`,
    'This is the needs-you queue as the ledger recorded it, not a reconstruction of the whole floor.',
  ];
  if (replay?.thinned) parts.push('Long day: the frames are thinned to keep the scrub smooth.');
  return parts.join(' ');
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.rootEl
 * @param {HTMLElement} opts.dayEl
 * @param {HTMLElement} opts.clockEl
 * @param {HTMLButtonElement} opts.playEl
 * @param {HTMLInputElement} opts.scrubEl
 * @param {HTMLButtonElement} opts.closeEl
 * @param {HTMLElement} opts.noteEl
 * @param {() => any} opts.getScene
 * @param {() => any} opts.getSnapshot  the LIVE snapshot, restored on close
 * @param {(m:string, o?:{isError?:boolean}) => void} opts.toast
 * @param {(active:boolean) => void} [opts.onActiveChange] told when the canvas
 *   changes hands, so the composition root can stop the live snapshot stream
 *   from painting over the replay.
 */
export function createReplay(opts) {
  const { rootEl, dayEl, clockEl, playEl, scrubEl, closeEl, noteEl, getScene, getSnapshot, toast } =
    opts;
  const onActiveChange = opts.onActiveChange || (() => {});

  /** @type {any} the day being watched */
  let replay = null;
  /** Where the transport is, in ledger ms. */
  let at = 0;
  /** @type {any} */
  let timer = null;
  let playing = false;
  let lastDrawn = -1;

  const isOpen = () => !rootEl.hidden;

  /** Which day to open when nobody names one: yesterday, or the newest there is. */
  async function pickDay() {
    const res = await fetch('/api/replay/days');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const days = Array.isArray(body.days) ? body.days : [];
    if (!days.length) return null;
    return (days.find((d) => d.label === 'yesterday') || days[0]).day;
  }

  /** Paint the frame that covers `at`, and nothing if it is the one already up. */
  function draw() {
    const scene = getScene();
    if (!scene || !replay) return;
    const i = frameIndexAt(replay.frames, at);
    clockEl.textContent = clockOf(at);
    const span = Math.max(1, replay.to - replay.from);
    scrubEl.value = String(Math.round(((at - replay.from) / span) * 1000));
    if (i === lastDrawn) return;
    lastDrawn = i;
    const frame = i >= 0 ? replay.frames[i] : { t: at, queue: [] };
    scene.setState(
      frameToSnapshot(
        { t: at, queue: frame.queue },
        { projects: replay.projects || {}, settings: getSnapshot()?.settings || {} },
      ),
    );
    noteEl.textContent = noteFor(replay, frame.queue.length);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function setPlaying(next) {
    playing = next;
    playEl.textContent = next ? 'Pause' : 'Play';
    playEl.setAttribute('aria-label', next ? 'Pause' : 'Play');
    stopTimer();
    if (!next) return;
    // 60x means one real millisecond is sixty ledger milliseconds, so a tick
    // of TICK_MS real time advances the day by speed x TICK_MS.
    const step = (replay?.speed || DEFAULT_SPEED) * TICK_MS;
    timer = setInterval(() => {
      at += step;
      if (at >= replay.to) {
        at = replay.to;
        draw();
        // The day ends and the transport stops. It does not loop: a replay
        // that started again on its own would be an animation, and this is a
        // record of something that happened once.
        setPlaying(false);
        return;
      }
      draw();
    }, TICK_MS);
  }

  /** @param {string} [day] */
  async function open(day) {
    if (isOpen()) return;
    try {
      const wanted = day || (await pickDay());
      if (!wanted) {
        toast('There is nothing in the ledger to watch yet. Come back tomorrow.');
        return;
      }
      const res = await fetch(`/api/replay?day=${encodeURIComponent(wanted)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      replay = body;
    } catch (err) {
      toast(`Could not read that day: ${err.message}`, { isError: true });
      return;
    }

    at = replay.from;
    lastDrawn = -1;
    dayEl.textContent = replay.day;
    rootEl.hidden = false;
    // The canvas changes hands BEFORE the first frame is drawn: a snapshot
    // arriving between these two lines would otherwise be the last thing
    // painted and the replay would open on today.
    onActiveChange(true);
    draw();
    setPlaying(true);
    // The scrub takes focus, because it is the control this feature exists
    // for: the interesting question about yesterday is "when did that pile
    // up", and that is answered by dragging. A keyboard user gets the arrow
    // keys on it without hunting for it, and Escape still closes the whole
    // thing from wherever focus ends up (see `app.js`).
    try {
      scrubEl.focus();
    } catch {
      /* a transport that cannot take focus is still a transport */
    }
  }

  function close() {
    if (!isOpen()) return;
    stopTimer();
    playing = false;
    rootEl.hidden = true;
    replay = null;
    lastDrawn = -1;
    // Straight back to now. The live snapshot never stopped arriving; only
    // the canvas was looking somewhere else.
    onActiveChange(false);
    const scene = getScene();
    const live = getSnapshot();
    if (scene && live) scene.setState(live);
  }

  playEl.addEventListener('click', () => setPlaying(!playing));
  closeEl.addEventListener('click', () => close());
  scrubEl.addEventListener('input', () => {
    if (!replay) return;
    setPlaying(false);
    const span = Math.max(1, replay.to - replay.from);
    at = replay.from + (Number(scrubEl.value) / 1000) * span;
    draw();
  });

  return { open, close, isOpen, isActive: isOpen };
}
