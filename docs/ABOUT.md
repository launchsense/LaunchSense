# About LaunchSense

LaunchSense helps people check apps they built with AI before sharing them.

It reads a public repo and your live app the way a stranger would, and lists problems with proof. It gives one fix prompt for the top 3, then lets you re-check after you fix. It never changes your code.

## Who it is for

Builders who ship fast with AI coding tools and want a second set of eyes on a public repo before they share the link. You paste a repo link, get a plain report, hand the fix prompt to your coding helper, fix, then scan again.

## The moment it is built for

The moment after a repo becomes public and before you share the link. Public means every future reader can see it, including anything already committed. That is when a leaked key, a copyleft license, or a missing README stops being a private problem.

It reads public repos only. A private repo cannot be scanned, and no local agent or MCP setup is included here.

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
- **No shareable artifact.** The result has to become a link a judge or client can open on a phone. Chat text is not that.
- **No honest coverage accounting.** Counting what was read and marking the rest Unknown needs a fixed checker version and a shared store.
- **The policy bookkeeping rots.** Mapping evidence to OWASP ASVS requirements with version, coverage, and caveat does not survive inside a prompt file.

Same checks. A memory, a deadline trigger, and an artifact.

## Who built it

Built by someone who is not a developer, in the sense that this was never the job title.

LaunchSense came out of shipping AI-built products in real work, used by my own company and people in my industry. Every problem it reports is one I hit first-hand. The main interest behind it is the policy layer around AI-built software: what gets checked, what gets claimed, and what is honestly left unknown.

Anonymously, on purpose. The work is the reason.
