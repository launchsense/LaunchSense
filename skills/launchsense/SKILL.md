---
name: launchsense
description: Use when the repo you have open should be reviewed before you share it. Reviews your own checkout on your machine, free and unlimited, and uploads no files. This skill does not invent findings.
---

# LaunchSense

Skill version: 2026-10-14.2.

This skill reviews **your** checkout, the repository you installed it into, not only a checkout of LaunchSense itself. It runs on your machine, reads your working tree including uncommitted work, uploads no files and no file text, and has no hourly limit.

There is one way to run this check: on the machine it is installed on, against the files that are there.

## What leaves the machine

Say this early, and say it accurately. The review uploads no files and no file text. On an online run it does send small facts outward:

- to OSV, the ecosystem, name, and version of lockfile packages, at most 50 per run;
- to deps.dev and ClearlyDefined, the package name and version, at most 15 non-dev packages per run;
- to OpenSSF Scorecard, the github.com/owner/repo slug, only when package.json names one;
- to the engine's optional decision lane, only when it is switched on. `shared/adapters/decision.ts` names the providers: a local Ollama model, a development instrument that is off unless `LAUNCHSENSE_LOCAL_DECISION=1` is set, which needs no key, TypeSafe at api.typesafe.ai when `TYPESAFE_API_KEY` is set, and Perplexity at api.perplexity.ai when `PERPLEXITY_API_KEY` is set. The installer sets neither the switch nor a key, so by default no model request is made. The local rung's default address is loopback on this machine and can be pointed elsewhere, so a local run is not guaranteed to stay on the machine. When the reorder path runs, its state carries the finding title, severity, and rule id, and a title can itself hold a file path, a line number, a host name, or a package name and version; the question keys are hash-derived, so the raw fingerprint is not sent; the unknown-next-look path sends only a fixed choice list;
- no local audit usage counts are sent to LaunchSense, even with an old opt-in or a configured endpoint. The installer asks only the file-read question and preserves historical usage ledger entries without writing a new usage decision.

`LAUNCHSENSE_OFFLINE=1` turns the engine's outbound calls off for the run. There is no usage question; that switch covers the engine calls above. The policy fetch carries nothing about the repo. The model writing this audit is the model the person's harness is configured with, on the person's own provider; that inference is not this engine, and its privacy depends on that harness and provider, not on anything the installer sets.

## How it runs

The server is `mcp/server.ts` in the checkout, started with `node mcp/server.ts`. It speaks MCP over stdio as newline-delimited JSON: one JSON message per line, no length header. One message may not pass 4 MiB; a longer line is answered with an error and nothing runs. A saved report over 1 MiB is refused with an error rather than returned whole. A review that runs past its 10 minute budget is killed and reported as an error, not as a report. A partial result is not a pass.

## Policy source

The policy source is online at `https://harmless-chihuahua-667.convex.site/mcp`. It answers one tool, `launchsense_get_policy`, which returns the whole bundle in one call: version, skill, rules, checklist, and audit instructions. It takes no arguments and stores no code, so it receives no repository source.

Fetch it once, at install, and keep the copy in this skill folder. Later runs read that local copy and make no policy calls, so a normal session asks for no approvals. Re-fetch only when the person asks, or when the person has approved an online fetch. There is no automatic version comparison without a call and no auto-update: a coaching change reaches you on the fetch you were asked to make, and a change to a detector is a code change that reaches you when the engine is pulled.

Local reads the files. Online serves the policies. Read the rules, run `launchsense_scan_repo` here, and write the audit locally. It takes one optional argument, `mode`: `tree` (the default) reviews the whole working tree, and `change` scopes the findings to what changed since the base of the branch and names that base, while the whole tree is still read for context. A policy change reaches you on the next fetch. Nothing to reinstall.

## First run after install

Run the installer from the checkout of LaunchSense itself, and name the repo to review so it is never guessed: `sh ./install.sh --root /absolute/path/to/the/person's/repo` (also `--repo`). The flag takes an absolute, existing folder, and it is the repo to review. With no flag the installer targets the folder it lives in, which is LaunchSense, not the person's repo, and it prints that target. Neither path may hold a quote, a backslash, a dollar sign, a backtick, or a control character, because both are written into the server config; a bad path is refused and nothing is registered. If the installer reports that Node is missing or older than 24, the server was not registered: say so, and do not report a finished install. The review itself needs a pinned directory handle, which is available on Linux and macOS and refused on other platforms, Windows included.

