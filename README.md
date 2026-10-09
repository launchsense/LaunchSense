# LaunchSense

This is the engine and the skill. Clone it, run one installer, and your coding tool audits your repo on your own machine.

The two halves are separate on purpose. The checks live here: fixed analyzers, the severity table, the report builder, the governance reader. The coaching material lives online: the policy source serves the rules, the checklist, and the audit instructions, and it holds no code of yours. A coaching change reaches you on the next policy fetch. A change to a detector is a code change, and code reaches you when you pull this repo.

## Install

```
git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh
```

The installer asks two questions, copies the skill into your coding tool, and registers the local server and the policy source. Then it points you at your first audit. It reviews the folder it lives in by default, and prints which folder that is. To review a different repo, name it with an absolute path: `./install.sh --root /absolute/path/to/your/repo` (also `--repo`). The flag takes an absolute, existing folder, and neither that folder nor the LaunchSense checkout may hold a quote, a backslash, a dollar sign, a backtick, or a control character, because both are written into the server config; a bad path is refused and nothing is registered.

The review runs on your machine and uploads no files and no file text. It does reach the network unless you run it offline: OSV receives package names, ecosystems, and versions for lockfile versions, at most 50 per run; deps.dev and ClearlyDefined receive package names and versions, at most 15 non-dev packages per run; OpenSSF Scorecard receives the GitHub repo slug when your package.json names one. Usage counts default to no, and that question does not gate these calls: the one switch that covers all of them is `LAUNCHSENSE_OFFLINE=1`.

Two models are easy to confuse, so they are named apart. The model that writes the audit is your coding harness's own model, on your provider, and its privacy is your harness's business; this installer configures nothing there. The engine's optional decision lane is separate and narrower: `shared/adapters/decision.ts` names its providers, a local Ollama model that is a development instrument, and TypeSafe at api.typesafe.ai and Perplexity at api.perplexity.ai, which run only when an operator sets `TYPESAFE_API_KEY` or `PERPLEXITY_API_KEY`. Two things turn the lane on, and the installer does neither: the switch `LAUNCHSENSE_LOCAL_DECISION=1`, which needs no key, and a hosted key. The local rung's default address is loopback on this machine, and it can be pointed elsewhere by configuration, so a local run is not guaranteed to stay on the machine. When the reorder path runs, its state carries the finding title, severity, and rule id, and a title can itself contain a file path, a line number, a host name, or a package name and version; the question keys are hash-derived, so the raw fingerprint is not sent. The unknown-next-look lane sends only a fixed choice list. Those engine calls are operator configuration, not your harness's model, and the usage question does not gate them.

Platforms: Linux is the verified platform. macOS is allowed and untested. The review pins a directory handle and refuses to follow links, which needs `/proc/self/fd` on Linux or `/dev/fd` on macOS, so every other platform, Windows included, is refused by name rather than quietly mis-read. Node 24 or newer is required, and the installer checks for it before it registers the server: without a new-enough node the skill and the config are installed and the server is not, and the installer says so instead of reporting a finished install. A new-enough Node does not by itself make Windows work.

## What it checks

Secrets left in tracked files, licenses that need a person, dependencies with known holes or floating versions, risky code, project hygiene, and duplicate or large files. OSV covers up to 50 packages, and the rest is listed as not checked. These are the fixed analyzers in this repository, a known set, not a certificate of full coverage.

A partial result is not a pass. The not-checked list goes back line for line. The report states its own completeness in one line, `Review complete.` or `Review incomplete:` with the reasons in words. Ask again as a change review: the scan takes an optional `mode`, where `change` scopes the findings to what changed since the base of your branch and names that base, while the whole allowed tree is still read for context. A newly added `.ls/policy.yaml` acceptance shows up as one info row.

The report leads with the solution: START HERE, then PLAN, then DETAIL. The review never edits your source code. It writes only its own state under `.ls/`, plus one `.ls/` line in `.gitignore`, and only after the local file-read question has been answered.

## Layout

- `mcp/` - the local server and the review entry.
- `shared/` - the checks, the severity table, the report builder, the governance reader.
- `skills/launchsense/` - the skill your coding tool reads.
- `install.sh` - the installer.
- `public/install.txt` - the plain-text brief an agent reads to set everything up.

## The policy source

The policy text is served online at `https://harmless-chihuahua-667.convex.site/mcp`. It answers one closed, argument-free tool and returns the whole bundle in one call: version, skill, rules, checklist, and audit instructions. It takes no arguments, so it receives no repository source. The website and the policy service are run separately by the vendor and are not part of this repository.

## Run it directly

No build step and no dependencies. The engine runs on Node 24 or newer with types stripped:

```
node --experimental-strip-types mcp/review-entry.ts --root /path/to/your/repo
```

## License

Open core. MIT, per file, for the files `LICENSE.txt` names, proprietary for the rest.
