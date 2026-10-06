#!/bin/sh
# Local review for a checkout of this repository.
# People using LaunchSense add https://harmless-chihuahua-667.convex.site/mcp
# They do not run this script.
#
# Usage counts are off until you say yes to one question. This script asks
# before it records anything. It never writes an agreement you did not give.
# The answer is remembered, so the question is asked once.

set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
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
mkdir -p "$CONFIG_DIR"

# A tier or an environment switch can decide the answer without a question.
# Neither one is a prompt, so each says so in the record it writes.
FORCED_OFF=0
FORCED_OFF_WHY=""
if [ "${1:-}" = "--enterprise" ] || [ "${LAUNCHSENSE_TIER:-}" = "enterprise" ]; then
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
echo "Public users add https://harmless-chihuahua-667.convex.site/mcp and do not run this script."
echo "This local review reads files on this machine. It does not upload them."

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
echo "To turn it off later, run LAUNCHSENSE_DIAGNOSTICS=off sh $ROOT/install.sh, or set granted to false in that file."

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
  echo "The skill and the config above are installed. The hosted address does not need Go."
  exit 0
fi

mkdir -p "$HOME/.cursor" "$CONFIG_DIR"
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
if [ ! -f "$CURSOR_CONFIG" ]; then
  # cwd is the module folder, so LAUNCHSENSE_ROOT names the checkout to review.
  # Without it the server would read the mcp folder instead of the checkout.
  # These two keys are the whole contract with the server: it reads
  # LAUNCHSENSE_ROOT, LAUNCHSENSE_REVIEW and LAUNCHSENSE_API_URL, and nothing
  # else. A key written here that no Go file reads is a promise the installer
  # cannot keep, so there are no others.
  cat > "$CURSOR_CONFIG" <<EOF
{
  "mcpServers": {
    "launchsense": {
      "command": "go",
      "args": ["run", "."],
      "cwd": "$ROOT/mcp",
      "env": {
        "LAUNCHSENSE_ROOT": "$ROOT",
        "LAUNCHSENSE_REVIEW": "$ROOT/mcp/review-entry.ts"
      }
    }
  }
}
EOF
  echo "Wrote $CURSOR_CONFIG"
else
  echo "Left existing $CURSOR_CONFIG in place. Point launchsense at: cd $ROOT/mcp && go run ."
  echo "Set LAUNCHSENSE_ROOT=$ROOT in that entry so the server reviews the checkout, not the mcp folder."
fi

echo "Installed the launchsense skill and the local config. Auth is not checked."