import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_RULE_IDS, severityFor } from "../shared/policies/severity.ts";

// A rule id that no band knows silently becomes "info" through the fallthrough
// in severityFor. That is how a real finding can drop out of every actionable
// list with no error and no failing test. This scan reads every emitted
// `ruleId: "..."` literal in the analyzers and endpoints and requires each one
// to be classified. Add a rule, and this fails until the band is chosen.
//
// It reads source text, not the graph, so it stays dependency-free.

const ROOTS = ["shared", "convex"];
const SKIP = new Set(["node_modules", "_generated", "dist", ".git"]);

function tsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function emittedRuleIds() {
  const found = new Set();
  for (const root of ROOTS) {
    for (const file of tsFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/ruleId\s*:\s*"([^"]+)"/g)) {
        found.add(match[1]);
      }
    }
  }
  return found;
}

describe("every emitted rule id is classified", () => {
  const emitted = emittedRuleIds();

  it("finds emitted rule ids to check", () => {
    assert.ok(emitted.size > 10, `expected many rule ids, found ${emitted.size}`);
  });

  it("has a band for every emitted rule id", () => {
    const unknown = [...emitted].filter((id) => !KNOWN_RULE_IDS.has(id));
    assert.deepEqual(
      unknown,
      [],
      `unclassified rule ids silently become info: ${unknown.join(", ")}`,
    );
  });

  it("maps each emitted id to the band that names it", () => {
    for (const id of emitted) {
      assert.ok(
        ["high", "medium", "low", "info"].includes(severityFor(id)),
        `${id} did not resolve to a band`,
      );
    }
  });
});
