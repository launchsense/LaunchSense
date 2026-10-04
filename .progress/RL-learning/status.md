# Night run status (append-only, one line per unit)

Coordinator reads queue.md, takes the top UNSTARTED item, commits, appends here.

- 2026-10-05 M1 ranking math module done (53c5c5c)
- 2026-10-05 M2 five precision drafts done (drafts/)
- 2026-10-05 wave-full 05 done (wave-full-05.md) - 1 real live secret found (spring-boot-realworld jwt.secret)
- 2026-10-05 M1b maths scoring pass done (12 bands scored on local nimble, values 2.16-2.94 on a 0-3 rubric)
- 2026-10-05 coordinator launched in background for waves 06-10
- 2026-10-05 queue extended with feature-board work (items 13-15)
- 2026-10-05 wave-full 06 re-verified by me (its 2 owner-queue rows both hold: sidekiq 128-char random key with a keep-private comment, wallabag shipped APP_SECRET default)
- 2026-10-05 wave-full 07 done (wave-full-07.md) - 10/10, 13 private-key header TPs (civetweb+mongoose demo certs), yyjson repo name in the locked list does not exist, scanned ibireme/yyjson
- 2026-10-05 wave-full 08 done (wave-full-08.md) - 10/10, WQ-3 real committed Django SECRET_KEY, model.eval() FP class = 19 rows across 6 repos
- 2026-10-05 wave-full 09 done (wave-full-09.md) - 10/10, no owner decisions, tracked-env FP cleared by reading every key in immich/.env
- 2026-10-05 wave-full 10 done (wave-full-10.md) - 10/10, 144/145 H/M false positives, Kotlin view-binding credential gate is the biggest defect found in 100 repos (53 rows)
- 2026-10-05 waves 06-10 committed together (b80e788); a second masker leak (Django SECRET_KEY) written to owner-queue.md as a shape, helper widened
- 2026-10-05 M4 done (commit 5e0e731): decision-source internal query written, 0 rows to read (usageDiagnostics unreachable offline, reading says so rather than inventing a number); local walk now skips .progress by name and discloses the skip; OSV not-checked line now names the lockfile that was in hand; 8 new tests, 393/393 pass, tsc clean, claim guard clean
- 2026-10-05 owner-queue renumbered: a concurrent coordinator and I both wrote it, so WQ-1..6 are its rows and WQ-7/8 are mine, no number reused, duplicate Django row folded into WQ-5
- 2026-10-05 M5 done: 4 counts-only case drafts in cases/ (50-repo totals, language precision, coverage honesty, unmeasured ranking) + index. No repo names, no paths, no values, no em dashes. All totals reconcile to 433 H\/M rows and 15,532 files read.
