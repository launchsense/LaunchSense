# Feature board

This file is the list. When you name a feature in chat, it gets a row here.

GitHub issues and pull requests are for building. They are not the idea list. A pull request is the code. An issue can open when a row moves to building.

A row moves in this order:

- noted: you named it
- agreed: we decided to build it
- building: code is in progress
- done: it runs

Nothing on this page runs until its row says done.

## Board

### 24/7 public-repo learner

- Status: noted
- Named: 2026-10-04

A bot keeps running and checks public repos of one chosen size. The size to start from is the guest cap that already exists: 200 files and about 2MB. The repos are vibe-coded apps, so the trail is about that kind of code.

Each run writes a note in a private repo we control. The note is the bugs, the issues, and what the check missed or got wrong. We use that private trail to change LaunchSense. The notes are not a public report.

A first manual pass ran on 2026-10-04. Five public repos were reviewed locally, offline. That pass is a written trail a person can use to tighten a check. It is not this bot, and a model does not train on it.

What it does not do:

- It does not run today.
- It does not store raw file contents or raw secret values.
- A model does not invent a finding, and it does not add a check by itself. The checks stay fixed until a person changes them from the trail.
- It cannot honestly scan all day on the shared GitHub quota. A later row has to say whose quota it spends before the bot is allowed to run.

### Outreach bot

- Status: noted
- Named: 2026-10-04

After the public-repo learner has a real finding, a second bot prepares one report and one reach-out. The report is ours: what was read, what was not checked, and the fixed findings. A partial result is not a pass. The note says who LaunchSense is, why we wrote, and why the MCP review is the tool that fits that repo.

The channel follows the repo, in this order:

1. Read `CONTRIBUTING.md`, the security policy, and any "do not contact" line. If those say not to write, the bot stops.
2. Where a public GitHub comment is allowed, one comment on an existing issue or discussion. No new spam thread. No secrets, no exploit steps, no demand.
3. Where email is the published contact, one email to that address. The same identification and the same short pitch.
4. If the repo names a maintainer and a public social contact, the bot may read that page and draft a note. It still says who is writing.

What it does not do:

- It does not run today.
- It does not send email, post a comment, or open a pull request.
- It does not hide that the sender is LaunchSense.
- It does not write to a repo that asks not to be contacted.
- It does not attach file contents, secret values, or a private report link that exposes the code.
- A model may draft the words. A person approves the first batch before anything is sent. After that, the bot may repeat only the approved shape.

### Signed-in scan

- Status: done
- Named: 2026-10-04

GitHub sign-in is optional before a scan, and it is offered again when a guest limit is hit. A signed-in scan reads the pasted public repo further, and it can read one private repo the person can already read. The read uses their GitHub token for one archive download. The guest paste stays on the shared quota, 200 files, and about 2MB. Signed in, the cap is 1,000 files and about 8MB. The download stops at 20MB.

The report card names Cursor, Codex, or Claude when the repo shows that tool. It does not offer a connection. The hosted MCP address is on the Connect page.

What it does not do:

- It does not store raw file contents.
- It does not keep the GitHub token after sign-out.
- It does not read past 1,000 files or about 8MB.

### Hosted MCP

- Status: done
- Named: 2026-10-04

The Connect page shows `https://harmless-chihuahua-667.convex.site/mcp`. A coding tool adds that address. It does not clone this repo. `launchsense_scan_public` reads one public GitHub repo on our server, with the same caps as the paste. `launchsense_get_report` reads a report by scan id. Alpha has no login.

What it does not do:

- It does not read a repo that exists only on a laptop.
- It does not ask deps.dev. OSV still stops at 50 packages.
- Two scans an hour from one caller, and eight an hour in total, then the route pauses.
- It does not store raw file contents or raw secret values.
- A model does not add a finding. It may only reorder inside one severity band.

A checkout of this repository can still run a local review on files already on disk. That local review is not the public connection.

### Policy text on files we already read

- Status: done
- Named: 2026-10-04

License family names and source-available names are read from text the review already has. An OR expression stays a choice. Unknown stays unknown. A model may quote a next look. That quote is not a finding. This is not a full SPDX grammar.

### Lockfile inventory and transitive advisories

- Status: done
- Named: 2026-10-04

The alpha review lists direct and transitive npm packages from the lockfile. It asks OSV about up to 50 of those exact versions and lists how many were not queried. A missing lockfile stays incomplete. Install scripts are named and not run. A deprecated flag and a publish date come from deps.dev. Archived status stays unknown. The website OSV path still stops at 50 targets.

### Registry facts

- Status: done
- Named: 2026-10-04

When the review is online it asks deps.dev, then ClearlyDefined if that is empty. Scorecard is a dated fact when a GitHub repo is named. Offline, those stay not checked. Not a score, and not a legal source.

### Repeated functions and dead copies

- Status: done
- Named: 2026-10-04

The alpha review reports repeated 12-line function text, a generated marker on a large file, and duplicate files. Dynamic import stays unknown. This is not a quality score.

### Deep local reads

- Status: done
- Named: 2026-10-04

The alpha review can name a vendored tree it did not read, a host it did not contact, a lockfile SBOM with omissions, and a model or dataset card. ScanCode is not included.

### Relationship questions

- Status: noted
- Named: 2026-10-04
- Launch: later

A visible link between the project and a package it ships, shown as a question the owner can dismiss. A shared name is not a finding. Corporate commit emails stay in this row.

### More code patterns

- Status: done
- Named: 2026-10-04

New findings use code.* ids. Old secret.* ids still score. Added innerHTML, child_process exec, weak crypto, and a CORS wildcard. SQL stays a shape, not a proved injection.
