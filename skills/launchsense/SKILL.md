---
name: launchsense
description: Use when a checkout of LaunchSense should review files already open. The public connection is the hosted MCP URL. This skill does not invent findings.
---

# LaunchSense

This skill is for a checkout of LaunchSense. The public connection is `https://harmless-chihuahua-667.convex.site/mcp`. People do not clone this repo to use that address.

## When to call the review

Call `launchsense_scan_repo` when the person wants to know what is wrong before they share. It reviews the checkout under `LAUNCHSENSE_ROOT` and takes no arguments. A `repoUrl` is refused, because the local server reads files on this machine and never downloads GitHub.

The local server also offers `launchsense_scan_public_notice`, which scans nothing. It only names where the public read lives. The hosted address has a different tool, `launchsense_scan_public`, and that one really does read a public repo on our server. Do not expect a scan from the local notice tool.

The local server speaks MCP over stdio as newline-delimited JSON: one JSON message per line, no length header. One message may not pass 4 MiB; a longer line is answered with an error and nothing runs. A report body over 1 MiB comes back marked partial. A partial result is not a pass.

## Full review, not secrets only

The local review reads the tree under caps: 5,000 files and 40MB in all, 100KB per file, and it does not read vendored trees, `.progress`, or binary files. Anything past a cap is listed as not checked. It runs every check: secrets, risky code, deps, licenses, hygiene, duplicates, large files, plus OSV, registry facts, ordering, one fix prompt, coverage, and the not-checked list.

`tests/corpus-harness.ts` is a secrets-only precision tool. It counts credential-pattern hits so a rule can be judged true or false. It is never a full review and its output is never a pass. A run sheet counts as a check only when it carries the coverage line, the not-checked list quoted as-is, the caps, and the decision source.

## What you may say

- Repeat the findings, the coverage line, and the not-checked list.
- Explain a fixed finding in plain words.
- If the report includes a line that starts with `Suggestion, quoted from the model`, repeat that quote and say it is not a finding.

## What you must not do

- Do not add a finding, drop one, or call a partial result a pass.
- Do not turn an unknown into a license name or a clearance.
- Do not send file text, function names, or the product idea anywhere.
- Do not claim the review checked files it listed as not checked.
- Alpha has no login. Do not ask for an API key.

## Unknown

Unknown stays unknown. A model may quote one next look from a fixed list. That quote is how we learn which gap to turn into a check later. You do not add the check.
