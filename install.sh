#!/bin/sh
# Local review for a checkout of this repository.
# Everyone who uses LaunchSense runs this script. It installs the skill,
# registers the local file review and the online policy source, and asks two
# questions.
#
# The folder to review defaults to this checkout, and that default is printed
# so it is never silent. Name your own repo with --root <folder> or
# --repo <folder>; the path must be absolute and must exist. The engine files
# this installer copies always come from this checkout, whatever the target is.
# Both paths are written into the server config, so both are checked for
# characters that would break it before anything is written.
#
# Usage counts are off until you say yes to one question. This script asks
# before it records anything. It never writes an agreement you did not give.
# The answer is remembered, so the question is asked once.

set -eu
# The engine path: this checkout. Canonical, physical path, so a symlinked or
# relative route to it cannot put a different string into the config than the
# one that is validated and written.
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
TIER=alpha
# The wording of the question. Change this string and the question is asked
# again, because the person is agreeing to new text.
NOTICE_VERSION=2026-10-05
# The wording of the local file-read acknowledgement. Its own version, because it
# is its own question. Default is yes (operator decision), so the record and the
# register call it an acknowledgement and not consent.
FILES_NOTICE_VERSION=2026-10-06
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
  --enterprise             Leave usage counts on this machine without asking.
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

# A tier or an environment switch can decide the answer without a question.
# Neither one is a prompt, so each says so in the record it writes.
FORCED_OFF=0
FORCED_OFF_WHY=""
if [ "$TIER" = "enterprise" ] || [ "${LAUNCHSENSE_TIER:-}" = "enterprise" ]; then
  TIER=enterprise
  FORCED_OFF=1
  FORCED_OFF_WHY="enterprise tier"
fi
case "${LAUNCHSENSE_DIAGNOSTICS:-}" in
  off | OFF) FORCED_OFF=1; FORCED_OFF_WHY="LAUNCHSENSE_DIAGNOSTICS=off" ;;
esac

# The moment a decision was made, read back from the append-only log. A second
# run must not overwrite the time the person answered, or the record moves every
# time the installer is run. Only the answer for the wording in force now counts,
# so a record for old text cannot supply the timestamp for new text, and the last
# such line wins. $1 is the granted value. $2, when given, is the decision source
# that must match too, so one forced switch cannot lend its time to another; an
# empty $2 matches any source, which is what a remembered answer needs, because
# its time belongs to the earlier decision under a different source label.
# Parameter expansion only, no sed and no awk, so the installer still runs with an
# almost empty PATH.
decision_time_from_log() {
  [ -f "$CONSENT_LOG" ] || return 0
  FOUND=""
  while IFS= read -r LINE; do
    if [ -n "$2" ]; then
      case "$LINE" in
        *"\"noticeVersion\":\"$NOTICE_VERSION\""*"\"granted\":$1"*"\"source\":\"$2\""*) ;;
        *) continue ;;
      esac
    else
      case "$LINE" in
        *"\"noticeVersion\":\"$NOTICE_VERSION\""*"\"granted\":$1"*) ;;
        *) continue ;;
      esac
    fi
    REST="${LINE#*\"decidedAt\":\"}"
    FOUND="${REST%%\"*}"
  done < "$CONSENT_LOG"
  if [ -n "$FOUND" ]; then printf '%s' "$FOUND"; fi
  return 0
}

# True when the same decision, for the same wording and the same source, is
# already on the log. A repeat of an answer already on record is not a new
# decision, so it writes no line. A changed answer is a new decision.
decision_on_log() {
  [ -f "$CONSENT_LOG" ] || return 1
  while IFS= read -r LINE; do
    case "$LINE" in
      *"\"noticeVersion\":\"$1\""*"\"granted\":$2"*"\"source\":\"$3\""*) return 0 ;;
    esac
  done < "$CONSENT_LOG"
  return 1
}

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

