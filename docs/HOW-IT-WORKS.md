# How a scan works

Use this right before you flip your repo public. That is the moment a leaked key or a bad license becomes real.

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
