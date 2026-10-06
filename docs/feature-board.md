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
- The hosted read keeps 200 scans an hour for the shared hosted bucket, and 600 in total across the hosted lane, then the route pauses. The counter holds no part of your network address.
- It does not store raw file contents or raw secret values.
- A model does not add a finding. It may only reorder inside one severity band.

A checkout of this repository can still run a local review on files already on disk. That local review is not the public connection.

### Policy text on files we already read

- Status: done
- Named: 2026-10-04

License family names and source-available names are read from text the review already has. An OR expression stays a choice. Unknown stays unknown. A model may quote a next look. That quote is not a finding. This is not a full SPDX grammar.

### The licence declaration

- Status: done for npm. Named: 2026-10-06.

For a project that commits an npm `package-lock.json`, every installed package, direct and transitive, is read for the licence it declares. The lockfile is the declaration being read, so the hosted path adds no request and no egress. The installed `package.json` is the fallback where the lockfile is silent, and a disagreement between the two reads as Unknown.

A small cited table turns each SPDX family into what its licence text asks for: licence text, copyright notice, a NOTICE file where the licence has one, state of changes, source disclosure for copyleft, and the distribution clash for strong copyleft. It is not a legal engine and says so in the artifact it writes.

`npm run notices` generates the third-party notice file from the committed lockfile. The same lockfile produces byte-identical output. The local review carries the same text.

One row per dependency whose terms need a person, capped at 25 with the remainder stated, plus one informational row whose fingerprint is the licence mix, so a change between two permissive licences is still visible. An Unknown licence produces no row and no severity. On a rescan a changed dependency licence is reported as a licence change, not a code change.

Not built: other ecosystems, vendored trees as an obligation source, per-file SPDX headers, registry freshness, and the AI lookup lane. The lookup hook exists and is refused unless a lane is supplied.

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

### Concepts node (code name `concepts`)

- Status: noted
- Named: 2026-10-04
- Launch: later

The harness a coding tool already runs can manage sub-agents, red team a change, and blue team a change. The MCP review today cannot reach that power. It reads the working tree, runs the shared checks, orders the findings, and returns a lead. A concepts node is the data and structure flow that would let it reach the harness instead of only reporting beside it.

The code name is `concepts`. It is an internal handle for one node. It is not a user-facing word, not a menu item, and not a brand.

What the node holds is concepts, not file text. Each concept carries a name, what it describes, the harness capability it maps to, when it is worth calling, the evidence it needs, and what it must never do. The edges let a concept start a sub-agent run, a red team pass, or a blue team pass, and let the result fold back into the same findings table the report already builds.

The role of AI is that a user never has to learn a new command. The flow decides for itself when a concept is the better path than the plain report, calls it, and folds the result back. The report then says what ran. It is never silent.

This row is shared with the owner first. The owner reads it. Only then does the status move to agreed, and only then does any code move.

What it does not do:

- It does not run today. Nothing on this row is built.
- It does not ask the user to know it exists, and it never hides what it ran.
- It does not edit the repository.
- It does not send file text to Convex or anywhere else. Concepts stay on the machine.
- It does not add a finding and it does not drop one. A concept result folds into the fixed checks and the fixed table order.
- It does not turn unknown into a pass, and it is never a clearance.
- A model does not add a check by itself. If it keeps naming the same check, a person may later turn it into one.

### Giving the bots a computer (AWS Lambda, Cloudflare Workers, the Grok CLI tool, or Grok Bot)

- Status: noted
- Named: 2026-10-04
- Launch: later

The two bot rows above both stop at the same wall. The 24/7 public-repo learner cannot scan all day on the shared GitHub quota, and the outreach bot has no way to read a repo properly before it writes. Neither bot has a machine. A bot cannot fetch an archive, unpack it, and run the checks without somewhere to run that code. This row is that somewhere. It attaches to both bot rows, so the same compute serves the learner and the outreach bot.

Four candidates, named so the choice is visible. Nothing is built. The owner's direction is a dedicated Grok Bot, written under that heading below. Two candidates are compute we would run ourselves. Two are a product somebody signs into. That difference matters and is written out below.

AWS Lambda. It can run the same Node analyzers the website uses, unpack an archive into its own temporary disk, and finish inside one invocation. Current published limits are 10,240 MB of memory and a 900 second timeout. Published price is $0.0000166667 per GB-second and $0.20 per 1M requests, with a free tier of 1M requests and 400,000 GB-seconds a month. This is the only one of the four we have read a price for, so it is the honest starting point.

Cloudflare Workers. Cheaper and always on, but it is a short request, not a batch job. The reported memory figure is 128MB per isolate, and paid CPU time can be raised from a short default up to 5 minutes. Whether a repo archive fits inside that memory is not measured by us, so it stays unknown. Unknown stays unknown until someone runs one archive through it.

The Grok CLI tool. Already installed on this machine. It is a real tool with its own agent loop, not an API call we write. It could do the thinking half of a review, the part that reads a finding and asks what the author missed. What it is not: it is not a scheduler, it is not 24/7, and it runs on one machine that has to be awake. It cannot be the answer to "run all day". It may be a good answer to "read one repo carefully and write the note". Which of those two it is has to be decided by a person, not assumed here.

Grok Bot. A separate xAI product, and not the same thing as the Grok CLI tool above. Per xAI's own pages it launched in beta on 2026-08-11. Each Bot has a computer of its own in the cloud, signs into tools the way a person does, and keeps working 24/7 after the laptop is closed. Bots can run in parallel, message each other, and learn a workflow after watching it once. This is the closest published answer to the wall this row describes, so it is named here on purpose.

