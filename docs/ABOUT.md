# About LaunchSense

LaunchSense checks the codebase, not the business. It does not say if the app will sell.

You built the app with an AI coding tool. It works, and you are about to share the repo. You do not know what to ask Codex, so the check never starts. LaunchSense already knows what to ask. It says what is wrong, in plain words, and gives a prompt you can paste. It never changes your code.

## What it solves

- A leaked key, token, password, or private key.
- A license that does not fit, including copyleft or missing terms. A signal, not legal advice.
- A dependency with a known hole, or one with no fixed version.
- Risky code, like eval, or a database query built from text.
- A missing README, tests, or CI.
- Duplicate files and huge files.

The website paste and the hosted MCP check duplicate files and large files.

## Why use it

You do not need the name of the problem. The checks are fixed, so a model does not invent a finding. You leave with a prompt for Codex, Cursor, or Claude. The report says what it did not read, and a gap is not a pass. It does not change your code, block a deploy, or judge whether anyone will pay.

## Policies and standards

Policy means the rules for the codebase. A license is one rule inside that, not the whole layer. The findings sit on OWASP Top 10, OWASP ASVS, OSV, and CWE. Each line is a signal with a caveat. It is not a certification, and it is not a verdict that the product will sell.

## Who it is for

People who ship fast with AI coding tools and have no name for these problems. A public repo needs no account. Sign in to read one private repo, or more of a public one. The Connect page shows the MCP address a coding tool adds.

## The moment it is built for

The moment before you share the link, whether the repo is public or still private. The leaked key or the copyleft license is already in the history. Checking the code before anyone else sees it is the job. Judging the market is not.

What runs today is the public paste, a signed-in read of one repository on your GitHub token, and the same public read from the hosted MCP. A guest read stops at 200 files and about 2MB. Signed in, the cap is 1,000 files and about 8MB. The Connect page shows the MCP address.

## What it will not do

- It will not change your code.
- It will not block publishing.
- It will not store raw secret values.
- It will not call a partial result a pass.
- It will not claim a certification or a compliance pass.
- It will not pretend a fetch check proves how a page looks on a phone.

## Why not just a skill in your coding agent

Honest answer, because it is the whole difference.

A skill can already do most of the checking. It can read your repo, run patterns, fetch a public repo, and write you a fix prompt. We are not claiming to analyse better.

Where a skill genuinely falls short:

- **Nobody runs it at the right moment.** A skill fires when you open a chat. The moment that matters is the deadline, usually alone, late.
- **No memory between people or sessions.** The fix and re-check loop needs the old findings, your accepted-risk decisions, and the previous coverage to survive and be shared.
- **No shareable artifact.** The result has to become a link a reviewer or client can open on a phone. Chat text is not that.
- **No honest coverage accounting.** Counting what was read and marking the rest Unknown needs a fixed checker version and a shared store.
- **The policy bookkeeping rots.** Mapping evidence to OWASP ASVS requirements with version, coverage, and caveat does not survive inside a prompt file.

Same checks. A memory, a deadline trigger, and an artifact.

## Why not just GitHub Security

GitHub Security is the upstream place for dependency and code findings. LaunchSense should not replace it. For a connected repo, LaunchSense can read the same evidence, explain it in plain words, put the top three into one fix prompt, and then compare what changed on the next scan.

## Who built it

Built by someone who is not a developer, in the sense that this was never the job title.

LaunchSense came out of shipping AI-built products in real work, used by my own company and people in my industry. Every problem it reports is one I hit first-hand. The main interest behind it is the policy layer around AI-built software: what gets checked, what gets claimed, and what is honestly left unknown.

Anonymously, on purpose. The work is the reason.
