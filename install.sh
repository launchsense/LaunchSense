#!/bin/sh
# Local review for a checkout of this repository.
# People using LaunchSense add https://harmless-chihuahua-667.convex.site/mcp
# They do not run this script.
# Alpha has no login. Usage counts are on unless you set LAUNCHSENSE_DIAGNOSTICS=off
# or pass --enterprise.

set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TIER=alpha
DIAGNOSTICS=on
if [ "${1:-}" = "--enterprise" ] || [ "${LAUNCHSENSE_TIER:-}" = "enterprise" ]; then
  TIER=enterprise
  DIAGNOSTICS=off
fi
if [ "${LAUNCHSENSE_DIAGNOSTICS:-}" = "off" ]; then
  DIAGNOSTICS=off
fi

echo "LaunchSense local review for this checkout."
echo "Public users add https://harmless-chihuahua-667.convex.site/mcp and do not run this script."
echo "This local review reads files on this machine. It does not upload them."
echo "If diagnostics stay on, we receive rule id counts, the harness name, the version, duration, and which order source ran. We do not receive code, paths, titles, or function names."
if [ "$DIAGNOSTICS" = "on" ]; then
  echo "Diagnostics: on. Set LAUNCHSENSE_DIAGNOSTICS=off to refuse."
else
  echo "Diagnostics: off."
fi

mkdir -p "$HOME/.config/launchsense"
cat > "$HOME/.config/launchsense/config.json" <<EOF
{
  "tier": "$TIER",
  "diagnostics": "$DIAGNOSTICS",
  "agreed": true,
  "authRequired": false,
  "harness": "local"
}
EOF

SKILL_SRC="$ROOT/skills/launchsense/SKILL.md"
for dest in \
  "$HOME/.cursor/skills/launchsense" \
  "$HOME/.claude/skills/launchsense" \
  "$HOME/.codex/skills/launchsense"
do
  mkdir -p "$dest"
  cp "$SKILL_SRC" "$dest/SKILL.md"
done

# The server is a Go module in mcp/. There is no go.mod at the repo root, so
# `go run ./mcp` cannot start. cwd must be the module folder and args must run
# the module in place. Without go on PATH, write no server at all rather than
# a config that cannot start.
if ! command -v go > /dev/null 2>&1; then
  echo "go is not on PATH, so the local MCP server was not registered."
  echo "Install Go, then run: cd $ROOT/mcp && go run ."
  echo "The skill and the alpha config above are installed. The hosted address does not need Go."
  exit 0
fi

mkdir -p "$HOME/.cursor" "$HOME/.config/launchsense"
CONFIG="$HOME/.cursor/mcp.json"
if [ ! -f "$CONFIG" ]; then
  # cwd is the module folder, so LAUNCHSENSE_ROOT names the checkout to review.
  # Without it the server would read the mcp folder instead of the checkout.
  cat > "$CONFIG" <<EOF
{
  "mcpServers": {
    "launchsense": {
      "command": "go",
      "args": ["run", "."],
      "cwd": "$ROOT/mcp",
      "env": {
        "LAUNCHSENSE_ROOT": "$ROOT",
        "LAUNCHSENSE_REVIEW": "$ROOT/mcp/review-entry.ts",
        "LAUNCHSENSE_AUTH_REQUIRED": "0"
      }
    }
  }
}
EOF
  echo "Wrote $CONFIG"
else
  echo "Left existing $CONFIG in place. Point launchsense at: cd $ROOT/mcp && go run ."
  echo "Set LAUNCHSENSE_ROOT=$ROOT in that entry so the server reviews the checkout, not the mcp folder."
fi

echo "Installed the launchsense skill and the alpha config. Auth is not checked."
