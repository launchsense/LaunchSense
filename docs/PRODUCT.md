# LaunchSense, product

The confidence check before you deploy.

You point LaunchSense at the app you built with AI. It tells you what is wrong, in
plain words, with the exact next step for your AI tool. It never edits your code
and never blocks a deploy.

Status: Phase 1, shipped and live at `https://harmless-chihuahua-667.convex.site`.
Source: `https://github.com/launchsense/LaunchSense`.

## The problem

AI made building faster. The checking did not get faster. It stayed manual and
optional, so it is easy to skip.

The same builder now has more code to look at and less time to look at it. Today a
pre-share check is six steps:

1. Build fast with AI.
2. Push to GitHub.
3. Maybe run a linter or a scanner.
4. Get a wall of output you do not understand.
5. Close it.
6. Deploy and hope.

Steps 3 to 5 are where it breaks. The output is real and the reader is not technical,
so the wall of output is the same as no output. Often they check nothing at all.

The moment that matters is narrow and specific: the app works, it has to go live,
and the quiet worry starts. That is when a leaked key, a copyleft licence, or a
missing README stops being a private problem and becomes permanent.

## What is really going on in their head

Why does someone skip the check when the worry is real? Four things are happening
at once. Two of them help us. Two of them fight us, and those two are the ones the
whole product is designed around.

**Working for us: the repo is about to be public.** The moment they share the link,
anyone can reopen every version of it forever. That worry is what brings them to a
checker. We do not have to create it. It is already there.

**Working for us: they already trust their AI tool.** They do not want a security
process. They want the next thing to paste into Cursor or Claude. If we can hand
them one ready instruction, the whole thing works for someone who would never read
a security report.

**Fighting us: the fear cuts both ways.** One fear is "what if it finds something
bad." The bigger fear is "what if it dumps a hundred things on me and I cannot tell
which one matters." A tool that scares someone without giving them a clear next
step gets closed and never reopened. This is why the report opens with one plain
answer and three things to do, and not with a long list.

**Fighting us: the habit.** They have deployed without checking every time, and
nothing bad happened. That habit has been rewarded. Ask them to change it at the
last minute and they will skip you. So we do not ask for an account, we do not ask
for a private repo, and we do not ask them to learn a process. We ask for one paste,
at the exact moment they were already nervous.

What we do about the two that fight us:

| The problem | What the product does |
|---|---|
| A hundred findings they cannot sort | One plain answer, then the three things to fix first, then the rest. Worst things first, not the order we happened to find them. |
| The deploy-and-hope habit | No account, nothing to install, one paste. And the thing they walk away with is the fix prompt, not the report. |

Most of this product exists to beat those last two.

## Who it is for

Vibe coders. Builders who ship fast with AI coding tools and want a second set of
eyes on a public repo before they share the link.

They have no security team and are not going to hire one. On this decision they
trust their AI coding tool, Cursor or Claude or v0, and the builder community
around them. They do not read policies, licences, or security warnings.

## The job, in one sentence

> My app finally works and I am about to share the repo link. I want to know what
> is actually wrong with it, in words I understand, so I can fix the things that
> matter before anyone else can see them.

That is the whole job. The moment is not "I need a security tool." The moment is
"this is about to be public and I am not sure what is in it."

Everything below is checked against that sentence. If a feature does not help a
builder fix the things that matter before someone else sees them, it is not the job.

## What they hire it for

Time, and the confidence they did not ship something embarrassing or dangerous.
Not a trophy. Not a competition.

The core loop is three steps:

1. Paste your repo.
2. Copy one fix prompt.
3. Rescan and see what changed.

## Why we are not trying to be the only tool at this

Plain words and one fix prompt are not our edge. CheckVibe already scans the repo
and the live site, explains findings in plain English, and hands out fix prompts for
Cursor and Claude. GitHub Security is the upstream place for dependency and code
findings. CodeRabbit reviews pull requests.

What we add is the loop nobody else closes. Every scan is pinned to one commit, so
the second scan compares against the first and sorts every finding into **fixed**,
**still broken**, **new**, **back again**, or **unknown**. The builder can see the
fix actually landed and work through the rest one step at a time.

