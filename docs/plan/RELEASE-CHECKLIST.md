# Release checklist — publishing `1.3.0`

**Owner:** the repository owner, by hand up to the tag. **Time:** about ten minutes of checks, then
about fifteen watching a workflow.

1.1.0 called itself the first public release and was never pushed to the registry, so `npx deckhq`
returned `E404` for its entire life. That happened because nobody had written the steps down. These
are the steps.

**What changed since 1.2.0: the tag does the release.** `.github/workflows/publish.yml` publishes
to npm through trusted publishing (OIDC) and then creates the GitHub Release with its assets. So
**step 7 is the last thing a human does**, and it is the irreversible one — `npm publish` runs on a
runner a minute later and npm unpublish is time-boxed to 72 hours with the version number burned
either way. Everything before step 7 is safe to run and repeatable. Steps 8 to 12 are watching.

---

## Before you start

Nothing to log in to. There is no npm token here and there is no `NPM_TOKEN` secret: GitHub mints a
short-lived OIDC credential for this repository and this workflow file, and npm verifies it against
the trusted publisher configured on the package.

```sh
npm view deckhq version         # expect 1.2.0 — the version this release replaces
```

The owner's one-time trusted-publisher setup (npmjs.com → the package → Settings → Trusted
publisher: `DkPanseriya` / `deckhq` / `publish.yml`, no environment) **is done**. If it were not,
the publish job would fail looking for a token that does not exist.

## 1. Land everything that ships in 1.3.0

`CHANGELOG.md` is written so each agent appends to the existing headings. Confirm every merged
package has its line in the `1.3.0` entry, and that anything in **Known gaps** that has since been
verified has been moved out of it.

The `1.3.0` section is closed: `## Unreleased` was renamed to `## 1.3.0 — 2026-09-04` and a fresh
empty `## Unreleased` opened above it, so the next package has a heading to append to.

## 2. Get to a clean `main`

```sh
git checkout main
git pull
git status                      # must be clean; nothing staged, nothing modified
```

## 3. Verify locally

```sh
npm install
npm run lint
npm run format:check
npm run typecheck
npm test
```

All five must pass. `prepublishOnly` runs lint, typecheck and the suite again on the runner, but
finding a failure here costs nothing and finding it after the tag wastes a version number.

> **The known flake is fixed — do not re-run a red suite.** `test/integration/daemon-hooks-port.test.mjs`
> used to take its ports from a helper that binds port 0, reads the number and releases it, so two
> calls could hand back the *same* port and the assertion would fail with an `actual`/`expected`
> pair one apart. It now reserves a batch of ports bound all at once and releases each one only as
> it is handed over, so no two ports in that file can be the same number
> (`docs/DEVIATIONS.md` §138.3). There is no flake left to wave through: a red suite is real.

## 4. Confirm CI is green

```sh
gh run list --branch main --limit 1
```

Nine combinations — Ubuntu, macOS, Windows × Node 18, 20, 22 — plus the type gate and the Ubuntu
goldens job. All green. Not "green except Windows".

## 5. Inspect the tarball

```sh
npm pack --dry-run
```

Expect **198 files, 730.1 kB packed, 2.4 MB unpacked** for 1.3.0 (1.2.0 was 42 files and 225 kB;
the growth is the split modules, the render parts and the two PWA icons). Read the list and
confirm `bin/`, `src/` (including `src/data/rates.json` and `src/core/publisher-key.mjs`),
`public/` (including `deck.js`, `palette.js`, `settings-ui.js`, `minifloor.js`, `snapshot.js`,
`sound.js`, `coach-marks.js`, `floor-rule.js`, all forty `render/*` parts,
`manifest.webmanifest`, `sw.js` and both icons), `README.md` and `LICENSE` are present — and that
none of the following are:

- `plugin/`, `vscode/`, `site/`, `packs/` — separate artifacts with their own channels
- `test/`, `docs/`, `scripts/`, `node_modules/`
- `state.json` or `state/` — user data
- `run.log`, `run.err.log`, any `*.log`, any golden, any `.pem`
- `.claude/`, `public/tsconfig.json`

If anything unwanted is there, fix the `files` field in `package.json` — never by adding a
`.npmignore`, which silently overrides `files`.

## 6. Confirm the metadata the registry will show

```sh
node -e "const p=require('./package.json');console.log(p.version,'|',p.description)"
```

