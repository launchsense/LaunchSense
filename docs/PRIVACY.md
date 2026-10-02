# Privacy

## What leaves your machine

Only the repo URL you paste. Nothing on your machine is read.

## What we save

- Repo owner and name, commit SHA, and file paths.
- Finding records: rule, file, line, and a redacted snippet.
- File contents, with secret patterns already replaced, kept for 24 hours. Old copies are deleted when a later scan runs, not merely ignored.

## What we never save

- Raw secret values. Both the snippet and the cached file text pass through redaction before anything is written.
- Raw file text. We analyze it in memory, then store only the redacted version.
- Anything from your machine outside the pasted URL.

## Who fetches the code

Our server fetches public repo data from GitHub. Your browser only sends the URL and shows the results.
