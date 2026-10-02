# How to read your report

The page has four tabs after the report. Read the report first, then the tabs if you want depth.

## Start at the top

One prompt for the top 3 comes first, with a copy button. Those three are ranked across your code and your live app together, secrets ahead of everything else. Below it the rest of the list stays visible, ordered, with every step spelled out.

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

## Plain words explanations

The Explain in plain words button rewrites each finding in one or two short sentences. It runs through an AI provider when one is configured, and falls back to plain fixed wording when none is. AI never decides what is a finding. If the output references something we did not check, it is thrown away and the fixed wording is shown instead.

## The four tabs

**Repo DNA.** The shape of your project: folders, languages, entry points, what exists and what does not. Judge Readiness sits here as a signal from the files we could read, with evidence coverage shown as a percentage. It is not a certification.

**Standards.** One honest line per OWASP ASVS 5.0.0 requirement we can partially map. Every line carries coverage, status, evidence count, and a caveat. Nothing claims full coverage we cannot prove.

**Missions.** Seven steps in a fixed order, one active at a time. Completion is verified from the scan, never self declared. Achievements are marked earned only when the data proves it. No points, no leaderboard.

**Handoff.** Plain text you can copy or share, for a developer friend who has no coding agent. It lists the ordered steps, the items to confirm closed, and the not checked list.

## After you fix things

Run a new scan on the new commit. The rescan compare puts both commits side by side and sorts every finding into one of five groups:

- Fixed: the problem is gone in the new commit.
- Still broken: it is still there.
- New: it appeared since the last scan.
- Back again: it was fixed once and has returned.
- Unknown (not rechecked): the new scan did not cover it, so no conclusion is drawn.

Each line also shows why it changed: the code changed, the advisory data changed, or the checker itself changed. You can mark a finding as accepted risk to keep it visible without treating it as a problem to fix. Both commit numbers are shown, so you always know which two scans are being compared. If you rescan without new commits, the report is unchanged.