We are not trying to be the only tool at this. We are trying to make the
before-you-share step one people actually finish.

## Why not just a skill in your coding agent

Because a skill can already do most of the checking. It can read the repo, run
patterns, fetch a public repo, and write a fix prompt. We are not claiming to
analyse better.

Where a skill genuinely falls short:

- **Nobody runs it at the right moment.** A skill fires when you open a chat. The
  moment that matters is the deadline, usually alone, late.
- **No memory between people or sessions.** The fix and re-check loop needs the old
  findings, your accepted-risk decisions, and the previous coverage to survive.
- **No shareable artifact.** The result has to become a link a reviewer or client can
  open on a phone. Chat text is not that.
- **No honest coverage accounting.** Counting what was read and marking the rest
  unknown needs a fixed checker version and a shared store.
- **The policy bookkeeping rots.** Mapping evidence to OWASP ASVS requirements with
  version, coverage, and caveat does not survive inside a prompt file.

Same checks. A memory, a deadline trigger, and an artifact.

## What it actually does in Phase 1

Deterministic checks decide every finding. AI only rewrites findings in plain words
and never decides anything.

- **Secrets and risky patterns.** Tracked `.env`, private keys, credential patterns,
  `eval`, install scripts, SQL-like shapes, debug leftovers.
- **Dependencies.** Manifests and lockfiles, exact versions, OSV advisories,
  unpinned ranges, duplicates.
- **Licences.** SPDX identifiers, `LICENSE` and `NOTICE` files, missing or copyleft
  signals. Reported as a policy result, never as legal advice.
- **Repo hygiene.** README and setup quality, tests, CI, entry points, config, env
  usage, agent instruction files.
- **Live app, optional.** HTTPS, reachability, non-blank response, main-action hint,
  viewport meta. Fetch-only. It reads served HTML and cannot prove how a page looks
  on a phone, and the report says so.
- **Repo DNA and Share readiness.** A tree and language map, plus an explainable
  readiness band with read-coverage attached. Signals only, never certification.

Caps are stated in the interface, not buried: 200 files, about 2MB, 100KB per file
when a single file is read, and 5000 stored tree entries.

One naming note, since it appears in older planning: the readiness band is called
`Judge Readiness` in the internal plan and `Share readiness` in the shipped
interface. It is the same single signal. This document uses the shipped name.

## The AI lane

One direction, one lane, always with a floor under it.

```
Gemini 2.5 Flash (thinking off)
  -> Ollama Cloud, small model
    -> deterministic wording
```

AI output is rejected and replaced with plain wording if it references an unknown
finding, drops an actionable finding, or claims a check we did not run. A scan never
fails because AI failed.

## Honest coverage, which is the actual product

The most dangerous thing a scanner can say is nothing when it means "I did not
look."

So coverage is a first-class output, not a footnote. The report opens with a
verdict and the line saying how much was not read, in the same block, because a
reader must not be able to reach the headline without the caveat.

Every scan reports one of four states, and only these four:

| State | Meaning |
|---|---|
| **Checked** | The check ran and returned a result |
| **Partial** | The check ran, skipped some inputs, and the counts are shown |
| **Not checked** | The check did not run, and the reason is shown |
| **Unknown** | A previous result cannot be re-verified |

The clean-result headline is deliberately not a clean bill of health:

> Nothing was flagged in the files we read. This is not a clean bill of health.
> We read 200 of 340 files. The other 140 were not read.

That is the whole design. A tool that says "safe" when it read 200 of 340 files is
worse than no tool, because it buys false confidence at exactly the moment the
builder is about to hit publish.

## Privacy and what we store

- Public repos only. A private repo cannot be scanned.
- No raw file contents are stored, ever. Only owner, repo, commit SHA, file paths,
  sizes, hashes, and redacted finding snippets.
- No raw secret values, anywhere. One redaction function covers every output path:
  findings, evidence, share payloads, AI prompts, logs.
- Share and passport pages carry counts, titles, and short explanations only. No
  paths, no line numbers, no code, no secret values.
