import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnosticPayload } from "../shared/review/diagnostics.ts";
import { rankFromAnswers, questionIdFor, tableOrder, actionableFindings } from "../shared/reports/priority.ts";

// The honest provenance block and the decision-model help analytics.
//
// Two things must hold:
//   1. The .ls report says plainly that fixed checks decide, and names which
//      rung ordered and which produced the licence suggestion. It never claims a
//      model decided a finding.
//   2. The analytics carry the help as a count and closed labels only: how many
//      positions moved, whether a lane answered, and which rung suggested the
//      licence. No title, no path, no free text.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

const F = (fingerprint, severity, ruleId, title) => ({ fingerprint, severity, ruleId, title });

describe("the decision lane reports whether it helped, as a count", () => {
  it("counts the positions it moved inside a band", () => {
    const findings = [
      F("m1", "medium", "code.sql-pattern", "one"),
      F("m2", "medium", "code.eval-use", "two"),
      F("h1", "high", "secret.credential-pattern", "three"),
    ];
    // The lane is very sure about m2 and not at all about m1, so it moves m2 up.
    const answers = {
      [questionIdFor("m1")]: { type: "noul", noul: 0.0 },
      [questionIdFor("m2")]: { type: "noul", noul: 1.0 },
      [questionIdFor("h1")]: { type: "noul", noul: 1.0 },
    };
    const result = rankFromAnswers(findings, answers, "jev");
    assert.equal(result.source, "jev");
    assert.equal(result.laneAnswered, true);
    assert.ok(result.moved > 0, "the lane moved something, so moved must be above zero");
    // The high band is untouched: no crossing.
    const floor = tableOrder(actionableFindings(findings));
    assert.equal(result.order[0], floor[0], "the high finding stays first");
  });

  it("reports zero moved and no lane when the table answered", () => {
    const result = rankFromAnswers(
      [F("a", "high", "secret.tracked-env", "x"), F("b", "medium", "code.eval-use", "y")],
      null,
      "table",
    );
    assert.equal(result.moved, 0);
    assert.equal(result.laneAnswered, false);
    assert.equal(result.source, "table");
  });

  it("reports a lane that answered and changed nothing", () => {
    const findings = [F("a", "medium", "code.sql-pattern", "x"), F("b", "medium", "code.eval-use", "y")];
    const answers = {
      [questionIdFor("a")]: { type: "noul", noul: 0.5 },
      [questionIdFor("b")]: { type: "noul", noul: 0.5 },
    };
    const result = rankFromAnswers(findings, answers, "perplexity");
    assert.equal(result.laneAnswered, true);
    assert.equal(result.moved, 0, "a flat answer moves nothing");
  });
});

describe("the diagnostic payload carries the help as count and label only", () => {
  const base = {
    stage: "alpha",
    tier: "alpha",
    harness: "local",
    version: "alpha",
    durationMs: 10,
    orderSource: "jev",
    ruleCounts: {},
    govDetected: false,
    govRefused: "none",
    govStale: false,
    govSuppressedFingerprint: 0,
    govSuppressedRulePath: 0,
    govSuppressedRule: 0,
    govIgnored: 0,
    govSandbag: false,
  };

  it("keeps orderMoved, laneAnswered, and suggestionSource through the payload", () => {
    const out = diagnosticPayload({ ...base, orderMoved: 3, laneAnswered: true, suggestionSource: "jev" });
    assert.equal(out.orderMoved, 3);
    assert.equal(out.laneAnswered, true);
    assert.equal(out.suggestionSource, "jev");
  });

  it("normalizes an unknown suggestion source to none, never storing it", () => {
    const out = diagnosticPayload({ ...base, orderMoved: 0, laneAnswered: false, suggestionSource: "ada@example.com" });
    assert.equal(out.suggestionSource, "none");
  });

  it("caps orderMoved rather than storing it raw", () => {
    const out = diagnosticPayload({ ...base, orderMoved: 999999999, laneAnswered: false, suggestionSource: "none" });
    assert.equal(out.orderMoved, 100000);
  });
});

describe("the .ls report states the provenance honestly", () => {
  const entry = read("mcp", "review-entry.ts");

  it("says fixed checks decide, in the report and the render", () => {
    assert.match(entry, /Checks: fixed rules\. No model decides a finding or a severity\./);
  });

  it("names the order rung and the positions moved", () => {
    assert.match(entry, /Order source: \$\{report\.orderSource\}\. Model moved \$\{report\.orderMoved\}/);
  });

  it("names the licence suggestion and its source", () => {
    assert.match(entry, /Licence suggestion: \$\{report\.licenseSuggestion\.pick \?\? "none"\} \(source: \$\{report\.licenseSuggestion\.source\}\)/);
  });

  it("never claims a model decides a finding, without the negation on the same line", () => {
    // The honest line is "No model decides a finding or a severity." So the
    // phrase may appear, but only negated. A bare claim would be the defect.
    for (const [name, text] of [
      ["mcp/review-entry.ts", entry],
      ["shared/review/buildReport.ts", read("shared", "review", "buildReport.ts")],
    ]) {
      for (const line of text.split("\n")) {
        if (!/model decides a finding/i.test(line)) continue;
        assert.match(line, /no model decides a finding/i, `${name} claims a model decides a finding: ${line.trim()}`);
      }
    }
  });
});
