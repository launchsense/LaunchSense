# LaunchSense

This is the public half: the check engine and the skill. Clone it, run one installer, and your coding tool audits your repo on your own machine.

The rules come from the policy source, served online. The engine and the policy are separate on purpose: the rules stay current without a reinstall, and the engine never carries them.

## Install

```
git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh
```

On Windows, run it from Git Bash. The installer asks two questions, copies the skill into your coding tool, and registers the local server and the policy source. Then it points you at your first audit.

The file check runs on your machine, reads your working tree including uncommitted work, and sends nothing. Usage counts default to no.

## What it checks

Secrets left in tracked files, licenses that need a person, dependencies with known holes or floating versions, risky code, project hygiene, and duplicate or large files. OSV covers up to 50 packages, and the rest is listed as not checked.

A partial result is not a pass. The not-checked list goes back line for line.

## Layout

- `mcp/` — the local server and the review entry.
- `shared/` — the checks, the severity table, the report builder, the governance reader.
- `skills/launchsense/` — the skill your coding tool reads.
- `install.sh` — the installer.
- `public/install.txt` — the plain-text brief an agent reads to set everything up.

## The other half

The website and the policies live in a separate repository, `launchsense-core`, which is private. It holds the policy and governance engine, the backend, and the site. The policy text still reaches your tool through the policy source.

If you want the whole thing local with no policy source and no network at all, ask the creator for access to the policy and governance engine: https://www.withkeshav.com

## Run it directly

No build step and no dependencies. The engine runs on Node 24 or newer with types stripped:

```
node --experimental-strip-types mcp/review-entry.ts --root /path/to/your/repo
```

## License

Open core. MIT for the paths `LICENSE.txt` names, proprietary for the rest.
