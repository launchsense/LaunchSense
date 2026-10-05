import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_RULE_IDS, severityFor, reviewRequired } from "../shared/policies/severity.ts";

// A rule id that no band knows silently becomes "info" through the fallthrough
// in severityFor. That is how a real finding can drop out of every actionable
// list with no error and no failing test. This scan reads every rule id the
// analyzers and endpoints emit and requires each one to be classified. Add a
// rule, and this fails until the band is chosen.
//
// Two shapes carry a rule id out of a source file:
//   1. an object literal, `ruleId: "..."`, and
//   2. the first positional argument of a helper whose first parameter is
//      `ruleId`, `finding("...", path, line, title, why, raw)`.
// The second shape was missed. `shared/review/buildReport.ts` has a local
// `finding()` helper, so `license.clash` and `deps.deprecated`, the only
// per-dependency licence finding the product emits and its deprecation notice,
// were invisible to this guard and sat at "info" through the fallthrough.
// Helpers are discovered from the source rather than listed, so a new emitter
// is covered by writing it, not by editing this file.
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

function sourceFiles() {
  return ROOTS.flatMap((root) => tsFiles(root));
}

/** Functions that take `ruleId` as their first parameter, so a call can pass one. */
function ruleIdHelpers(text) {
  const names = new Set();
  for (const match of text.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(\s*ruleId\s*:/g)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(\s*ruleId\s*:/g)) {
    names.add(match[1]);
  }
  return names;
}

/** Rule ids in one file: object literals plus positional first arguments. */
function ruleIdsIn(text, helpers) {
  const found = new Set();
  for (const match of text.matchAll(/ruleId\s*:\s*"([^"]+)"/g)) {
    found.add(match[1]);
  }
  for (const name of helpers) {
    const call = new RegExp(`\\b${name}\\s*\\(\\s*"([^"]+)"`, "g");
    for (const match of text.matchAll(call)) found.add(match[1]);
  }
  return found;
}

function ruleIdsInFile(file, helpers = ruleIdHelpers(readFileSync(file, "utf8"))) {
  return ruleIdsIn(readFileSync(file, "utf8"), helpers);
}

function scan() {
  const files = sourceFiles();
  // Two passes: learn every helper name, then read every call site with it.
  const helpers = new Set();
  for (const file of files) {
    for (const name of ruleIdHelpers(readFileSync(file, "utf8"))) helpers.add(name);
  }
  const emitted = new Set();
  for (const file of files) {
    for (const id of ruleIdsIn(readFileSync(file, "utf8"), helpers)) emitted.add(id);
  }
  return { emitted, helpers, files };
}

const { emitted, helpers, files } = scan();

describe("every emitted rule id is classified", () => {
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

describe("the scan can see a rule id passed positionally", () => {
  it("discovers the local finding helper in the local report builder", () => {
    assert.ok(
      helpers.has("finding"),
      "the helper scan missed finding(), so every positional rule id is invisible again",
    );
  });

  it("reads the rule ids buildReport.ts passes positionally", () => {
    // These four sit in shared/review/buildReport.ts as the first argument of
    // finding(). None of them appears as a `ruleId:` literal in that file, so
    // before this scan was widened they were not checked at all.
    const local = ruleIdsInFile("shared/review/buildReport.ts");
    for (const id of ["deps.install-script", "license.policy", "deps.deprecated", "license.clash"]) {
      assert.ok(local.has(id), `${id} is emitted positionally and must be in the scan`);
    }
  });

  it("finds an unclassified id that is only ever passed positionally", () => {
    // The guard above is only worth its cost if it would fail on a new
    // positional emitter. This is that check, on a synthetic call site.
    const snippet = 'findings.push(finding("deps.not-classified", name, 1, "title", "why", raw));';
    const found = ruleIdsIn(snippet, new Set(["finding"]));
    assert.deepEqual([...found], ["deps.not-classified"], "a positional id must be read");
    assert.equal(KNOWN_RULE_IDS.has("deps.not-classified"), false, "it is unclassified on purpose");
  });

  it("classifies the per-dependency licence finding and the deprecation notice", () => {
    // Both were emitted with no band, so severityFor fell through to "info" and
    // reviewRequired said no. A licence clash between two declared terms is a
    // question for a person, not advice.
    assert.equal(severityFor("license.clash"), "medium");
    assert.equal(severityFor("deps.deprecated"), "medium");
    assert.equal(reviewRequired(severityFor("license.clash")), true);
    assert.equal(reviewRequired(severityFor("deps.deprecated")), true);
  });
});

describe("every file in the scan roots was read", () => {
  it("read the analyzers and the endpoints", () => {
    assert.ok(files.length > 10, `expected many source files, found ${files.length}`);
    for (const root of ROOTS) {
      assert.ok(
        files.some((file) => file.startsWith(root)),
        `${root} was not scanned`,
      );
    }
  });
});