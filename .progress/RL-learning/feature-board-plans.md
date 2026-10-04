# Feature-board plans: every `noted` row, plans only

Written 2026-10-05. Nothing here is code. No row moves past `noted` because this
file exists. The board's own rule applies: the owner reads first, then status moves
to `agreed`, and only then does anything move.

Five `noted` rows: the 24/7 public-repo learner, the outreach bot, relationship
questions, the concepts node, and giving the bots a computer.

Each plan below has four parts: **what it is**, **the seam** (where it attaches to
code that exists today), **the never-list** (what it must never do), and **what the
owner must decide before any code is written**.

One shared observation, because it applies to four of the five:

> The 100-repository run in this folder produced 433 high and medium rows and 52
> survived a person opening the line. Every one of the two bot rows depends on the
> tool being worth listening to. A bot that reports at 12% precision will get a
> maintainer to block it within one contact, and it will deserve to. The precision
> work in `cases/case-1-fifty-repos-counts.md` is therefore upstream of both bots,
> not a parallel concern.

---

## 1. The 24/7 public-repo learner

### What it is

A scheduled job that clones public repositories within a size band, runs the
existing deterministic checks, and writes a private note per run describing what was
read, what was not checked, and which findings did not survive a check.

The board already names the right starting size: the guest cap that exists today,
200 files and about 2MB, at `shared/scanCaps.ts:3-4`.

### The seam

Attaches to the hosted scan path, not the local one, because a hosted runner already
exists and already speaks the same analyzer:

- `convex/scans/actions.ts` `runScan` is the fetch step and already handles quota
  limits, caching, and a truncated tree.
- `convex/scans/analyze.ts` is the analyze step and already produces
  `coverageNote`, `status`, and the not-checked facts.
- The table it needs does not exist. `usageDiagnostics`
  (`convex/schema.ts:195`) holds counts and a source name and is the wrong shape
  for a note.

The seam is one new table holding the note and the pinned revision, and one caller
of the two functions that already work.

### The never-list

Taken from the board row, restated as checks that could fail:

- It never adds a finding and never drops one. The model may reorder inside a
  band, nothing more. That is the existing promise at
  `convex/adapters/decision.ts:9-13` and this job inherits it unchanged.
- It never stores raw file contents or raw secret values. The note holds rule ids,
  paths, counts, and shapes.
- It never calls a finding fixed. A finding is fixed when a rescan says the line is
  gone, not when a model says so.
- It never becomes a training run. The board says a model does not train on the
  trail and that stays true.
- It never runs on the shared GitHub quota without a named quota owner. This is
  stated on the board and it is the blocking item.
- It never sends anything to a third party. Every number stays on our machines.

### What the owner must decide first

1. **Whose GitHub quota.** The board says this blocks the bot. It is right and it
   is the whole question. The shared quota is also what the website paste spends, so
   running a learner on it degrades the product a customer is using.
2. **The size band.** 200 files and 2MB is the current guest cap. Whether the
   learner should run at that band or a wider one is a quota question in disguise.
3. **What makes a repo eligible.** "Vibe-coded apps" is a description, not a test.
   The learner needs a selection rule a person wrote down, or it will drift.
4. **Where the notes land and who reads them.** A private repository the owner
   controls. That is a decision with a lifetime attached to it.
5. **Whether it runs at all before the precision work lands.** Recommendation from
   the measurement, not from taste: no. Running a 12%-precision bot for a week
   produces a week of notes that say the same thing.

---

## 2. The outreach bot

### What it is

After the learner has a real finding, a second bot prepares one report and one
contact, following the channel order the board already sets out: contributing file
and security policy first, then a comment where that is allowed, then published
email, then a drafted note for a person's review.

### The seam

Depends entirely on row 1. There is no finding to write about without it.

The disclosure logic is the real seam and it is small:

- Reading `CONTRIBUTING.md`, `SECURITY.md`, and any "do not contact" line is a file
  read plus a decision, and the decision must be a refusal by default.
- The existing not-checked machinery at `shared/review/buildReport.ts` is the right
  model for what a report says it did not read. The outreach report is the same
  discipline applied to a different audience.

