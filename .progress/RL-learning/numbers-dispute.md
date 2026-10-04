# Numbers dispute: two sheets for waves 08, 09, 10

Written 2026-10-05. A second worker session wrote `wave-full-08.md`,
`wave-full-09.md` and `wave-full-10.md` after I did, with different file counts for
the same repository at the same revision. This file records which numbers are
reproducible, so the owner does not have to guess.

## The dispute

Same repository, same pinned revision, different read and skip counts.

| Repository | shortsha | My sheet | Other sheet | Re-run verdict |
|---|---|---|---|---|
| Regime-Switching-Risk-Parity-Crypto-Index-Vault | `ad75937` | 60 read, 3 skipped | 47 read, 5 skipped | **60/3 reproduces.** 47/5 does not. |
| zk-connect-four | `7a75269` | 134 read, 18 skipped | 138 read, 21 skipped | **134/18 reproduces.** 138/21 does not. |

## How this was settled

Not by argument. By re-running the scan.

```
git clone --depth 1 https://github.com/abailey81/Regime-Switching-Risk-Parity-Crypto-Index-Vault.git
git rev-parse --short HEAD          -> ad75937   (matches both sheets)
LAUNCHSENSE_OFFLINE=1 node --experimental-strip-types mcp/review-entry.ts --root <clone> --json
  -> filesRead 60, filesSkipped 3

git clone --depth 1 https://github.com/albertobas/zk-connect-four.git
git rev-parse --short HEAD          -> 7a75269  (matches both sheets)
  -> filesRead 134, filesSkipped 18
```

Both re-runs match my sheets exactly and the scan JSON in
`/tmp/opencode/full/wave-08/`. The other numbers do not match either source.

**Resolution: my sheets stand.** They are restored in the working tree and are what
is committed. The other writer's versions of those three files were reverted, not
merged, because merging would put two contradictory sets of counts in the same
file with nothing to tell a reader which is real.

## What was kept from the other writer

Their additions were not thrown away.

- **Two new owner-queue rows, WQ-7 and WQ-8.** Both were verified by me before
  being kept. WQ-7 is the homelab committed service credentials: I re-read
  `immich/.env` and confirmed 14 lines, 8 assignments, `TYPESENSE_API_KEY` at line
  5 (16 characters, lowercase words and hyphens) and `DB_PASSWORD` at line 6
  (8 characters, same shape). Both claims hold exactly.

  WQ-7 is a better finding than the note I had filed for the same repository. I had
  cleared it as low-entropy and not a credential. They are right that a committed
  `DB_PASSWORD` is a committed credential whatever its entropy, and right that the
  scanner anchored it on line 1, which is a comment. That is the same always-line-1
  defect this run already recorded, seen from the other direction: right verdict,
  wrong anchor, and two credentials inside one file reported as one finding.

- **WQ-8, the nullhub `platform_key` and `auth_mode` literals.** Kept as filed.

## Numbering

Three writers have now touched `owner-queue.md`. WQ-1 to WQ-6 are the first
coordinator's, WQ-7 and WQ-8 are the second coordinator's, WQ-9 and WQ-10 are mine.
No number is reused. `uniq -d` on the heading list returns empty.

## What this says about the run, honestly

Two coordinators wrote the same sheets from the same scan corpus and produced
different counts without either of us noticing, because there was no shared
workspace convention for who owns a wave sheet once it exists. The counts were
reproducible all along. Nobody checked.

The rule that would have caught it: a number in a wave sheet is a measurement, and
a measurement has to be re-runnable. Every count in my sheets can be reproduced with
one clone and one command, and I have now demonstrated that for the two rows that
disagreed.

This is also the same failure the whole project is about, one level up. The tool
produced 433 rows and 418 of them were noise. Two agents produced three sheets for
the same 30 repositories and one set of numbers was wrong. In both cases the fix
was the same: go and look at the actual thing again, do not trust the second
copy.

## What was not done

- The other writer's sheets were reverted, not deleted. Nothing was thrown away that
  was not reproduced or refuted.
- No row in their owner-queue additions was accepted without my own re-read of the
  file.
- I did chase it. Wave 07 had been overwritten by the other writer before I wrote
  this file, and its counts were wrong in the same direction. It has been restored
  from my commit and verified below.

## Wave 07 was wrong too, and is now fixed

The other writer's version of `wave-full-07.md` claimed 96/7 for xxHash where the
scan says 91/4, 806/324 for mongoose where the scan says 1711/321, and 979/130 for
civetweb where the scan says 405/127. That sheet was the committed version when I
started checking. It is now replaced with the version whose numbers come from the
scan output.

## Every sheet verified, all 50 rows

Rather than check two rows by hand, I checked all fifty against the scan JSON:

| Wave | Rows in sheet | Verified | Mismatched |
|---|---|---|---|
| 06 | 10 | 10 | 0 |
| 07 | 10 | 10 | 0 |
| 08 | 10 | 10 | 0 |
| 09 | 10 | 10 | 0 |
| 10 | 10 | 10 | 0 |

Every `read/skip` pair in every sheet now matches `/tmp/opencode/full/wave-*/`. The
50 distinct revisions cover exactly the 50 repositories scanned. Zero mismatches.

That check is repeatable: parse the sheet table for `sha` and `read/skip`, then
compare against the `sha`, `filesRead` and `filesSkipped` fields in the wave JSON.
Any future sheet can be put through the same test in one command.