# An answer already on record for this exact wording is kept, so a second run
# does not ask again. Only a new wording asks again.
REMEMBERED=""
PRIOR=""
if [ -f "$CONFIG" ]; then
  PRIOR=$(cat "$CONFIG")
  case "$PRIOR" in
    *'"diagnosticsConsent"'*'"noticeVersion": "'"$NOTICE_VERSION"'"'*)
      case "$PRIOR" in
        *'"agreed": true'*) REMEMBERED="true" ;;
        *) REMEMBERED="false" ;;
      esac
      ;;
  esac
fi

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || printf 'unknown')

echo "LaunchSense local review for this checkout."
echo "This script installs the skill, registers the local file review and the online policy source, and asks two questions."
echo "This local review reads files on this machine. It does not upload them."
if [ "$TARGET_SET" -eq 1 ]; then
  echo "The review target is the folder you named: $TARGET_ROOT"
else
  echo "No review target was named, so the default is this checkout: $TARGET_ROOT"
  echo "To review another repo, name it: sh install.sh --root /absolute/path/to/your/repo (also --repo)."
fi

GRANTED=false
# These three carry the JSON fragment, so an absent decision is a real null
# rather than a bare word that would make the file unreadable. DECIDED_AT is the
# moment the answer was given, not the moment this file was last rewritten, so a
# second run does not move the record.
DECIDED_AT="$NOW"
GRANTED_AT='null'
REFUSED_AT='null'
SOURCE=""

if [ "$FORCED_OFF" -eq 1 ]; then
  SOURCE="$FORCED_OFF_WHY"
  SAVED="$(decision_time_from_log false "$FORCED_OFF_WHY")"
  if [ -n "$SAVED" ]; then DECIDED_AT="$SAVED"; fi
  REFUSED_AT="\"$DECIDED_AT\""
  echo "Usage counts stay on this machine. The $FORCED_OFF_WHY switch decided that, so no question was asked."
elif [ "$REMEMBERED" = "true" ]; then
  GRANTED=true
  SOURCE="remembered yes"
  SAVED="$(decision_time_from_log true "")"
  if [ -n "$SAVED" ]; then DECIDED_AT="$SAVED"; fi
  GRANTED_AT="\"$DECIDED_AT\""
  echo "You already said yes to this question. Usage counts stay on."
elif [ "$REMEMBERED" = "false" ]; then
  SOURCE="remembered no"
  SAVED="$(decision_time_from_log false "")"
  if [ -n "$SAVED" ]; then DECIDED_AT="$SAVED"; fi
  REFUSED_AT="\"$DECIDED_AT\""
  echo "You already said no to this question. Usage counts stay on this machine."
else
  SOURCE="prompt"
  printf '%s\n' "Send anonymous usage counts to LaunchSense?"
  printf '%s\n' "This sends rule id counts, the harness name, the version, how long the"
  printf '%s\n' "review took, and which order source ran."
  printf '%s\n' "It does not send code, file paths, finding titles, or function names."
  printf '%s\n' "The review reads files on this machine. It does not upload them."
  printf '%s\n' "Type yes to send. Type no to keep it on this machine. Default is no."
  printf '%s' "yes or no: "
  # An end of input is a no, not a failure, so the installer still finishes and
  # a non-interactive run cannot fail the install. `read` returns non-zero at
  # end of input, which `set -e` would otherwise turn into an exit.
  DIAG_ANSWER=""
  read -r DIAG_ANSWER || DIAG_ANSWER=""
  case "$DIAG_ANSWER" in
    y | Y | yes | YES | Yes)
      GRANTED=true
      GRANTED_AT="\"$DECIDED_AT\""
      ;;
    *)
      REFUSED_AT="\"$DECIDED_AT\""
      echo "Usage counts stay on this machine."
      ;;
  esac
fi

if [ "$GRANTED" = "true" ]; then
  DIAGNOSTICS=on
  GRANTED_JSON=true
else
  DIAGNOSTICS=off
  GRANTED_JSON=false
fi

