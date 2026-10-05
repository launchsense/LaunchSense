# Changelog

All notable changes to LaunchSense. This file follows Keep a Changelog. Versions stay 0.x during Phase 1. Dates are release dates.

## [Unreleased]

### Added

- The licence declaration. For a project that commits an npm `package-lock.json`, every installed package, direct and transitive, is read for the licence it declares. The lockfile is the declaration being read, so this adds no request and no new egress. The installed `package.json` is the fallback where the lockfile is silent, and a disagreement between the two reads as Unknown rather than picking one. A declaration that is not an SPDX expression, such as `MIT/X11`, reads as Unknown. An `OR` expression stays a choice. `UNLICENSED` reads as `LicenseRef-Proprietary-UNLICENSED`, a proprietary claim rather than a licence name. A bare `GPL-2.0` is kept as declared and marked deprecated, because rewriting it into `-only` would assert an only-versus-or-later choice the string does not make.
- `shared/licensing/obligations.ts`, one cited row per licence family: licence text, copyright notice, a NOTICE file where the licence has one, state of changes, source disclosure for copyleft, and the distribution clash for strong copyleft. A small table of what a licence text asks for, not a legal engine, and it says so.
- `npm run notices` writes the third-party notice file from the committed lockfile. It is deterministic: the same lockfile in, byte-identical file out. It names each component with its licence, states what that licence requires with the clause it came from, and lists what it did not read. The local review carries the same text.
- `license.inventory` as an informational row with the per-id counts, the unknown count, and the named gaps. `license.declaration` as one informational row whose fingerprint is the licence mix, so a change between two permissive licences still shows up on the rescan. `license.dependency` as one row per dependency whose terms need a person, low for file-level copyleft and medium for library copyleft, strong copyleft, source-available and proprietary terms, capped at 25 with the remainder stated.
- A guarded AI lookup for a dependency licence that reads as Unknown. It runs only when a lane is supplied, the prompt carries the package name, the version and fixed wording and nothing else, and the answer is a suggestion with no rule id, no fingerprint and no severity, which never writes back into the component it came from. No lane is wired in this release, so the path is refused and unknown stays unknown.
- `license_change` as a cause on a rescan transition. A dependency whose declared licence changed is reported as a licence change rather than a code change, through the transition machinery that already shipped. A dependency added or removed is still a code change.
- Optional server-minted LaunchSense credentials for the hosted MCP read. A token is `ls_live_<publicId>_<secret>`; the server stores the `publicId` in the clear and a SHA-256 hash of the whole token, never the token. Resolution is one indexed read then a constant-time compare, and `revoked` is read on every resolve so a revoke is immediate.
- Three identity layers kept apart. `attributedCallerId` is the server-minted credential id, written on `scans`, and the only one with authority; `declaredHarness` is an operator label carried on the resolved credential as a claim and never used for a rate limit key, an ownership check, or an access decision; `verifiedBinding` is a server-observed binding to a person or installation and is null on every row, because a scan reads the public repository with our own GitHub credential and nothing about the call identifies a person. Only `attributedCallerId` reaches a scan row; the other two live on the credential.
- Audience binding. A credential is minted for the canonical MCP server URI and the server checks it, so a credential minted elsewhere is refused. A 401 carries `WWW-Authenticate` pointing at the RFC 9728 protected resource metadata path.
- `Authorization` added to `Access-Control-Allow-Headers`, so a browser-based MCP client can send a credential at all. Nothing authenticates on `Mcp-Session-Id` and no session id is issued.
- Hosted scan quota keyed on the resolved `callerId` rather than one shared bucket, with a per-caller daily cap in addition to the hourly one. No credential resolves means the one shared bucket, unchanged. A caller-supplied string never reaches a key.
- `scans.channel` (`web`, `mcp`, `api`) alongside `scans.surface`, both written on every path, and `attributed` written `false` on a scan with no or refused credential so attributed over total is a real ratio.

### Fixed

- An in-flight scan of the same public repository could cross callers. `findInFlight` matched on (owner, repo) with no sha and no identity, and `runScan` handed that row back once a sha was pinned, so the second caller received a scan row owned by the first. A row is now only reused when it belongs to the caller; anything else is skipped, a new row is minted for the caller, and the sha-keyed tree cache copies the tree into it so the work is not repeated.
- `commitSha` and `treeSha` are recorded as separate scan fields. The tree response carries the tree object sha, not the commit sha, so a naive equality check would have failed on every repository. The tree response is now compared against the tree sha the commit response already promised, and a disagreement fails the scan instead of recording a snapshot neither response supports. The tree request and every blob ref are built through functions that refuse anything that is not a full 40-character commit sha.

