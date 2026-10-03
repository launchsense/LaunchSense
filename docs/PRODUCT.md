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

## The forces on this decision

Why does the check get skipped when the worry is real? Four forces, and only two
of them matter enough to design against.

**Push: the repo is going public and the builder cannot unsee what is in it.** Once
the link is shared, every future reader can see every commit that ever existed. This
is the force that creates the visit. It is real and it needs no help from us.

**Pull: one fix prompt handed to the AI tool they already trust.** They are not
looking for a security workflow. They want the next instruction to paste into
Cursor or Claude. Giving them that in one copy is what makes the tool usable by
someone who does not read security output.

**Anxiety, and this is the one that decides the outcome.** Two fears pull in
opposite directions. The first is "what if it finds something awful." The second,
and the stronger one, is "what if it tells me a wall of things and I cannot tell
which matter." A scanner that produces anxiety without a clear next step gets
closed and never reopened. This is why the report opens with one verdict and three
ordered actions, not a findings list.

**Habit: deploy and hope.** This is the force that actually loses. The builder has
shipped this way every time and nothing bad happened yet, so the habit has been
rewarded. A tool that asks them to change a habit at the last minute will be
skipped, not used. This is why the product does not ask for an account, does not
ask for a private repo, and does not ask for a workflow. It asks for one paste, at
the moment they were already hesitating.

What we do about the two that matter:

| Force | What the product does |
|---|---|
| Anxiety about a wall of output | One verdict, then three ordered actions, then the rest. Severity decides order, not the order we found things. |
| The deploy-and-hope habit | No account, no install, one paste. And the fix prompt is the deliverable, not the report. |

The push and the pull are working for us. The anxiety and the habit are working
against us. Most of the design exists to fight the second pair.

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
- Share links and passports do not expire and cannot be revoked today. The interface
  says so before you create one, not after.
- Signing in unlocks nothing yet. It says so plainly instead of implying a richer
  scan is one click away.

## Milestones, riskiest first

Phases are scope. Milestones are proof. Each one starts with the riskiest guess in
its simplest possible form, and a milestone is not done until a real person, not
us, has done the thing.

### M1, the return. Not proven.

**The guess:** a vibe coder who fixes something will come back and rescan.

This is the riskiest assumption in the product and it is currently unproven. We
have tested that a scan works. We have not tested that anyone returns. Every scan
is pinned to one commit and compares against the last, which is the differentiator
we claim over CheckVibe and over a coding-agent skill. If nobody returns, that
differentiator is worth nothing and this is a one-shot scanner with extra steps.

**Simplest form:** one builder, one repo, one real fix, one voluntary second scan,
unprompted. No reminder, no email, no mission card. They come back on their own.

**Kill condition:** if ten builders complete a first scan and we cannot get three of
them to do a second scan unprompted, the return loop is not real and the product
positioning has to change before we build anything else on top of it.

**Status:** not started. This is the next thing to test, ahead of any new feature.

### M2, comprehension. Partly proven.

**The guess:** a nontechnical builder reads the verdict and understands what was
and was not checked.

Tested against ourselves, not against outsiders. The verdict-and-scope block exists
and is enforced by tests, but no external reader has been observed using it. The
risk is not that the words are unclear. The risk is that a user reads "nothing was
flagged" and stops before reaching "we read 200 of 340 files".

**Simplest form:** show the report to five builders who have never seen it and ask
what they think it means. If any of them says "so it's fine", the milestone is not
met.

### M3, the fix actually lands. Structurally proven, behaviourally unknown.

**The guess:** handing the fix prompt to an AI tool produces a real fix and the
rescan shows it as fixed.

The compare engine works and sorts findings into fixed, still broken, new, back
again, and unknown. What is unproven is whether the prompt is good enough that the
AI tool resolves the finding on the first try. A compare that mostly says "still
broken" would train the user to stop trusting it.

### M4, the share artifact gets used. Not proven.

**The guess:** a builder shares the link with someone who actually opens it and
finds it useful.

The share page works and leaks nothing. Whether anyone sends it, or a recipient
cares, is untested.

## Where it goes after the milestones

These are scope phases, not proofs. Do not start one before its prerequisite
milestone is met.

- **Phase 1, live now.** Guest scan, plain report, one merged fix prompt, rescan
  compare, share and passport, Repo DNA, Share readiness, serial missions, plus
  read-only MCP endpoints and a local adapter script. The MCP surface is small on
  purpose and exists to prove the contract, not to be the product.
- **Phase 2, gated on M1.** GitHub App on a selected repo, monitoring,
  push-triggered checks, history, score trends, full standards maps, SBOM signals.
  Monitoring only makes sense if the return loop is real. If M1 fails, this phase
  is re-scoped, not built.
- **Phase 3, gated on M4.** A versioned public API, a full MCP integration, teams,
  roles, audit logs, retention. The Phase 1 MCP routes are the seed, not the
  finished version.

## Market

Tailwind, with a number attached. CodeRabbit compared 470 open-source pull
requests, 320 AI co-authored and 150 human only. AI-authored pull requests carried
10.83 issues each against 6.45 for human ones, about 1.7x more.
Source: `https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report`

Timing matters as much as the number. AI coding tools went from new to normal in
about a year. Speed went up. Checking stayed manual, and manual is where it gets
skipped. Same person, more code, same hour. That gap is the opening.

People already pay for this. CheckVibe charges from $24 per month and gates its fix
prompts behind the paid plan.

First market on purpose: about 50 vibe coders in my extended network fit this right
now. They are the first test set and the first word of mouth.

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