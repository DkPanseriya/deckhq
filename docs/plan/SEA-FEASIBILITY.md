# Standalone executable — feasibility

WP-76, written for WP-75. **Nothing here was built.** This is a read of Node's single executable
application (SEA) feature against this package, so the decision is made once and on the record.

## The question

Can a release ship `deckhq.exe` and a `deckhq` binary, so a friend downloads one file, double-clicks
it, and never installs Node?

## What SEA actually is

Node 20+ builds a SEA by injecting a blob into a **copy of the `node` binary**: one JS file as
CommonJS, a `sea-config.json`, `node --experimental-sea-config`, then `postject` to inject, then —
on Windows and macOS — re-sign. It is still marked experimental in Node 24.

Four consequences for this package, in order of how much they cost:

1. **CommonJS, one file.** DeckHQ is ESM throughout and imports lazily on purpose:
   `bin/deckhq.mjs` dispatches every subcommand through `await import()` so `statusline` keeps its
   20 ms budget (§92). A blob wants one CommonJS entry point, so this needs a **bundler** as a dev
   dependency. Legal — rule 3 forbids _runtime_ dependencies — but "no build step" is a claim in the
   README, and it would stop being true of the release artifact.
2. **The assets are not just code.** `public/` is ~40 render parts, two PNGs, a webmanifest and a
   service worker, served from disk. A SEA can carry assets, but every
   `fs.readFileSync(new URL('../public/…'))` in `src/http/` becomes `sea.getAsset()` behind a branch
   that still works from a checkout. That is a change to the server's file serving.
3. **Signing.** An unsigned `.exe` gets SmartScreen; an unsigned macOS binary is refused by
   Gatekeeper on Apple Silicon outright. Windows wants a paid certificate (~$200–400/yr, hardware
   token); Apple wants a $99/yr Developer ID plus notarisation. **This is the blocking cost, and it
   is money and identity rather than engineering.**
4. **Size.** ~110 MB per platform per release against a 730 kB tarball.

What does **not** change: the app profile (`~/.deckhq/app-profile`) and the Chrome/Edge discovery in
`src/cli/chrome.mjs` work exactly as they do now — a SEA still spawns a browser it finds on the
machine, and DeckHQ still never bundles one. `deckhq app` behaves identically.

## What a release job would add

A matrix job on Windows, macOS (arm64 and x64) and Linux: bundle to CJS,
`node --experimental-sea-config`, copy the node binary, `postject`, sign (`signtool` / `codesign` +
`notarytool`), smoke-test `--version` and `app --dry-run` on the runner, upload. Four to six
artifacts, two secrets this project does not have, one more thing that can be red on a tag.

## Risks

- The feature is experimental: its config shape has changed between majors already.
- A bundler in front of a codebase that relies on lazy imports will change startup behaviour, and
  the status line's budget is the thing that notices.
- Unsigned binaries are worse than no binaries: a stranger who is warned off by SmartScreen does not
  then go and try `npx`.
- Antivirus false positives on injected Node binaries are common and unfixable from here.

## Recommendation

**No, not now — and WP-75 is the reason it is not needed.** One line that installs Node and the
package, plus an icon on the Desktop, gets a friend to the same place: nothing to configure, nothing
to remember, a thing to click. A SEA replaces "one paste" with "one download" at the cost of a
bundler, an asset-loading branch through the HTTP layer, ~$300/yr of certificates, and 400 MB per
release.

Revisit when either is true: a paying tier justifies the certificates, or people are measured
bouncing off the Node requirement after the installers shipped.
