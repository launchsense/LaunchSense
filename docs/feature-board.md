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

What it does not do:

- It does not run today.
- It does not store raw file contents or raw secret values.
- A model does not invent a finding, and it does not add a check by itself. The checks stay fixed until a person changes them from the trail.
- It cannot honestly scan all day on the shared GitHub quota. A later row has to say whose quota it spends before the bot is allowed to run.

### Signed-in scan

- Status: done
- Named: 2026-10-04

GitHub sign-in is optional before a scan, and it is offered again when a guest limit is hit. A signed-in scan reads the pasted public repo further, and it can read one private repo the person can already read. The read uses their GitHub token for one archive download. The guest paste stays on the shared quota, 200 files, and about 2MB. Signed in, the cap is 1,000 files and about 8MB. The download stops at 20MB.

The report card names Cursor, Codex, or Claude when the repo shows that tool. It does not offer an install. The local MCP review is a later row.

What it does not do:

- It does not store raw file contents.
- It does not keep the GitHub token after sign-out.
- It does not read past 1,000 files or about 8MB.

### Local MCP review

- Status: agreed
- Named: 2026-10-04

Starts after GitHub sign-in on the website is finished and proven. The coding tool loads our process. That process reads the files already on disk and runs LaunchSense checks and the decision order. It does not call GitHub, and it does not send the repo to the server.

What it does not do yet:

- It does not run. The public MCP route still asks the server to scan GitHub.
- It does not store raw file contents or raw secret values.
- A model does not add a finding. It may only reorder inside one severity band.
