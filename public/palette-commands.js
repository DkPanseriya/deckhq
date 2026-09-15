/**
 * THE COMMANDS IN THE PALETTE — everything that used to be a header button,
 * plus the surfaces `docs/plan/05-GUI-UX-SPEC.md` §5.3 names.
 *
 * Split out of `public/palette.js` by WP-88b, and for the reason WP-22 gives
 * for every other split in this tree: that file stood at 899 lines against the
 * 900-line ceiling, and the look's nine rows had nowhere to go.
 * `buildCommandEntries` came out whole — row for row, comment for comment —
 * because it is the one part of the palette that is a TABLE rather than a list
 * builder, and it is the part that grows every time the product does.
 *
 * Pure: it reads a context object and returns entries, so the whole table is
 * asserted by `test/unit/palette.test.mjs` without a browser. `palette.js`
 * re-exports it, so nothing that already imported it had to move.
 */

/**
 * The three things a look can be asked to do that are not "be a preset"
 * (WP-88b). A table rather than three literals inline, because all three are
 * the same row with a different verb in it.
 */
const LOOK_VERBS = Object.freeze([
  {
    id: 'cmd:look-reset',
    group: 'command',
    act: 'resetLook',
    label: 'Look: reset',
    hint: 'every option back to the preset it started from',
    keywords: ['look', 'reset', 'default', 'revert', 'floor', 'undo'],
  },
  {
    id: 'cmd:look-export',
    group: 'command',
    act: 'exportLook',
    label: 'Look: export',
    hint: 'the floor as a file — it names no project and no path',
    keywords: ['look', 'export', 'save', 'download', 'json', 'share', 'anonymous'],
  },
  {
    id: 'cmd:look-import',
    group: 'command',
    act: 'importLook',
    label: 'Look: import',
    hint: 'apply one — a bad file is refused whole',
    keywords: ['look', 'import', 'load', 'open', 'json', 'restore'],
  },
]);

/**
 * Commands: everything that used to be a header button, plus the surfaces
 * §5.3 names. Pure — it reads a context object and returns entries, so the
 * whole table can be asserted in a unit test without a browser.
 *
 * Each `accel` is one character that ranks its command first, so the command
 * costs one keystroke plus Enter. They are unique by assertion, not by
 * inspection.
 *
 * @param {{snapshot:any, letGoVisible:boolean, redactSnapshots?:boolean,
 *          lookPresets?:Array<{id:string, label:string, blurb:string}>,
 *          actions:Record<string, Function>}} ctx
 */
