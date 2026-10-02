import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareFindings, depOfVuln } from "../shared/reports/compare.ts";

function opts(over = {}) {
  return {
    oldAnalyzer: "stage3.1",
    newAnalyzer: "stage3.1",
    oldFetched: new Set(["a.ts"]),
    newFetched: new Set(["a.ts"]),
    oldContents: new Map([["a.ts", "h1"]]),
    newContents: new Map([["a.ts", "h1"]]),
    previouslyFixed: new Set(),
    depOf: depOfVuln,
    ...over,
  };
}

function finding(fp, extra = {}) {
  return {
    ruleId: "secret.eval-use",
    fingerprint: fp,
    path: "a.ts",
    line: 3,
    severity: "high",
    title: "Eval",
    why: "Because.",
    ...extra,
  };
}

describe("compareFindings", () => {
  it("marks identical lists as still broken with nothing else", () => {
    const list = [finding("fp1"), finding("fp2")];
    const out = compareFindings(list, structuredClone(list), opts());
    assert.equal(out.length, 2);
    assert.ok(out.every((t) => t.state === "still_broken"));
  });

  it("marks removed covered findings as fixed with code cause", () => {
    const out = compareFindings([finding("fp1")], [], opts());
    assert.equal(out.length, 1);
    assert.equal(out[0]?.state, "fixed");
    assert.equal(out[0]?.cause, "code_change");
  });

  it("marks removed findings as unknown when new coverage drops the file", () => {
    const out = compareFindings(
      [finding("fp1")],
      [],
      opts({ newFetched: new Set() }),
    );
    assert.equal(out[0]?.state, "unknown");
  });

  it("marks changed advisories as fixed with advisory cause", () => {
    const old = [finding("fp1", {
      ruleId: "deps.vulnerability",
      path: "package.json",
      title: "GHSA-aaa affects leftpad@1.0.0",
    })];
    const next = [finding("fp2", {
      ruleId: "deps.vulnerability",
      path: "package.json",
      title: "GHSA-bbb affects leftpad@1.0.0",
    })];
    const out = compareFindings(old, next, opts({
      oldFetched: new Set(["package.json"]),
      newFetched: new Set(["package.json"]),
      oldContents: new Map([["package.json", "h1"]]),
      newContents: new Map([["package.json", "h1"]]),
    }));
    const fixed = out.find((t) => t.oldFingerprint === "fp1");
    assert.equal(fixed?.state, "fixed");
    assert.equal(fixed?.cause, "advisory_update");
  });

  it("marks analyzer bumps as unknown, never fixed", () => {
    const out = compareFindings(
      [finding("fp1")],
      [],
      opts({ newAnalyzer: "stage3.2" }),
    );
    assert.equal(out[0]?.state, "unknown");
    assert.equal(out[0]?.cause, "analyzer_update");
  });

  it("marks refound fixed findings as regressed", () => {
    const out = compareFindings(
      [finding("fp1")],
      [finding("fp1")],
      opts({ previouslyFixed: new Set(["fp1"]) }),
    );
    assert.equal(out[0]?.state, "regressed");
  });
});
