---
name: launchsense
description: Use when a checkout of LaunchSense should review files already open. The public connection is the hosted MCP URL. This skill does not invent findings.
---

# LaunchSense

This skill is for a checkout of LaunchSense. The public connection is `https://harmless-chihuahua-667.convex.site/mcp`. People do not clone this repo to use that address.

## When to call the review

Call `launchsense_scan_repo` when the person wants to know what is wrong before they share. Do not call `launchsense_scan_public` to download a repo. That tool does not download GitHub.

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
