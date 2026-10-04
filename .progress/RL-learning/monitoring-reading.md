# Monitoring reading: decision-source distribution (M4)

Written 2026-10-05. This is the first reading of the decision-source distribution,
the item Phase 2 of `decision-implement-plan.md` asks for. Filed under the same
honesty rules as findings: no claim beyond what the stored rows show.

## What I built

One internal query, `convex/decisionMonitoring.ts`, named
`decisionSourceDistribution`. It reads `usageDiagnostics` and returns, per day and
for the window as a whole:

- rows per source (`jev`, `perplexity`, `local`, `table`)
- how many of those were `table`, counted as fallbacks rather than as a rung that
  won
- median and max `durationMs`

Default window 7 days, bounded to between 1 and 90. It is an `internalQuery`, so
it is not a public endpoint and cannot be called from the browser.

## The reading itself: no numbers yet

**There is no data to read.** The `usageDiagnostics` table is written by exactly
one mutation, `convex/mcpLimit.ts` `recordUsage`, and that mutation is only
reachable through `sendDiagnostics` in the local entry, which returns false unless
`LAUNCHSENSE_API_URL` is set. On this machine it is unset. Across all 50 offline
wave scans in this run, the tool reported `diagnosticsSent: false` every time.

So the honest distribution right now is: **0 rows. No rung has been observed in
production, not once.** That is a coverage gap in our own monitoring, exactly as
`decision-model-capabilities.md` already flagged for Perplexity, and it now
extends to the whole table. Jev, Perplexity, and the local rung are all
unobserved, which is not the same as any of them being bad.

Writing a number here without a row to read it from would be the fabrication this
project is built to avoid, so the number stays unwritten.

## What the query refuses to report, and why

The return value carries a `notMeasured` array naming four things this table does
not store. They are named rather than omitted, so a reader does not go looking for
a metric the query will never produce:

1. **Rung accuracy against the rule table.** No owner labels are stored. Without
   labels there is nothing to score a rung against, and a self-consistency number
   would look like accuracy without being it.
2. **Reorder counts.** How many findings a rung actually moved is not stored. The
   table records which source answered, not what it did to the order.
3. **Swap consistency.** Both presentation orders are not run yet, so there is no
   rate to report. This is Phase 1 and it has not been implemented.
4. **Per-call rung failures and why.** The adapter records `attempts` with a
   reason per rung, but that array is not persisted into the table. The query
   therefore cannot say which provider was tried and rejected.

## What is needed before this reading says anything

- A deployment where `LAUNCHSENSE_API_URL` is set and `recordUsage` is reachable,
  or an explicit decision that the hosted deployment never sends usage counts.
  The second is a legitimate answer; the reading would then report zero forever
  and that should be stated as a decision, not as an accident.
- Nothing else. The query is written, tested, and typed.

## Tests that hold this line

`tests/decision-monitoring-checks.mjs`, 7 assertions over the source. They hold
five properties:

- the query reads only `orderSource` and `durationMs`, never file text, a
  snippet, a repo name, or a path
- `notMeasured` names rung accuracy, reorder counts, and swap consistency
- an unobserved rung is absent from the output and nothing maps absence to a
  failing state
- the executable code contains no retire, promote, or reward path, and no
  ascending source sort. Comments are stripped before this check, because the
  comments say what the code must never do.
- the query is `internalQuery`, not a public `query`

These are source-shape tests, not behavioural tests. They would not catch a
wrong number computed correctly. They exist to stop the query growing a
scoring path, which is the failure that matters here.

## Not decided by me

Whether the hosted deployment should send usage counts at all. That is the
operator's call and it involves a data transfer, so it stays a question, not a
change. The query is internal and unsent until someone calls it.