# The local file-read acknowledgement. Default is yes: pressing enter allows the
# expanded read, which is the project files and the agent instruction files. A
# pre-answered question is not a freely given agreement, so this is recorded and
# described as an acknowledgement, and the lawful basis is contract, not consent.
# Like the usage question, it is asked once per wording: an answer already on
# record for this version is kept, so a second run does not ask again or add a line.
FILES_GRANTED=false
FILES_REMEMBERED=""
if [ -f "$CONFIG" ]; then
  case "$PRIOR" in
    *'"filesConsent"'*'"noticeVersion": "'"$FILES_NOTICE_VERSION"'"'*)
      case "$PRIOR" in
        *'"acknowledged": true'*) FILES_GRANTED=true; FILES_REMEMBERED="yes" ;;
        *) FILES_GRANTED=false; FILES_REMEMBERED="no" ;;
      esac
      ;;
  esac
fi
if [ -z "$FILES_REMEMBERED" ]; then
  printf '%s\n' "Allow the local LaunchSense server to read files in this project folder,"
  printf '%s\n' "including agent instruction files like AGENTS.md and CLAUDE.md?"
  printf '%s\n' "The reads happen on this machine. Nothing is uploaded."
  printf '%s\n' "Default is yes. Press enter to allow, or type no to refuse."
  printf '%s' "yes or no [yes]: "
  FILES_ANSWER=""
  read -r FILES_ANSWER || FILES_ANSWER=""
  case "$FILES_ANSWER" in
    n | N | no | NO | No)
      FILES_GRANTED=false
      echo "The expanded read stays off. The review reads only the working tree."
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
# move the recorded moment the way the usage question already avoids.
FILES_DECIDED_AT="$NOW"
if [ -n "$FILES_REMEMBERED" ]; then
  SAVED_FILES="$(decision_time_from_log_purpose files "$FILES_GRANTED_JSON")"
  if [ -n "$SAVED_FILES" ]; then FILES_DECIDED_AT="$SAVED_FILES"; fi
fi
FILES_DECIDED_AT_JSON="\"$FILES_DECIDED_AT\""

# One append-only line per real decision, including a refusal. A refusal is
# evidence too. This file is the record we cannot see from here. A run that only
# repeats a decision already on record for this wording writes no line, and a
# changed answer is a new decision and does write one.
if [ "${SOURCE#remembered}" = "$SOURCE" ] && ! decision_on_log "$NOTICE_VERSION" "$GRANTED_JSON" "$SOURCE"; then
  printf '{"purpose":"usage","noticeVersion":"%s","granted":%s,"decidedAt":"%s","source":"%s"}\n' \
    "$NOTICE_VERSION" "$GRANTED_JSON" "$DECIDED_AT" "$SOURCE" >> "$CONSENT_LOG"
fi
if [ -z "$FILES_REMEMBERED" ] && ! decision_on_log_purpose files "$FILES_NOTICE_VERSION" "$FILES_GRANTED_JSON"; then
  printf '{"purpose":"files","noticeVersion":"%s","granted":%s,"decidedAt":"%s","source":"prompt"}\n' \
    "$FILES_NOTICE_VERSION" "$FILES_GRANTED_JSON" "$FILES_DECIDED_AT" >> "$CONSENT_LOG"
fi

cat > "$CONFIG" <<EOF
{
  "tier": "$TIER",
  "agreed": $GRANTED_JSON,
  "diagnostics": "$DIAGNOSTICS",
  "diagnosticsConsent": {
    "granted": $GRANTED_JSON,
    "noticeVersion": "$NOTICE_VERSION",
    "decidedAt": "$DECIDED_AT",
    "grantedAt": $GRANTED_AT,
    "refusedAt": $REFUSED_AT,
    "source": "$SOURCE"
  },
  "filesConsent": {
    "acknowledged": $FILES_GRANTED_JSON,
    "noticeVersion": "$FILES_NOTICE_VERSION",
    "acknowledgedAt": $FILES_DECIDED_AT_JSON
  },
  "authRequired": false,
  "harness": "local"
}
EOF

if [ "$DIAGNOSTICS" = "on" ]; then
  echo "Diagnostics: on, because you said yes. Nothing else is sent."
else
  echo "Diagnostics: off."
fi
echo "Recorded in $CONFIG and $CONSENT_LOG."
echo "To turn it off later, run: LAUNCHSENSE_DIAGNOSTICS=off sh \"$ROOT/install.sh\", or set granted to false in that file."

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
