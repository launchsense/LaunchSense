# How a scan works

LaunchSense checks the codebase, not the business. It does not say if the app will sell. It looks for problems you have no name for, says what is wrong, and gives a prompt you can paste.

## What you can scan

LaunchSense is for a public repo and a private one.

- Public repo: paste the URL. No account. A guest read stops at 200 files and about 2MB.
- Private repo, or a larger public read: sign in with GitHub. The scan uses your token and stops at 1,000 files and about 8MB.
- MCP: a coding tool review that reads the files on your machine is not running yet.

Two useful moments:

- The repo is already public and you want to know what a visitor will find.
- The repo is still private and you want the same check before you share the link.

## The first minute

1. Paste a repo link and press Run scan. Nothing else is needed. There is a "Try this repo" button if you have no repo of your own to hand.
2. To check your live app too, press "Also check my live app" and add the URL.
3. Copy the top 3 prompt into your coding helper.
4. Fix what it says, push a commit, then press Re-scan. That comparison is the part worth showing: fixed, still broken, new, back again, unknown.

## The steps

1. You paste your repo link plus your live app URL.
2. We read the repo file list and pin the latest commit. Everything after this points at that one commit.
3. A guest scan fetches up to 200 files, up to 2 MB in total. Signed in, the cap is 1,000 files and about 8MB.
4. We fetch the served live page HTML.
5. Fixed checks run: secrets, risky patterns, dependencies, licenses, and hygiene.
6. You get one fix prompt for the top 3, then the rest of the list.
7. Repo DNA, Share Readiness, standards lines, missions, and the handoff text are computed from the same read. A standards line is not-checked when we did not run that check.

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