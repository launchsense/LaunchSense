# Case draft 4: a ranking lane that has never been measured, and says so

Status: DRAFT. Not published. Counts only.

## The situation

This product orders the findings it produces. Behind the ordering sits a decision
lane that can reorder items within a severity band, using a model that returns
typed values rather than text.

Three providers are wired in. The monitoring reading for it was built this run.
Here is what the reading says:

**Rows available: 0.**

Not one decision-lane call has ever been recorded. The table that would hold the
distribution is written by one mutation, which is only reachable when a
deployment variable is set. It is not set. Across all 50 scans in this set, the
tool reported that usage counts were not sent, every time.

So the honest answer to "does the model order these findings better than the
rule table" is: **unknown, and no measurement exists yet.**

## Why that is the correct thing to publish

It would be easy to write the marketing version here. Two vendors, benchmark
tables, "smarter ordering", a claim about accuracy. Every number in that version
would be about a general benchmark on questions the product never asks.

A security triage band is not a general benchmark. A model that scores well on
reading comprehension has not been shown to rank a committed signing key above a
committed app secret. Those are different questions, and the second one is the
only one that matters.

## What the lane is allowed to do, and the tests that hold it

The lane is allowed to change one thing: the order of findings that already exist,
inside a severity band. It may never:

- add a finding or remove one
- change a severity
- set a licence, standards, or readiness verdict
- turn unknown into fixed, or partial into a pass
- claim a repository is safe

Five tests hold those lines. Three worth naming:

1. **The model cannot choose what a finding is.** It only ever receives a list of
   fingerprints the deterministic checks produced. It cannot introduce a rule
   because it cannot introduce a finding.
2. **A confident wrong answer loses.** A test gives the lane a medium finding and
   asks it to rank above a high one, with maximum confidence for the medium.
   Severity still wins. This is the test that stops the lane from being persuasive
   rather than correct.
3. **The lane refuses to send secret-shaped text.** If the state it is about to
   transmit contains something that looks like a private key block, an AWS key, or
   a provider token, the call is refused before any request is built, and the
   refusal names the shape without naming the value.

## What the reading refuses to report

The monitoring query returns a named list of metrics it cannot produce. Naming them
is more useful than omitting them, because a reader who knows a number will never
exist will stop looking for it:

| Metric | Why it is not reported |
|---|---|
| Rung accuracy against the rule table | No owner labels are stored. Without labels there is nothing to score against, and a self-consistency number would look like accuracy without being it. |
| How many findings a rung moved | Not stored. The table records which source answered, not what it did to the order. |
| Consistency when the presentation order is reversed | Both orders are not run yet, so there is no rate to report. |
| Which rung was tried and rejected, and why | The adapter records this per call; the table does not persist it. |

## The condition for changing the default

The rule table is the floor and it stays the floor. A hosted model becomes the
first choice only when it beats the table clearly on owner-labelled data, measured
as top-3 hit rate plus pairwise accuracy inside each band, repeatable across
repeated identical runs, with no missed real finding.

**None of that measurement exists.** So the default stays as it is, and the
product's own ordering claim stays a table claim.

## What this draft does not claim

- It does not claim either model is good or bad. Both are unobserved here.
- It does not claim the decision lane is useless. It claims the lane is
  unmeasured, which is a different sentence and the only true one.
- The vendor benchmark figures that do exist are about general benchmarks and are
  deliberately not reproduced as if they were evidence for this use.
