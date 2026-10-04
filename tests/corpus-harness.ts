// Corpus harness: run the real secrets analyzer over real repos and classify every
// credential hit. Secrets only. This is not a full review: it does not check
// deps, licenses, hygiene, live fetch, DNA, readiness, or standards.
// For the full local review, run:
//   node --experimental-strip-types mcp/review-entry.ts --root <dir>
// or call launchsense_scan_repo in the coding tool.
// This is the measurement that must exist before any more secret rules are
// added. A rule written without a corpus is a guess.
//
// Usage:
//   node --experimental-strip-types tests/corpus-harness.ts /tmp/opencode/corpus
//
// It prints, per repo:
//   - files scanned
//   - credential-pattern hits
//   - each hit with its line, so every one can be judged true or false
//
// It writes NOTHING. It reads local clones only. No network.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scanSecrets } from "../shared/analyzers/secrets.ts";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "target", "vendor",
  "__pycache__", ".venv", "venv", ".next", ".cache", "coverage",
]);

const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 3000;

interface Hit {
  repo: string;
  path: string;
  line: number;
  ruleId: string;
  snippet: string;
}

function walk(dir: string, repo: string, out: Hit[], state: { files: number }): void {
  if (state.files >= MAX_FILES) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (state.files >= MAX_FILES) return;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, repo, out, state);
      continue;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES || st.size === 0) continue;
    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    // Skip binary-looking files, same as the product does.
    if (content.includes("\u0000")) continue;
    state.files++;
    const rel = full.slice(full.indexOf(repo) + repo.length + 1);
    for (const hit of scanSecrets([{ path: rel, content }])) {
      out.push({
        repo,
        path: rel,
        line: hit.line,
        ruleId: hit.ruleId,
        snippet: hit.snippet.slice(0, 140),
      });
    }
  }
}

function main(): void {
  const root = process.argv[2];
  if (root === undefined || !existsSync(root)) {
    console.error("give a corpus directory");
    process.exit(2);
  }
  console.error(
    "Secrets-only run. This is not a full review: risky code shapes, deps, licenses, hygiene, " +
    "live fetch, DNA, readiness, and standards are not checked. " +
    "For the full local review, run: " +
    "node --experimental-strip-types mcp/review-entry.ts --root <dir>"
  );

  const repos = readdirSync(root).filter((d) => {
    try {
      return statSync(join(root, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const all: Hit[] = [];
  for (const repo of repos) {
    const before = all.length;
    walk(join(root, repo), repo, all, { files: 0 });
    const mine = all.slice(before);
    const creds = mine.filter((h) => h.ruleId === "secret.credential-pattern");
    console.log(`${repo}: ${creds.length} credential-pattern hits`);
  }

  const creds = all.filter((h) => h.ruleId === "secret.credential-pattern");
  console.log("");
  console.log(`TOTAL credential-pattern hits: ${creds.length}`);
  console.log("");
  const other = all.filter((h) => h.ruleId !== "secret.credential-pattern");
  const byRule = new Map<string, number>();
  for (const h of other) byRule.set(h.ruleId, (byRule.get(h.ruleId) ?? 0) + 1);
  console.log(`Other-rule hits the analyzer held but this list does not print: ${other.length}`);
  for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${rule}`);
  }
  console.log("");

  // Group by the syntactic shape, so the failure modes are visible rather than a
  // flat list of file names.
  const shapes = new Map<string, number>();
  for (const h of creds) {
    const s = h.snippet.trim();
    let shape = "other";
    if (/^\s*#|^\s*\/\//.test(s)) shape = "comment";
    else if (/:\s*(str|string|int|number|bool|float|dict|list)\b/.test(s)) shape = "type annotation";
    else if (/=\s*[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(s)) shape = "call/constructor";
    else if (/=\s*[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_]/.test(s)) shape = "attribute reference";
    else if (/["']\s*["']/.test(s)) shape = "empty string";
    else if (/["']/.test(s)) shape = "quoted literal";
    else shape = "bare value";
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  console.log("by shape:");
  for (const [shape, n] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${shape}`);
  }

  console.log("");
  console.log("every hit, for judging true or false:");
  for (const h of creds) {
    console.log(`  ${h.repo.padEnd(20)} ${h.path}:${h.line}`);
    console.log(`      ${h.snippet.replace(/\s+/g, " ").slice(0, 120)}`);
  }
}

main();
