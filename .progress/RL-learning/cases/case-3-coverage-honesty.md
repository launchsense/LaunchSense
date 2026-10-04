# Case draft 3: what "we read your files" has to mean

Status: DRAFT. Not published. Counts only.

## The problem this case names

Every run in this set reported the same status. Fifty repositories, fifty times:
**partial.** Not one run was complete.

That is not a defect in the tool. It is the tool being honest about a limit that
almost every comparable tool hides. A security scanner that reports "clean" on a
repository where it read 4 files out of 400 is not being precise, it is lying by
omission. This one says partial every time, and the reason is always printed.

## What was read and what was not

| | |
|---|---|
| Files read across 50 repositories | 15,532 |
| Files skipped, every one named in a not-checked list | 1,339 |
| Share of the tree skipped | 8.6% |
| Median files read per repository | 168 |
| Runs reporting complete coverage | 0 of 50 |

## The part worth arguing about

Five repositories contributed almost nothing to this run:

| Files read | What that repository is |
|---|---|
| 1 | A written playbook, mostly Markdown |
| 4 | A small environment-reproduction example |
| 5 | A GitHub Actions deployment example |
| 9 | A Compose interpolation example |
| 9 | A second Compose example |

Those five hold 28 files read between them, out of 15,532. They are not evidence
of anything. Any headline number computed across all 50 is, for practical purposes,
a number computed across 45.

This is the part a single "50 repositories scanned" claim would hide completely.

## The three honest statements a report can make

The runs in this set make all three, every time:

1. **What was read.** A count, plus the median, so the shape of the coverage is
   visible rather than implied.
2. **What was not read.** A named list. In this set, 1,339 entries, including
   every file over 100KB, every binary file, every vendored tree, and every
   directory over the read cap.
3. **Why the result is not a pass.** Printed in the coverage note itself, not only
   in a footnote: a partial result is not a pass.

The third one is the load-bearing sentence. A partial result presented as a
finding is worse than no result, because it converts an honest limit into a false
claim.

## Where the disclosure itself is weak

Three places, all found by reading the output rather than trusting it:

- **The always-line-1 problem.** A tracked environment file finding reports the
  file and line 1, whatever actually tripped it. A reader who opens line 1 sees a
  comment, not the assignment. In this set, every one of these findings needed a
  separate pass over every key in the file to clear or confirm.
- **The path that does not exist.** A license finding reported its location as
  `(repo)` on line 1 in 13 rows. There is no such file to open.
- **A skip count that is not a list.** One scan in an earlier wave reported 5 skips
  and then listed 8. The count and the list disagreed, and the count was the one a
  reader would quote.

A disclosure is only worth something if a reader can act on it without redoing the
work. All three of these force the reader to redo the work.

## What this draft does not claim

- It does not claim these repositories are unsafe. A partial result is not a
  finding.
- It does not claim the coverage was good enough. 8.6% skipped and five
  near-empty repositories say otherwise.
- It names no repository and no file.
