# Run the check on your own machine

The local check reads the repo on your machine, including work you have not pushed. It sends nothing to us, and it has no hourly limit. It is free.

New here? Follow the one page that holds everything in order: `/start` on the website. What follows is the short version.

## What you need

- The repo, cloned: `https://github.com/launchsense/LaunchSense`
- Node 24 or newer on your PATH. Without Node the installer says so and registers no server.
- Cursor, Claude Code, or Codex. The installer drops the skill into all three.

## Install

Open your copy of the repo in a terminal and run:

```
./install.sh
```

On Windows, run it from Git Bash. It asks two questions.

1. Send anonymous usage counts. Default is no. Counts stay on your machine until you say yes.
2. Read your project files and agent instruction files, such as AGENTS.md. Default is yes. This is an acknowledgement, not consent, and it is described that way. Nothing is uploaded either way.

It then writes the server entry with `LAUNCHSENSE_ROOT` set to your checkout, so the server reviews the checkout and not its own folder. No login is needed.

## Give this to your agent

Paste this to the agent that has the checkout open:

```
Set up the local LaunchSense check from https://github.com/launchsense/LaunchSense. Clone it if it is not on this machine, run ./install.sh from its root, answer its two questions as I tell you, and confirm the launchsense server entry points LAUNCHSENSE_ROOT at my checkout. Then run a local review of my checkout and show me the report. Nothing is uploaded.
```

## What you get

- Unlimited local reviews of any repo on disk, public or private.
- Usage counts stay off unless you answered yes. Turn them off later with `LAUNCHSENSE_DIAGNOSTICS=off sh install.sh`.

## If it does not start

- `node is not on PATH`: install Node 24 or newer, then run `node <checkout>/mcp/server.ts` from the checkout.
- An existing `~/.cursor/mcp.json` is left in place. The installer prints the two entries to paste. `/start` shows the same block per tool.