### The never-list

- It never sends anything without a person approving the first batch. The board
  says this and it is the load-bearing rule.
- It never hides that the sender is LaunchSense.
- It never writes to a repo that asks not to be contacted. Refusal is the default
  and an unread policy file is a refusal, not a maybe.
- It never attaches file contents, secret values, or a private report link that
  exposes the code.
- It never opens a new thread where a comment on an existing one is the norm.
- It never states an exploit step. The report describes the shape and the fix.
- After the first approved batch it repeats only the approved shape. A model may
  draft the words; it does not choose the channel.

### What the owner must decide first

1. **Who approves, and what "approved" means.** One named person. A batch of ten
   contacts reviewed together, or one at a time, changes how the bot is built.
2. **The first target.** One repository, chosen by the owner, sent by hand. What is
   learned from that one send is worth more than any amount of design.
3. **Whether this is ever automatic.** The board allows "repeat only the approved
   shape" after a first batch. Whether that is right is an owner call about a
   stranger's inbox, not an engineering one.
4. **What happens when the tool was wrong.** A false positive sent to a maintainer
   costs credibility that a scan cannot buy back. Decide the correction path before
   the first send, not after it.

---

## 3. Relationship questions

### What it is

A visible link between a project and a package it ships, shown as a question the
owner can dismiss. A shared name is not a finding.

### The seam

Smallest plan on the board. It needs:

- The dependency graph the review already builds. `parseManifests` at
  `shared/analyzers/deps.ts` and `inventoryNpmLock` at
  `shared/review/lockfile.ts` already produce direct and transitive packages with a
  depth marker.
- A new finding kind that is a question. `shared/review/buildReport.ts:298` shows
  the shape: a finding whose `why` says what was observed and what was not proven.

The part that matters is that it must be a different kind of row. A question is not
a severity finding. If it lands in the same list with the same severity, a
dismissable item becomes a scary one, and the board's own rule ("a shared name is
not a finding") stops being true in practice.

### The never-list

- It never claims a shared name is a licence problem. The board says this outright.
- It never scores. No severity, no ordering effect beyond its own row.
- It never touches corporate commit emails. The board puts this in the row for a
  reason: author identity is not a licence fact and handling it wrongly is a
  privacy problem, not a precision problem.
- It never becomes a supply-chain verdict. "This project uses a package" is not
  "this project is exposed".
- It never fires on a name collision alone.

### What the owner must decide first

1. **Question, or a separate line in the report.** My read is that mixing it into
   the findings list undermines the board's own wording. The owner decides whether
   it is a finding with a low severity or its own section.
2. **What counts as a relationship.** Same owner on GitHub, same npm scope, same
   licence file, a maintainer email domain. Each is weak evidence on its own.
3. **Whether the commit-email part stays out permanently.** The board says it stays
   in this row, which reads as "not now". Worth making explicit.

---

## 4. The concepts node

### What it is

A structure that lets the review reach a coding tool's own harness, so the harness
can manage sub-agents, red-team a change, and blue-team a change, and fold the
result back into the findings table the report already builds.

The board is careful about the role of AI here: the user never learns a new
command, the flow decides for itself when a concept beats the plain report, and the
report says what ran.

### The seam

The honest answer is that there is no seam yet, and that is the point of the row
being `noted`.

What exists today:

- The findings table and its order, at `shared/review/buildReport.ts` and
  `shared/reports/priority.ts`. This is the only thing a concept result would fold
  back into.
- The never-list is already enforced in code for the decision lane. The tests at
  `tests/decision-lane-checks.mjs` hold that the lane cannot add a finding, cannot
  change a severity, and refuses secret-shaped text before a request is built.

So the property that makes a concept node safe to build later is already tested for
a smaller subsystem. That is worth saying: the safety argument for this row is not
hopeful, it is an existing test suite that a concept flow would have to pass too.

The seam that does not exist: anything that reaches a coding tool's harness. A
hosted deployment cannot call a developer's local harness. Any version of this
feature is therefore local-first by necessity, not by preference.

### The never-list

From the board, restated:

