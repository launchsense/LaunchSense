import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A raw NUL byte in a source file makes git treat the whole file as binary, so
// it disappears from diffs and review, and the claim guard and prettier skip it.
// shared/consent/digest.ts shipped one, written as a literal NUL inside a string
// join rather than the escape sequence. This catches the class.

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DIRS = ["shared", "convex", "src", "scripts", "tests"];
const EXTS = [".ts", ".tsx", ".mjs", ".js", ".md", ".txt", ".sh", ".json"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "_generated" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (EXTS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe("no source file carries a raw NUL byte, which makes git call it binary", () => {
  it("finds no NUL in any shared, convex, src, scripts, or tests source file", () => {
    const offenders = [];
    for (const dir of DIRS) {
      for (const file of walk(join(root, dir))) {
        if (readFileSync(file).includes(0)) offenders.push(file.slice(root.length + 1));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these files contain a NUL byte and would be treated as binary: ${offenders.join(", ")}`,
    );
  });
});
