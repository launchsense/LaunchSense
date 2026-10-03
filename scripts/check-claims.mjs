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

// A walk-back only counts when it qualifies the phrase. Matching a negation
// anywhere on the line let "no issues found" rescue itself, because "no" is
// part of the phrase.
function isWalkedBack(line, match) {
  const before = line.slice(0, match.index).toLowerCase();
  // The negation has to be close to the claim and not inside it.
  // Tight window. A negation 25 characters away, separated by a clause, does
  // not qualify this phrase: "It does not store secrets, and it fully scans
  // every repository" is still an overclaim about the scanning.
  const tail = before.slice(Math.max(0, before.length - 15));
  return /\b(not|never|without|cannot)\b\s*$/.test(tail) || /\b(is|are|does|do)\s+not\s*$/.test(tail);
}

const POSITIVE_CLAIMS = [
  { phrase: /fully\s+scans?/i, why: "the scan reads at most 200 files and 2MB" },
  { phrase: /scans?\s+every\s+(file|repo|line)/i, why: "files are skipped by caps" },
  { phrase: /\bcertified\b/i, why: "standards lines are signals, not certification" },
  { phrase: /\bis\s+compliant\b/i, why: "no compliance claim is made" },
  { phrase: /\bguaranteed?\b/i, why: "a partial result is never a pass" },
  { phrase: /\bno\s+issues\s+(found|exist)/i, why: "skipped work is listed as not checked" },
  { phrase: /\ball\s+secrets\b/i, why: "secrets are patterns, not proof" },
  { phrase: /coming\s+soon/i, why: "unbuilt work is named, not promised" },
  // Sign-in promises. Signing in currently unlocks nothing a user can see:
  // getInstallationToken, projects.listForUser, and entitlements.getMyEntitlements
  // all have zero callers. Verified 2026-10-03. Copy must disclaim, not sell.
  { phrase: /deeper\s+scan/i, why: "sign-in unlocks no deeper scan; the connected path has no callers" },
  { phrase: /saved\s+history/i, why: "no history store exists" },
  // "unlocks nothing" is the honest disclaimer and must stay allowed, so this
  // targets only claims that sign-in grants a real capability.
  { phrase: /unlocks?\s+(private\s+repos?|a\s+deeper\s+scan|full\s+scans?)/i, why: "sign-in unlocks no scan capability today" },
  // Durability promises with no mechanism behind them. The queue copy said
  // "you will not lose your place" while pressing Run scan minted a new scanId
  // and a new queue row. See .progress/UI-COPY-CONTENT-POLICY-PLAN.md W1.
  { phrase: /(you\s+will\s+not\s+lose\s+your\s+place|you\s+keep\s+your\s+place)/i, why: "no durable queue ticket exists" },
  // Verdict wording. "No findings. The checks found nothing to flag." read as a
  // clean bill of health while the scope sat far below it. A verdict must carry
  // its own scope. See .progress/UI-COPY-CONTENT-POLICY-PLAN.md W2.
  // A verdict phrase is only a defect when the line does not also carry its scope.
// The guard reads one line at a time, so a qualifier on the next line cannot be
// seen by a regex lookahead. `qualifier` is checked against the whole line.
{ phrase: /\bno\s+findings\s*[.!]/i, qualifier: "not checked", why: "a bare verdict reads as safe; it must name what was not checked" },
  { phrase: /nothing\s+was\s+flagged/i, qualifier: "not checked", why: "a clean result must state its scope in the same sentence" },
  { phrase: /\bchecks\s+found\s+nothing\b/i, why: "most of the repo was never read" },
  // Share links and passports are permanent. No expiresAt, no revoked flag, and
  // no ctx.db.delete anywhere targets either table. Verified 2026-10-03.
  { phrase: /\byou can revoke\b/i, why: "no revoke mutation exists for shares or passports" },
  { phrase: /\blink (expires|expired)\b/i, why: "no expiresAt exists on shareArtifacts or passportArtifacts" },
  // Scoped to affirmative withdrawal promises. The honest copy says "There is no
  // way to take it back", and "no way to" is not a negation the walk-back window
  // recognises, so this rule must not match it at all.
  { phrase: /\byou can (take|turn) (it|this|your link) (down|offline)\b/i, why: "a share link cannot be withdrawn today" },
];