### Changed

- Both halves of a replaced finding now carry the same cause. A row that replaced a row at the same coordinate was reported as an advisory change on one side and a code change on the other, which described one event two ways.
- Home, readme, and docs now say LaunchSense checks the codebase, not whether the app will sell. Repeated functions are named as the next rule, not as a check that runs today.
- The home page and every report now say the rules are fixed, and a model may only reorder items that share a severity.

### Added

- Standards tab now includes OWASP Top 10:2025, OSV, and three CWE labels on checks that already run. deps.dev and OpenSSF Scorecard stay not-checked. A timeout on OSV stays not-checked.
- One repository archive per scan, about 4 GitHub requests instead of about 200.
- Live quota display on the scan page: requests left, how many more scans that allows, and the reset countdown. Plus the check order, in plain words.
- Admission control. Six scans analyse at once; the rest queue and are told their place instead of everyone failing together.
- DNS guard on live URL checks. Hostnames are resolved and rejected if any answer is loopback, private, link-local, CGNAT, or reserved, checked again on every redirect hop.
- Public roadmap page: shipped, being built, and what we will not build.
- Scan report page with per-finding cards, severity, and a single ordered fix prompt for the top 3.
- Live app URL check over fetch: HTTPS, response, main action hint, and phone viewport meta. Redirects, timeouts, and oversized pages show as Unknown, never as a pass.
- Safe share cards and Passport links that work signed out on a phone, with referral attribution. Public pages carry counts and fix titles only, never paths, lines, or snippets.
- Re-scan and compare: fixed, still broken, new, back again, and unknown states, with both commit numbers pinned and a cause line on every change.
- Accept-risk marking on findings you decide to keep.
- Repo DNA map and a Share Readiness signal with evidence coverage shown.
- OWASP ASVS 5.0.0 subset mappings with coverage, caveat, and evidence counts. Signals only, no certification claim.
- Seven serial missions and six achievements, verified from scan state only. No points and no leaderboard.
- Plain text handoff for a developer friend with no coding agent.
- Plain words explanations with an AI lane (Gemini, then Ollama Cloud, then fixed wording) and output validation that rejects unknown finding ids, dropped findings, and invented claims.
- Plain-language docs set: how a scan works, how to read your report, about, privacy, limits, glossary.

### Security

- Live URL checks no longer accept hostnames that encode a private target. `169.254.169.254.nip.io`, `localtest.me`, and similar previously passed validation, and the check is public and unauthenticated. Addresses are now resolved and checked on every hop.
- 164 stored rows carried redacted file text left over from an earlier schema. Convex does not drop fields from existing documents, so removing the column did not remove the data. All rows deleted and verified gone, before any deploy.

### Fixed

- Tarball and fallback reads now reserve byte budget before adding a file, so the 2MB cap cannot be crossed by one more entry.
- Fallback per-file fetches now actually run when the tarball fetch fails or is truncated.
- The Share-ready mission now requires a live check that reached the site, not merely the absence of a failed live check.
- Accepted-risk marks no longer insert duplicate rows.
- AI explanations are now returned and visible in the report instead of validated and discarded.
- The footer no longer calls the checks open source while the project license is proprietary.
- Privacy page described a 24 hour cache of redacted file text that was removed three releases ago. It now describes what is actually stored: paths, sizes, hashes, and redacted snippets.
- Docs claimed re-scanning the same commit costs nothing. It costs about 4 GitHub requests. Corrected, with the real cost stated.
- Scan page told users their snippets were cached for 24 hours. No purge existed. Corrected.

### Changed

- npm dependency records use exact installed versions from `package-lock.json` when that file is present.
- OpenRouter fallback now uses the real free model id `openrouter/stealth/space-bunny-alpha`.
- Correction: the AI lane's second rung is Ollama Cloud, an OpenAI-compatible endpoint reached over `OLLAMA_BASE_URL`, not OpenRouter. The OpenRouter rung named above was removed; that model id is no longer in the code.
- First-party analytics writes are throttled by event kind and day.
- Claim guard now checks two more things: any sentence claiming there is no stored copy of your code, and any stated cache or retention window. A window must match a TTL constant in the code and be backed by code that deletes. This is why the three defects above cannot come back silently.
- Repo renamed to LaunchSense.
- Positioning now names three ways in: a public paste, a private repo after GitHub login, and MCP. The private scan is not running yet. MCP for a private repo is work we will do.
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
