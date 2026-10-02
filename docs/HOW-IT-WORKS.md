# How a scan works

1. You paste a public GitHub repo link.
2. We read the repo file list and pin the latest commit.
3. We fetch up to 200 files, up to 2 MB in total.
4. Fixed checks run: secrets, risky patterns, dependencies, licenses, and hygiene.
5. You get a Fix Before You Share list, ordered with secrets first.
6. Items marked info need no action. The rest need review before sharing.

Plain words used in the app:

- Partial means some work was skipped. A partial result is never a pass.
- Evidence means the proof behind a finding: file, line, and a redacted snippet.
- Fingerprint means the stable ID of a finding. It stays the same when lines shift.
- Quota means the shared GitHub request budget. When it runs out, scans pause and show a retry time.
