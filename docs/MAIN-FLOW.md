# Main flow

The check people keep is the hosted MCP at `https://harmless-chihuahua-667.convex.site/mcp`. The website is the front door. A person sees who it is for, tastes one public read, and goes to Connect. A partial result is not a pass. You do not clone this repo to use the public check.

This page is the code path of the live paste. A browser check of the deployed pages is recorded at the end.

## 1. Open the link

`https://harmless-chihuahua-667.convex.site`

The home page says who it is for, then three lines: you built it, you do not know what to ask, LaunchSense already asks. The sample form is on that page. No account is required for a public repo. Sign in with GitHub is not on this page until a guest read hits its cap.

Other pages on the same site:

- `/why` says who it is for, what the check names, and what it will not say.
- `/how` says taste it here, then keep it in the coding tool, then the caps.
- `/connect` shows the MCP address, the Cursor block, the Claude line, and what that call does and does not do.
- `/blog` lists two posts: `/blog/why-policy` and `/blog/what-the-research-says`.
- `/case-studies` says none are published yet.
- `/s/<id>` is a share link. `/p/<id>` is a passport link. Both are created only after a scan. They use the same menu.

## 2. Paste one GitHub URL

The form asks for a repository URL. A guest paste must be a public `https://github.com/owner/repo` URL. A signed-in paste can be a public repo or one private repo that GitHub account can already read.

Empty input stops on the page. The server rejects a URL that is not GitHub, that carries credentials, or that is not https.

Optional fields on the same form:

- A live site URL. If it is filled, the scan fetches that page after the repo check.
- A main-action phrase. If it is filled, the live check looks for that phrase in the page.

## 3. The server pins one commit

`runScan` does this, in order:

1. Parse `owner` and `repo`.
2. If the same repo is already fetching and a commit is pinned, return that scan. This window is 2 minutes.
3. Create a scan row. A guest row does not carry a GitHub token. A signed-in row uses the token stored for that session.
4. Ask GitHub for the repo. A missing public repo tells a guest to sign in if it is theirs. A signed-in miss says to use an account that can read it. A contents denial says to turn on Contents: Read and sign in again.
5. Read the default branch, then the latest commit on that branch. The scan is pinned to that 40-character SHA.
6. If that same SHA was scanned in the last 24 hours and the tree is still stored, reuse the tree. The new scan row still exists. `cached` is true.
7. Otherwise fetch the recursive git tree for that SHA. Paths are stored. File bodies are not stored in this step.

If GitHub's shared quota is exhausted, the scan is partial and nothing is marked checked. If the tree is larger than the stored path list, the scan is partial and unlisted paths are not checked.

A guest scan spends the shared unsigned GitHub quota. A signed-in scan spends that person's token, and the guest quota number is left as it was.

## 4. The server reads file text

`analyzeScan` runs next. If many scans arrive at once, this one waits for a slot. The page says the place in line and keeps the same scan id. Resuming calls `analyzeScan` again. It does not start a second scan.

Then:

1. Skip generated and vendor paths the guest scan already skips.
2. Sort what remains so manifests and license files are first, then `src/` and `convex/`.
3. Keep at most 200 files and about 2MB for a guest. A signed-in scan keeps at most 1,000 files and about 8MB. The download itself stops at 20MB.
4. Download one archive of that commit. If the archive fails, fall back to per-file reads.
5. A file over 100KB is skipped, except a lockfile, which has its own larger ceiling.
6. Anything not read is a skip with a reason. Findings cover fetched files only.

The checks then run on the text that was fetched: secrets and code shapes, dependency names, license text, repo hygiene, and OSV for up to 50 versioned packages. deps.dev is not queried on this paste. An allowed license is not turned into a finding. Unknown stays unknown. An install script is named and is not run.

The coverage line is stored with the result. It counts files analyzed, files skipped, and how many packages OSV checked.

## 5. Order, then the page

The priority table always orders the findings. Credential-shaped rows come first, then severity, then a stable fingerprint. The decision API may reorder inside one severity band. It sends titles, severity, rule id, and fingerprint only. If it does not answer, the table order stands. The model does not add a finding and does not remove one.

The page then shows:

- The coverage line and the not-checked list, in the same view as the answer.
- One lead and up to two more prompts. Each prompt says where, what is wrong, and what to change.
- The rest of the fix list, without repeating those prompts.
- The findings, with path and line.

A partial status stays partial. Skipped files do not become a pass.

## 6. What the person can do next

- Copy one finding, or copy a prompt.
- If a live URL was pasted, read the live checks: https, whether the fetch reached a page, a non-blank body, the main-action phrase, and a viewport meta tag. That fetch does not prove how the page looks.
- Create a share link (`/s/<id>`) or a passport link (`/p/<id>`). The link does not expire. It cannot be taken back. It does not contain file bodies.
- Rescan the same repo. If the commit SHA is unchanged, the page says so. If it changed, a compare is offered against the previous scan.

Sign-out deletes the GitHub token used for a signed-in read. The token is not kept on the user row.

## Hosted MCP, same public read

Connect shows `https://harmless-chihuahua-667.convex.site/mcp`. Home links there. Home does not repeat the address.

The coding tool sends one JSON-RPC message to that address. `launchsense_scan_public` takes a public GitHub URL and runs the same read as the paste: pin the commit, respect the guest caps, then return the coverage line and the findings. `launchsense_get_report` reads a report by scan id. Two scans an hour from one caller, and eight an hour in total, then the route pauses. Alpha has no login. A private repo stays on the signed-in paste. This address does not read a repo that exists only on a laptop.

## Walk after deploy

Checked `https://harmless-chihuahua-667.convex.site` after the production deploy of `22a5c2b`. That build still had the long home page. The heading in that script was "LaunchSense checks the codebase, not the business."

The source after that walk is the short site in the sections above. The live site matches this document only after this commit is pushed and then deployed. A full guest paste was not run in the `22a5c2b` check, so this note does not claim a new scan result.
