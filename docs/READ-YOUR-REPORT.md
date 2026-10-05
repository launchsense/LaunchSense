# How to read your report

The page has four tabs after the report. Read the report first, then the tabs if you want depth.

## Start at the top

The result box comes first. The headline and the line saying how much was not read are in the same box. A gap is not a pass. The page does not say the app will sell, and it does not say the repo is safe.

Then one lead. That is the item a first check usually misses: a leaked key, a license that needs a person, duplicate or huge files, or the first high finding if none of those are present. Copy that prompt.

Then three short prompts, worst first. Each one says what is wrong, where, and what to change. Copy one into Codex, Cursor, or Claude. Under those three, a line says how the order was chosen. A model may reorder items inside one severity band. It does not choose which findings exist. If it did not answer, the order is severity and credential risk alone.

Below that, the rest of the list stays visible.

## Each finding card shows

- What was seen, in plain words.
- Where: file and line. Never the secret value.
- How bad: high, medium, low, or info.
- What happens if you ignore it.
- A copy button for that finding.

## What needs action

High and medium findings need review before sharing. Low and info findings are advisory only.

Debug output is low. A leftover `debugger` statement is medium, because it freezes the app for anyone who opens it. Only high findings block the share-ready milestone.

## The Not checked box

It is always visible. It lists what was skipped and why, so skipped work never looks finished.

## Plain words explanations

The Explain in plain words button rewrites each finding in one or two short sentences. It runs through an AI provider when one is configured, and falls back to plain fixed wording when none is. AI never decides what is a finding. If the output references something we did not check, it is thrown away and the fixed wording is shown instead.

The rewrite is the whole of the model's part. It never decides a severity, a licence fact, consent, who a caller is, or whether a request is allowed. Its `humanOversightLevel` is `prompt_guided` in C2PA Technical Specification 2.4 terms: you pressed the button and nobody approved the sentence afterwards. Read it anyway. A model writes plausible sentences about code it has not run.

## The four tabs

**Repo DNA.** The shape of your project: folders, languages, entry points, what exists and what does not. Share Readiness sits here as a signal from the files we could read. Two numbers are shown: read coverage, which is how much of the repo was actually opened, and actionable share, which is how many findings need action. It is not a certification.

**Standards.** Honest lines for the checks we can map: an OWASP ASVS 5.0.0 subset, OWASP Top 10:2025, OSV, and three CWE labels. deps.dev and OpenSSF Scorecard stay not-checked. Every line carries version, status, a caveat, and a source. A not-checked line is not a pass.

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