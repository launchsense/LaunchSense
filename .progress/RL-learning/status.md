# Run status: full offline reviews, 100 repos

Append-only. One line per completed unit, newest at the bottom. Waves 01 to 05
are recorded in their own sheets; this file starts at the night coordinator run
that covered waves 06 to 10 autonomously.

Method for every wave below: depth-1 clone to /tmp/opencode/full, then
`LAUNCHSENSE_OFFLINE=1 node --experimental-strip-types mcp/review-entry.ts
--root <dir> --json`. Every HIGH and MEDIUM finding was judged by reading the
real file at the reported line, and the harness reports an absent file or an
out-of-range line rather than trusting the scan. Clones cleaned after each wave.
No GrowthX, nothing pushed, nothing deployed, no secret values written anywhere.

---

2026-10-05 waves 06 to 10 complete, 50 repos reviewed (PHP/Ruby, C/C++,
crypto/ML, infra, mobile/other), all depth-1 and all offline. 1241 findings
total, 433 of them HIGH or MEDIUM. 13 of those 433 rows were flagged as
fabricated, and every one is the same rule bug: `license.policy` emits
`path "(repo)"` line 1, a placeholder path that does not exist, so a reviewer
cannot open it. No model-fabricated finding in these 50 repos. Live secrets
found: 8 entries in owner-queue.md, of which 2 are genuine committed signing
secrets (sidekiq `secret_key_base`, dharmpatel28 Django `SECRET_KEY`), 13 are
committed private keys that upstream documents as test or tutorial material
(civetweb 11, mongoose 1), 1 is a weak committed DB password in a homelab
repo (homelab immich), and 2 are config literals queued for their naming
context rather than because a key is exposed. Top repeated classes of error,
in order of volume: credential-pattern regex firing on ordinary code, 200+
false highs across Kotlin, Swift, Ruby, C and Python, the global 20-per-rule
match cap silently filling with those false positives, `code.eval-use` firing
on PyTorch `model.eval()`, `code.inner-html` firing on generated, vendored and
first-party markup builders, and license advice issued where a LICENSE file
already exists. Precision is the single blocker on this analyzer for
non-JavaScript ecosystems, not recall.- 2026-10-05 item 14 done: feature-board plans for 5 noted rows, plans only, zero code. Key line for the owner: the two bot rows depend on the 12pct precision measurement, so precision work is upstream of both, and whose-GitHub-quota is one question that unblocks two rows.