- AI providers receive redacted summaries and evidence IDs only, never file bodies.

## Known limits, stated up front

- Public repos only. No private repository path yet.
- 200 files and about 2MB per guest scan.
- No browser rendering. The live check reads served HTML, not a rendered phone.
- The check runs when you press Run, or from the read-only MCP endpoints. There is no
  automatic reminder and no monitoring in Phase 1, so a stale result stays stale
  until you rescan.
- A hung advisory lookup is **unknown**, never a pass.
- The report was found confusing by at least one real user. See M2. We have the
  signal, not yet the fix.
- Share links and passports do not expire and cannot be revoked today. The interface
  says so before you create one, not after.
- Signing in unlocks nothing yet. It says so plainly instead of implying a richer
  scan is one click away.

## Milestones, riskiest first

Phases are scope. Milestones are proof. Each one starts with the riskiest guess in
its simplest possible form, and a milestone is not done until a real person, not
us, has done the thing.

### M1, the return. First real data point. Not yet a proven pattern.

**The guess:** a vibe coder who fixes something will come back and rescan.

This was the riskiest guess in the product and it has just had its first test
outside our own hands.

**What happened.** A builder outside the team ran a scan, fixed what it found,
and came back and pressed re-scan on his own, with no reminder from us. He is now
asking for the MCP integration. One person, one unprompted return.

**What that proves.** The loop is possible. A real person completed paste, fix,
rescan without being asked. That is the first sign the thing we claim over
CheckVibe and over a coding-agent skill is real rather than theoretical.

**What it does not prove.** Three out of ten is the bar, and this is one. One
person can be a friend who wanted to be helpful. The return has to happen with
people who are not close to us, and more than once, before the loop counts as real.
Status stays "not proven" until the count is there.

**Plainest test:** ten builders finish a first scan. Count how many come back on
their own, no reminder, no email, no nudge. Record the names and dates before
asking them, so the ones who did not return are not forgotten.

**When to stop:** fewer than three of ten return on their own, and the return loop
is not real. The story changes before anything is built on top of it.

**First recorded result, 2026-10-03:** 1 builder, 1 unprompted return. Below the bar
of 3 of 10, and recorded here rather than rounded up.

### M2, they understand the result. Partly proven, one problem found.

**The guess:** a builder who is not technical reads the answer and understands what
was checked and what was not.

**What happened.** Team members used it, and one piece of feedback was that the
report or its wording was confusing. That is the first outside signal, and it did
not come back clean.

This matters more than it looks. Our whole position rests on the reader
understanding the difference between the clean-looking first line and the line under
it saying we only read 200 of 340 files. If real readers find the report confusing,
the strongest claim we have is not landing.

**What is not yet known.** Which part confused them, and whether they
misread the coverage line specifically or something else. We have the signal, not
the diagnosis.

**Plainest test:** show the report to five builders who have never seen it and ask
them what they think it says. If any one of them says "so it's fine", we have not
got there yet. Separately, ask the team member who was confused which specific part
lost them.

### M3, the fix we hand over actually works. First outside success observed.

**The guess:** pasting the fix prompt into an AI tool really fixes the thing, and
the next scan shows it as fixed.

**What happened.** A team member used LaunchSense, a licence finding came up, and
they went and corrected the licence issue. That is the full loop working on a real
problem in a real repo, by someone who is not us: a finding was read, understood,
and fixed.

**What that proves.** The prompt is good enough to produce a real fix at least
once. The finding was legible enough to act on. That is the first evidence the
handoff is worth anything.

**What it does not prove.** One licence fix is the easiest kind of finding to act
on, because the fix is short and legal, not technical. We have not yet seen a
secret or a dependency finding drive the same result. And we have not yet seen the
next scan show it as fixed.

**Status:** one confirmed fix in the wild. Encourage, and thin.

### M4, the share link gets used. Not proven.

**The guess:** a builder sends the link to someone who opens it and finds it useful.

The share page works and gives nothing private away. Whether anyone sends it, or
whether the person who gets it cares, we have not seen.

