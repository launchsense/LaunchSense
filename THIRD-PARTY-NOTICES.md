# Third-party notices

This repository contains only our own code. The skills listed here are installed in the
local agent library (`~/.config/opencode/skills/`), not in this repository, and are not
distributed with it. This file records their source and licence so that the obligation is
already met the moment any of them is committed here or published. If that happens, keep
the notice and the licence text for each, and carve an exception into `LICENSE.txt`,
because that licence claims no rights over third-party content.

Nothing below is code we ship. It is prompt-and-instruction text, used to guide an agent.

## Apache-2.0

- `frontend-design` (skills/frontend-design), from `anthropics/skills`.
- `enhance-prompt` (plugins/stitch-utilities/skills/enhance-prompt), from
  `google-labs-code/stitch-skills`.

Apache-2.0 requires the licence text, retention of notices, and a statement of changes.
`frontend-design` is unmodified. `enhance-prompt` is unmodified. Each has a `SOURCE.md`
in the local library naming the path and date.

## MIT

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

## Ours, no notice needed

- `ui-craft-floor` was written here from the durable checks in `impeccable`, restated in
  our own words.