After `./install.sh` finishes, run the first audit immediately, on the repo the person has open, and show them the report. Setup is not done until they have seen one real result. Ask for approval once, covering the policy fetch and this one review, so the whole first run is smooth. The installer's own one question is not that approval: it asks only whether it may read the agent instruction files and save the local report copy, and it does not gate the ordinary review. This approved review is what authorizes reading the working tree.

## Check for updates

Your installed copy of this skill can go stale. There is no automatic version check. When the person asks for an update, or has approved an online fetch, call `launchsense_get_policy`, compare the bundle version with the Skill version line in your copy, and follow online when it is newer. Say in one line that you refreshed it.

## When to call the review

Call `launchsense_scan_repo` when the person wants to know what is wrong before they share. It reviews the checkout under `LAUNCHSENSE_ROOT`, which must be absolute and must exist, and it names the folder it read when that folder is not a LaunchSense checkout. It takes one optional `mode` argument: `tree` (the default) reads the whole working tree, and `change` scopes the findings to what changed since the base of the branch, while the whole tree is still read for context, and the base is named in the report. A `repoUrl` is refused, because the server reads files on this machine and never downloads GitHub.

## Completeness, and how to quote it

Every report states its own completeness in one line right after the coverage line: `Review complete.` or `Review incomplete: <reasons in words>`. Quote that line as it is. Never invent a completeness line, and never call an incomplete review a pass. The reasons name the checks that applied and did not run; a check that does not apply to this repo is not a reason. Over MCP the same facts arrive as report text, so an incomplete review is not an error: `isError` is reserved for a review that could not run at all.

## The `.ls` files

The review keeps its own state in a `.ls` folder under `LAUNCHSENSE_ROOT`. The folder is gitignored and stays on the machine. Reads go through pinned directory handles with the final component refusing a link, so a swapped directory or a link cannot move a read or a write outside the checkout. Symbolic links inside the tree are not followed and are listed as skipped.

### `.ls/policy.yaml`

The review reads a governance file at `.ls/policy.yaml`, once per run, before the walk, and shares that one read with every later step. It is the repo's own memory: the findings the person already looked at and accepted, each with a reason, so a later review does not raise them again. It is declarative only. It cannot run code, disable a rule, or change a severity.

- A finding is only ever hidden when an acceptance names it, by fingerprint, by rule and path, or by rule alone, or when an ignored path covers it. Nothing else is hidden.
- On a `change` run, an acceptance added since the last report is reported as one info row naming the rule and the path. It is a disclosure, never above info, and never a block.
- An absent file changes nothing. A link, an unreadable file, or a file over the 1 MiB metadata bound is a refusal, never a silent absence.
- A wrong file is refused whole and nothing is suppressed. A file that would silence more than half the findings through one acceptance, or four fifths in total, is refused whole too. A refusal is stated in the not-checked list.
- An accepted finding is named in the not-checked list as accepted, so a reader can always see what was hidden and why.
- In tree and change reviews, the lead, finding counts, fix plan and prompts are rebuilt from the final findings after acceptance and change filtering. An accepted finding does not contribute to those recommendations. Files-read counts and applicable unrun checks do not change because a finding was accepted. If the summaries disagree with the findings, keep that inconsistency visible rather than calling the result complete.
- Do not commit it unless the repo owner says to.

When the person accepts a finding, write the acceptance into `.ls/policy.yaml` with their reason. Do not write the file silently: show them the entry and let them confirm. Never remove an acceptance they made without asking.

### `.ls/reports/`

Each acknowledged review writes its own files under `.ls/reports/`, all named from the run's timestamp, which is the ISO time with its colons and dots replaced by hyphens:

- the report, `<stamp>.md`. It is written last, after every fallible side file, so the saved copy and the terminal report state the same status, findings, and gaps. The saved copy carries no usage-count line and no model quote. The terminal report says `Usage counts were not sent.` JSON reports `diagnosticsSent: false` and `diagnosticsReason: "disabled"`.
- the policy snapshot, `<stamp>.policy.yaml`: the exact bytes that were read, or an empty policy when the file was absent, and no snapshot at all when the read was refused.
- the third-party notice, `<stamp>-THIRD-PARTY-NOTICES.generated.md`.

