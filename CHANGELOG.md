# Changelog

All notable changes to LaunchSense. This file follows Keep a Changelog. Versions stay 0.x during Phase 1. Dates are release dates.

## [Unreleased]

### Added

- Nothing yet.

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