const NEGATIVE_CLAIMS = [
  {
    phrase: /never\s+stores?\s+raw\s+(file\s+)?(text|body|contents?)/i,
    structural: noFileBodyStored,
    why: "a file body column would exist",
  },
  { phrase: /never\s+stores?\s+raw\s+secret/i, structural: noFileBodyStored, why: "a file body column would exist" },
  { phrase: /never\s+(stores|saves|keeps)\s+(raw\s+)?secret/i, structural: noFileBodyStored, why: "a file body column would exist" },
  { phrase: /never\s+block/i, structural: noRepoWritePath, why: "the code would contain a write path" },
  { phrase: /never\s+changes?\s+(your\s+)?code/i, structural: noRepoWritePath, why: "the code would contain a write path" },
  {
    // "We store no copy of your code" is the claim the whole privacy page rests
    // on, in the wording the UI actually uses. It means exactly what
    // "never stores raw file text" means.
    phrase: /(no|stores?\s+no|keeps?\s+no)\s+(copy|copies|version|versions)\s+of\s+(your\s+)?(code|source|file|files)/i,
    structural: noFileBodyStored,
    why: "a file body column would exist",
  },
];

// RETENTION_CLAIMS. "cached for 24 hours" and "deleted after 24 hours" are the
// second class of false claim that cost an audit, the first being the deleted
// file-text column. They are checked against the code: the number in the copy
// must be the number in a TTL constant, and a deletion must actually exist.
//
// The failure this catches is specific and already happened once: the docs kept
// describing a 24 hour cache of file text that had been deleted, while the UI
// kept telling users their snippets were cached for 24 hours, with no purge
// behind either sentence.
const RETENTION_CLAIMS = [
  { phrase: /cached?\s+for\s+(\d+)\s*(hour|day|week|month)s?/i, kind: "cache" },
  { phrase: /deleted?\s+(?:by\s+)?(?:a\s+later\s+\w+\s+)?(?:after|within)\s+(\d+)\s*(hour|day|week|month)s?/i, kind: "retention" },
  { phrase: /kept?\s+for\s+(\d+)\s*(hour|day|week|month)s?/i, kind: "retention" },
];

// "for 24 hours" is only meaningful as a retention claim when it is near a
// cache or deletion word. Elsewhere it is ordinary copy about something else.
function looksLikeRetention(text) {
  return /\b(cach\w*|stor\w*|keep\w*|delet\w*|retain\w*|purge\w*|saved|save)\b/i.test(text);
}

// The TTL a claim is measured against. Kept as whole units in the source so the
// copy and the code cannot drift apart by a factor of a thousand.
const TTL_UNITS = { hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };

function ttlMatchesCopy(copiedNumber, copiedUnit) {
  const source = readAllSource();
  const wanted = Number(copiedNumber) * (TTL_UNITS[copiedUnit.toLowerCase()] ?? 0);
  if (wanted === 0) return false;
  // Match the right-hand side of a TTL constant, allowing arithmetic form:
  // `CONTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000` and `CACHE_TTL_MS = 86400000`.
  const pattern = /[A-Z_]*(TTL|MAX_AGE|RETENTION)[A-Z_]*\s*=\s*([0-9_]+(?:\s*[*+]\s*[0-9_]+)*)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const expr = match[2];
    if (expr === undefined) continue;
    // Evaluate only digits joined by * or +, which is exactly the form used.
    if (!/^[0-9_]+(?:\s*[*+]\s*[0-9_]+)*$/.test(expr)) continue;
    const value = expr.split(/\s*[*+]\s*/).reduce((acc, part) => acc * Number(part.replace(/_/g, "")), 1);
    if (value === wanted || value * 1000 === wanted) return true;
  }
  return false;
}

