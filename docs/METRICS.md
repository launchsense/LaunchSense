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

The website is wired to PostHog, the first of the four. It runs cookieless: it sets no cookie, writes nothing to your browser's storage, and identifies a visitor with a privacy hash PostHog computes on its own servers, so we hold no visitor identifier. Session replay, autocapture, surveys, and person profiles are all off, and only a page view and a page leave are sent. The build holds a public client key, which is a read key for the dashboard, not a write key for the site.

The local check is unchanged. Its counts come only from opted-in diagnostics, stored in `usageDiagnostics`, and the MCP surface loads no browser script. When another visitor counter is added, it gets its own privacy line before it ships.

## What this means for the next three weeks

Read usage back from the tables we already have. Add no new targets on top.
