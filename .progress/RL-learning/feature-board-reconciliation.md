# Feature-board reconciliation: do the `done` rows still hold on today's code

Written 2026-10-05. This is the second pass over the same eight `done` rows that
`feature-board-audit.md` covers, asked a different question. The audit asked "does
the code do what the row says". This one asks "did anything drift since the row was
written, and does the row still hold against the current tree".

The difference matters. A row can be accurate and still have gone stale: the code
can move underneath it, or the row can have been written against a state that no
longer exists.

## Method

- The rows were named 2026-10-04. Every commit touching product code since then was
  listed, and each one was read against the rows it could plausibly affect.
- Each row was then re-checked against the working tree at commit `cf5afe8`, not
  against the tree the audit read an hour earlier. Where a line moved, the row was
  re-cited.
- No row is re-judged here. The verdicts come from the audit; this file only reports
  movement.

## Commits that touched product code since the rows were written

| Commit | What it changed | Rows it could affect |
|---|---|---|
| `701aab5` | Alpha review reads the local tree instead of downloading from GitHub | Deep local reads, Registry facts |
| `6b2ad4c` | Page text: rules are fixed, a model only reorders inside one band | Hosted MCP |
| `9bca93d` | Signed-in scan reads one archive on the person's token | Signed-in scan |
| `9c485b7` | New code checks stop flagging their own wording | More code patterns |
| `c765a48` | Public report leads with the codebase problem the checks found | Hosted MCP |
| `817613b` | Home page shows the install and the extra checks | Deep local reads |
| `d5200ae` | Site points at the hosted MCP | Hosted MCP |
| `24e5b64` | Discloses every skipped directory in local coverage | Deep local reads |
| `4218af8` | Local decision rung behind an environment flag | none, it is off by default |
| `53c5c5c` | Ranking math module and its tests | none of the board rows |
| `5e0e731` | Local walk skips the notes folder; OSV line names an unqueried lockfile | Deep local reads, Lockfile inventory |

Ten commits. Nine touch a row or could. Each was checked.

## Verdicts

| Row | Audit verdict | Still holds today | Drift |
|---|---|---|---|
| Hosted MCP | PARTIAL | Yes, unchanged | None. The tool-name mismatch is a pre-existing defect, not drift. |
| Signed-in scan | TRUE | Yes, unchanged | None |
| Policy text on files we already read | TRUE | Yes, unchanged | None |
| Lockfile inventory and transitive advisories | PARTIAL | Yes, and one row got stronger | Improved, see below |
| Registry facts | PARTIAL | Yes, unchanged | None |
| Repeated functions and dead copies | TRUE | Yes, unchanged | None |
| Deep local reads | TRUE | Yes, and one row got stronger | Improved, see below |
| More code patterns | TRUE | Yes, unchanged | None |

**Zero rows drifted into being wrong.** No `done` row became false after
`d5200ae` or any other commit. Two rows became more true.

## What improved, and the one thing that needs a board edit

### Improved: Lockfile inventory and transitive advisories

The row says a missing lockfile stays incomplete and that the not-queried count is
listed. Commit `5e0e731` made the second half sharper. Before it, a run holding a
complete lockfile and running offline produced a flat "Lockfile versions were not
queried", which reads the same as a run with no lockfile at all. After it, the
line names the file:

> `package-lock.json` was in the files read and its versions were not queried.
> Unknown stays unknown.

And the lock note says: "This run was offline, so no version in that lockfile was
checked against the advisory service. A lockfile in hand that was never queried is
unknown, not a pass."

Measured against a synthetic lockfile with 4 packages, offline: the lock note and
the OSV not-checked row both name the lockfile, and the status stays `partial`.
Before the change, a reader could not tell that gap from having nothing to check.

This is an improvement to the product, not to the row. The row's claim already
covered it.

### Improved: Deep local reads

The row says the alpha review can name what it did not read. Commit `5e0e731` added
one more thing it now names: a working notes folder at the root of a repository is
skipped by name and the skip is disclosed with its own reason line.

Measured on this repository: 302 files read, 15 skipped, and one of those rows is
the notes folder, worded "Working notes folder. Not read, and its contents are not
the repo owner's to review."

Again, an improvement the row already covers. The row says "can name a vendored
tree it did not read"; a named skip is the same capability.

### Needs a board edit, and it is not drift

The `24e5b64` commit disclosed skipped directories in local coverage. The
`Deep local reads` row lists what the alpha review can name: a vendored tree, a host
it did not contact, an SBOM with omissions, a model or dataset card. A skipped
directory is a fifth item that now exists and is not listed.

This is an omission in the row, in the direction of under-claiming, and it has been
there since `24e5b64`. It is not drift. It is the same kind of gap the audit found
on `More code patterns`, where `code.eval-use` is a real rule the row does not name.

**Two rows under-claim, both in the safe direction.** A board that under-claims is
much cheaper to fix than one that over-claims, which is the other two PARTIAL rows.

## The rows that were never at risk from any of this

Two claims are structural rather than behavioural, and no commit in this list could
have moved them:

- **The rate caps.** `convex/mcpLimit.ts:5-6` holds `CALLER_LIMIT = 2` and
  `GLOBAL_LIMIT = 8`. No commit in the list touched that file.
- **The read caps.** `shared/scanCaps.ts` holds 200 files, 2MB, 1000 files, 8MB,
  20MB. No commit in the list touched that file.

Worth stating plainly because these are the numbers a customer is actually held to.
Both files have been untouched since before the rows were named, so both rows are
as true as they were on 2026-10-04.

## What this reconciliation does not establish

- **It does not establish that the deployed site behaves this way.** This is a
  reading of the code at `cf5afe8`. The live deployment is a separate check and I
  did not make it, because the audit's own scope said code only and I did not widen
  it. A row can be true in the source and false in production if a deploy is behind
  the source. That remains unknown.
- **It does not establish that the two PARTIAL rows became TRUE.** They did not.
  The registry facts and the lockfile registry row still describe the local review
  and not the hosted scan, exactly as the audit found.
- **It does not clear the noted rows.** Four of the five remain unbuilt, and the
  plans in `feature-board-plans.md` are plans.

## Summary

| Question | Answer |
|---|---|
| Did any `done` row become false? | No. 0 of 8. |
| Did any row drift in a way a reader would notice? | No. |
| Did any row become more accurate? | Yes, 2, both from `5e0e731`. |
| Did any row need an edit for under-claiming? | Yes, 2, both long-standing, both in the safe direction. |
| Is anything still PARTIAL? | Yes, 2, both the registry seam between local and hosted. |
| Is the deployed behaviour verified? | No. That is the gap in this file. |
