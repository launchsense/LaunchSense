# Changelog

All notable changes to LaunchSense. This file follows Keep a Changelog. Versions stay 0.x during Phase 1. Dates are release dates.

## [Unreleased]

### Added

- Scan report page with per-finding cards, severity, and a single ordered fix prompt for the top 3.
- Live app URL check over fetch: HTTPS, response, main action hint, and phone viewport meta. Redirects, timeouts, and oversized pages show as Unknown, never as a pass.
- Safe share cards and Passport links that work signed out on a phone, with referral attribution. Public pages carry counts and fix titles only, never paths, lines, or snippets.
- Re-scan and compare: fixed, still broken, new, back again, and unknown states, with both commit numbers pinned and a cause line on every change.
- Accept-risk marking on findings you decide to keep.
- Repo DNA map and a Judge Readiness signal with evidence coverage shown.
- OWASP ASVS 5.0.0 subset mappings with coverage, caveat, and evidence counts. Signals only, no certification claim.
- Seven serial missions and six achievements, verified from scan state only. No points and no leaderboard.
- Plain text handoff for a developer friend with no coding agent.
- Plain words explanations with an AI lane (Gemini, then OpenRouter free, then fixed wording) and output validation that rejects unknown finding ids, dropped findings, and invented claims.
- Plain-language docs set: how a scan works, how to read your report, about, privacy, limits, glossary.

### Changed

- Repo renamed to LaunchSense.
- Docs state that only public repos can be read, and that private repos are not supported in this release.
- Publish guard now blocks internal notes, tool config, secrets, and private-life details on every push.

## [0.3.0] - 2026-10-02

### Added

- Deterministic analyzers: secrets, hygiene, dependencies with live vulnerability lookup, and licenses.
- Evidence ledger and findings with stable fingerprints.
- Central redaction engine. Raw secret values are never stored.
- Fix Before You Share checklist built from findings.
- Guest scan page now runs fetch then analysis, and shows counts, coverage, and not-checked items.
- Stricter publish rules so only app source can reach GitHub.

## [0.2.0] - 2026-10-02

### Added

- Guest public GitHub URL input with validation.
- Commit SHA resolution and recursive file tree fetch.
- 24-hour caching by repo and commit. Repeat scans skip refetching.
- Honest partial states for quota limits and large trees.

## [0.1.0] - 2026-10-02

### Added

- Foundation: React plus Vite plus Convex app with health check, sign-in skeleton, and static hosting.
