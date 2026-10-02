# LaunchSense

Check your public repo before you show it to anyone.

LaunchSense reads public GitHub repos. It looks at your code and your live app the way a stranger would, and lists problems with proof. It gives one fix prompt for the top 3. It never changes your code.

## Public repos only

This reads public repos. It cannot see a private one.

- Repo already public: scan it any time.
- Repo still private: scan it after you flip it public, before you share the link anywhere.
- Need to check a private repo: not supported yet. Local tooling such as MCP is the route for that, and it is not built.

## How to use

1. Open the app and paste your repo link plus your live app URL.
2. Press Run scan.
3. Copy the top 3 prompt into your coding helper.
4. Fix the items, then scan again.

## What it checks

- Secrets left in tracked files, like keys, tokens, and passwords.
- Risky code patterns, like eval, debug leftovers, and string-built database queries.
- Dependencies, like known vulnerabilities, floating versions, and install scripts.
- Licenses, like missing terms or copyleft terms that need a human decision.
- Project hygiene, like README, tests, CI, and duplicate or large files.

## What it does not do

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
- The shape of your project: Repo DNA, plus a Judge Readiness signal with coverage shown.

## After the scan

- Re-scan on the new commit and compare: fixed, still broken, new, back again, unknown.
- OWASP ASVS 5.0.0 subset lines with coverage and caveats. Signals, never a certification.
- Seven missions in order, and achievements earned only when the scan proves them.
- Plain text handoff for a developer friend with no coding agent.
- One fix prompt for the top 3, ranked across your code and your live app.

## Limits

- Public repos only. Private repos cannot be read, and no local agent or MCP setup is included.
- Guest scans only in this release. Saving and history need sign-in, which is not built.
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
