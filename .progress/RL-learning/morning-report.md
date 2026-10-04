# Morning report: LaunchSense night run, 2026-10-05

Everything below is measured from files in this folder. Where something is unknown
it says unknown, and where a count does not reconcile it says so.

The queue is empty. Every item is DONE. Nothing is DEFERRED.

---

## 1. Every queue item, with its status

| # | Item | Status | Evidence |
|---|---|---|---|
| 5 | wave-full 06 PHP/Ruby | DONE | `wave-full-06.md`. Sheet written by a concurrent coordinator; I re-verified both of its owner-queue rows against the clones and both hold. |
| 6 | wave-full 07 C/C++ | DONE | `wave-full-07.md`. 10 of 10 repos. |
| 7 | wave-full 08 crypto/ML | DONE | `wave-full-08.md`. 10 of 10 repos. |
| 8 | wave-full 09 infra | DONE | `wave-full-09.md`. 10 of 10 repos. |
| 9 | wave-full 10 mobile/other | DONE | `wave-full-10.md`. 10 of 10 repos. |
| 10 | M4 monitoring query and coverage remainder | DONE | `monitoring-reading.md`, `convex/decisionMonitoring.ts`, the walk exclusion and the OSV line in `mcp/review-entry.ts` and `shared/review/buildReport.ts`, 8 new tests. |
| 11 | M5 counts-only case drafts | DONE | `cases/` holds 4 drafts and an index. |
| 13 | Feature-board audit of `done` rows | DONE | `feature-board-audit.md`. 8 rows, 6 TRUE, 2 PARTIAL, 0 FALSE. |
| 14 | Feature-board plans for `noted` rows | DONE | `feature-board-plans.md`. 5 rows, plans only, no code. |
| 15 | Feature-board reconciliation | DONE | `feature-board-reconciliation.md`. 0 of 8 rows drifted into being false. |
| 12 | This report | DONE | This file. |

Commits this run: `b80e788`, `a16dfc2`, `5e0e731`, `0c890db`, `31a675e`, `dab2be7`,
`cf5afe8`, `83309c0`, plus this report's commit. Local only. No push, no deploy.

---

## 2. The scan corpus, in one table

50 repositories, waves 06 to 10, depth-1 clones of public repositories, offline,
cleaned after each wave.

| Group | Repos | Files read | Files skipped | High | Medium | High+medium |
|---|---|---|---|---|---|---|
| PHP and Ruby | 10 | 3,318 | 188 | 88 | 16 | 104 |
| C and C++ | 10 | 6,976 | 635 | 42 | 53 | 95 |
| Crypto and ML | 10 | 563 | 63 | 31 | 13 | 44 |
| Infrastructure | 10 | 573 | 13 | 1 | 13 | 14 |
| Mobile and other | 10 | 4,102 | 440 | 148 | 28 | 176 |
| **Total** | **50** | **15,532** | **1,339** | **310** | **123** | **433** |

Every coverage note read "partial". 50 of 50. Median files read per repository: 168.

### What survived human verification

| Outcome | Rows | Share of 433 |
|---|---|---|
| Kept: real and correctly classified | 52 | 12% |
| License notice on a real file | 37 | 9% |
| License row pointing at a path that does not exist | 13 | 3% |
| False positive | 331 | 76% |

52 + 37 + 13 + 331 = 433. Reconciles.

The 331 false positives, by cause:

| Cause | Rows |
|---|---|
| Credential name gate matched a word inside a receiver, an attribute, or a dotted type name | 262 |
| innerHTML matched inside generated documentation or a vendored tree | 47 |
| The eval rule matched `model.eval()` | 21 |
| Child-process rule matched a module import with no arguments | 1 |

262 + 47 + 21 + 1 = 331. Reconciles.

**One defect produced 80% of the false positives.** The rule asks whether a
variable's name contains a credential word, then takes whatever follows as its
value. That is a person-readable summary of `shared/analyzers/secrets.ts:104`.

---

## 3. Models that ran

**No subagent model ladder was exercised in my part of this run, and I am not
going to imply otherwise.**

The wave sheets say what actually happened:

- The runner that executed waves 06 to 10 was a deterministic Python harness
  (`/tmp/opencode/full/harness.py`). It clones, runs the analyzer, opens the real
  line at every HIGH and MEDIUM location, masks the value, and prints the result.
  No model is in that loop.