- Version is `1.3.0`, and `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
  agree with it — `test/unit/plugin-manifest.test.mjs` fails if they do not.
- `vscode/package.json` stays on its own version (`0.1.0`). It is a different artifact.
- The description is the pitch and contains no caveat, no "unverified", no changelog fragment. The
  Codex, Gemini CLI and OpenCode caveats live in the README's Honest limits and must still be there.
- `publishConfig.access` is `public`; `engines.node` is `>=18`.
- `license` is `MIT` and `LICENSE` is in the tarball.
- `repository`, `homepage`, `bugs` and `funding` all resolve. **`funding` still points at a GitHub
  Sponsors profile that is not enrolled** — see step 12.

## 7. Dry-run the publish, then tag

```sh
npm publish --dry-run --access public
```

This runs the full `prepublishOnly` gate and prints exactly what would be uploaded without
uploading it. **This is the last reversible step.** Read the output. If the file list differs from
step 5, stop and find out why.

### 7a. Check the release notes will fit — **resolved: the job caps the body, and the pre-check refuses an oversize one before publishing**

```sh
node scripts/release/changelog-section.mjs --release-body --max-chars 120000 1.3.0 | node -e "
  let s='';process.stdin.setEncoding('utf8').on('data',d=>s+=d).on('end',()=>{
    const n=s.length;console.log(n,'characters',n>125000?'— TOO LONG':'— fits');});"
```

Expect **`99848 characters — fits`** and exit 0. Anything else, stop. Count characters, not bytes:
the notes are full of em dashes and `§`, so `wc -c` reads 702 bytes high and GitHub's cap is on
characters.

A GitHub Release body is capped at **125,000 characters** and the raw `1.3.0` section is
**145,581** — 20,581 over. That is still true, and it no longer matters, because the `release` job
no longer sends the raw section. `changelog-section.mjs --release-body` sends the Highlights block
whole, then the section's bullets in heading order to a budget of 100,000 characters — cut between
bullets, never inside one — and a last line linking the full section in `CHANGELOG.md` at the tag
(`…/blob/v1.3.0/CHANGELOG.md#130--2026-09-04`). A section that already fits is sent unchanged, with
no link.

And the `publish` job runs **that same command** with `--max-chars 120000` **before** `npm publish`,
not after: an oversize body, or a missing section, now fails the job while nothing has been
published and failing costs nothing. The 422 that would have arrived after the registry was
already written cannot arrive any more. `docs/DEVIATIONS.md` §138.

If the command above prints a number over 120,000 or exits non-zero, the Highlights block itself
has outgrown the budget — it is the one part never cut. Shorten it; do not raise the cap.

### 7b. Tag

Then, and only then:

```sh
git tag -a v1.3.0 -m "v1.3.0" && git push origin v1.3.0
```

**That is the whole release.** The tag push starts `publish.yml`, which runs the nine-way matrix,
publishes to npm with provenance, and creates the GitHub Release. Nothing else is typed by a human.

Push the tag only from a commit that is already on `main` and already green — the workflow refuses
a tag whose `package.json` version disagrees with it, and refuses a version with no `CHANGELOG.md`
section, but neither check can undo a publish that has already happened.

## 8. Watch the run

```sh
gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

Or open it: `https://github.com/DkPanseriya/deckhq/actions/workflows/publish.yml`, and the run
itself at `https://github.com/DkPanseriya/deckhq/actions/runs/<run-id>`.

Three jobs, in order, each gating the next:

| Job       | What it does                                                                                     | If it fails                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `verify`  | lint, format check and the suite on nine OS × Node combinations                                  | Nothing was published. Fix, delete the tag, tag again.                                               |
| `publish` | asserts the npm floor, refuses a tag/version mismatch, refuses a missing changelog section or a release body over 120,000 characters, publishes | If it fails **before** `npm publish`, nothing happened. If it fails during, check the registry first. |
| `release` | downloads the published tarball, checks it against the registry's own sha512, builds the Windows zip, renders the manifests, creates the Release | The package is already on the registry and cannot be taken back. See below.                          |

## 9. Verify the registry

```sh
npm view deckhq
npm view deckhq version dist-tags description
```

Then open <https://www.npmjs.com/package/deckhq> and check, in this order:

- **The README renders**, with the hero GIF and the screenshots visible. Relative image paths are
  rewritten by npm against the `repository` field, so an image that shows on GitHub can still be
  broken here. Look, do not assume.
- **The description under the package name** is the pitch, and reads well truncated — it is what
  appears in search results next to a dozen competitors.
- **"Dependencies: 0"** — the whole trust story in one number, on the page, for free.
- **The provenance badge.** This is the first release published through trusted publishing, so it
  is the first that can have one. Its absence means the publish did not go through OIDC.