export function buildCommandEntries(ctx) {
  const { snapshot, letGoVisible, actions } = ctx;
  // WP-88b. Empty until `render/look-options.js` has loaded, and empty forever
  // on a build whose renderer did not — so the nine rows below appear exactly
  // when the Look section they belong to does.
  const lookPresets = Array.isArray(ctx.lookPresets) ? ctx.lookPresets : [];
  const settings = snapshot?.settings || {};
  const soundOn = Boolean(settings.sound);
  const notifyOn = settings.notifications !== false;
  // WP-83. `=== true`, not a truthiness test: a snapshot from a daemon that
  // predates the setting must read as OFF, which is the shipped default.
  const costOn = settings.showCost === true;
  const redacting = Boolean(ctx.redactSnapshots);

  return [
    {
      id: 'cmd:new-agent',
      group: 'command',
      label: 'New agent',
      hint: 'start another session in a project',
      accel: 'a',
      keywords: ['session', 'start', 'spawn'],
      run: () => actions.newAgent(),
    },
    {
      id: 'cmd:new-project',
      group: 'command',
      label: 'New project',
      hint: 'open a session in a directory',
      accel: 'p',
      keywords: ['repo', 'directory', 'folder', 'room'],
      run: () => actions.newProject(),
    },
    {
      // WP-39. Not a header control: `05` §5.2's header is a headline, and a
      // button for this would be a fourth thing competing with the numeral.
      // The `P` key is the everyday route; this is how it is discovered.
      id: 'cmd:float-office',
      group: 'command',
      label: 'Float the office',
      hint: 'a small always-on-top window, over your terminal',
      accel: 'f',
      keywords: ['pip', 'picture', 'mini', 'floor', 'window', 'widget', 'always on top'],
      run: () => actions.floatOffice(),
    },
    {
      // WP-60. The repos nobody is working in. They used to be a column drawn
      // permanently down the corner of the floor; they are a popover now, and a
      // thing that only ever appears on hover needs a name somewhere it can be
      // found. `i` is the everyday route, the same way `P` is for the office.
      id: 'cmd:idle-projects',
      group: 'command',
      label: 'Idle projects',
      hint: 'the repos nobody is working in — I',
      accel: 'i',
      keywords: ['repo', 'repos', 'idle', 'nobody', 'projects', 'list'],
      run: () => actions.idleProjects(),
    },
    {
      id: 'cmd:settle',
      group: 'command',
      label: 'Settle floor',
      hint: 'send every idle agent to the lounge',
      accel: 's',
      keywords: ['bench', 'all', 'lounge', 'tidy'],
      run: () => actions.settleFloor(),
    },
    {
      id: 'cmd:hooks',
      group: 'command',
      label: 'Install hooks',
      hint: 'exact state the moment it changes',
      accel: 'h',
      keywords: ['consent', 'claude', 'codex', 'events'],
      run: () => actions.openHooks(),
    },
    {
      // WP-62. Chrome fires `beforeinstallprompt` on a floor it considers
      // installable and offers nothing visible until the page asks; this is
      // the asking. On a browser that never fired it — Firefox, Safari, a
      // window that is already an installed app — this row is still here and
      // still useful, because it then says the one command that gets a real
      // Desktop and Start Menu icon instead. A row that appears and
      // disappears depending on a browser event would be a row nobody can
      // find twice.
      //
      // No accelerator: installing is a once-ever action, and the accelerators
      // are for the two-keystroke everyday ones.
      id: 'cmd:install-app',
      group: 'command',
      label: 'Install as app',
      hint: 'its own window, its own icon, no tab strip',
      keywords: ['pwa', 'desktop', 'shortcut', 'icon', 'standalone', 'window', 'taskbar', 'dock'],
      run: () => actions.installApp(),
    },
    {
      // WP-67. Studio is opt-in per project and off by default everywhere, so
      // this row is where "plan this project" is found rather than a control
      // on a plate that would be dead on almost every floor. It acts on the
      // selected session's project, and a project that has not enabled Studio
      // is told so — by the daemon, in the daemon's own words — rather than
      // having the row hidden, which is a row nobody can find twice.
      //
      // No accelerator: the everyday accelerators are for the everyday
      // commands, and starting a planner is not one.
      id: 'cmd:studio-plan',
      group: 'command',
      label: 'Studio: plan this project',
      hint: 'start the planner interview — it writes a blueprint, a roster and a board',
      keywords: ['studio', 'plan', 'planner', 'grill', 'blueprint', 'roster', 'board', 'idea'],
      run: () => actions.studioPlan(),
    },
    {
      id: 'cmd:refresh',
      group: 'command',
      label: 'Refresh',
      hint: 'rescan every session now',
      accel: 'r',
      keywords: ['rescan', 'reload', 'poll'],
      run: () => actions.refresh(),
    },
    {
      // §5.3 lists "Snapshot the office" among the commands. It carries no
      // accelerator on purpose: it already has a one-key shortcut of its own
      // (`S`), and spending a palette accelerator on it would mean either a
      // second way to type the same thing or taking `s` off Settle floor.
      id: 'cmd:snapshot',
      group: 'command',
      label: 'Snapshot the office',
      hint: 'floor plus stats, on the clipboard — S',
      keywords: ['screenshot', 'png', 'share', 'capture', 'clipboard', 'image'],
      run: () => actions.snapshot(),
    },
    {
      id: 'cmd:redact',
      group: 'command',
      label: redacting ? 'Redact project names — turn off' : 'Redact project names',
      hint: redacting
        ? 'currently on; every snapshot shows MK tags'
        : 'MK tags instead of names in the next snapshot — Shift S',
      keywords: ['privacy', 'anonymise', 'anonymize', 'hide', 'mk', 'nda'],
      run: () => actions.toggleRedaction(),
    },
    {
      // WP-18. The card arrives once a day on its own; this is how you get it
      // back, and how somebody who has never seen it finds out it exists. It
      // carries no accelerator — `t` is not spent on it because showing a card
      // again is not a two-keystroke everyday action, and a wrong `t` would be
      // a modal appearing over the floor.
      id: 'cmd:postcard',
      group: 'command',
      label: "Today's card",
      hint: 'the day so far, from the ledger',
      keywords: ['postcard', 'day', 'lights out', 'night', 'daily', 'summary', 'recap'],
      run: () => actions.showPostcard(),
    },
    {
      // WP-27. Monday's card, on demand. On or after 1 December this is the
      // annual one, which is the same rule the automatic card follows — there
      // is one definition of "which Wrapped is this", in `public/wrapped.js`.
      id: 'cmd:wrapped',
      group: 'command',
      label: 'Wrapped',
      hint: 'the week, or the year from 1 December',
      keywords: ['week', 'weekly', 'annual', 'year', 'review', 'recap', 'stats'],
      run: () => actions.showWrapped(),
    },
    {
      // WP-45. The floor, scrubbed through a day of your own ledger at 60x.
      //
      // FREE, and in this list rather than behind a purchase on purpose: the
      // plan put floor replay in the Supporter pack, and a feature that reads
      // the user's own records cannot be sold without becoming a gate on data
      // they already own (`08` §1.1 rule 2). The pack sells themes and
      // avatars. See `src/core/replay.mjs` and DEVIATIONS §129.
      //
      // No accelerator: it takes the floor over, and a mis-typed key that
      // takes the floor away from somebody mid-thought is worse than one more
      // character of typing.
      id: 'cmd:replay',
      group: 'command',
      label: 'Watch yesterday',
      hint: 'the queue filling and emptying, from your ledger, at 60x',
      keywords: ['replay', 'yesterday', 'history', 'day', 'rewind', 'playback', 'ledger', 'watch'],
      run: () => actions.watchYesterday(),
    },
    {
      // WP-30. The layout is a file the user owns: theme, room order, folded
      // rooms and the two floor preferences. No accelerator — exporting is
      // not an everyday two-keystroke action, and a mis-typed one would put a
      // download in somebody's downloads folder.
      id: 'cmd:layout-export',
      group: 'command',
      label: 'Export layout',
      hint: 'theme, room order and floor preferences, as a file',
      keywords: ['layout', 'theme', 'save', 'download', 'json', 'backup', 'share', 'floor'],
      run: () => actions.exportLayout(),
    },
    {
      id: 'cmd:layout-import',
      group: 'command',
      label: 'Import layout',
      hint: 'apply one — a bad file is refused whole',
      keywords: ['layout', 'theme', 'load', 'open', 'json', 'restore', 'floor'],
      run: () => actions.importLayout(),
    },
    {
      id: 'cmd:settings',
      group: 'command',
      label: 'Settings',
      hint: 'stall window, notifications, resume, floor, look, data, hooks',
      accel: ',',
      keywords: ['preferences', 'options', 'configure'],
      run: () => actions.openSettings(),
    },
    // WP-88b · the look, from the keyboard.
    //
    // Six presets and three verbs, and NOT one row per option: the catalogue is
    // fifty-two of those over ten pickers, and a palette carrying fifty-two
    // floor materials is a palette nobody finds "New agent" in again. A preset
    // is the unit somebody names out loud, and the Look section is where an
    // option is chosen — which is also why `?look=` takes a preset name and
    // never a look.
    //
    // No accelerators: those are for the two-keystroke everyday actions, and
    // repainting the whole building is not one. Each preset row carries the
    // preset's own one-line character as its hint, because "Night lab" says
    // nothing to somebody who has not seen it.
    ...lookPresets.map((preset) => ({
      id: `cmd:look-${preset.id}`,
      group: 'command',
      label: `Look: ${preset.label}`,
      hint: preset.blurb,
      keywords: ['look', 'floor', 'theme', 'preset', 'carpet', 'rug', 'interior', 'graphics'],
      run: () => actions.setLookPreset(preset.id),
    })),
    ...(lookPresets.length
      ? LOOK_VERBS.map((verb) => ({ ...verb, run: () => actions[verb.act]() }))
      : []),
    {
      id: 'cmd:onboarding',
      group: 'command',
      label: 'Onboarding again',
      hint: 'the three coach marks, from the top',
      accel: 'o',
      keywords: ['help', 'guide', 'intro', 'tour', 'coach'],
      run: () => actions.openOnboarding(),
    },
    {
      id: 'cmd:notifications',
      group: 'command',
      label: notifyOn ? 'Notifications — turn off' : 'Notifications — turn on',
      hint: notifyOn ? 'currently on' : 'currently off',
      accel: 'n',
      keywords: ['notify', 'alerts', 'desktop', 'os', 'enable'],
      run: () => actions.setNotifications(!notifyOn),
    },
    {
      id: 'cmd:sound',
      group: 'command',
      label: soundOn ? 'Sound — turn off' : 'Sound — turn on',
      hint: soundOn ? 'currently on' : 'currently off',
      accel: 'u',
      keywords: ['audio', 'mute', 'chime', 'volume'],
      run: () => actions.setSound(!soundOn),
    },
    {
      // WP-83. A STORED setting, unlike the row below it: whether a currency
      // appears at all is a property of the machine, not of this tab. It ships
      // off, and turning it on restores every cost surface unchanged.
      id: 'cmd:show-cost',
      group: 'command',
      label: costOn ? 'Hide cost' : 'Show cost',
      hint: costOn ? 'list-price estimates are showing' : 'token usage only; estimates are hidden',
      keywords: ['money', 'price', 'dollars', 'usd', 'rate card', 'spend', 'billing', 'tokens'],
      run: () => actions.setShowCost(!costOn),
    },
    {
      // A view toggle, not a stored setting. The old header wrote
      // `settings.showLetGo` and nothing ever read it (docs/DEVIATIONS.md
      // §58); "am I looking at fired agents right now" is a property of this
      // tab, not of the machine, so it lives in memory and resets on reload.
      //
      // WP-61 renamed the words, not the wiring: the id stays `cmd:show-let-go`
      // and the state stays `let_go`, because both are addresses rather than
      // copy (docs/DEVIATIONS.md §143). The old vocabulary lives on in the
      // keywords, so somebody who learned "let go" still finds this row.
      id: 'cmd:show-let-go',
      group: 'command',
      label: letGoVisible ? 'Hide fired' : 'Show fired',
      hint: letGoVisible ? 'currently shown' : 'off the floor, reachable from here',
      accel: 'l',
      keywords: ['archived', 'removed', 'fired', 'letgo', 'let go'],
      run: () => actions.toggleLetGoVisible(),
    },
  ];
}
