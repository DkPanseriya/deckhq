# DeckHQ — instructions for agents working in this repository

This is the public repository: the product, its source, its tests and its manual. Everything here is
MIT-licensed and everything here is meant to be read.

- **Read `README.md` first**, then `docs/GUIDE.md` for what DeckHQ does and every command, key and
  file it touches. `docs/ADAPTERS.md` is the contract for supporting another coding tool.
- **`CONTRIBUTING.md` is the process**, and `.github/PULL_REQUEST_TEMPLATE.md` is the checklist a
  change is measured against.
- **The gates are `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test`.** All
  four pass before a change is proposed. `npm run goldens:check` covers the rendered floor.
- **Do not weaken a test named `INVARIANT:` to make a change pass.** Those tests hold the rules the
  product is built on; if one has to move, say so in the pull request and say why.
- **Claims are measured, not asserted.** A line that says something is fast, verified or supported
  needs a measurement behind it. Where a claim cannot be measured on the machine at hand, the code
  says so rather than implying otherwise — `docs/ADAPTERS.md` §6 is that rule written down.

**Maintainers: planning documents live in a private repository mounted at `internal/`; when it is
absent, skip anything that needs it.**
