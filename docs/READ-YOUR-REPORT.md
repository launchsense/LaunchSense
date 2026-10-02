# How to read your report

## Start at the top

The Fix Before You Share list comes first. Start with step 1 and work down. Secrets come before everything else.

## Each finding card shows

- What was seen, in plain words.
- Where: file and line. Never the secret value.
- How bad: high, medium, low, or info.
- What happens if you ignore it.
- A copy button for that finding.

## What needs action

High and medium findings need review before sharing. Low and info findings are advisory only.

## The Not checked box

It is always visible. It lists what was skipped and why, so skipped work never looks finished.

## After you fix things

Run a new scan on the new commit. The rescan compare puts both commits side by side and sorts every finding into one of five groups:

- Fixed: the problem is gone in the new commit.
- Still broken: it is still there.
- New: it appeared since the last scan.
- Back again: it was fixed once and has returned.
- Unknown (not rechecked): the new scan did not cover it, so no conclusion is drawn.

Each line also shows why it changed: the code changed, the advisory data changed, or the checker itself changed. You can mark a finding as accepted risk to keep it visible without treating it as a problem to fix. Both commit numbers are shown, so you always know which two scans are being compared. If you rescan without new commits, the report is unchanged.
