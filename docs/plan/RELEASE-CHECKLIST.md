# Release checklist — publishing `1.2.0`

**Owner:** the repository owner, by hand. **Time:** about twenty minutes, most of it waiting on CI.

1.1.0 called itself the first public release and was never pushed to the registry, so `npx deckhq`
returned `E404` for its entire life. That happened because nobody had written the steps down. These
are the steps.

Everything below is safe to run except **step 9**, which cannot be undone: `npm unpublish` is
time-boxed to 72 hours and the version number is burned either way. Do not skip step 8.

---

## Before you start

You need to be logged in to npm as an account that owns (or can claim) the name `deckhq`, with 2FA
ready.

```sh
npm whoami                      # expect your npm username, not an error
npm view deckhq version         # expect E404 for the very first publish
```

If `npm view deckhq` returns a package you do not own, stop — the name is taken and the rest of the
plan needs revisiting before anything else happens.

## 1. Land everything that ships in 1.2.0

`CHANGELOG.md` is written so each agent appends to the existing headings. Confirm every merged
package has its line in the `1.2.0` entry, and that anything in **Known gaps** that has since been
verified has been moved out of it. In particular:

- WP-01 packaging — `publishConfig`, `prepublishOnly`, description, keywords.
- WP-02 repository files — `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, templates.
- WP-03 README rewrite and hero GIF — **this is what the npm page renders.** If the README has not
  landed, the npm page is the old one forever for this version number.
- WP-04 macOS/Linux terminals, WP-05 `deckhq doctor` — the bug report form already asks for
  `deckhq doctor` output, so a release without it sends people to a command that does not exist.

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
npm test
```

All four must pass. `prepublishOnly` runs lint and test again at publish time, but finding a
failure here costs nothing and finding it at step 9 wastes a version number.

## 4. Confirm CI is green

```sh
gh run list --branch main --limit 1
```

Nine combinations — Ubuntu, macOS, Windows × Node 18, 20, 22. All green. Not "green except
Windows".

## 5. Inspect the tarball

```sh
npm pack --dry-run
```

Expect roughly **39 files, ~203 kB** (`bin`, `src`, `public`, `README.md`, `LICENSE`; the count
moves if a source file was added). Read the list and confirm none of the following appear:

- `state.json` or `state/` — user data
- `run.log`, `run.err.log`, any `*.log`
- `.claude/`
- `docs/`, `test/`, `scripts/`, `node_modules/`

If anything unwanted is there, fix the `files` field in `package.json` — never by adding a
`.npmignore`, which silently overrides `files`.

## 6. Confirm the metadata the registry will show

```sh
node -e "const p=require('./package.json');console.log(p.version,'|',p.description)"
```

- Version is `1.2.0`.
- The description is the pitch and contains no caveat, no "unverified", no changelog fragment. The
  Codex caveat lives in the README's Honest limits and must still be there.
- `publishConfig.access` is `public`.
- `license` is `MIT` and `LICENSE` is in the tarball.

## 7. Tag

```sh
git tag -a v1.2.0 -m "v1.2.0"
git push origin main
git push origin v1.2.0
```

## 8. Dry-run the publish

```sh
npm publish --dry-run --access public
```

This runs the full `prepublishOnly` gate and prints exactly what would be uploaded without
uploading it. **This is the last reversible step.** Read the output. If the file list here differs
from step 5, stop and find out why.

## 9. Publish

```sh
npm publish --access public
```

Approve the 2FA prompt. This cannot be undone.

## 10. Verify the registry

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
- The repository, homepage, issues and funding links all resolve.
- The licence reads MIT.
- The published version is `1.2.0` and `latest` points at it.

## 11. Smoke test on a machine that has never seen the repo

The point of the whole exercise. Do this on at least a clean Mac and a clean Windows box — the
Windows path is the verified one and the macOS path is the one the audience is actually on.

```sh
npx deckhq@latest
```

Expect: it downloads, the daemon starts on `127.0.0.1:4317`, a browser opens, and the floor renders.
Then:

```sh
npx deckhq@latest --version     # 1.2.0
npx deckhq@latest doctor        # once WP-05 has landed
```

If this fails, the fix is a `1.2.1`, not an unpublish.

## 12. GitHub release

```sh
gh release create v1.2.0 \
  --title "v1.2.0 — installable" \
  --notes-file <(sed -n '/^## 1\.2\.0/,/^## 1\.1\.0/p' CHANGELOG.md | sed '$d') \
  docs/media/floor.png docs/media/panel.png
```

Attach the hero GIF too if WP-03 produced one. Check the rendered release page: the release notes
are the first thing a visitor from Hacker News reads.

## 13. Repository settings — owner only, in the GitHub UI

None of these are in the repository, so none of them are done by a commit:

- **Social preview image.** Settings → General → Social preview. Without it every link to this
  repo, in Slack, X, Discord and iMessage, renders as a grey box with a repo name, permanently.
  This is WP-02's acceptance criterion.
- **Repository description and topics**, matching `02-MARKET-AND-LAUNCH.md` §2. Keep the pitch and
  the `package.json` description saying the same thing.
- **Enable private vulnerability reporting.** Settings → Advanced Security. `SECURITY.md`,
  `CODE_OF_CONDUCT.md` and the issue template chooser all link to
  `/security/advisories/new`, which 404s until this is on.
- **Enable Discussions.** The issue template chooser links to it.
- **Enable GitHub Sponsors** for `DkPanseriya`, or remove `.github/FUNDING.yml` and the `funding`
  field in `package.json`. A Sponsor button pointing at a profile that is not enrolled is worse
  than no button.
- Confirm the issue forms render: open **New issue** and check both forms appear and that blank
  issues are disabled.

## 14. After

- Watch `npm view deckhq` downloads for the first week — that is the first row of the north-star
  table in `00-ORCHESTRATOR-BRIEF.md` §5 moving off zero.
- Open the `1.3.0` heading in `CHANGELOG.md` when the next package lands, so nobody has to
  remember to.
- Consider publishing from CI with `--provenance` for the next release. It needs a GitHub Actions
  workflow with `id-token: write` and an npm automation token, and it puts a verified-provenance
  badge on the npm page — which is worth having for a tool whose whole pitch is that you can trust
  what it does on your machine.
