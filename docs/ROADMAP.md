# Roadmap

This page says what LaunchSense does now, what it does not do yet, and what we
plan to build next. We keep it public so nobody has to guess.

Nothing here is a promise about a date. If a line is unbuilt, it is written as
unbuilt.

## Shipped

The guest scan works today and needs no account.

- Public repository scan, pinned to one commit.
- Secret, dependency, licence, and hygiene checks, each with evidence.
- Repo DNA: shape, languages, entry points, signals for tests, readme, CI, licence.
- Judge Readiness with evidence coverage, and the reason behind every band.
- Live URL check, including DNS resolution and a redirect-by-redirect address guard.
- Share links and a read-only passport.
- Re-scan and compare, so you can see what a fix actually changed.
- Missions: the next actions worth taking, in order.
- One repository archive per scan instead of one request per file.

## Being built

**Connected repository deep scan.** Sign in with GitHub, install a read-only app
on the repositories you choose, and scan deeper than a guest scan can.

Why it is worth building: a guest scan is deliberately bounded. It reads public
data only, stops at 200 files and about 2MB, and shares the GitHub quota that
every visitor spends. A connected repository removes those limits. It also lets
LaunchSense read GitHub's own Dependabot and code scanning evidence where those
exist, so LaunchSense can explain it, rank it, and compare it after a fix instead
of asking you to reread a security dashboard.

| | Guest scan | Connected scan |
| --- | --- | --- |
| Private repositories | no | yes |
| Files and size | 200 files, about 2MB | a much larger budget |
| GitHub rate limit | shared, 60 an hour | per-installation, far higher |
| Vulnerabilities | OSV lookup | OSV plus Dependabot alerts |
| CI status | workflow files, read as text | actual Actions run results |
| Delivery signals | none | commit cadence, review time, releases |

How the permission works, stated plainly:

- A GitHub App, installed on **selected repositories only**, never the whole account.
- **Read-only permissions.** Contents, metadata, pull requests, actions, workflows. There is no write permission anywhere in the request, so a stolen token could not change a repository.
- Uninstalling is one click and the token dies immediately.
- Installation tokens expire every hour, so a fresh one is minted per scan. We never hold a long-lived user token.

What it will not do: connect a repository and write to it, or change your code.
The guest scan will never require an account. Signing in buys depth, not access
to the basic scan.

## What connected scans will still not do

Stating this now, so nobody discovers it later.

- **No runtime performance.** GitHub does not expose CPU, memory, latency, or
  bundle size. We can report delivery performance, which is real and useful:
  does CI pass on the default branch, how long do reviews take, how often do
  releases ship. Runtime speed needs a hosting provider integration, which is a
  separate product.
- **No stored copy of your code.** Settled: connected scans read fresh each time.
   We keep metadata, evidence, and redacted snippets for the scan record, but no
   copy of the connected repo itself.
- **No write access of any kind.** Read-only is the whole design.

## Planned after that

Rough order, not a schedule.

- **Save and history.** Email sign-in, so you can return to past scans and see
  what changed. This is not built yet.
- **Private repositories without the app**, for people who would rather paste a
  short-lived read-only token than install anything. Worth having, and it is a
  support surface we would rather not open first.
- **Public API and MCP.** A stable way to run the same checks from your tool or
  coding helper. A guest browser scan will still work without either.
- **Team view.** Findings across several repositories, so a team sees the same
  rule failing in four places at once.
- **Rules from users.** A way to add a project-specific check that we do not
  ship, scoped to one repository.
- **Tracked fix verification.** When a scan sees a fingerprint again after a
  claimed fix, say so plainly rather than leaving the user to compare.
- **Rendered browser evidence.** Optional rendered checks for the public app
  when the live page is client-rendered. Only used when fetch evidence cannot
  support the claim. Browserless is the preferred free tier for now.
- **Full standards maps and architecture graphs.** Deeper evidence views, still
  without certification language.
- **PageSpeed trends.** Optional, only when the user opts in. Missing data shows
  Unknown.
- **SBOM signals.** Evidence from software bill of materials, never a verdict by
  itself.

## What we will not build

- Auto-fixing code in your repository. Read-only is a feature, not a limitation.
- A certification or a score out of ten. Judge Readiness is a band with
  reasons, not a grade pretending to be objective.
- Anything that requires an account for the basic scan.

## How this list changes

Tell us and we will argue. If something here is wrong, or something missing
matters more than what is listed, that is a better use of our time than
polishing the parts that already work.
