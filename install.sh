#!/bin/sh
# Local review for a checkout of this repository.
# Everyone who uses LaunchSense runs this script. It installs the skill,
# registers the local file review and the online policy source, and asks one
# question about reading agent instruction files and saving the local report.
#
# The folder to review defaults to this checkout, and that default is printed
# so it is never silent. Name your own repo with --root <folder> or
# --repo <folder>; the path must be absolute and must exist. The engine files
# this installer copies always come from this checkout, whatever the target is.
# Both paths are written into the server config, so both are checked for
# characters that would break it before anything is written.
#
# Usage counts are not collected on this machine: the local usage-count sender
# is retired, so there is no usage question and nothing is ever sent. The
# installer records no usage decision, and any earlier usage ledger lines are
# left exactly as they were.

set -eu
# The engine path: this checkout. Canonical, physical path, so a symlinked or
# relative route to it cannot put a different string into the config than the
# one that is validated and written.
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
TIER=alpha
# The wording of the local agent-file/report acknowledgement. Its own version,
# because it is its own question. Default is yes (operator decision), so the
# record and the register call it an acknowledgement and not consent. The version
# changed with the wording: the question now names exactly what the
# acknowledgement covers, the agent instruction files and the saved local report
# copy, so an answer given for the older, broader wording is not applied to it.
FILES_NOTICE_VERSION=2026-10-14
CONFIG_DIR="$HOME/.config/launchsense"
CONFIG="$CONFIG_DIR/config.json"
CONSENT_LOG="$CONFIG_DIR/consent.jsonl"

# The folder to review. The default is this checkout, which is right when the
# person runs the installer inside the repo they want reviewed, and silently
# wrong when they mean their own repo and this script is an engine they cloned
# beside it. So the default is disclosed and the person can name another folder
# with --root or --repo. The named folder is validated before anything is
# written: an absolute path, an existing folder, and a path whose characters
# cannot turn into a command or break the JSON config it is written into. A bad
# target stops the run. It never falls back to reviewing this checkout.
TARGET_ROOT="$ROOT"
TARGET_SET=0

usage() {
  cat <<'USAGE'
install.sh [--root <folder> | --repo <folder>] [--enterprise]

  --root, --repo <folder>  The repo to review. Must be an absolute, existing
                           folder. The default is this checkout, the folder
                           install.sh lives in.
  --enterprise             Record the enterprise tier in the local config.
USAGE
}

# A path is safe to write into the config when it cannot carry a shell quote, a
# command substitution, a backslash that eats the next character, or a control
# character that would split the JSON. A space and normal punctuation are fine.
is_safe_path() {
  case "$1" in
    *[\\]*) return 1 ;;
    *'"'*) return 1 ;;
    *'$'*) return 1 ;;
    *'`'*) return 1 ;;
    *[[:cntrl:]]*) return 1 ;;
  esac
  return 0
}

# A plain number: digits only, no leading zero, and short enough that the
# shell's integer arithmetic can hold it. A number up to eighteen digits compares
# safely; past that the comparison fails rather than returns false. Nine digits is
# well inside that range and far more than any Node major needs, so a very long
# numeric string is refused here and never reaches `[ -lt ]`.
is_plain_number() {
  case "$1" in
    '') return 1 ;;
    *[!0-9]*) return 1 ;;
  esac
  # No leading zero, except the number zero itself.
  case "$1" in
    0) return 0 ;;
    0*) return 1 ;;
  esac
  [ "${#1}" -le 9 ]
}

