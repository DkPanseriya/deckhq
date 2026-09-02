# What this changes

<!-- One paragraph. What was wrong or missing, and what it does now. -->

Closes #

## Checklist

- [ ] **Tests pass on all three platforms.** The CI matrix is Ubuntu, macOS and Windows against
      Node 18, 20 and 22. Green on your own machine is not the same thing — path handling and
      process spawning are where this project breaks on one OS and passes on the others.
- [ ] **The `INVARIANT:` tests are untouched.** No observed event may clear a user-owned state
      (`docs/01-PRODUCT.md` §2). If a test named `INVARIANT:` had to be relaxed, skipped or
      rewritten to make this pass, this is the wrong change — say so below and open an issue
      instead.
- [ ] **No new runtime dependency.** `package.json` still has no `dependencies` block. Dev
      dependencies are fine.
- [ ] **No new network egress.** Nothing added that makes an outbound call: no analytics, no
      update check, no CDN font, script or image.
- [ ] **Deviations are documented.** Anything that departs from `docs/` — a different algorithm, a
      missed budget, a constraint the plan did not anticipate — has a numbered entry appended to
      `docs/DEVIATIONS.md` with the reason and the measurement.
- [ ] **Screenshot attached, if the floor changed.** Anything under `public/render/` or
      `public/style.css` needs a before-and-after image. The three worst bugs in this project's
      history were invisible to the whole unit suite and obvious in one PNG.
- [ ] `npm run lint` and `npm run format:check` pass.

## Screenshots

<!-- Before and after, if this touches anything visual. Delete this section if it does not. -->

## Notes for the reviewer

<!-- Anything you are unsure about, anything you deliberately left out, anything you want argued
     with. Being wrong out loud here is cheaper than being wrong quietly. -->
