# LaunchSense

Check your repo before you flip it public.

LaunchSense looks at your code and your live app the way a stranger would, and lists problems with proof. It gives one fix prompt for the top 3. It never changes your code.

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
- It never stores raw secret values. Snippets are redacted before storage.
- A partial result is never shown as a pass. Unchecked work stays listed as not checked.

## Limits

- Guest scans only in this release. Saving and history need sign-in, which is coming later.
- GitHub quota is shared, so heavy use can pause scans until the quota resets.
- Each scan reads at most 200 files and 2 MB in total. The rest is listed as not checked.
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
- `docs/READ-YOUR-REPORT.md`: how to read findings and the fix list.
- `docs/ABOUT.md`: who LaunchSense is for and what it will not do.
- `docs/PRIVACY.md`: what we save and what we never save.
- `docs/LIMITS.md`: quotas, caps, and what stays unchecked.
- `docs/GLOSSARY.md`: every special word in one plain line.
- `CHANGELOG.md`: what changed in each release.

Built with React, Vite, TypeScript, and Convex. License: proprietary, see `LICENSE.txt`. The repo is visible for review only. No use without permission.