Where it does not fit our shape. Grok Bot is a product a person subscribes to and messages, not compute our code calls. There is no documented way for LaunchSense to hand it a repo and get a finding back on a schedule. So it could be the machine that runs the 24/7 learner as a supervised human-in-the-loop job, while it can never become part of the scanner itself. The checks stay in our code. Someone still has to start each run and read each note.

Access today is through Cursor Pro, Pro+, and Ultra, SuperGrok tiers, Cursor Teams, or Enterprise. Published tiers are $20 a month on Cursor Pro, $30 a month on SuperGrok, and $40 a seat a month on Cursor Teams Standard. Weekly usage is included and extra usage is billed by token cost. We have not used it and we have not measured a run, so this row claims no cost per scan.

The owner's direction. There will be a dedicated Grok Bot for this work, separate from anything else it is used for. One Bot, kept for the learner and the outreach bot, so their runs do not share a session with unrelated work. That is a decision the owner has made, not a thing that runs today.

One boundary matters more than the price. A Bot signs into real accounts and works in a shared cloud machine. Every Grok Bot on one account shares that computer, files, browser, and logins, and isolation is per user rather than per Bot. A dedicated Bot makes our own runs easier to keep apart from each other. It does not make them private, because the machine and the session are still not ours. A repository we are reviewing would sit on that cloud machine. The owner knows this and chose it.

On Grok for starting and for scale. Using the Grok CLI tool to start a review is cheap and quick, because the tool is already on the machine. Using it for scale is a different question. A machine that is awake runs one pass at a time. More passes means paid compute somewhere, and the price is per token, not per machine. This row does not claim a number for a scaled bot run, because we have not run one.

A worker is compute only. It does not add a finding and it does not drop one. The fixed checks and the fixed table order stay the same, whether the code runs on a laptop, in Lambda, in a Worker, or under a Bot that a person is watching. If a worker cannot read a file, that file is listed as not checked. A worker never turns a skip into a pass.

What it does not do:

- It does not run today. Nothing on this row is built, and no worker is started.
- It is not finished being decided. The owner has chosen a dedicated Grok Bot. The other three are still on the board as the fallback if that one does not work.
- It does not raise the guest scan cap of 200 files and about 2MB. A worker does not become a way around the quota. Whose quota a worker spends is a separate question that has to be answered before any worker runs.
- It does not send raw file contents or raw secret values out of the machine. The redaction and hashing rules are the same rules the website uses, and a worker does not get a looser version of them.
- It does not edit a repository and it does not open a pull request.
- It does not turn unknown into a pass, and it never upgrades a partial result into a clearance.
- The repository sits on that Bot's cloud machine, not on ours. The owner chose that. The checks still run on LaunchSense code, not on the Bot.
- A model working inside a worker does not add a check by itself. If it keeps naming the same check, a person may later turn it into one.

### Guided ask: licence and stack advice

- Status: noted
- Named: 2026-10-06

Vibe coders do not know what to ask. A blank box fails them. After a scan, the product asks the next question itself, based on what it just read: which licence fits this repo, and whether the stack is fit to ship.

Licence advice reads the detected facts: the licence the repo declares, the licences the lockfile packages declare, whether copyleft appears, and whether the repo looks commercial. It recommends one licence type and says why, one line per fact. It is a suggestion, not legal advice, the same way an Unknown licence suggestion is a suggestion and never a finding.

Stack advice reads the manifests: unpinned versions, known CVEs with fix versions, end of life runtimes, a missing lockfile, a missing CI workflow. It says what is fit and what is not, as a checklist, not a score.

The questions come from the decision lane, not free chat. The model answers closed questions with fixed options, and deterministic code maps the answers to the recommendation. A model never decides a finding, and it never decides the advice either. If the model does not answer, the page shows the checklist without the recommendation rather than guessing.

What it does not do:

- It does not run today.
- It never gives legal advice. The licence line stays a suggestion with its reasons attached.
- It never invents a check. New stack facts arrive as analyzer rows first, and advice only reads them.
- It never asks for anything the scan did not read. Every question cites the row behind it.
- It never sends anything anywhere. Answers stay on the page unless the visitor shares the report.

### Policies built with you (the full-service stack)

- Status: noted
- Named: 2026-10-06

The open core stays fixed. A model never decides a finding. What changes for a customer is the policy: the rules they want enforced, in their words.

This is a target market, not a tool feature. A team that vibe-coded an MVP and now faces an enterprise security review does not want a generic scan. They want their own rules: our licences only, these APIs banned, our secrets look like this, every repo must carry a privacy page and a terms page. That is a bespoke policy pack, and it is where a forward-deployed engineer earns money.

The shape of the service. A short engagement, about a week, in which an engineer maps the customer's stack, writes ten to fifteen policies as a declarative pack, runs them across the customer's repos, and hands back the fix prompts. The pack is theirs. It runs on their machine and in their CI through the GitHub Action. Nothing about the core changes to make it work.

What it teaches the product. Every bespoke rule is a candidate template. Once a week of work produces the same rule twice, it becomes a named pack for a vertical, so the tenth fintech customer is not the tenth snowflake. Without that rule, every engagement is custom work and the margin is a services margin, not a product margin.

Where it shows up. UX, UI, and content all carry this: a page that says we will write your policies with you, a pricing line for the sprint, and the copy that explains it in plain words.

What it does not do:

- It does not run today. There is no policy engine, no pack format, and no FDE process yet.
- It does not let a policy execute code. Declarative only: patterns, allowlists, banned calls, required files, size caps.
- It does not let a custom policy invent, drop, or re-rank a finding. A policy tightens or reports; it never decides what is true.
- It does not ship as a template until it passes the corpus precision gates, so a pack cannot lower precision for everyone else.
- It does not change the open core. The core stays one implementation and two doors.
