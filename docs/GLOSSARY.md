# Words we use

Each word in one plain line.

- Passport: a small proof card for one scan. It shows counts and the commit, never secrets.
- Evidence: the proof behind a finding. File, line, and a redacted snippet.
- Snapshot: the saved result of one scan at one commit.
- Policy: the rule that decides if a finding needs review before sharing.
- Partial: a result where some work was skipped. A partial result is never a pass.
- Fingerprint: the stable ID of a finding. It stays the same when lines shift.
- Quota: the shared GitHub request budget. When it runs out, scans pause and show a retry time.
- Redacted: secret values replaced before anything is saved.
- Fix Before You Share: the ordered checklist built from your findings. Secrets first.
- Not checked: work that was skipped, listed openly so nothing looks finished when it is not.
