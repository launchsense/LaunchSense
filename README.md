# LaunchSense

LaunchSense checks the codebase, not the business. It does not say if the app will sell.

You built the app with an AI coding tool. It works, and you are about to share the repo. You do not know what to ask Codex, so the check never starts. LaunchSense already knows what to ask. It says what is wrong, in plain words, and gives a prompt you can paste. It never changes your code.

## Three ways in

- Public repo, no account. Paste the GitHub URL. This is what runs today.
- Private repo. Sign in with GitHub and check a repo you can already read. That scan is not running yet. Signing in today does not start it.
- MCP. The same check from your coding helper. A small public-repo route exists. Private repos through MCP are work we will do.

## How to use

1. Open the app and paste your repo link plus your live app URL.
2. Press Run scan.
3. Copy the top 3 prompt into your coding helper.
4. Fix the items, then scan again.

## What it solves

Things a vibe coder has no name for:

- A leaked key, token, password, or private key in a tracked file.
- A license that does not fit the tool, including missing terms or copyleft. That is a signal for a person, not legal advice.
- A dependency with a known hole, or one with no fixed version.
- Risky code, like eval, or a database query built from text.
- A missing README, tests, or CI.
- Duplicate files and huge files.

Repeated functions, and a wider read of code bloat, are the next rules in that same layer. They are not checked yet.

## Why use it

- You do not need the name of the problem. The report names it.
- The checks are fixed. A model does not invent a finding.
- You leave with a prompt you can paste into Codex, Cursor, or Claude.
- It says what it did not read. A gap is not a pass.
- It does not change your code, and it does not block a deploy.
- It does not judge the market, the idea, or whether anyone will pay.
- After you fix, scan again and see what changed.

## Policies and standards

Policy means the rules for the codebase, not a sales policy and not only a license check. A license is one rule inside the layer.

The findings sit on standards you may not have heard of: OWASP Top 10, OWASP ASVS, OSV for dependency holes, and CWE. Each line is a signal with a caveat. It is not a certification.

## What it does not do

- It does not say if the product will sell.
- It never changes your code and never blocks publishing.
- It never stores raw secret values or raw file text. Secret patterns are replaced before anything is written.
- A partial result is never shown as a pass. Unchecked work stays listed as not checked.

## What is checked

- Secrets left in tracked files, like keys, tokens, and passwords.
- Risky code patterns, like eval, debug leftovers, and string-built database queries.
- Dependencies, like known vulnerabilities, floating versions, and install scripts.
- Licenses, like missing terms or copyleft terms that need a human decision.
- Project hygiene, like README, tests, CI, and duplicate or large files.
- Your live app, by fetching the served page. HTTPS, does it load, is there content, is the main action visible, is there a phone viewport tag.
- The shape of your project: Repo DNA, plus a Share Readiness signal with coverage shown.

## After the scan

- Re-scan on the new commit and compare: fixed, still broken, new, back again, unknown.
- Standards lines for OWASP ASVS 5.0.0, OWASP Top 10:2025, OSV, and three CWE labels. deps.dev and Scorecard stay not-checked. Signals, never a certification.
- Seven missions in order, and achievements earned only when the scan proves them.
- Plain text handoff for a developer friend with no coding agent.
- One fix prompt for the top 3, ranked across your code and your live app.

## Limits

- The paste box reads public repos. A private scan after GitHub login is not running yet.
- MCP today is a public-repo route. Private repos through MCP are work we will do.
- GitHub quota is shared, so heavy use can pause scans until the quota resets.
- Each scan reads at most 200 files and 2 MB in total. The rest is listed as not checked.
- Plain words explanations use an AI provider when one is configured. None is configured in this release, so fixed wording is shown.
- More detail: `docs/LIMITS.md`. Privacy detail: `docs/PRIVACY.md`.

## Run it locally

Needs Node 24 and npm 11.

```sh
npm ci
# use two terminals:
npm run dev:backend
npm run dev
```

Checks:

```sh
npm run typecheck
npm run lint
npm run build
```

Releases use `npm run deploy` and are done by maintainers only. A git push never deploys.

## Docs

- `docs/HOW-IT-WORKS.md`: what happens when you scan.
- `docs/READ-YOUR-REPORT.md`: how to read findings, signals, missions, and the recheck.
- `docs/ABOUT.md`: who it is for, why not a skill, and what it will not do.
- `docs/PRIVACY.md`: what we save and what we never save.
- `docs/LIMITS.md`: quotas, caps, and everything unchecked.
- `docs/GLOSSARY.md`: every special word in one plain line.
- `docs/SELF-SCAN-LOG.md`: we scan our own repo with LaunchSense after every stage and publish the result.
- `CHANGELOG.md`: what changed in each release.

Built with React, Vite, TypeScript, and Convex. License: proprietary, see `LICENSE.txt`. The repo is visible for review only. No use without permission.