The folder is written only when the local file read was acknowledged. It stays on the machine and is not committed. The first time it is written, one `.ls/` line is added to `.gitignore`, and the report says so when that cannot be done.

## Full review, not secrets only

The local review admits at most 5,000 files and reads at most 40,000,000 actual working-tree content bytes. Ordinary whole-content analysis uses a 100,000-byte buffer limit; eligible larger files receive only the provider stream below. `package-lock.json` and names ending in `-lock.json` may exceed the per-file cap, never the remaining total budget. Binary content later skipped consumes that budget. Local metadata files, such as the policy or an `.ignore` file, are read under a separate 1 MiB bound each. The walk excludes vendored trees (`vendor`, `third_party`, `3rdparty`, `deps`), installed packages or tool caches (`node_modules`, `.venv`, `venv`, `site-packages`, `.tox`, `.mypy_cache`, `.pytest_cache`, and the rest of the named list), and `.progress`. Binary content is not analyzed. Anything past a cap is listed as not checked.

The line-level checks carry their own gates, and the report names each one when it fires: the secret checks do not judge lines over 2,000 characters, the code-shape checks do not judge lines over 500 characters, a file stops at 20 matched lines, and the per-file omission list stops at 10 rows with one count-only row for the rest, whose totals include every affected file.

It runs applicable secrets, risky-code, dependency, licence, hygiene, duplicate and large-file checks within their limits, plus OSV, registry facts, ordering, the fix plan, coverage and the not-checked list where available. It does not run every check on every artifact. These are the fixed analyzers in this repository, a known set, not a certificate of full coverage.

### Large artifacts: preserve the provider-only boundary

Larger `.html`, `.htm`, `.js`, `.jsx`, `.mjs` and `.cjs` files can receive a provider-signature stream with a 64 KiB read buffer. Paths are sorted deterministically; stream bytes and admitted files consume the same global budgets, not extra allowances. Other large extensions remain skipped and the lockfile exception is unchanged.

The stream checks only `AKIA` plus 16 uppercase letters or digits; the five legacy GitHub prefixes `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` plus 20 alphanumeric characters, or `github_pat_` plus 20 letters, digits or underscores; and six standard private-key BEGIN labels (generic, RSA, EC, DSA, OPENSSH, ENCRYPTED). Generic credentials, code shapes, repeated functions and other whole-content checks remain `Not checked` in `artifactCoverage`. Completing the provider stream leaves the overall review `Partial`, never a full-artifact pass.

Provider coverage is `Checked` only for a complete stable read, `Partial` for a judged prefix, `Not checked` when no provider bytes were judged under the budget, or `Unknown` after read errors, mutation or NUL binary content. Discarded observations are not a clean zero. Detection continues after 20 listed matches and retains the known withheld count. Matched values and snippets are not returned.

Streamed `byteOffset` is zero-based; line is one-based LF and column is a one-based UTF-8 byte column, not a decoded character column. A full artifact SHA requires a complete stable read. JSON exposes `artifactCoverage`, `streamedProviderSummary`, `artifactIdentities` and listed `artifactSignals`. Saved text retains safe coordinates and hashes and labels signals not raised after scope filtering or governance. Never treat an unraised signal, full hash or finished stream as clearance.

This requires an updated engine checkout, not just refreshed coaching. The stream uses Node builtins, adds no dependencies, executes no target code and makes no network requests. The Node guard is not an operating-system sandbox; Linux remains verified, macOS allowed but unverified, and Windows refused. Do not claim all vulnerabilities are found, a security guarantee or SOC 2/ISO certification. Existing buffered secret-line and code-shape omissions are unchanged.

## The report leads with the solution

The report opens with START HERE, then the lead fix prompt and the next prompts to paste, each naming the file. Then PLAN, the ordered fix steps, secrets first, each with its why, the files to open, and a short checklist. DETAIL comes last: the findings, the not-checked list line for line, the licence suggestion, and one line pointing at the third-party notice file, `THIRD-PARTY-NOTICES.generated.md`, written next to the report. The notice text is not dumped into the report body.

A solution here is the ranked, ordered fix path the fixed rules produce. It is not prose advice invented for the repo, and it is not a model's opinion.

## Licences, and the file you can commit

For an npm project with a committed `package-lock.json`, the review reads the licence every installed package declares, direct and transitive, and writes a third-party notice file named `THIRD-PARTY-NOTICES.generated.md`. That file is deterministic: the same lockfile gives the same bytes. It names each component with its licence, states what that licence text asks for with the clause it came from, and lists what was not read. It is a declaration, not legal advice.

