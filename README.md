# LaunchSense

This is the engine and the skill. Clone it, run one installer, and your coding tool audits your repo on your own machine.

The two halves are separate on purpose. The checks live here: fixed analyzers, the severity table, the report builder, the governance reader. The coaching material lives online: the policy source serves the rules, the checklist, and the audit instructions, and it holds no code of yours. A coaching change reaches you on the next policy fetch. A change to a detector is a code change, and code reaches you when you pull this repo.

## Install

```
git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh
```

The installer asks one file-read question, copies the skill into your coding tool, and registers the local server and the policy source. Then it points you at your first audit. It reviews the folder it lives in by default, and prints which folder that is. To review a different repo, name it with an absolute path: `./install.sh --root /absolute/path/to/your/repo` (also `--repo`). The flag takes an absolute, existing folder, and neither that folder nor the LaunchSense checkout may hold a quote, a backslash, a dollar sign, a backtick, or a control character, because both are written into the server config; a bad path is refused and nothing is registered.

The review runs on your machine and uploads no files and no file text. It does reach the network unless you run it offline: OSV receives package names, ecosystems, and versions for lockfile versions, at most 50 per run; deps.dev and ClearlyDefined receive package names and versions, at most 15 non-dev packages per run; OpenSSF Scorecard receives the GitHub repo slug when your package.json names one. Local audit usage counts are not sent, even with an old opt-in or a configured endpoint. The installer asks no usage question and preserves historical usage ledger entries. The switch that covers the engine's outbound calls is `LAUNCHSENSE_OFFLINE=1`.

Two models are easy to confuse, so they are named apart. The model that writes the audit is your coding harness's own model, on your provider, and its privacy is your harness's business; this installer configures nothing there. The engine's optional decision lane is separate and narrower: `shared/adapters/decision.ts` names its providers, a local Ollama model that is a development instrument, and TypeSafe at api.typesafe.ai and Perplexity at api.perplexity.ai, which run only when an operator sets `TYPESAFE_API_KEY` or `PERPLEXITY_API_KEY`. Two things turn the lane on, and the installer does neither: the switch `LAUNCHSENSE_LOCAL_DECISION=1`, which needs no key, and a hosted key. The local rung's default address is loopback on this machine, and it can be pointed elsewhere by configuration, so a local run is not guaranteed to stay on the machine. When the reorder path runs, its state carries the finding title, severity, and rule id, and a title can itself contain a file path, a line number, a host name, or a package name and version; the question keys are hash-derived, so the raw fingerprint is not sent. The unknown-next-look lane sends only a fixed choice list. Those engine calls are operator configuration, not your harness's model. Retiring the usage sender does not disable them.

Platforms: Linux is the verified platform. macOS is allowed and untested. The review pins a directory handle and refuses to follow links, which needs `/proc/self/fd` on Linux or `/dev/fd` on macOS, so every other platform, Windows included, is refused by name rather than quietly mis-read. Node 24 or newer is required, and the installer checks for it before it registers the server: without a new-enough node the skill and the config are installed and the server is not, and the installer says so instead of reporting a finished install. A new-enough Node does not by itself make Windows work.

## What it checks

Secrets left in tracked files, licenses that need a person, dependencies with known holes or floating versions, risky code, project hygiene, and duplicate or large files. OSV covers up to 50 packages, and the rest is listed as not checked. These are the fixed analyzers in this repository, a known set, not a certificate of full coverage.

A partial result is not a pass. The not-checked list goes back line for line. The report states its own completeness in one line, `Review complete.` or `Review incomplete:` with the reasons in words. Ask again as a change review: the scan takes an optional `mode`, where `change` scopes the findings to what changed since the base of your branch and names that base, while the whole allowed tree is still read for context. A newly added `.ls/policy.yaml` acceptance shows up as one info row.

The report leads with the solution: START HERE, then PLAN, then DETAIL. The review never edits your source code. It writes only its own state under `.ls/`, plus one `.ls/` line in `.gitignore`, and only after the local file-read question has been answered.

## Large files: provider checks, not a full-file pass

The review admits at most 5,000 files and reads at most 40,000,000 content bytes.
Ordinary whole-content analysis uses a 100,000-byte buffer limit. Larger `.html`,
`.htm`, `.js`, `.jsx`, `.mjs` and `.cjs` files can receive only a supported
provider-signature stream with a 64 KiB read buffer. Both paths share the same
file and byte budgets. The lockfile exception is unchanged; other large extensions
remain skipped and listed as not checked.

The stream checks AWS access-key shapes (`AKIA` plus 16 uppercase letters or digits),
the five legacy GitHub token prefixes (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` plus
20 alphanumeric characters), `github_pat_` plus 20 letters, digits or underscores,
and six standard private-key BEGIN labels: generic, RSA, EC, DSA, OPENSSH and ENCRYPTED.
A matching shape is not proof that a credential is live. Generic credentials, risky
code, repeated functions and other whole-content checks do not run on these files.
Those checks stay `Not checked`, so a finished provider stream is still a partial review.

Provider coverage is `Checked` only for a complete stable read, `Partial` for a
judged prefix, `Not checked` when the byte budget leaves no provider bytes judged,
or `Unknown` after a read error, mutation or NUL binary content. Invalidated
observations are discarded, not reported as a clean zero. Detection continues after
20 listed matches and retains the known unlisted count. Matched values and snippets
are not returned.

Streamed locations use zero-based byte offsets, one-based LF lines and one-based
UTF-8 byte columns, not decoded character columns. A full artifact SHA-256 requires
a complete stable read. JSON exposes `artifactCoverage`, `streamedProviderSummary`,
`artifactIdentities` and listed `artifactSignals`. Saved text retains the safe
coordinates and hash, and labels signals not raised after scope filtering or
governance. A retained signal is not necessarily a final finding; a hash is not clearance.

This needs an updated engine checkout, not just a coaching refresh. The stream uses
Node builtins, adds no dependencies, executes no target code and makes no network
requests. The Node version guard is not an operating-system sandbox. These signals
do not guarantee security or provide SOC 2, ISO or any certification.

## Report output and saved copies

`launchsense_scan_repo` returns its report directly. After scanning, use that
returned output, including when saving was declined. `launchsense_report` reads
only an available saved Markdown copy under `.ls/reports`; it does not cache the
last scan output. Saving an optional copy requires the current file-read/report-
saving acknowledgement. No saved copy does not prove whether this root was scanned
or how saving was answered. For an unscanned root, run a first scan for its direct
output; scanning does not always save a copy.

## Layout

On a rescan, accepted findings stay named in the not-checked list but no longer contribute to the lead's finding count, fix plan or prompts. Tree and change reviews rebuild these from the final findings. Files-read counts and applicable unrun checks remain unchanged. JSON, MCP scan output and an acknowledged saved report describe the same remaining work. Pull the newer engine for this behavior; refreshing the policy bundle alone does not update code.

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

## Public CI

GitHub's required `check` verifies Node 24 syntax, local MCP startup, initialization and tool discovery in an isolated profile. It does not run a repository audit or the detector evals. Those tests stay in the separate product repository. A fixed check, not full coverage.

## License

Open core. MIT, per file, for the files `LICENSE.txt` names, proprietary for the rest.
