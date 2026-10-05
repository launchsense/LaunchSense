# Privacy

## What leaves your machine

On the website, only the repo URL you paste. The website does not read your machine.

The hosted MCP reads a public GitHub repo on our server, the same way the paste does. A checkout of this repository can run a local review that reads files on that machine and does not upload them. After you agree, alpha and pro may send how that local review was used: rule id counts, the harness name, the version, how long it took, and which order source ran. That share does not include code, paths, titles, or function names. Enterprise leaves this off. The switch is `diagnostics` in `~/.config/launchsense/config.json`.

## What we save

- Repo owner and name, commit SHA, and file paths.
- Finding records: rule, file, line, and a redacted snippet, capped at 200 characters.
- Per file: its path, size, and a content hash. Nothing more.
- Scan results, so a re-scan of the same commit can be compared against the last one.
- Your GitHub token, when you sign in to read a private repo or more of a public one. See the next section.

## Your GitHub token

The scan uses your GitHub token on our server, and we store it. It is stored as a plaintext string at rest. It is not encrypted. The token is readable only by our server's internal functions. The functions a signed-in user can call return a boolean or nothing, never the token. Signing out from the menu deletes it. The token is not deleted when a session expires on its own, so it stays until you sign out.

## What we never save

- **File contents, in any form.** We read them in memory during a scan and keep only the numbers above. There is no copy of your code in our database.
- Raw secret values. Every snippet passes through redaction before it is written, and the redaction runs before the value can reach storage.
- Anything from your machine outside the pasted URL.

## How long we keep things

- Cached file metadata: deleted 24 hours after it was written, by a later scan of that repository.
- Findings and evidence: kept so a re-scan can tell you what you fixed. There is no automatic deletion today.
- Quota counters: a single row, overwritten.
- Your GitHub token: kept until you sign out from the menu. It is not deleted when the session expires.

## A note on deleted schemas

Convex does not drop fields from records that already exist. When we removed the file-content column, rows written before that change could still carry a copy of the file text. The schema no longer has that column, and the purge that deletes stale file-content rows runs at the start of every analyze. If we ever remove a field like that again, the same purge runs before the change ships.

## Who fetches the code

Our server fetches public repo data from GitHub, either as a file list or as one repository archive. Your browser only sends the URL and shows the results.

## Analytics volume

First-party analytics writes are limited by event kind and day, so this public endpoint cannot write an unbounded stream of rows.

## Live URL checks

If you give a live app URL, our server makes a plain HTTP request to that address and reads the returned HTML. It refuses to contact loopback, private, link-local, or cloud metadata addresses, including hostnames that resolve to one. It follows up to three redirects and re-checks every hop.