#!/bin/sh
# Installs the LaunchSense MCP command and the one skill that governs it.
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

echo "LaunchSense alpha install."
echo "The review reads files on this machine. It does not upload them."
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

mkdir -p "$HOME/.cursor" "$HOME/.config/launchsense"
CONFIG="$HOME/.cursor/mcp.json"
if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
{
  "mcpServers": {
    "launchsense": {
      "command": "go",
      "args": ["run", "./mcp"],
      "cwd": "$ROOT",
      "env": {
        "LAUNCHSENSE_REVIEW": "$ROOT/mcp/review-entry.ts",
        "LAUNCHSENSE_AUTH_REQUIRED": "0"
      }
    }
  }
}
EOF
  echo "Wrote $CONFIG"
else
  echo "Left existing $CONFIG in place. Point launchsense at: go run ./mcp in $ROOT"
fi

echo "Installed the launchsense skill and the alpha config. Auth is not checked."
