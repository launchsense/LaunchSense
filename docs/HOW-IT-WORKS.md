# How a scan works

## What you can scan

Public GitHub repos only. If your repo is private, we cannot read it and there is nothing to check yet.

Two useful moments:

- Your repo is already public and you want to know what a visitor will find. Scan it.
- Your repo is about to become public. Flip it, scan it, fix what shows up, and only then share the link. Public means every future reader can see it, including anything already committed.

Private repos are out of scope for now. Local tools such as MCP can read them, but that is not built here.

## The first minute

1. Paste a repo link and press Run scan. Nothing else is needed. There is a "Try this repo" button if you have no repo of your own to hand.
2. To check your live app too, press "Also check my live app" and add the URL.
3. Copy the top 3 prompt into your coding helper.
4. Fix what it says, push a commit, then press Re-scan. That comparison is the part worth showing: fixed, still broken, new, back again, unknown.

## The steps

1. You paste your repo link plus your live app URL.
2. We read the repo file list and pin the latest commit. Everything after this points at that one commit.
3. We fetch up to 200 files, up to 2 MB in total.
4. We fetch the served live page HTML.
5. Fixed checks run: secrets, risky patterns, dependencies, licenses, and hygiene.
6. You get one fix prompt for the top 3, then the rest of the list.
7. Repo DNA, Share Readiness, standards lines, missions, and the handoff text are computed from the same read.

## What runs and what does not

The checks are fixed code, so the same input always gives the same findings. Explanations in plain words are written separately, by an AI provider when one is configured. AI only rewrites findings in plainer language. It never decides what is a finding, and its output is thrown away if it references anything we did not check.

## After you fix things

Run a re-scan. We pin the new commit, run the same checks, and compare. Every finding lands in one of five states: fixed, still broken, new, back again, or unknown. Unknown means we did not read that file this time, so no conclusion is drawn. Unknown never becomes fixed.

If the checker itself changes between your two scans, old findings become unknown instead of fixed. That is deliberate: a different checker cannot honestly claim your bug is gone.

## How much it costs, and what we tell you

One scan makes about four requests to GitHub: repository metadata, the latest commit, the file list, and one repository archive. The archive holds the file contents, so we read them from there instead of asking for each file separately.

Per-file metadata (path, size, hash) is cached for 24 hours per commit and deleted after that. File contents are never cached.

We show the remaining GitHub quota and the reset time on the scan page, and we count how many more scans that allows. When scans arrive faster than the slots available, they queue and you are told your place rather than everyone failing at once.

## Re-scanning

A re-scan of the same commit still reads the repository again. It costs a few GitHub requests, and it returns the same result, because every check is fixed code.

Plain words used in the app:

- Partial means some work was skipped. A partial result is never a pass.
- Evidence means the proof behind a finding: file, line, and a redacted snippet.
- Fingerprint means the stable ID of a finding. It stays the same when lines shift.
- Quota means the shared GitHub request budget. When it runs out, scans pause and show a retry time.