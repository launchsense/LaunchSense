# Third-party notices

This repository contains only our own code, except the dependency closures
named below, which stay under their own licences. The skills listed at the
bottom are installed in the local agent library (`~/.config/opencode/skills/`),
not in this repository, and are not distributed with it. This file records their source and licence so that the obligation is
already met the moment any of them is committed here or published. If that happens, keep
the notice and the licence text for each, and carve an exception into `LICENSE.txt`,
because that licence claims no rights over third-party content.

Nothing in the skills sections below is code we ship. That part is prompt-and-instruction text, used to guide an agent.

## npm closure

`npm run notices` names every installed npm package with its licence. No GPL
or AGPL in the closure; copyleft present is file-level (MPL-2.0 build
tooling) plus one CC-BY-4.0 data package, each with its obligation recorded
in `shared/licensing/obligations.ts`.

## Go modules (mcp/)

`mcp/THIRD-PARTY-GO.csv` is the `go-licenses` output for the built binary,
regenerated with `GOTOOLCHAIN=go1.23.0 go-licenses csv ./...` from `mcp/`.
Fifteen rows: fourteen third-party modules, all permissive (MIT,
BSD-2-Clause, BSD-3-Clause, Unlicense, no GPL, no AGPL), plus our own
`launchsense/mcp` module row, which `go-licenses` cannot classify and which
needs no third-party notice. Test-only modules outside the binary (testify
MIT, go-spew ISC, gock.v1 MIT, check.v1 BSD-2-Clause) are equally
permissive.

## Skills in the local agent library

### Apache-2.0

- `frontend-design` (skills/frontend-design), from `anthropics/skills`.
- `enhance-prompt` (plugins/stitch-utilities/skills/enhance-prompt), from
  `google-labs-code/stitch-skills`.

Apache-2.0 requires the licence text, retention of notices, and a statement of changes.
`frontend-design` is unmodified. `enhance-prompt` is unmodified. Each has a `SOURCE.md`
in the local library naming the path and date.

### MIT

From `github/awesome-copilot` (MIT), each with a `SOURCE.md` naming the path, date, and
any edit made:

- web-design-reviewer, landing-page-conversion-audit, ui-screenshots,
  draw-io-diagram-generator
- react19-patterns
- harness-engineering, poka-yoke, verify-agent-action, doublecheck
- mcp-security-audit, mcp-implementation-security-review, audit-integrity, test-gap-audit,
  agent-owasp-compliance, agent-supply-chain, github-actions-hardening
- docs-sync-audit, mcp-release-qa, em-dash, build-evidence-map, editorconfig,
  go-mcp-server-generator

MIT requires the copyright notice and the permission text on redistribution. Some of the
above were adapted to our house rules (plain words, no em dashes, no self-rated
confidence); the edit is recorded in that skill's `SOURCE.md`.

### Ours, no notice needed

- `ui-craft-floor` was written here from the durable checks in `impeccable`, restated in
  our own words.
