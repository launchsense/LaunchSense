// Grading harness for archived scan output.
//
// The 100-repo review emitted thousands of non-leak rows and judged none of them,
// so every family in the report was an ungraded claim. This turns archived scan
// JSON plus a local checkout into a worklist where every row carries the real
// source line, so a reviewer can grade it instead of guessing from a count.
//
// What it does NOT do, on purpose:
//
//   - It never assigns true / false / noise. A verdict needs a reader who looked
//     at the line. A script guessing would be a worse claim than no claim.
//   - It never adds or drops a row. Every finding in the input gets exactly one
//     output slot, including the ones it could not resolve, so the totals always
//     reconcile against the scan JSON.
//   - It never hides an ungraded row. An unreadable file, an out-of-range line
//     and a placeholder path each get their own status and their own count.
//
// Secret-shaped literals in the copied line are masked. Grading needs the
// identifiers around a value, never the value itself.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Paths the caller never wants read. Empty by default, so the harness carries
// no project name of its own: a caller passes its own private folders as plain
// prefixes, for example `--forbid .progress/private-one --forbid secrets/`.
// The default keeps `.git` and `node_modules` out of any read, which is a rule
// about reading source, not about one project.
export const DEFAULT_FORBIDDEN = [".git/", "node_modules/"];

let forbiddenPrefixes = [...DEFAULT_FORBIDDEN];

/** Set the forbidden prefixes. Used by the CLI and by callers with their own list. */
export function setForbidden(prefixes) {
  forbiddenPrefixes = [...DEFAULT_FORBIDDEN, ...prefixes];
}

// Placeholder-shaped stays readable: lower case words joined by _ - . or space.
// A random key carries digits or mixed case, so this split is the same one the
// wave passes used when they called a literal "word shaped".
const PLACEHOLDER = /^[a-z]+(?:[_.-][a-z]+)*$/;

// A literal only gets masked when the line looks like it is carrying a secret.
// The first version of this masked every quoted run of 13 or more characters and
// that was wrong in a way grading cannot survive: it hid the very text the
// anchor check needs to read. A URL, a SQL statement, a module name and
// "Access-Control-Allow-Origin" are all quoted, all long, and none of them are
// secrets, so hiding them turned real claims into FALSE verdicts.
const SECRET_ASSIGNMENT =
  /\b(secret|passwd|password|passphrase|private[_-]?key|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|auth[_-]?key|credential|token)\b\s*[:=]/i;
const PEM_HEADER = /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/;
// A source address, a path or a lowercase dotted name is evidence, not a
// credential, whatever its length. A bare identifier is NOT in this list: a
// random key is shaped exactly like an identifier, and treating it as one let a
// key-shaped literal through unmasked.
const NOT_A_SECRET = /:\/\/|^\s*#|^[./~]|\/|^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

function shape(text) {
  const classes = [];
  if (/[a-z]/.test(text)) classes.push("lower");
  if (/[A-Z]/.test(text)) classes.push("upper");
  if (/[0-9]/.test(text)) classes.push("digit");
  if (/[^A-Za-z0-9]/.test(text)) classes.push("symbol");
  return classes.join("+") || "empty";
}

