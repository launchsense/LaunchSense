# Roadmap

This page says what LaunchSense does now, what it does not do yet, and what comes
next. We keep it public so nobody has to guess. Nothing here is a promise about a
date. If a line is unbuilt, it is written as unbuilt.

## Shipped

The guest scan works today and needs no account.

- Public repository scan, pinned to one commit.
- Secret, dependency, licence, and hygiene checks, each with evidence.
- Repo DNA: shape, languages, entry points, signals for tests, readme, CI, licence.
- Share Readiness with evidence coverage, and the reason behind every band.
- Live URL check, including DNS resolution and a redirect-by-redirect address guard.
  Optional and off by default.
- Share links and a read-only passport.
- Re-scan and compare, so you can see what a fix actually changed.
- One repository archive per scan instead of one request per file.
- The local check, which reads your own checkout on your machine, sends nothing to
  us, and has no hourly limit. See `LOCAL-MCP.md`.
- A licence suggestion: one pick with its reasons, from the declared mix. A
  suggestion, never a licence fact.

## Alpha

**Hosted MCP.** The Connect page shows `https://harmless-chihuahua-667.convex.site/mcp`.
A coding tool adds that address. `launchsense_scan_public` reads one public GitHub
repo on our server, with the same caps as the paste. `launchsense_get_report` reads
a report by scan id, including the licence suggestion and one standards line. The
hosted read keeps 200 scans an hour for the shared bucket, and 600 in total across
the lane, then the route pauses. A resolved credential gets 20 an hour and 120 a
day. Alpha has no login on that address. A checkout of this repository can run the
local review, which is not the public connection.

The website stays the first look: paste a public repo, read a report, copy a prompt.
Unknown stays unknown. A model may quote one next look. That quote is not a finding.

## Not built yet

- No saved history, and no monitoring or scheduled scans.
- No GitHub App installation read. Sign-in today downloads one archive on the
  person's token.
- No runtime performance data. GitHub does not expose it.
- No certification and no score out of ten.

## What we will not build

- Auto-fixing code in your repository. Read-only is a feature, not a limitation.
- A certification or a score out of ten. Share Readiness is a band with reasons,
  not a grade pretending to be objective.
- Anything that requires an account for the basic scan.

## How this list changes

Tell us and we will argue. If something here is wrong, or something missing matters
more than what is listed, that is a better use of our time than polishing the parts
that already work.