# The version string `node --version` prints, reduced to its major number. Only
# a real version shape counts: `v<major>.<minor>.<patch>`, where each part is a
# plain number, with an optional prerelease or build suffix after the patch
# (`v24.0.0-rc.1`, `v24.0.0+build.5`), which Node itself prints and which names
# major 24. Anything else, including a missing part, a word where a number
# belongs, a leading zero, a fourth part, or a number too long to compare, is 0.
# Zero is below the floor, so an unreadable version is refused, never coerced to
# a passing one.
node_major() {
  V="${1#v}"
  # Drop an optional prerelease or build suffix, and everything after it. The
  # shape of what remains is checked part by part below.
  CORE="${V%%[-+]*}"
  case "$CORE" in
    *.*.*) ;;
    *)
      printf '0'
      return 0
      ;;
  esac
  MAJOR="${CORE%%.*}"
  REST="${CORE#*.}"
  MINOR="${REST%%.*}"
  PATCH="${REST#*.}"
  # Exactly three parts: a fourth dot is not a version this reads.
  case "$PATCH" in *.*)
    printf '0'
    return 0
    ;;
  esac
  if ! is_plain_number "$MAJOR" || ! is_plain_number "$MINOR" || ! is_plain_number "$PATCH"; then
    printf '0'
    return 0
  fi
  printf '%s' "$MAJOR"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --root | --repo)
      if [ $# -lt 2 ]; then
        echo "error: $1 needs a folder, for example --root /home/you/myrepo" >&2
        exit 2
      fi
      TARGET_ROOT="$2"
      TARGET_SET=1
      shift 2
      ;;
    --enterprise)
      TIER=enterprise
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$TARGET_SET" -eq 1 ]; then
  case "$TARGET_ROOT" in
    /*) ;;
    *)
      echo "error: --root/--repo must be an absolute path, got: $TARGET_ROOT" >&2
      echo "A relative path is resolved against wherever you happen to be, which is how the wrong repo gets reviewed." >&2
      exit 2
      ;;
  esac
fi
if ! is_safe_path "$TARGET_ROOT"; then
  echo "error: the review target holds a character that cannot be used safely: $TARGET_ROOT" >&2
  echo "A path with a quote, a backslash, a dollar sign, a backtick, or a control character is refused rather than written into the config." >&2
  exit 2
fi
if [ ! -d "$TARGET_ROOT" ]; then
  echo "error: the review target is not an existing folder: $TARGET_ROOT" >&2
  exit 2
fi
CANONICAL=$(CDPATH= cd -- "$TARGET_ROOT" && pwd -P) || {
  echo "error: the review target could not be resolved: $TARGET_ROOT" >&2
  exit 2
}
TARGET_ROOT="$CANONICAL"
if ! is_safe_path "$TARGET_ROOT"; then
  echo "error: the resolved review target holds an unsafe character: $TARGET_ROOT" >&2
  exit 2
fi

# The engine path goes into the same JSON as the target, so it is held to the
# same rule, before anything is consented, configured, or copied. An engine
# checkout with a double quote, a backslash, or a control character can break
# the JSON config. Dollar signs and backticks are also refused under the same
# path policy as the target; those characters alone do not break JSON.
# The fix is to refuse and say so, not to rename the person's folder.
if ! is_safe_path "$ROOT"; then
  echo "error: the LaunchSense engine folder holds a character that cannot be written safely: $ROOT" >&2
  echo "A folder with a quote, a backslash, a dollar sign, a backtick, or a control character is refused rather than written into the server config." >&2
  echo "Move the LaunchSense checkout to a path without those characters, then run install.sh again." >&2
  exit 2
fi

mkdir -p "$CONFIG_DIR"

# The tier is recorded in the local config. The usage-count sender is retired,
# so the tier decides nothing about sending anymore; it is kept only so an
# enterprise install still names its tier. No question and no record are tied
# to it.
if [ "${LAUNCHSENSE_TIER:-}" = "enterprise" ]; then
  TIER=enterprise
fi

# The same test for a named purpose. Two purposes share one ledger, so a line is
# only a repeat of the decision being asked about when the purpose matches too.
# $1 purpose, $2 noticeVersion, $3 granted.
decision_on_log_purpose() {
  [ -f "$CONSENT_LOG" ] || return 1
  while IFS= read -r LINE; do
    case "$LINE" in
      *"\"purpose\":\"$1\""*"\"noticeVersion\":\"$2\""*"\"granted\":$3"*) return 0 ;;
    esac
  done < "$CONSENT_LOG"
  return 1
}

# The moment a named purpose's decision was made, read back from the ledger. A
# remembered answer keeps its original time, so a later run does not move it.
# $1 purpose, $2 granted.
decision_time_from_log_purpose() {
  [ -f "$CONSENT_LOG" ] || return 0
  FOUND=""
  while IFS= read -r LINE; do
    case "$LINE" in
      *"\"purpose\":\"$1\""*"\"granted\":$2"*) ;;
      *) continue ;;
    esac
    REST="${LINE#*\"decidedAt\":\"}"
    FOUND="${REST%%\"*}"
  done < "$CONSENT_LOG"
  if [ -n "$FOUND" ]; then printf '%s' "$FOUND"; fi
  return 0
}

# The remembered decision for the wording in force now, read from the specific
# filesConsent object in the prior config. node parses the JSON, so a version
# string in an unrelated field cannot satisfy the check: the version and the
# acknowledged flag must be the same object's fields, and acknowledged must be a
# boolean. Prints yes, no, or nothing when there is no valid current decision.
# It never prints a config value. node is the product's own runtime; without it
# the answer is "no decision", so the question is asked again rather than guessed.
prior_files_decision() {
  [ -f "$CONFIG" ] || return 0
  command -v node > /dev/null 2>&1 || return 0
  node -e '
    const fs = require("fs");
    let data;
    try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    const files = data && typeof data === "object" && !Array.isArray(data) ? data.filesConsent : undefined;
    if (!files || typeof files !== "object" || Array.isArray(files)) process.exit(0);
    if (files.noticeVersion !== process.argv[2]) process.exit(0);
    if (typeof files.acknowledged !== "boolean") process.exit(0);
    process.stdout.write(files.acknowledged ? "yes" : "no");
  ' "$CONFIG" "$FILES_NOTICE_VERSION" 2> /dev/null || true
  return 0
}

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || printf 'unknown')

echo "LaunchSense local review for this checkout."
echo "This script installs the skill, registers the local file review and the online policy source, and asks one question about reading agent instruction files and saving the local report."
echo "This local review reads files on this machine. It does not upload them."
if [ "$TARGET_SET" -eq 1 ]; then
  echo "The review target is the folder you named: $TARGET_ROOT"
else
  echo "No review target was named, so the default is this checkout: $TARGET_ROOT"
  echo "To review another repo, name it: sh install.sh --root /absolute/path/to/your/repo (also --repo)."
fi

# Usage counts are not collected on this machine: the local usage-count sender
# is retired. There is no usage question, no usage decision, and no usage line
# written to the ledger. Any earlier usage ledger lines are left untouched.
# These two names stay in the config, always false and off, because the local
# review still reads them as a compatibility shape; they grant nothing.

# The local agent-file/report acknowledgement. Default is yes: pressing enter
# allows the extra reads, which are the agent instruction files, and the saving
# of the local report copy under .ls/reports. Ordinary project files are read
# only for a review the person asks for, which the skill asks them to approve
# separately; this question is not a blanket gate on reading the working tree. A
# pre-answered question is not a freely given agreement, so this is recorded and
# described as an acknowledgement, and the lawful basis is contract, not consent.
# It is asked once per wording: an answer already on record for this version is
# kept, so a second run does not ask again or add a line.
FILES_GRANTED=false
FILES_REMEMBERED=""
DECISION="$(prior_files_decision)"
case "$DECISION" in
  yes) FILES_GRANTED=true; FILES_REMEMBERED="yes" ;;
  no) FILES_GRANTED=false; FILES_REMEMBERED="no" ;;
esac
if [ -z "$FILES_REMEMBERED" ]; then
  printf '%s\n' "Allow the local LaunchSense server to read agent instruction files like AGENTS.md,"
  printf '%s\n' "and to save its local report copy under .ls/reports?"
  printf '%s\n' "Those stay on this machine. Nothing is uploaded."
  printf '%s\n' "An ordinary review you ask for still reads the project files."
  printf '%s\n' "Default is yes. Press enter to allow, or type no to refuse."
  printf '%s' "yes or no [yes]: "
  FILES_ANSWER=""
  read -r FILES_ANSWER || FILES_ANSWER=""
  case "$FILES_ANSWER" in
    n | N | no | NO | No)
      FILES_GRANTED=false
      echo "The agent instruction files stay listed as not checked, and no local report copy is saved."
      ;;
    *)
      FILES_GRANTED=true
      ;;
  esac
fi
FILES_GRANTED_JSON=false
if [ "$FILES_GRANTED" = "true" ]; then FILES_GRANTED_JSON=true; fi
# The moment of the decision. A remembered answer keeps the time it was first
# given, read back from the ledger line for this purpose, so a later run does not
# move the recorded moment.
FILES_DECIDED_AT="$NOW"
if [ -n "$FILES_REMEMBERED" ]; then
  SAVED_FILES="$(decision_time_from_log_purpose files "$FILES_GRANTED_JSON")"
  if [ -n "$SAVED_FILES" ]; then FILES_DECIDED_AT="$SAVED_FILES"; fi
fi
FILES_DECIDED_AT_JSON="\"$FILES_DECIDED_AT\""

# One append-only line per real file-read decision, including a refusal. A run
# that only repeats a decision already on record for this wording writes no
# line. The usage sender is retired, so no usage line is written here at all,
# and any earlier usage lines in this shared ledger are left byte-for-byte.
if [ -z "$FILES_REMEMBERED" ] && ! decision_on_log_purpose files "$FILES_NOTICE_VERSION" "$FILES_GRANTED_JSON"; then
  printf '{"purpose":"files","noticeVersion":"%s","granted":%s,"decidedAt":"%s","source":"prompt"}\n' \
    "$FILES_NOTICE_VERSION" "$FILES_GRANTED_JSON" "$FILES_DECIDED_AT" >> "$CONSENT_LOG"
fi

cat > "$CONFIG" <<EOF
{
  "tier": "$TIER",
  "agreed": false,
  "diagnostics": "off",
  "filesConsent": {
    "acknowledged": $FILES_GRANTED_JSON,
    "noticeVersion": "$FILES_NOTICE_VERSION",
    "acknowledgedAt": $FILES_DECIDED_AT_JSON
  },
  "authRequired": false,
  "harness": "local"
}
EOF

echo "Usage counts are not sent from this machine. The local usage-count sender is retired, so there is nothing to turn on or off."
echo "Recorded in $CONFIG and $CONSENT_LOG."

SKILL_SRC="$ROOT/skills/launchsense/SKILL.md"
for dest in \
  "$HOME/.cursor/skills/launchsense" \
  "$HOME/.claude/skills/launchsense" \
  "$HOME/.codex/skills/launchsense"
do
  mkdir -p "$dest"
  cp "$SKILL_SRC" "$dest/SKILL.md"
done

# The server is a Node module in mcp/. It runs in place with node, the same
# runtime the review already needs, so there is no second toolchain to install.
# The version is read first: the server needs Node 24 or newer, and a server
# registered for an older Node is a config that cannot start. Without a new
# enough node, write no server at all and print no line that reads as a finished
# install.
NODE_MAJOR=0
if command -v node > /dev/null 2>&1; then
  NODE_VERSION="$(node --version 2> /dev/null || printf 'unknown')"
  NODE_MAJOR="$(node_major "$NODE_VERSION")"
fi

if [ "$NODE_MAJOR" -lt 24 ]; then
  if ! command -v node > /dev/null 2>&1; then
    echo "node is not on PATH, so the local MCP server was not registered."
  else
    echo "node is $NODE_VERSION, but the local MCP server needs Node 24 or newer, so it was not registered."
  fi
  echo "Install Node 24 or newer, check with: node --version"
  echo "Then run: LAUNCHSENSE_ROOT=\"$TARGET_ROOT\" LAUNCHSENSE_REVIEW=\"$ROOT/mcp/review-entry.ts\" node \"$ROOT/mcp/server.ts\""
  echo "The skill and the config above are installed, but the server is not registered, so the install is not finished. The policy address does not need Node."
  exit 0
fi

mkdir -p "$HOME/.cursor" "$CONFIG_DIR"
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
POLICY_URL="https://harmless-chihuahua-667.convex.site/mcp"
if [ ! -f "$CURSOR_CONFIG" ]; then
  # LAUNCHSENSE_ROOT names the repo to review: the folder the person named, or
  # this checkout when they named none. LAUNCHSENSE_REVIEW names the review
  # script and stays absolute, so it does not depend on the folder the server
  # was started in. The launchsense entry reads files on this machine. The
  # launchsense-policy entry serves skill, rules, checklists, and audit
  # instructions only, never a scan.
  cat > "$CURSOR_CONFIG" <<EOF
{
  "mcpServers": {
    "launchsense": {
      "command": "node",
      "args": ["$ROOT/mcp/server.ts"],
      "env": {
        "LAUNCHSENSE_ROOT": "$TARGET_ROOT",
        "LAUNCHSENSE_REVIEW": "$ROOT/mcp/review-entry.ts"
      }
    },
    "launchsense-policy": {
      "url": "$POLICY_URL"
    }
  }
}
EOF
  echo "Wrote $CURSOR_CONFIG"
else
  echo "Left existing $CURSOR_CONFIG in place, so nothing was merged automatically."
  echo "Add these two entries inside its mcpServers object, then restart your tool:"
  cat <<EOF
    "launchsense": {
      "command": "node",
      "args": ["$ROOT/mcp/server.ts"],
      "env": {
        "LAUNCHSENSE_ROOT": "$TARGET_ROOT",
        "LAUNCHSENSE_REVIEW": "$ROOT/mcp/review-entry.ts"
      }
    },
    "launchsense-policy": {
      "url": "$POLICY_URL"
    }
EOF
fi

echo "Installed the launchsense skill and the local config. No login is needed."
echo ""
echo "Next: run the first audit now, so you see it work."
echo "In your coding tool, with this repo open, ask it to review the repo with launchsense_scan_repo."
