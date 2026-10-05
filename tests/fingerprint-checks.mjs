import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as redaction from "../shared/redaction.ts";
import { ANALYZER_VERSION } from "../shared/analyzers/version.ts";
import { scanSecrets } from "../shared/analyzers/secrets.ts";

// WS4. Two identical findings in one file used to hash to one
// fingerprint. The run then deduped on the fingerprint and dropped one of
// them, so the count of the finding was wrong and the two copies shared one
// identity. Each repeat after the first now carries its own occurrence
// number. The first occurrence keeps the exact string it has always had,
// so every stored fingerprint stays stable.
const { fingerprintFinding, redactedSnippet, occurrenceFor } = redaction;

// The dedupe shape from convex/scans/analyze.ts, keyed on the whole
// fingerprint.
function dedupeOnFingerprint(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });
}

// What convex/scans/analyze.ts pushEvidence does, using the shared helpers.
function pushShape(ruleId, path, rawSnippet, findings) {
  const snippet = redactedSnippet(rawSnippet);
  const occurrence = occurrenceFor(findings, { ruleId, path, redactedSnippet: snippet });
  const fingerprint = fingerprintFinding(ruleId, ANALYZER_VERSION, path, snippet, occurrence);
  const finding = { ruleId, path, redactedSnippet: snippet, fingerprint };
  findings.push(finding);
  return finding;
}

describe("WS4 identical findings keep separate identities", () => {
  it("exports the occurrence counter used to number repeats", () => {
    assert.equal(typeof occurrenceFor, "function", "shared/redaction.ts must export occurrenceFor");
  });

  it("gives each repeat after the first its own fingerprint", () => {
    const first = fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 0);
    const second = fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 1);
    const third = fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 2);
    assert.notEqual(first, second);
    assert.notEqual(second, third);
    assert.equal(first, fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;"));
    assert.equal(second, `${first}:1`);
    assert.equal(third, `${first}:2`);
  });

  it("leaves the first-occurrence fingerprint byte for byte what it always was", () => {
    // The legacy string is ruleId:analyzerVersion:path:hash of the redacted
    // snippet, with no suffix. A stored fingerprint must not change.
    assert.equal(
      fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;"),
      `code.debug-leftover:${ANALYZER_VERSION}:src/a.ts:afe012ff`,
    );
    assert.equal(
      fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 0),
      `code.debug-leftover:${ANALYZER_VERSION}:src/a.ts:afe012ff`,
    );
  });

  it("keeps both of two identical findings through the dedupe", () => {
    const findings = [];
    pushShape("code.debug-leftover", "src/a.ts", "console.log(x)", findings);
    pushShape("code.debug-leftover", "src/a.ts", "console.log(x)", findings);
    assert.equal(findings.length, 2);
    assert.equal(dedupeOnFingerprint(findings).length, 2);
    assert.equal(new Set(findings.map((f) => f.fingerprint)).size, 2);
    assert.equal(findings[0].fingerprint.endsWith(":1"), false);
    assert.equal(findings[1].fingerprint, `${findings[0].fingerprint}:1`);
  });

  it("counts only true repeats, so different findings keep their own number", () => {
    const findings = [];
    pushShape("code.debug-leftover", "src/a.ts", "console.log(x)", findings);
    pushShape("code.debug-leftover", "src/a.ts", "console.log(y)", findings);
    pushShape("code.debug-leftover", "src/b.ts", "console.log(x)", findings);
    pushShape("code.eval-use", "src/a.ts", "console.log(x)", findings);
    assert.equal(findings.length, 4);
    assert.equal(new Set(findings.map((f) => f.fingerprint)).size, 4);
    for (const finding of findings) {
      assert.equal(finding.fingerprint.endsWith(":1"), false, finding.fingerprint);
    }
    const sameLine = { ruleId: "code.debug-leftover", path: "src/a.ts", redactedSnippet: "console.log(x)" };
    assert.equal(occurrenceFor(findings, sameLine), 1);
    findings.push({ ...sameLine, fingerprint: `${findings[0].fingerprint}:1` });
    assert.equal(occurrenceFor(findings, sameLine), 2);
  });

  it("starts each rule and path at occurrence zero again", () => {
    // The count is per rule, path and snippet inside one run. A second run
    // starts from zero, so a rescan reports the same fingerprints.
    assert.equal(occurrenceFor([], { ruleId: "code.debug-leftover", path: "src/a.ts", redactedSnippet: "x" }), 0);
    const later = [
      { ruleId: "code.debug-leftover", path: "src/a.ts", redactedSnippet: "x" },
      { ruleId: "code.debug-leftover", path: "src/a.ts", redactedSnippet: "x" },
    ];
    assert.equal(occurrenceFor(later, { ruleId: "code.debug-leftover", path: "src/a.ts", redactedSnippet: "x" }), 2);
  });

  it("is reachable in a real scan: two identical code lines in one file", () => {
    // The analyzer really can return the same rule, path and snippet twice.
    const matches = scanSecrets([
      { path: "src/a.ts", content: "eval(userInput)\neval(userInput)\n" },
    ]).filter((m) => m.ruleId === "code.eval-use");
    assert.equal(matches.length, 2, "fixture must produce two identical matches");
    assert.equal(matches[0].snippet, matches[1].snippet);

    const findings = [];
    for (const match of matches) {
      pushShape(match.ruleId, match.path, match.snippet, findings);
    }
    assert.equal(dedupeOnFingerprint(findings).length, 2);
  });

  it("is wired into analyzeScan, which numbers repeats before it dedupes", () => {
    const source = readFileSync(new URL("../convex/scans/analyze.ts", import.meta.url), "utf8");
    assert.match(source, /occurrenceFor\(/, "analyze.ts must count earlier repeats");
    assert.match(
      source,
      /fingerprintFinding\(\s*item\.ruleId,\s*ANALYZER_VERSION,\s*item\.path,\s*snippet,\s*occurrence,?\s*\)/,
      "analyze.ts must pass the occurrence to fingerprintFinding",
    );
    assert.match(source, /seen\.has\(f\.fingerprint\)/, "the dedupe must stay keyed on the full fingerprint");
  });
});
