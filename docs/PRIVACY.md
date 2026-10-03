# Privacy

## What leaves your machine

Only the repo URL you paste. Nothing on your machine is read.

## What we save

- Repo owner and name, commit SHA, and file paths.
- Finding records: rule, file, line, and a redacted snippet, capped at 200 characters.
- Per file: its path, size, and a content hash. Nothing more.
- Scan results, so a re-scan of the same commit can be compared against the last one.

## What we never save

- **File contents, in any form.** We read them in memory during a scan and keep only the numbers above. There is no copy of your code in our database.
- Raw secret values. Every snippet passes through redaction before it is written, and the redaction runs before the value can reach storage.
- Anything from your machine outside the pasted URL.

## How long we keep things

- Cached file metadata: deleted 24 hours after it was written, by a later scan of that repository.
- Findings and evidence: kept so a re-scan can tell you what you fixed. There is no automatic deletion today.
- Quota counters: a single row, overwritten.

## A note on deleted schemas

Convex does not drop fields from records that already exist. When we removed the file-content column, every row written before that change still carried a copy of the file text. We deleted all 164 of those rows before this deployment, and verified that none remain. If we ever remove a field like that again, the same deletion runs before the change ships.

## Who fetches the code

Our server fetches public repo data from GitHub, either as a file list or as one repository archive. Your browser only sends the URL and shows the results.

## Analytics volume

First-party analytics writes are limited by event kind and day, so this public endpoint cannot write an unbounded stream of rows.

## Live URL checks

If you give a live app URL, our server makes a plain HTTP request to that address and reads the returned HTML. It refuses to contact loopback, private, link-local, or cloud metadata addresses, including hostnames that resolve to one. It follows up to three redirects and re-checks every hop.