- The repository, homepage, issues and funding links all resolve, and the licence reads MIT.
- The published version is `1.3.0` and `latest` points at it.

## 10. Verify the release page

<https://github.com/DkPanseriya/deckhq/releases/tag/v1.3.0>. The release job has **never run**, so
this is the first time any of it is observed rather than reviewed:

- The notes are the `## 1.3.0` section of `CHANGELOG.md`, opening on the Highlights paragraph.
- Nine assets: `floor.png`, `panel-review-card.png`, `hero.gif`, `deckhq-1.3.0-win.zip`,
  `Formula/deckhq.rb`, the three winget manifests and `scoop/deckhq.json`.
- `packaging/README.md` says what a user does with each. Spot-check one digest against
  `npm view deckhq@1.3.0 dist.integrity`.

## 11. Smoke test on a machine that has never seen the repo

The point of the whole exercise. Do this on at least a clean Mac and a clean Windows box — the
Windows path is the verified one and the macOS path is the one the audience is actually on.

```sh
npx deckhq@latest
```

Expect: it downloads, the daemon starts on `127.0.0.1:4317`, a browser opens, and the floor renders.
Then:

```sh
npx deckhq@latest --version     # 1.3.0
npx deckhq@latest doctor
```

If this fails, the fix is a `1.3.1`, not an unpublish.

## 12. Repository settings — owner only, in the GitHub UI

None of these are in the repository, so none of them are done by a commit. The description and
topics are done. These four need the owner in the GitHub UI or an enrolment only the owner can make,
and none of them is new for 1.3.0:

- **Social preview image.** Settings → General → Social preview. Without it every link to this
  repo, in Slack, X, Discord and iMessage, renders as a grey box with a repo name, permanently.
  This is WP-02's acceptance criterion. There is no API for it — it is an upload in the UI.
- **Enable private vulnerability reporting.** Settings → Advanced Security. `SECURITY.md`,
  `CODE_OF_CONDUCT.md` and the issue template chooser all link to `/security/advisories/new`,
  which 404s until this is on.
- **Enable Discussions.** The issue template chooser links to it.
- **Enable GitHub Sponsors** for `DkPanseriya`, or remove `.github/FUNDING.yml` and the `funding`
  field in `package.json`. A Sponsor button pointing at a profile that is not enrolled is worse
  than no button, and 1.3.0 ships that button pointing at nothing.
- **Enable Pages** — Settings → Pages → Source: GitHub Actions — or `pages.yml` keeps failing
  quietly on every push to `main`.
- Confirm the issue forms render: open **New issue** and check both forms appear and that blank
  issues are disabled.

## 13. After

- Watch `npm view deckhq` downloads for the first week — that is the first row of the metrics
  table in `08-PLAN-V2-100X.md` §11 moving off zero.
- **WP-43's acceptance criterion is met the moment the `release` job goes green**, and not before.
  Until then `packaging/README.md`, the site's install page and the README all describe a job that
  has been reviewed and never observed, and they say so.
- Open the `1.4.0` heading in `CHANGELOG.md` when the next package lands. `publish.yml` refuses to
  publish a version that has no `## X.Y.Z` section, and `npm test` fails on a version bump without
  one, so a forgotten heading is caught before the irreversible step rather than after it.
- **Provenance needs no flag and no token.** Trusted publishing attaches the attestation on its
  own; `--provenance` must **not** be added, and an npm automation token must not be created — the
  point of the OIDC design is that no long-lived credential exists in the repository to leak.

## Recovering a failed `release` job

The npm publish is already done and cannot be undone, so this is a repair, not a retry of the
release. The job is written to be re-runnable: it re-uploads assets onto a release that already
exists rather than failing on it. So:

1. Re-run the failed job from the Actions UI. Most failures here are the registry lagging the
   publish, and the tarball step already retries twenty times at fifteen seconds.
2. If it fails again for a reason in the repository, fix it on `main`, delete and re-push the tag.
   The `publish` job will refuse the second run — the version is already on the registry — which is
   correct and expected; `release` still needs the publish to have succeeded, so cut the release by
   hand instead:

```sh
node scripts/release/changelog-section.mjs 1.3.0 > notes.md
gh release create v1.3.0 --verify-tag --title "v1.3.0" --notes-file notes.md \
  docs/media/floor.png docs/media/panel-review-card.png docs/media/hero.gif
```

3. Never delete a published version to make a release page work. A `1.3.1` is cheaper than a
   burned version number.