- It never edits the repository.
- It never sends file text to Convex or anywhere else. Concepts stay on the machine.
- It never adds or drops a finding. A concept result folds into the fixed checks
  and the fixed table order.
- It never turns unknown into a pass and is never a clearance.
- It never hides what it ran. If it ran, the report says so.
- A model never adds a check by itself. If it keeps naming the same check, a person
  may later turn it into one.
- `concepts` stays an internal handle. Not a user-facing word, not a menu item,
  not a brand.

### What the owner must decide first

1. **Read the row, then decide.** The board says this row is shared with the owner
   first. Nothing else should happen first.
2. **Local-only, or not at all.** A hosted deployment cannot reach a harness. If
   local-only is unacceptable, this row is not a feature, it is a different product.
3. **What a concept actually is, concretely.** The board describes the fields it
   carries. The owner decides whether that list is right, because it is the schema
   and the schema is the hard part.
4. **Which harness capability goes first.** One. Sub-agents, red team, or blue
   team. Not all three at once.

---

## 5. Giving the bots a computer

### What it is

The machine both bot rows need. A bot cannot fetch an archive, unpack it, and run
the checks with nowhere to run the code. The owner has already chosen: a dedicated
Grok Bot, separate from anything else it is used for, so the learner and the
outreach bot do not share a session with unrelated work.

The board names the other three as fallbacks and is right that the difference
matters: two are compute we run, two are a product a person signs into.

### The seam

The code seam is the smallest of any row on the board, and that is the useful fact:

- The analyzer runs today in `mcp/review-entry.ts`, which takes a `--root` and a
  directory already on disk. That is a directory in, JSON out.
- The walk discloses every skip, `mcp/review-entry.ts:87` onward, so a worker that
  reads less produces a smaller coverage claim rather than a silent one.

So the seam is an archive-unpack step in front of a program that already exists. No
analyzer needs rewriting to run anywhere.

### The never-list

- It does not raise the guest scan cap. A worker is not a way around the quota.
- It never sends raw file contents or raw secret values off the machine. The same
  redaction rules apply, with no looser version for a worker.
- It never edits a repository and never opens a pull request.
- It never turns a skip into a pass, and never upgrades a partial into a clearance.
- It never adds a finding. The fixed checks and the fixed table order stay the same
  wherever the code runs.
- Whose quota a worker spends is a separate question that has to be answered before
  any worker runs. The board says this and it applies here too.
- A model inside a worker never adds a check by itself.

### What the owner must decide first

1. **The boundary the board already accepted, in writing.** A Bot signs into real
   accounts on a shared cloud machine, isolation is per user rather than per Bot,
   and a repository under review sits on that machine. The owner chose this. What
   is still missing is which repositories may go there. That is a data question
   with a concrete answer, and it should be answered before the first run.
2. **Whether the fallback list is still the right fallback.** Lambda and Workers
   are the compute-we-run options. If the Bot path needs a repository to stay on
   our side, the decision is already made and the board could say so.
3. **A schedule.** The board is explicit that a Bot is not a scheduler. Someone
   starts each run. Whether that is acceptable at the volume the learner needs is
   the question.
4. **What it costs per run.** The board claims no number, because none has been
   measured. One measured run would settle it. That measurement is cheap and
   nothing else on this row is.

---

## What all five rows share

**Precision comes first for the two bot rows.** The 100-repository run in this
folder is the measurement, and it says the tool is right about 1 row in 8. The
fix is known, cheap, and already specified in `drafts/draft-3-name-gate-literal.md`
and `drafts/draft-2-value-gate-types.md`. Both are person-gated drafts, not merged.
A bot built before those land will generate the same noise at machine speed.

**One owner decision unblocks two rows.** Whose GitHub quota the learner spends is
asked by the learner row and repeated by the compute row. It is one question with
one answer, and no plan here can start without it.

**The never-lists are the same everywhere.** No finding added, no finding dropped,
no severity changed, no unknown promoted, no secret value stored, nothing sent
off-machine. That is not a set of principles, it is a set of tests, and the tests
for the decision lane already exist at `tests/decision-lane-checks.mjs`. Whatever
gets built on these rows should have to pass those tests too.
