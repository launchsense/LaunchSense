// Claim guard. Public copy must not assert capability the code does not have.
//
// Two audit findings in this repo were doc lines describing behaviour that was
// never implemented. That class of defect is cheap to reintroduce and expensive
// to catch later, so it is checked on every run instead.
//
// Two kinds of sweeping phrase, checked differently:
//
//   POSITIVE  "fully scans every file", "is certified". These must never appear
//             unqualified in public copy. A walk back on the same line
//             ("not a certification") makes them honest, so it is allowed.
//
//   NEGATIVE  "never stores raw secrets". These are the safety claims this
//             product is built on, so they must be backed by the code that
//             makes them true. If that code is removed, this fails.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// fileURLToPath, not URL.pathname: this checkout path contains spaces and the
// raw pathname keeps them percent encoded.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const NEGATION = /\b(not|never|no|without|cannot|does\s+not)\b/i;

const POSITIVE_CLAIMS = [
  { phrase: /fully\s+scans?/i, why: "the scan reads at most 200 files and 2MB" },
  { phrase: /scans?\s+every\s+(file|repo|line)/i, why: "files are skipped by caps" },
  { phrase: /\bcertified\b/i, why: "standards lines are signals, not certification" },
  { phrase: /\bis\s+compliant\b/i, why: "no compliance claim is made" },
  { phrase: /\bguaranteed?\b/i, why: "a partial result is never a pass" },
  { phrase: /\bno\s+issues\s+(found|exist)/i, why: "skipped work is listed as not checked" },
  { phrase: /\ball\s+secrets\b/i, why: "secrets are patterns, not proof" },
  { phrase: /coming\s+soon/i, why: "unbuilt work is named, not promised" },
];

const NEGATIVE_CLAIMS = [
  { phrase: /never\s+stores?\s+raw/i, evidence: /sharedRedact/, why: "redaction at write time" },
  { phrase: /never\s+(stores|saves|keeps)\s+(raw\s+)?secret/i, evidence: /sharedRedact/, why: "redaction at write time" },
  { phrase: /never\s+block/i, structural: noRepoWritePath, why: "the code would contain a write path" },
  { phrase: /never\s+changes?\s+(your\s+)?code/i, structural: noRepoWritePath, why: "the code would contain a write path" },
];

const COPY_GLOBS = ["README.md", "CHANGELOG.md", "docs", "src"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".progress", "_generated"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|tsx?)$/.test(name)) out.push(full);
  }
  return out;
}

const source = walk(join(ROOT, "convex"))
  .concat(walk(join(ROOT, "shared")))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

// "never changes your code" and "never blocks publishing" are the same claim:
// there is no write path to a repository. Proved structurally by finding no
// write verb aimed at the GitHub API, rather than by matching a comment.
function noRepoWritePath() {
  const verbs = /\b(POST|PUT|PATCH|DELETE)\b/;
  for (const file of walk(join(ROOT, "convex")).concat(walk(join(ROOT, "shared")))) {
    const text = readFileSync(file, "utf8");
    if (verbs.test(text) && /api\.github\.com/.test(text) && /contents\/|repos\/.*\/(issues|pulls)\b/.test(text)) {
      return false;
    }
  }
  return true;
}

function copyFiles() {
  const out = [];
  for (const entry of COPY_GLOBS) {
    const full = join(ROOT, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const failures = [];
let checked = 0;

for (const file of copyFiles()) {
  const rel = relative(ROOT, file);
  // The guard lists the banned phrases itself, so it never checks itself.
  if (rel === "scripts/check-claims.mjs") continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const claim of POSITIVE_CLAIMS) {
        if (!claim.phrase.test(line)) continue;
        checked++;
        // "This is not a certification" walks the claim back, so it is honest.
        if (NEGATION.test(line)) continue;
        failures.push({ rel, line: i + 1, text: line.trim(), why: claim.why });
      }
      for (const claim of NEGATIVE_CLAIMS) {
        if (!claim.phrase.test(line)) continue;
        checked++;
        if (claim.structural !== undefined) {
          if (claim.structural()) continue;
        } else if (claim.evidence.test(source)) {
          continue;
        }
        failures.push({ rel, line: i + 1, text: line.trim(), why: `${claim.why} (no code support)` });
      }
    });
}

if (failures.length > 0) {
  console.error("Claim guard failed. Public copy asserts something unsupported:\n");
  for (const f of failures) {
    console.error(`  ${f.rel}:${f.line}`);
    console.error(`    ${f.text}`);
    console.error(`    why: ${f.why}\n`);
  }
  console.error("Either the claim is true and the code must prove it, or the wording is wrong.");
  process.exit(1);
}

console.log(`Claim guard passed. ${checked} claim phrase(s) checked.`);