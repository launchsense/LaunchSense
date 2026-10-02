# How a scan works

## What you can scan

Public GitHub repos only. If your repo is private, we cannot read it and there is nothing to check yet.

Two useful moments:

- Your repo is already public and you want to know what a visitor will find. Scan it.
- Your repo is about to become public. Flip it, scan it, fix what shows up, and only then share the link. Public means every future reader can see it, including anything already committed.

Private repos are out of scope for now. Local tools such as MCP can read them, but that is not built here.

## The steps

1. You paste your repo link plus your live app URL.
2. We read the repo file list and pin the latest commit.
3. We fetch up to 200 files, up to 2 MB in total.
4. We fetch the served live page HTML.
5. Fixed checks run: secrets, risky patterns, dependencies, licenses, and hygiene.
6. You get one fix prompt for the top 3, then the rest of the list.

Plain words used in the app:

- Partial means some work was skipped. A partial result is never a pass.
- Evidence means the proof behind a finding: file, line, and a redacted snippet.
- Fingerprint means the stable ID of a finding. It stays the same when lines shift.
- Quota means the shared GitHub request budget. When it runs out, scans pause and show a retry time.
