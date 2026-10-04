# Words we use

Each word in one plain line.

## The product

- Policy: the rules for the codebase. A license is one rule inside this. It is not a judgment of whether the app will sell.
- Standard: a named line such as OWASP Top 10, OWASP ASVS, OSV, or CWE. A signal with a caveat, not a certification.

## Scanning

- Passport: a small proof card for one scan. It shows counts and the commit, never secrets.
- Share link: a public page for one scan. It shows counts and fix titles, no paths, no lines, no snippets.
- Evidence: the proof behind a finding. File, line, and a redacted snippet.
- Fingerprint: the stable ID of a finding. It stays the same when lines shift, so a recheck can tell fixed from still broken.
- Redacted: secret values replaced before anything is saved.
- Quota: the shared GitHub request budget. When it runs out, scans pause and show a retry time.

## Results

- Partial: a result where some work was skipped. A partial result is never a pass.
- Unknown: work that was skipped, so no conclusion is drawn. It never becomes fixed.
- Not checked: the standing list of what this release does not do.
- Fix Before You Share: the ordered list built from your findings. Secrets first.
- Top 3: the three highest ranked items, merged into one prompt you can paste into your coding helper.
- Accepted risk: a finding you chose to keep. It stays visible and is not counted as a problem to fix.

## Signals

- Repo DNA: the shape of the project. Folders, languages, entry points, what exists and what does not.
- Share Readiness: a signal from the files we could read, with read coverage shown. Not a certification.
- Read coverage: the share of the repo we actually opened and read. Low read coverage means most of the repo is unchecked.
- Actionable share: the share of findings that need action. It describes the mix of findings, not how much was checked.
- Coverage: how much of the repo we actually looked at.
- Policy: the rule that decides if a finding needs review before sharing.
- Standards mapping: one honest line linking a finding to a named requirement, with version, coverage, status, a caveat, and a source. Not a certification.

## Progress

- Re-scan: running the check again on a new commit and comparing.
- Compare: the five states every finding lands in. Fixed, still broken, new, back again, unknown.
- Cause line: why a finding changed. The code changed, the advisory data changed, or the checker changed.
- Mission: one step in a fixed order. Only one is active at a time.
- Achievement: a milestone marked earned only when the scan data proves it. No points, no leaderboard.
- Handoff: plain text you can send to a developer friend who has no coding agent.