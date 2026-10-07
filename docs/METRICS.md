# What we count, and what cannot be counted

Usage is the goal, not a target. This page states which numbers exist, which do not, and why.

## GitHub downloads and pulls

A `git pull`, `git fetch`, or `git clone` cannot be counted per person. Git is distributed: once cloned, the repo lives on the other machine and nothing calls back.

What GitHub does count, in aggregate:

- Clone counts and view counts, through the traffic API, for the last 14 days. They need a token with push access and they never name a person.
- Release asset downloads, per release. Same shape: counts, not names.

Use those three when you want a download-side read. Do not present them as per-person tracking. They are not that.

## Website visitors

Visitor counts come only from PostHog, Plausible, GA4, or Datafast, and only with read-only access. No write keys, no session replay owned by us.

Today none of the four is wired. The site loads no analytics script. So there is no visitor number from our own stack today. The usage read we do have is the hosted funnel we already store: scans submitted and analyzed, shares, rescans, and the MCP protocol counts in `dailyMetrics`.

When a visitor counter is wired, it gets its own privacy line before it ships, and the key it uses stays read-only.

## What this means for the next three weeks

Read usage back from the tables we already have. Add no new targets on top. If the hosted sample is busy, it fails softly and offers the free local check.