// A retention claim needs both a matching TTL and something that deletes.
function retentionIsEnforced() {
  return /\b(delete|purge|remove)\w*\s*\(/i.test(readAllSource()) &&
    /\b(TTL|RETENTION|MAX_AGE)\w*/i.test(readAllSource());
}

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

// Definitions are excluded. `shared/redaction.ts` defines sharedRedact, so
// including it let the guard pass after the only real call site was deleted.
const sourceFiles = walk(join(ROOT, "convex")).concat(walk(join(ROOT, "shared")));

// Definitions are excluded. `shared/redaction.ts` defines sharedRedact, so
// including it let the guard pass after the only real call site was deleted.
function readAllSource() {
  return sourceFiles
    .filter((f) => !/(^|\/)(redaction|projectSignals)\.ts$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

const source = readAllSource();

// "never changes your code" and "never blocks publishing" are the same claim:
// there is no write path to a repository. Proved structurally by finding no
// write verb aimed at the GitHub API, rather than by matching a comment.
// "never stores raw file text" is proved structurally: the fileContents table
// must not have a body field at all, and the write mutation must not take one.
function noFileBodyStored() {
  const schema = readFileSync(join(ROOT, "convex", "schema.ts"), "utf8");
  const block = schema.match(/fileContents: defineTable\([\s\S]*?\n  \}\)/);
  if (block === null) return false;
  if (/\bcontent:\s*v\./.test(block[0])) return false;
  const store = readFileSync(join(ROOT, "convex", "scans", "store.ts"), "utf8");
  const mutation = store.match(/export const saveContent[\s\S]*?returns:/);
  if (mutation === null) return false;
  if (/\bcontent:\s*v\./.test(mutation[0])) return false;
  return true;
}

function noRepoWritePath() {
  const verbs = /method:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i;
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    if (!verbs.test(text)) continue;
    // Allow the one installation-token exchange that is not a repository write.
    if (/api\.github\.com\/app\/installations\/.*access_tokens/.test(text) && /GITHUB_APP_PRIVATE_KEY/.test(text)) continue;
    // A write verb anywhere in a file that also talks to the GitHub API counts,
    // whatever the endpoint path is.
    if (/api\.github\.com|github\.com\/repos/.test(text)) return false;
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
    .forEach((raw, i) => {
      // Inline code is a quoted example, not a claim about the product. The
      // self-scan log names banned phrases while describing them.
      const line = raw.replace(/`[^`]*`/g, "``");
      for (const claim of POSITIVE_CLAIMS) {
        const match = line.match(claim.phrase);
        if (match === null) continue;
        checked++;
        // "This is not a certification" walks the claim back, so it is honest.
        if (isWalkedBack(line, match)) continue;
        // A verdict is allowed when its scope is named on the same line.
        if (claim.qualifier !== undefined && line.toLowerCase().includes(claim.qualifier)) continue;
        failures.push({ rel, line: i + 1, text: raw.trim(), why: claim.why });
      }
      for (const claim of NEGATIVE_CLAIMS) {
        if (!claim.phrase.test(line)) continue;
        checked++;
        if (claim.structural !== undefined) {
          if (claim.structural()) continue;
        } else if (claim.evidence.test(source)) {
          continue;
        }
        failures.push({ rel, line: i + 1, text: raw.trim(), why: `${claim.why} (no code support)` });
      }
      for (const claim of RETENTION_CLAIMS) {
        const match = line.match(claim.phrase);
        if (match === null) continue;
        if (!looksLikeRetention(raw)) continue;
        checked++;
        const number = match[1];
        const unit = match[2];
        if (number === undefined || unit === undefined) continue;
        // A retention claim must be backed by a TTL constant with the same value
        // and by code that deletes. Either alone is not enough: a TTL with no
        // purge, or a purge with no stated window, is what the audit caught.
        const ttlOk = ttlMatchesCopy(number, unit);
        const purgeOk = retentionIsEnforced();
        if (ttlOk && purgeOk) continue;
        const why = !ttlOk
          ? `copy says ${number} ${unit}(s) but no TTL constant matches`
          : "no purge or deletion code backs the retention claim";
        failures.push({ rel, line: i + 1, text: raw.trim(), why });
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