- An Unknown licence stays Unknown. It is never a finding, never a severity, and never folded into a permissive group.
- A licence document is a recognised licence basename with no extension or a plain document extension; `COPYING.LESSER` and `COPYING.LIB` are also recognised. Known source kinds, including `.mjs`, `.zig` and `.jl`, retain code and secret checks without setting policy from quoted licence text. Unsupported root licensing inputs and listed-but-unread root documents remain unresolved, with not-checked coverage rows; a permissive manifest cannot clear them. Scope-limiting wording needs review, and unsupported or contradictory scope is `Unknown`, not an invented grant or restriction. Scope checks inspect all supplied content within existing caller read limits, not legal permission. Quote those gaps and do not call the whole project mirrorable.
- Each local `gh` metadata command has a 10-second deadline and a combined 65,536-byte output allowance. A failed exit or invalid privacy field is unavailable, not proof of absence or public visibility. Supported credential spans are refused even inside plain identifiers; repository detection is unchanged.
- The review also suggests one licence for the project, from the ids and counts the repo declares plus the allowlist in `.ls/policy.yaml`. It is a suggestion, not a licence fact, and copyleft or proprietary terms decline because those need a person. A lane may order the candidates; it cannot turn a decline into a pick.
- An OR expression stays a choice. Ask which one was chosen.
- yarn.lock, pnpm-lock.yaml, Cargo, Go and PyPI dependency licences, vendored trees and per-file SPDX headers are not read.
- The guarded AI lookup for an Unknown licence exists, and is refused unless a lane is configured. A lane answer is a suggestion, not a licence fact.

## What the AI is allowed to do

Two things reach a model on this engine, and nothing else. Both run through the decision lane in `shared/adapters/decision.ts`, and only when the lane is switched on: `LAUNCHSENSE_LOCAL_DECISION=1` turns on the local rung and needs no key, and a hosted rung runs when `TYPESAFE_API_KEY` or `PERPLEXITY_API_KEY` is set. The installer sets neither, so by default no model request is made. The local rung's default address is loopback on this machine and can be pointed elsewhere, so a local run is not guaranteed to stay on the machine. Both paths are soft, and both only ever touch findings the fixed checks already made: the reorder state carries the finding title, severity, and rule id, and the question keys are hash-derived, so the raw fingerprint is not sent; the quote path picks one next-look sentence for an unknown gap from a fixed list and sends no repository text. That quote is not a finding and does not turn an unknown into a licence or a pass.

Human oversight level, `humanOversightLevel` in C2PA Technical Specification 2.4, is `prompt_guided`: a person asked for the output and nobody approved it afterwards. No path in this product is `fully_autonomous` and none is `human_validated`. We borrow the vocabulary. We are not a C2PA claim generator.

The AI never decides a finding, a severity, a licence fact, consent, who a caller is, or whether a request is allowed. Each of those is fixed code: `shared/analyzers`, `shared/policies/severity.ts`, `shared/licensing`, `install.sh`. If a line suggests a model settled one of those, it is wrong.

## What you may say

- Repeat the findings, the coverage line, and the not-checked list.
- The not-checked list goes back as it is, line for line. Do not summarise it, shorten it, or merge its lines. If it has 19 entries, the person sees 19 entries. A shortened list reads as a complete one, and that is the one thing this product must never do.
- The coverage line goes back as it is: the file count, the skip count, and the sentence "A partial result is not a pass."
- Explain a fixed finding in plain words.
- If the report includes a line that starts with `Suggestion, quoted from the model`, repeat that quote and say it is not a finding.

## What you must not do

- Do not add a finding, drop one, or call a partial result a pass.
- Do not turn an unknown into a license name or a clearance.
- Do not describe the third-party notice file as clearance. It says what each package declares and what that text asks for. A person decides whether any of it applies to how the project ships.
- Do not send file text, function names, or the product idea anywhere.
- Do not claim the review checked files it listed as not checked.
- Do not say nothing leaves the machine. The review uploads no files, and it does send the small facts listed under What leaves the machine.
- Alpha has no login. Do not ask for an API key.

## Unknown

Unknown stays unknown. A model may quote one next look from a fixed list. That quote is how we learn which gap to turn into a check later. You do not add the check.