- Judging those rows was done directly against the cloned files, which is what the
  task asked for and what the observer rule requires.
- The one subagent-shaped thing this session could have used was a task
  dispatch tool. My tool catalogue did not contain one. The governing rules
  describe a ladder of `space-bunny-free`, then `space-bunny-alpha`, then
  `ollama-cloud/deepseek-v4.1-flash`. None of them ran, because none of them could
  be called.
- A concurrent coordinator session was active on the same files. It produced
  `wave-full-06.md` and the first version of `owner-queue.md`. My reading: that is
  a second worker on one queue, not a model ladder step.

The M1b maths pass in an earlier part of this run did score 12 bands on the local
`nimble` model, values 2.16 to 2.94 on a 0 to 3 rubric. That is recorded in
`queue.md` item 4 and was not my work.

---

## 4. Failures, retries, and replacements

| What failed | How it failed | What I did |
|---|---|---|
| `yyjson-tldr/yyjson` | Repository does not exist on GitHub. Two known alternates (`icyfox/yyjson`, `yyjson/yyjson`) also do not exist. | Scanned the real upstream, `ibireme/yyjson`, and recorded the swap in the sheet instead of making it silently. |
| `MacPaw/OpenAI` | Listed repo name is not the real one. | Used the fallback `MacPaw/OpenAI-Swift`, recorded in the sheet. |
| `wave-07/02-yyjson.json` and `wave-08/10-eth-price-prediction.json` | Unparseable JSON, because the harness printed a two-document stream when the first clone failed. | Read both with a streaming decoder. No data lost. |
| Two masked-value leaks | See section 6. | Widened the masker, tested it against 11 sample lines, then re-verified every affected row. |
| Two concurrent writers on the same files | A coordinator wrote `wave-full-06.md` and `owner-queue.md` while I was writing the same paths. | Did not clobber. Re-verified its two owner-queue rows, kept its numbering, renumbered mine from WQ-7 so no number was reused, and folded my duplicate Django row into its existing WQ-5. |
| Six line citations in my first audit draft | Pointed at lines that had moved after my own edits earlier in the run. | Re-verified every citation with `sed -n` and corrected four. |

**No item failed twice, so nothing is DEFERRED.**

---

## 5. Live-looking secrets found

Eight rows in `owner-queue.md`. Shapes only, no value recorded in any file.

| Row | What | Verdict |
|---|---|---|
| WQ-1 | sidekiq, two 128-character `secret_key_base` literals in a sample app | Real shape. The file's own comment asks that its secrets be kept private. |
| WQ-2 | wallabag, `APP_SECRET` in a tracked `.env` | Real shape. The shipped upstream default. Rotate on a real install. |
| WQ-3 | civetweb, 11 committed private key files | Real material. `SECURITY.md` says they are test material. |
| WQ-4 | mongoose, one committed EC key in a tutorial | Real material, demo fixture. |
| WQ-5 | A Django `SECRET_KEY` with the `django-insecure-` prefix, committed | Real shape, development config (`DEBUG = True`, empty `ALLOWED_HOSTS`). |
| WQ-6 | An OpenRouter-shaped key literal in a README | Documentation. Refuted by reading the line's own comment. |
| WQ-7 | keila, a 64-character Phoenix `secret_key_base` in the base config | Real shape, low risk: `runtime.exs` reads the real key from the environment. |
| WQ-8 | Two secret values printed into an agent session on this machine | Not a finding about a repo. A masking defect on my side. See section 6. |

Also cleared and recorded so they are not re-reported: 10 entries covering 18
findings, each refuted by opening the actual file.

**Needs an owner decision: WQ-1, WQ-2, WQ-5, and WQ-8.** The rest are recorded for
completeness. No private key body was read, opened, or copied at any point.

---

## 6. The masking defect, stated plainly

Twice, while confirming rows by hand, the masking helper in my wave harness did not
catch a committed secret literal and the value printed into an agent session on this
machine.

- Once for the wallabag `APP_SECRET`, a 16-character value on `.env` line 1.
- Once for the Django `SECRET_KEY`, a 66-character value on `settings.py` line 23.

Both were public in their own repositories already. Neither was written into any
file in this folder, neither was sent to a network service, and neither was passed
to another tool.

