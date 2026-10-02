# Limits

What this release does not do. Everything here is stated so nothing looks finished when it is not.

## Code we can read

- Public GitHub repos only. Private repos are not readable, so nothing about them is checked or claimed.
- Guest scans only. There are no accounts yet, so each scan stands alone.
- GitHub quota is shared. When it runs out, scans show partial with a retry time.
- Caps per scan: 200 files, 2 MB in total, 100 KB per file. Skipped files are listed as not checked.
- Binary files and generated folders like node_modules, dist, and build are skipped.

## Checks we do not run

- Dependency freshness and deps.dev data are not checked yet.
- Vulnerability lookup covers npm, PyPI, and Go. Timeouts show as unknown, never as safe.
- License notes are signals, not legal advice.
- Authentication and runtime behaviour are not tested.
- Rendered layout on a real phone is not checked. The live check only reads served HTML, and the report says so.

## Signals, not verdicts

- Judge Readiness is a signal from the files we could read. It is not a certification and it does not judge product quality.
- Standards mappings are an OWASP ASVS 5.0.0 subset with version, coverage, and caveat on every line. No mapping claims full coverage it cannot prove.
- Repo DNA describes shape and structure, nothing about merit.

## AI explanations

- Explanations are written by an AI provider when a key is configured. No key is configured in this release, so plain deterministic wording is shown instead.
- AI output is rejected when it references an unknown finding, drops an actionable finding, or claims a check we did not run. Rejected output falls back to plain wording.
- AI never decides what is a finding. Only the fixed checks decide that.
- Bring your own AI key stays out of this release.

## Not built yet

- No saved projects, no history, no rescan across sessions.
- No MCP layer and no code upload for private repos. Local tools are the route for private code, and none is bundled here.
- No monitoring, no scheduled scans, no GitHub App.
- No blog posts published yet.

## The one rule that overrides all of these

A partial result is never a pass. Anything unchecked stays listed as not checked.