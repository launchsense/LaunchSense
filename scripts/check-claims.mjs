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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  // Sign-in reads one archive on the person's token, up to 1,000 files.
  // A further read in the coding tool is not running, so copy must not sell it.
  { phrase: /deeper\s+scan/i, why: "a further read is the local coding tool review, which is not running" },
  // Allows the honest denial "there is no saved history". The negation sits
  // before the phrase, which isWalkedBack's 15 character window cannot see.
  { phrase: /(?<!no\s)(?<!not\s)saved\s+history/i, why: "no history store exists" },
  // "unlocks nothing" is the honest disclaimer and must stay allowed, so this
  // targets only claims that sign-in grants a real capability.
  { phrase: /unlocks?\s+(private\s+repos?|a\s+deeper\s+scan|full\s+scans?)/i, why: "sign-in states a cap; it does not sell an unlock" },
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
  // Accepts either an explicit not-checked qualifier or the verdict block's own
  // negative framing, which carries the same meaning in fewer words.
  {
    phrase: /nothing\s+was\s+flagged/i,
    qualifier: /\b(not checked|not a clean bill of health|did read)\b/i,
    why: "a clean result must state its scope in the same sentence",
  },
  { phrase: /\bchecks\s+found\s+nothing\b/i, why: "most of the repo was never read" },
  // A bare "full check passed" reads as if every check ran. The secrets-only
  // corpus harness is the usual way this lie happens: it counts one rule and
  // calls the run a check. A verdict is allowed when its scope is named on
  // the same line, the same rule as "no findings" above.
  { phrase: /\bfull\s+(check|review|scan)\s+passed\b/i, qualifier: "not checked", why: "a bare full-check verdict hides the checks that did not run" },
  { phrase: /\bcomplete\s+(check|review|scan)\s+passed\b/i, qualifier: "not checked", why: "a bare complete-check verdict hides the checks that did not run" },
  // A "full review" that only judged one rule family must say so. The 100-repo
  // case exposed this: the full review emitted code, hygiene, deps, and license
  // rows, and the run judged only secret.* rows (2017 rows dropped). Any verdict
  // that reads as a whole-repo pass must name the families it did not grade.
  { phrase: /\bfull\s+(review|check|scan)\b(?!.{0,40}not checked)/i, qualifier: /\b(not checked|not graded|one family|leak-only)\b/i, why: "a full review must name any rule family it did not grade" },
  // The product promises in three public docs that AI never decides what is a
  // finding, only the fixed checks do. The decision lane (Jev, Perplexity) may only
  // ORDER findings the checks already produced. This rule blocks copy that lets a
  // model claim it chose the work. Verified 2026-10-03.
  { phrase: /\b(AI|the model) (chooses|decides|selects) which (check|checks|tool|tools|scan)/i, why: "the checks decide findings, never a model" },
  { phrase: /\bAI[- ](driven|powered) (scan|check) selection\b/i, why: "the checks are fixed and deterministic" },
  // Share links and passports are permanent. No expiresAt, no revoked flag, and
  // no ctx.db.delete anywhere targets either table. Verified 2026-10-03.
  { phrase: /\byou can revoke\b/i, why: "no revoke mutation exists for shares or passports" },
  { phrase: /\blink (expires|expired)\b/i, why: "no expiresAt exists on shareArtifacts or passportArtifacts" },
  // Scoped to affirmative withdrawal promises. The honest copy says "There is no
  // way to take it back", and "no way to" is not a negation the walk-back window
  // recognises, so this rule must not match it at all.
  { phrase: /\byou can (take|turn) (it|this|your link) (down|offline)\b/i, why: "a share link cannot be withdrawn today" },
  // Mission and achievement wording. Each of these awarded a state the scan
  // could not verify. See .progress/UI-COPY-CONTENT-POLICY-PLAN.md W6.
  { phrase: /\bsecure your project\b/i, why: "a verdict, not a mission; high findings clear while others remain" },
  { phrase: /\bshared\s+safely\b/i, why: "earned on shareCreated alone, with no verification of findings" },
  { phrase: /\bcarried no secrets\b/i, why: "creation is all that is checked, not the scan contents" },
  { phrase: /\bclean\s+compare\b/i, why: "unknown items stay unknown after a rescan" },
  { phrase: /safe and cheap/i, why: "scans are partial and no price is stated" },
  { phrase: /without exposing secrets/i, why: "the share page states what it does and does not contain" },
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

