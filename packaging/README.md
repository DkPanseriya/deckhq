# Packaging

What a `vX.Y.Z` tag attaches to its GitHub Release, and what to do with each file. The install
that the README leads with is still `npx deckhq`; these are for people who keep their tools under
a package manager. Every manifest is generated at release time by
`scripts/release/manifests.mjs`, from the sha256 of the tarball the npm registry actually serves,
so nothing here is a hand-maintained copy that can drift from the published bytes. The only
hand-written file in this directory is `deckhq.cmd`.

All three package managers install Node as a dependency rather than bundling it. The installed
tool is byte-for-byte what `npx deckhq` runs — a few hundred kilobytes, zero runtime dependencies.

| Release asset                                                                                          | What it is                                                        | What you do with it                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deckhq.rb`                                                                                            | Homebrew formula over the npm tarball, `depends_on "node"`        | `brew install --formula ./deckhq.rb`. For a tap: commit it as `Formula/deckhq.rb` in a `homebrew-deckhq` repository, after which `brew tap DkPanseriya/deckhq && brew install deckhq` works. The tap repository does not exist yet.                                                     |
| `deckhq-X.Y.Z-win.zip`                                                                                 | The tarball's contents (`package/`) plus `deckhq.cmd` beside them | What winget and scoop install. Unzip anywhere and run `deckhq.cmd` if you want neither.                                                                                                                                                                                                 |
| `DkPanseriya.DeckHQ.yaml`, `DkPanseriya.DeckHQ.installer.yaml`, `DkPanseriya.DeckHQ.locale.en-US.yaml` | winget manifest, schema 1.6.0, portable install from the zip      | Put the three files in one folder, then `winget install --manifest <folder>`. Local manifests need `winget settings --enable LocalManifestFiles` once, from an administrator prompt. `winget install DkPanseriya.DeckHQ` needs a PR to `microsoft/winget-pkgs`, which is a manual step. |
| `deckhq.json`                                                                                          | scoop manifest over the zip, `depends: nodejs-lts`                | `scoop install https://github.com/DkPanseriya/deckhq/releases/download/vX.Y.Z/deckhq.json`. Or commit it to a bucket; `checkver` and `autoupdate` are filled in so the bucket follows the next release on its own.                                                                      |
| `floor.png`, `panel.png`                                                                               | The two screenshots from `docs/media/`                            | They are there for the release page.                                                                                                                                                                                                                                                    |

## How the job produces them

`.github/workflows/publish.yml`, `release` job, after `publish` has succeeded:

1. `npm view deckhq@X.Y.Z dist.tarball` (retried while the registry catches up), download it, and
   check the download against the registry's `dist.integrity` sha512 — so the sha256 in the
   formula is of the bytes users receive.
2. Unpack the tarball, add `packaging/deckhq.cmd`, zip. The zip's release URL is known before the
   release exists, so the winget and scoop manifests can point at it.
3. `scripts/release/manifests.mjs` renders the five manifest files from `package.json` plus the two
   digests. `scripts/release/changelog-section.mjs X.Y.Z` prints the matching `## X.Y.Z` section of
   `CHANGELOG.md` as the release notes.
4. `gh release create vX.Y.Z --verify-tag --notes-file … <assets>`. A re-run of the job finds the
   release already there and re-uploads the assets onto it instead.

To see what a release would contain without tagging one:

```sh
node scripts/release/changelog-section.mjs 1.2.0
node scripts/release/manifests.mjs --version 1.2.0 \
  --tarball-url https://registry.npmjs.org/deckhq/-/deckhq-1.2.0.tgz --tarball-sha256 <hex> \
  --zip-url https://github.com/DkPanseriya/deckhq/releases/download/v1.2.0/deckhq-1.2.0-win.zip \
  --zip-sha256 <hex> --out dist
```

Both scripts are covered by `test/unit/release-scripts.test.mjs`, which also fails the suite when
`package.json`'s version has no `CHANGELOG.md` section — the same refusal the workflow makes before
it publishes.