## Where it goes after the milestones

These are stages of building, not proof. Do not start one until the milestone before
it has been met.

- **Phase 1, live now.** Guest scan, plain report, one fix prompt, rescan compare,
  share and passport, Repo DNA, Share readiness, and missions. Also read-only MCP
  endpoints and a small adapter script. The MCP part is kept small on purpose. It is
  there to show the shape works, not to be the product.
- **Phase 2, waits on M1.** GitHub App on a repo you choose, monitoring, checks
  triggered by a push, history, score trends, fuller standards maps, SBOM signals.
  Monitoring only makes sense once people come back on their own. If M1 fails, this
  stage is redrawn instead of built.
- **Phase 3, was gated on M4. Now moving earlier, and the reason is recorded.** A
  public API with versions, a full MCP setup, teams, roles, audit logs, retention.
  The Phase 1 MCP routes are the start of this, not the finished version.

### The MCP decision, and the pressure behind it

Real users asked for MCP before we planned to build it. Two people who used the
product want their agents to call it. That is genuine pull, and it is the first
time demand has arrived for something on the far end of the roadmap.

The honest tension: the plan said do not build Phase 3 until M4 is proven, and M4 is
not proven. But pull is the strongest signal we have, and turning it away to follow
a plan we wrote before we had users would be the plan serving itself.

What we are doing and why:

- **MCP moves earlier, as a small read-only surface.** It scans a public repo and
  reads a report. Nothing private, no writes, no account. The Phase 1 routes already
  exist, so this is finishing them, not starting from nothing.
- **The gate on M4 still stands for everything else in Phase 3.** Teams, roles,
  audit logs, and retention all wait. Those are large, and M4 is still unproven.
- **M1 is still the number that matters.** MCP users are the same people who would
  rescan. If they come back through an agent instead of the browser, that still
  counts as a return. Track it the same way.

Recorded so the decision is visible: we are moving one Phase 3 item forward because
users asked, not because the plan changed its mind.

## Market

There is real evidence behind this, with a number. CodeRabbit looked at 470 open
source pull requests, 320 written with AI and 150 written by hand. The AI ones
carried 10.83 issues each, against 6.45 for the hand-written ones, about 1.7 times
more.
Source: `https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report`

The timing matters as much as the number. AI coding tools went from new to normal in
about a year. Speed went up. Checking stayed manual, and manual is where it gets
skipped. Same person, more code, same hour. That gap is the opening.

People already pay for this. CheckVibe charges from $24 per month and gates its fix
prompts behind the paid plan.

First market on purpose: about 50 vibe coders in my extended network fit this right
now. They are the first test set and the first word of mouth.

## What real people have done with it so far

Testing so far, stated as what it is rather than what it proves.

- Tested on many of my own repositories, and on a range of other public repos, to
  shake out the scanner itself.
- Shared with my team. They ran it on their work, found a licence issue, and
  corrected it. That is the first fix driven by LaunchSense outside my own hands.
- One team member came back and pressed re-scan on his own, without being asked. He
  is now asking for the MCP integration.
- One piece of feedback: the report or its wording was confusing. Recorded as an
  open problem under M2, not smoothed over.

What this is not: it is not the M1 proof. The people who returned are close to me,
which is the easiest possible version of the test. The bar is ten builders, three
returns, and it has not been run yet.

## How it is built, for the record

React and Vite on the front end. Convex for database, backend, and hosting. GitHub
holds the source. 192 automated tests run on every change, and a claim guard fails
the build on copy that asserts something the code cannot back.

The guard is not decoration. It carries 33 rules across three classes: unsupported
claims, safety promises that must be backed by the code, and retention numbers that
must match a real cache constant. Each rule was written against a string that was
genuinely in this product. During this build the guard caught three of our own new
strings, including two that were honest but phrased in a way the guard could not yet
understand. It now scans this document too.

## What is not built, plainly

Sign-in unlocks nothing today. There is no saved history, no private repo scanning,
no monitoring, no browser rendering, no share revocation. Each of those is either a
later phase or not started, and the interface never pretends otherwise.