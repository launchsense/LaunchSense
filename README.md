# LaunchSense

[![Live](https://img.shields.io/badge/live-blue)](https://harmless-chihuahua-667.convex.site)
[![CI](https://github.com/launchsense/LaunchSense/actions/workflows/check.yml/badge.svg)](https://github.com/launchsense/LaunchSense/actions/workflows/check.yml)
[![Release](https://img.shields.io/github/v/release/launchsense/LaunchSense)](https://github.com/launchsense/LaunchSense/releases)
[![License: MIT open core](https://img.shields.io/badge/license-MIT%20open%20core-green)](LICENSE.txt)
[![Security policy](https://img.shields.io/badge/security-policy-green)](SECURITY.md)

LaunchSense checks the codebase, not the business. It does not say if the app will sell.

You built the app with an AI coding tool. It works, and you are about to share the repo. You do not know what to ask Codex, so the check never starts. LaunchSense already knows what to ask. It says what is wrong, in plain words, and gives a prompt you can paste. It never changes your code.

## AI, and where it is going

The checks are fixed. A model does not invent a finding, and it does not choose which checks run.

AI is already in the product, in two places. Both are still evolving.

- Plain words. When an AI provider is configured, it rewrites a finding the checks already produced. If it fails, fixed wording is used. When no provider answers, fixed wording is shown.
- Order. A decision model may reorder findings inside one severity band. If it does not answer, a fixed table sets the order. The table is always the floor.

A model never decides a finding, a severity, a licence fact, consent, who a caller is, or whether a request is allowed. The C2PA `humanOversightLevel` for every AI path here is `prompt_guided`: a person asked for the output and nobody approved it afterwards.

The next step is a reinforcement learning loop, and it is not a trained model yet. A later scan shows what was fixed, what is still broken, and what is unknown. A person can use that record to change a check. The model does not add the check, and it does not train on the code.

## One way in

Clone this repo, run `./install.sh`, paste one setup prompt into Cursor, Claude Code, or Codex. Your tool audits your repo where it sits. No hourly limit. Nothing is uploaded unless you opt in.

## How to use

1. Clone and run `./install.sh`. Answer its two questions.
2. Paste the setup prompt into your coding tool with your repo open.
3. Ask it to audit the repo.
4. Fix the items, then ask again. Accepted findings go in `.ls/policy.yaml` with a reason, so they are not raised again.

## What it solves

Things a vibe coder has no name for:

- A leaked key, token, password, or private key in a tracked file.
- A license that does not fit the tool, including missing terms or copyleft. That is a signal for a person, not legal advice.
- A dependency with a known hole, or one with no fixed version.
- Risky code, like eval, or a database query built from text.
- A missing README, tests, or CI.
- Duplicate files and huge files.

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
- The shape of your project: Repo DNA, plus a Share Readiness signal with coverage shown.

## After the review

- Ask again on the new state and compare. Accepted findings in `.ls/policy.yaml` are not raised again.
- Standards lines for OWASP ASVS 5.0.0, OWASP Top 10:2025, OSV, and three CWE labels. deps.dev and Scorecard stay not-checked. Signals, never a certification.
- One fix prompt for the top 3, ranked across your code.

## Limits

- The local read covers 5,000 files and 40MB in all, 100KB per file. OSV covers up to 50 packages. The rest is listed as not checked.
- Plain words and ordering are described under "AI, and where it is going." When no provider answers, fixed wording is shown, and the fixed table sets the order. The table is always the floor.
- More detail: `docs/LIMITS.md`. Privacy detail: `docs/PRIVACY.md`. What gets counted: `docs/METRICS.md`.

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
- `docs/LOCAL-MCP.md`: run the check on your own machine, and what to paste to your agent.
- `docs/METRICS.md`: what gets counted, and what cannot be counted.
- `docs/GLOSSARY.md`: every special word in one plain line.
- `CHANGELOG.md`: what changed in each release.

Built with React, Vite, and TypeScript. License: open core, MIT for the paths LICENSE.txt names, proprietary for the rest. The repo is public so the open parts can be read and forked.
