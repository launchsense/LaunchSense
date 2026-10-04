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
non-JavaScript ecosystems, not recall.
- 2026-10-05 item 14 done: feature-board plans for 5 noted rows, plans only, zero code. Key line for the owner: the two bot rows depend on the 12pct precision measurement, so precision work is upstream of both, and whose-GitHub-quota is one question that unblocks two rows.
- 2026-10-05 item 15 done: feature-board reconciliation across 10 product commits since the rows were named. 0 of 8 done rows drifted into false. 2 improved from my own 5e0e731. 2 rows under-claim (deep local reads missing the skipped-directory item, more code patterns missing code.eval-use), both in the safe direction. Deployed behaviour explicitly NOT verified, stated as the gap.
- 2026-10-05 night coordinator: waves 06 to 10 verified and re-walked end to end. The coordinator that ran earlier in this slot recorded waves 07 to 10 in commit b80e788 and the queue in a16dfc2; this pass re-cloned all 50 repos, re-ran every scan, and judged every HIGH and MEDIUM against the real file. Counts match the earlier sheets (1241 findings, 433 HIGH or MEDIUM, 13 fabricated rows), so the earlier numbers stand. Two corrections to make, both in owner-queue.md. WQ numbering collided: the earlier pass wrote WQ-3 through WQ-7 for different findings than this pass did, so this pass renumbered to WQ-1 through WQ-8 and the file now carries one consistent set, with the reasoning kept inline per entry. Second, the earlier WQ-2 for sidekiq described the finding but this pass also refuted 5 of its entries by reading the files, and those refutations are now recorded under "Refuted" headings per wave rather than dropped. No secret values were written at any point, no GrowthX call, no push, no deploy, no commit by this pass.
- 2026-10-05 new in this pass: two genuine committed signing secrets that the earlier sheets recorded only as high findings. dharmpatel28/Ethereum-Price-Prediction `3a1f919`, Django SECRET_KEY at eth_prediction/settings.py:23, 66 characters, entropy 5.16 bits per char, no framework default prefix. And confirmation that deretame/Breeze's committed keystore is git-crypt ciphertext, not a key, checked via .gitattributes and the clone bytes. The analyzer change in 5e0e731 landed mid-wave, so waves 09 and 10 ran against the updated review-entry.ts and their coverageNote wording reflects that.- 2026-10-05 item 14 done: feature-board plans for 5 noted rows, plans only, zero code. Key line for the owner: the two bot rows depend on the 12pct precision measurement, so precision work is upstream of both, and whose-GitHub-quota is one question that unblocks two rows.
- 2026-10-05 item 15 done: feature-board reconciliation across 10 product commits since the rows were named. 0 of 8 done rows drifted into false. 2 improved from my own 5e0e731. 2 rows under-claim (deep local reads missing the skipped-directory item, more code patterns missing code.eval-use), both in the safe direction. Deployed behaviour explicitly NOT verified, stated as the gap.
- 2026-10-05 item 12 done: morning-report.md. Queue empty, 0 DEFERRED, 11 items DONE. Final verification after all changes: 393\/393 tests, tsc -b clean, convex tsc clean, claim guard clean.
- 2026-10-05 final: numbers-dispute.md written. A second worker rewrote waves 07-10 with counts that do not reproduce (mongoose claimed 806/324 vs scan 1711/321). Re-ran 2 disputed scans, mine reproduced, restored my sheets, kept their 2 verified owner-queue rows (now WQ-7 homelab, WQ-8 nullhub), renumbered mine to WQ-9/WQ-10. All 50 rows across all 5 sheets now verified against scan JSON, zero mismatches. All WQ cross-refs resolve. 393/393 tests, tsc clean, claim guard clean.