What I did: widened the helper so any identifier ending in a secret-ish word
matches, not only a bare credential word, and so any quoted literal of 12 or more
characters is masked unless it is provably an identifier, a path, or prose. Tested
it against 11 sample lines including the two that had leaked. Every row after that
point was masked.

What the owner should take from it: both values are in this machine's session logs.
No rotation is implied, since one is a published default and one is a development
key. It is recorded as WQ-8 because a rule about values belongs where the owner
reads about values.

---

## 7. The most repeated classes, ranked

Across waves 06 to 10, by rows produced. The first two are one defect wearing
different costumes.

| Rank | Class | Rows | One-line cause |
|---|---|---|---|
| 1 | Credential name gate on a receiver, an attribute, or a dotted type | 262 | The rule reads a word in a line and assumes the line is about that word. |
| 2 | innerHTML inside generated or vendored files | 47 | The walk skips `vendor` and `third_party` but not `3rdparty` or `doc/`. |
| 3 | `eval` rule on `model.eval()` | 21 | The rule matches the `eval(` shape without checking the receiver. |
| 4 | License row at a path that does not exist | 13 | The rule emits `(repo)` line 1 when no licence file was in the read. |
| 5 | Tracked env file reported at line 1 | 17 | The finding carries the file, not the assignment that tripped it, so the line can never be checked from the finding. |

Two of these are already drafted and person-gated, not merged:
`drafts/draft-3-name-gate-literal.md` covers rank 1 and
`drafts/draft-2-value-gate-types.md` covers the dotted-name half of it.

Rank 1 is the highest-value fix in the run. It is 80% of all false positives, and
the drafts for it already exist with tests written.

---

## 8. Product code changed this run

Five files, all covered by tests. This is the only product change in the run.

| Change | File |
|---|---|
| Local walk skips the notes folder by name and discloses the skip | `mcp/review-entry.ts` |
| OSV not-checked line names the lockfile that was in hand | `shared/review/buildReport.ts`, `mcp/review-entry.ts` |
| Decision-source distribution query, internal, no scoring | `convex/decisionMonitoring.ts` |
| Tests for both, 8 new assertions across 2 files | `tests/local-review-checks.mjs`, `tests/decision-monitoring-checks.mjs` |

Verified after the change: `393 of 393 tests pass`, `tsc -b` clean,
`tsc --noEmit -p convex/tsconfig.json` clean, `check:claims` clean, `eslint`
not run and not claimed.

The `.progress` exclusion was checked end to end on this repository: 302 files
read, 15 skipped, one of them the notes folder, and neither private folder name
appears anywhere in the output.

---

## 9. The three things worth the owner's attention

**First, precision.** The tool is right about 1 row in 8. That is measured, not
estimated, and it is on the file in `cases/case-1-fifty-repos-counts.md`. The fix
is known and drafted. Nothing about the two bot rows on the feature board should be
built before it lands, because a 12%-precision bot gets blocked by its first
maintainer and deserves to be.

**Second, two board rows over-claim and a name does not match.** The registry facts
row and the lockfile registry row describe the local review but read as though they
describe the hosted scan, which never asks either registry. Separately, the board
names `launchsense_scan_public`, which is the MCP route's name; the REST tools list
advertises `launchsense_scan_public_repo` and a third tool,
`launchsense_explain_findings`, that has no handler anywhere in the codebase. Four
fixes, all cited to a file and line, in `feature-board-audit.md`.

**Third, the decision lane has never been measured and now says so.** The monitoring
reading exists and reports 0 rows, because the table it reads is only written when
a deployment variable is set and it is not set. That is the honest answer. Whether
the hosted deployment should send usage counts at all is an open question involving
a data transfer, so it stays a question.

---

## 10. Next action

One thing, in this order:

1. **The owner reads `owner-queue.md`.** Four rows need a decision and one of them
   is about this machine, not about a repository.
2. **Merge the two name-gate drafts.** `drafts/draft-2` and `drafts/draft-3`, with
   their tests. That is the one change that moves the 12% figure.
3. **Answer one question: whose GitHub quota.** It is asked by the learner row and
   repeated by the compute row. No plan on either row starts without it.

Everything else in this folder is waiting on a person, which is the correct state
for it. Nothing here needs a bot, and nothing here should be published before a
person has read it.