// Shannon entropy per character, the measure the wave sheets already used. Raw
// bits per character, not per byte: dividing by 8 capped this at 1.0 and made the
// threshold below unreachable, so nothing was ever masked on entropy alone.
function bitsPerChar(text) {
  if (!text.length) return 0;
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function maskLine(line) {
  const lineLooksSecret = SECRET_ASSIGNMENT.test(line) || PEM_HEADER.test(line);
  return line.replace(
    /(['"`])((?:\\.|(?!\1).){6,}?)\1/g,
    (whole, q, body) => {
      if (PLACEHOLDER.test(body)) return whole;
      if (PEM_HEADER.test(body)) return `${q}<pem len=${body.length}>${q}`;
      // A line that assigns to a secret name is masked whatever the literal
      // looks like. Shape exemptions come after this, never before.
      if (lineLooksSecret) return `${q}<str len=${body.length} ${shape(body)}>${q}`;
      if (NOT_A_SECRET.test(body)) return whole;
      // Entropy alone, but only for a literal shaped like a credential: long,
      // high entropy, and carrying no space or hyphen. A credential has neither.
      // "Access-Control-Allow-Origin" and "SELECT id FROM users WHERE name = %s"
      // are high entropy too, and both are code, so both are exempt.
      const keyShaped = !/[\s-]/.test(body) && body.length >= 20 && bitsPerChar(body) > 3.2;
      if (keyShaped) return `${q}<str len=${body.length} ${shape(body)}>${q}`;
      return whole;
    },
  );
}

function truncate(line, max) {
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

export function isForbidden(relPath) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return forbiddenPrefixes.some((prefix) => norm === prefix.replace(/\/$/, "") || norm.startsWith(prefix));
}

// Pulls the reported line out of a checkout. Reports what it could not do
// instead of returning an empty string, because an empty read would grade as a
// silent pass.
export function readRow(rootDir, relPath, line, contextLines) {
  if (isForbidden(relPath)) {
    return { status: "forbidden-path", text: "", before: [], after: [] };
  }
  // license.policy emits the placeholder path "(repo)" for a repository level
  // signal. There is no file to open, so say so rather than guessing.
  if (!relPath || /^\(.*\)$/.test(relPath)) {
    return { status: "placeholder-path", text: "", before: [], after: [] };
  }
  const abs = join(rootDir, relPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return { status: "file-missing", text: "", before: [], after: [] };
  }
  let raw;
  try {
    raw = readFileSync(abs, "utf8").split(/\r?\n/);
  } catch {
    return { status: "unreadable", text: "", before: [], after: [] };
  }
  if (line < 1 || line > raw.length) {
    return { status: "line-out-of-range", text: "", before: [], after: [] };
  }
  const n = Math.max(0, contextLines);
  return {
    status: "ok",
    text: truncate(maskLine(raw[line - 1].trim()), 400),
    before: raw.slice(Math.max(0, line - 1 - n), line - 1).map((l) => truncate(maskLine(l.trim()), 200)),
    after: raw.slice(line, line + n).map((l) => truncate(maskLine(l.trim()), 200)),
  };
}

// A clone attempt that failed leaves the directory behind, empty but present.
// Treating that as a real checkout turns "this machine could not fetch the repo"
// into "the scanner pointed at a file the repo does not have", which is a
// different and wrong accusation. A usable checkout has worktree files in it.
function isCheckout(dir) {
  try {
    return readdirSync(dir).some((entry) => entry !== ".git");
  } catch {
    return false;
  }
}

function setHash(findings) {
  const s = findings
    .map((f) => `${f.ruleId}|${f.path}|${f.line}`)
    .sort()
    .join("\n");
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

// Two evidence files holding the same finding set are one scan of one repo. Which
// file survives matters: the corpus keeps golden-*.json as a copy of the w3-*.json
// scan, and "golden-air" sorts before "w3-air", so keeping the first name kept the
// copy that has no checkout map entry and turned 37 readable rows into
// no-checkout. Prefer whichever representative can actually be opened.
function pickRepresentative(candidates, resolveDir) {
  return candidates.find((c) => resolveDir(c.key)) || candidates[0];
}

// One slot per row, always. The caller's row count is the only source of truth.
export function buildWorklist({ evidenceDir, map, reposDir, localDirs, contextLines = 1 }) {
  const files = readdirSync(evidenceDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const dirFor = (key) => {
    const dir = localDirs && localDirs[key] ? localDirs[key] : map[key] ? join(reposDir, key) : null;
    return dir && isCheckout(dir) ? dir : null;
  };

  // Group first, pick the representative second.
  const groups = new Map();
  for (const file of files) {
    const key = file.replace(/\.json$/, "");
    const scan = JSON.parse(readFileSync(join(evidenceDir, file), "utf8"));
    const findings = scan.findings || [];
    const hash = setHash(findings);
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push({ key, findings });
  }

  const duplicates = [];
  const rows = [];
  let leakRows = 0;
  let evidenceFindings = 0;

  for (const candidates of groups.values()) {
    const keep = pickRepresentative(candidates, dirFor);
    for (const other of candidates) {
      if (other.key !== keep.key) duplicates.push([keep.key, other.key]);
    }
    const key = keep.key;
    const findings = keep.findings;
    evidenceFindings += findings.length;

    const mapped = map[key];
    const localDir = localDirs && localDirs[key];
    const repoDir = dirFor(key);
    const repo = localDir ? "local repository" : mapped ? mapped[0] : null;
    const revision = localDir ? "worktree" : mapped ? mapped[1] : null;

    for (const f of findings) {
      if (/^secret\./.test(f.ruleId)) {
        leakRows += 1;
        continue;
      }
      // A missing checkout is this machine's gap, not the repo's. It gets its own
      // status so it is never counted as the scanner pointing at a missing file.
      const read = repoDir
        ? readRow(repoDir, f.path, f.line, contextLines)
        : { status: "no-checkout", text: "", before: [], after: [] };
      rows.push({
        id: `${key}#${f.ruleId}#${f.path}#${f.line}`,
        scan: key,
        repo,
        revision,
        ruleId: f.ruleId,
        severity: f.severity,
        path: f.path,
        line: f.line,
        title: f.title,
        why: f.why,
        ...read,
      });
    }
  }

  const tally = (items, pick) => {
    const out = {};
    for (const it of items) {
      const k = pick(it);
      out[k] = (out[k] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  };

  return {
    generatedFrom: { evidenceDir, reposDir },
    totals: {
      evidenceFiles: files.length,
      distinctScans: groups.size,
      duplicateScans: duplicates.length,
      evidenceFindings,
      leakRows,
      nonLeakRows: rows.length,
      byFamily: tally(rows, (r) => r.ruleId),
      byStatus: tally(rows, (r) => r.status),
      bySeverity: tally(rows, (r) => r.severity),
    },
    duplicates,
    rows,
  };
}

// Script entry. The map is a JSON file of scan key to [repo, shortsha]; localDirs
// maps a scan key straight to a checkout that is already on this machine.
if (process.argv[1] && process.argv[1].endsWith("grade-findings.mjs")) {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const evidenceDir = arg("evidence");
  const mapPath = arg("map");
  const reposDir = arg("repos") || ".";
  const out = arg("out");
  const localPath = arg("local");
  // Every --forbid value is a path prefix the caller does not want read. Repeat
  // the flag for more than one. Nothing here is a project name.
  const forbid = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--forbid" && argv[i + 1] !== undefined) forbid.push(argv[i + 1].replace(/\\/g, "/"));
  }
  setForbidden(forbid);
  if (!evidenceDir || !mapPath) {
    console.error("usage: grade-findings.mjs --evidence <dir> --map <map.json> [--repos <dir>] [--local <map.json>] [--forbid <prefix>]... [--out <file>]");
    process.exit(2);
  }
  const map = JSON.parse(readFileSync(mapPath, "utf8")).scans || {};
  const localDirs = localPath ? JSON.parse(readFileSync(localPath, "utf8")) : undefined;
  const worklist = buildWorklist({ evidenceDir, map, reposDir, localDirs });
  const json = JSON.stringify(worklist, null, 2);
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, json);
    const t = worklist.totals;
    console.log(
      `scans ${t.distinctScans}/${t.evidenceFiles} (${t.duplicateScans} duplicate), ` +
        `leak ${t.leakRows}, non-leak ${t.nonLeakRows}`,
    );
    console.log("status:", JSON.stringify(t.byStatus));
  } else {
    console.log(json);
  }
}