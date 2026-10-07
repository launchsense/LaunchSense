---
name: launchsense
description: Use when the repo you have open should be reviewed before you share it. Reviews your own checkout locally, free and unlimited, and sends nothing to us. The public connection is the hosted MCP URL. This skill does not invent findings.
---

# LaunchSense

This skill reviews **your** checkout, the repository you installed it into, not only a checkout of LaunchSense itself. It runs on your machine, reads your working tree including uncommitted work, sends nothing to us, and has no hourly limit. The hosted connection is `https://harmless-chihuahua-667.convex.site/mcp`, which is the sample read of a public repo on our server, and it is shared and rate limited. The local check is the one with no limit.

## When to call the review

Call `launchsense_scan_repo` when the person wants to know what is wrong before they share. It reviews the checkout under `LAUNCHSENSE_ROOT` and takes no arguments. A `repoUrl` is refused, because the local server reads files on this machine and never downloads GitHub.

## The governance file: `.ls/policy.yaml`

The review reads a governance file at `.ls/policy.yaml` under `LAUNCHSENSE_ROOT`, if one exists. It is the repo's own memory: the findings the person already looked at and accepted, each with a reason, so a later review does not raise them again. It is declarative only. It cannot run code, disable a rule, or change a severity.

- A finding is only ever hidden when an acceptance names it, by fingerprint, by rule and path, or by rule alone. Nothing else is hidden.
- A wrong file is refused whole and nothing is suppressed. A file that would silence too much is refused whole too. A refusal is stated in the not-checked list.
- An accepted finding is named in the not-checked list as accepted, so a reader can always see what was hidden and why.
- The folder is gitignored and stays on the machine. Do not commit it unless the repo owner says to. The governance file is gitignored, so it is invisible to the hosted scan. Adoption is measured only from opted-in local diagnostics.

When the person accepts a finding, write the acceptance into `.ls/policy.yaml` with their reason. Do not write the file silently: show them the entry and let them confirm. Never remove an acceptance they made without asking.

The local server also offers `launchsense_scan_public_notice`, which scans nothing. It only names where the public read lives. The hosted address has a different tool, `launchsense_scan_public`, and that one really does read a public repo on our server. Do not expect a scan from the local notice tool.

The local server speaks MCP over stdio as newline-delimited JSON: one JSON message per line, no length header. One message may not pass 4 MiB; a longer line is answered with an error and nothing runs. A report body over 1 MiB comes back marked partial. A partial result is not a pass.

## Full review, not secrets only

The local review reads the tree under caps: 5,000 files and 40MB in all, 100KB per file, and it does not read vendored trees, `.progress`, or binary files. Anything past a cap is listed as not checked. It runs every check: secrets, risky code, deps, licenses, hygiene, duplicates, large files, plus OSV, registry facts, ordering, one fix prompt, coverage, and the not-checked list.

## Licences, and the file you can commit

For an npm project with a committed `package-lock.json`, the review reads the licence every installed package declares, direct and transitive, and writes a third-party notice file from it. That file is deterministic: the same lockfile gives the same bytes. It names each component with its licence, states what that licence text asks for with the clause it came from, and lists what was not read. It is a declaration, not legal advice.

- An Unknown licence stays Unknown. It is never a finding, never a severity, and never folded into a permissive group.
- An OR expression stays a choice. Ask which one was chosen.
- yarn.lock, pnpm-lock.yaml, Cargo, Go and PyPI dependency licences, vendored trees and per-file SPDX headers are not read.
- The guarded AI lookup for an Unknown licence exists, and is refused unless a lane is configured. A lane answer is a suggestion, not a licence fact.

`tests/corpus-harness.ts` is a secrets-only precision tool. It counts credential-pattern hits so a rule can be judged true or false. It is never a full review and its output is never a pass. A run sheet counts as a check only when it carries the coverage line, the not-checked list quoted as-is, the caps, and the decision source.

## What the AI is allowed to do

Three things, and nothing else. It rewrites a finding in plainer language. It can reorder findings inside one severity band, and only when a lane is configured. It can suggest a licence id for an Unknown one, and only through the guarded lookup, where the answer stays a suggestion.

Human oversight level, `humanOversightLevel` in C2PA Technical Specification 2.4, is `prompt_guided`: a person asked for the output and nobody approved it afterwards. No path in this product is `fully_autonomous` and none is `human_validated`. We borrow the vocabulary. We are not a C2PA claim generator.

The AI never decides a finding, a severity, a licence fact, consent, who a caller is, or whether a request is allowed. Each of those is fixed code: `shared/analyzers`, `shared/policies/severity.ts`, `shared/licensing`, `install.sh`, `convex/identity`, `convex/mcpLimit.ts`. If a line suggests a model settled one of those, it is wrong.

## What you may say

- Repeat the findings, the coverage line, and the not-checked list.
- Explain a fixed finding in plain words.
- If the report includes a line that starts with `Suggestion, quoted from the model`, repeat that quote and say it is not a finding.

## What you must not do

- Do not add a finding, drop one, or call a partial result a pass.
- Do not turn an unknown into a license name or a clearance.
- Do not describe the third-party notice file as clearance. It says what each package declares and what that text asks for. A person decides whether any of it applies to how the project ships.
- Do not send file text, function names, or the product idea anywhere.
- Do not claim the review checked files it listed as not checked.
- Alpha has no login. Do not ask for an API key.

## Unknown

Unknown stays unknown. A model may quote one next look from a fixed list. That quote is how we learn which gap to turn into a check later. You do not add the check.