// A retention claim is enforced only when a real purge is bound to the
// stated window. Three things must all exist in the source: a named
// purge or sweep that deletes rows, a call to it with a cutoff computed
// from a TTL constant, and that constant's value matching the claim. The
// old check was a tautology: any `delete(` anywhere plus any `TTL`
// anywhere passed, so copy with no purge behind it still went green.
// This fails closed: no bound purge means the claim is unsupported.
//
// EVERY candidate call site is checked, not just the first one found. This
// repo has more than one retention window (cached file metadata at 24 hours,
// MCP usage rows at 30 days), and reading only the first match made every
// other retention claim fail on whichever constant happened to come first in
// file order. The claim is still only satisfied by a real purge bound to a
// constant with the matching value; it just stops depending on source order.
//
// Subject-blind, and it is worth knowing that: this asks whether SOME purge
// with the claimed window exists, not whether that purge is for the subject the
// copy names. A retention claim about a table that nothing purges can still
// pass on an unrelated table's window. Read a pass as "a purge with this window
// exists somewhere in the code", not as "this sentence is backed".
function retentionIsEnforced(copiedNumber, copiedUnit) {
  const source = readAllSource();
  const wanted = Number(copiedNumber) * (TTL_UNITS[copiedUnit.toLowerCase()] ?? 0);
  if (wanted === 0) return false;
  // A purge, sweep, or expire routine that deletes rows by age.
  if (!/export const \w*(?:purge|sweep|expire)\w*[\s\S]*?\.db\.delete\(/i.test(source)) {
    return false;
  }
  // Each purge invoked with a cutoff derived from a named TTL constant. The
  // constant name is captured so its value can be resolved and compared with
  // the claim.
  const callPattern =
    /(?:purge|sweep|expire)\w*,\s*\{[\s\S]{0,400}?(?:beforeMs|sinceMs|olderThan):\s*Date\.now\(\)\s*-\s*([A-Z_]*(?:TTL|RETENTION|MAX_AGE)[A-Z_]*)[\s\S]{0,200}?\}/gi;
  let call;
  while ((call = callPattern.exec(source)) !== null) {
    const constant = call[1];
    if (constant === undefined) continue;
    const def = source.match(new RegExp(`${constant}\\s*=\\s*([0-9_]+(?:\\s*[*+]\\s*[0-9_]+)*)`));
    if (def === null) continue;
    const expr = def[1];
    if (expr === undefined || !/^[0-9_]+(?:\s*[*+]\s*[0-9_]+)*$/.test(expr)) continue;
    const value = expr.split(/\s*[*+]\s*/).reduce((acc, part) => acc * Number(part.replace(/_/g, "")), 1);
    if (value === wanted || value * 1000 === wanted) return true;
  }
  return false;
}

// shared/reports holds the mission, achievement, standards, and export strings
// that render verbatim in the UI. Without it the guard passed while
// "Shared Safely" and "carried no secrets" sat in missions.ts.
// llms.txt is the agent file a harness reads before touching the
// product, so a stale claim there is as live as one in a doc.
const COPY_GLOBS = ["README.md", "CHANGELOG.md", "docs", "src", "shared/reports", "llms.txt"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".progress", "_generated"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
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
  const schemaPath = join(ROOT, "convex", "schema.ts");
  // Public minimum has no convex. Nothing there can hold a file body, so this
  // check is satisfied by absence.
  if (!existsSync(schemaPath)) return true;
  const schema = readFileSync(schemaPath, "utf8");
  const block = schema.match(/fileContents: defineTable\([\s\S]*?\n  \}\)/);
  if (block === null) return true;
  if (/\bcontent:\s*v\./.test(block[0])) return false;
  // Archived: convex/scans/store.ts went with the web scan. Nothing to check there.
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
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  // Opt-in for the test suite: one extra path appended to the scanned
  // set. A synthetic violation in a temp file then fails the guard the
  // same way a real violation in llms.txt would. The default run sets
  // nothing, so `npm run check:claims` is unchanged.
  const extra = process.env.CLAIM_GUARD_EXTRA_FILE;
  if (extra !== undefined && extra.length > 0) out.push(join(ROOT, extra));
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
        // A verdict is allowed when its scope is named on the same line. The
        // qualifier may be a plain substring or a pattern.
        if (claim.qualifier !== undefined) {
          const hit = typeof claim.qualifier === "string"
            ? line.toLowerCase().includes(claim.qualifier)
            : claim.qualifier.test(line);
          if (hit) continue;
        }
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
        const purgeOk = retentionIsEnforced(number, unit);
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

const RULE_COUNT = POSITIVE_CLAIMS.length + NEGATIVE_CLAIMS.length + RETENTION_CLAIMS.length;

console.log(`Claim guard passed. ${RULE_COUNT} rules, ${checked} claim phrase(s) checked.`);