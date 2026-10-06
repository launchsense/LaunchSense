import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStandards, standardsCoverage } from "../shared/reports/standards.ts";
import { KNOWN_RULE_IDS } from "../shared/policies/severity.ts";

// The standards mapping, held tight. Three defects, one file of tests.
//
// 1. A row claimed "partial" coverage with no evidence rule, and its only
//    source was a product surface that no longer exists. A row must name a
//    signal the product still delivers.
// 2. A row labelled leaked credentials as "Cryptographic Failures". A leaked
//    key is not a broken cipher, and a security reviewer reads that row first.
// 3. The coverage number merged two axes (what we can check at all, and what
//    this scan found), so it double counted. Both are counted now, separately.
//
// This is the honesty metric a buyer reads. It is pinned in code so it cannot
// drift when a check is added or removed.

const source = readFileSync(new URL("../shared/reports/standards.ts", import.meta.url), "utf8");

// One empty scan: every row exists, nothing fired.
function rows() {
  return buildStandards({
    findings: [],
    analyzedFiles: 0,
    liveChecked: false,
    coverageNote: null,
  });
}

describe("every partial row names a signal the product still delivers", () => {
  it("never marks a row partial without at least one evidence rule", () => {
    for (const row of rows()) {
      if (row.coverage !== "partial") continue;
      assert.ok(
        row.evidenceRuleIds.length > 0,
        `${row.requirementId} is partial with no evidence rule, so nothing backs it`,
      );
    }
  });

  it("only names rule ids that exist in the severity map", () => {
    const known = new Set(KNOWN_RULE_IDS);
    for (const row of rows()) {
      for (const id of row.evidenceRuleIds) {
        assert.ok(known.has(id), `${row.requirementId} names ${id}, which is not a real rule`);
      }
    }
  });

  it("names no live rule, because the live check was removed", () => {
    for (const row of rows()) {
      for (const id of row.evidenceRuleIds) {
        assert.ok(!id.startsWith("live."), `${row.requirementId} names ${id}, but live is gone`);
      }
    }
  });

  it("keeps the Secure Communications row not-checked, not partial", () => {
    const v9 = rows().find((row) => row.requirementId === "V9.1.1");
    assert.ok(v9, "the row must still exist, named honestly");
    assert.equal(v9.coverage, "not-automatable");
  });
});

describe("a leaked credential is not a cryptographic failure", () => {
  it("does not label credentials as Cryptographic Failures", () => {
    const a04 = rows().find((row) => row.requirementId === "A04:2025");
    assert.ok(a04, "A04 must exist");
    for (const id of a04.evidenceRuleIds) {
      assert.ok(
        !id.startsWith("secret."),
        `A04 Cryptographic Failures names ${id}; a leaked credential is a different failure`,
      );
    }
  });

  it("maps the inference codes to the checks that actually detect them", () => {
    const byId = new Map(rows().map((row) => [row.requirementId, row]));
    assert.deepEqual(byId.get("CWE-95")?.evidenceRuleIds, ["secret.eval-use", "code.eval-use"]);
    assert.deepEqual(byId.get("CWE-79")?.evidenceRuleIds, ["code.inner-html"]);
    assert.deepEqual(byId.get("CWE-78")?.evidenceRuleIds, ["code.child-process"]);
    assert.deepEqual(byId.get("CWE-327")?.evidenceRuleIds, ["code.weak-crypto"]);
    assert.deepEqual(byId.get("CWE-942")?.evidenceRuleIds, ["code.cors-wildcard"]);
  });
});

describe("the coverage metric counts two axes, never merged", () => {
  it("counts coverage and status separately", () => {
    const coverage = standardsCoverage(rows());
    assert.equal(
      coverage.coverage.full + coverage.coverage.partial + coverage.coverage.notAutomatable,
      coverage.total,
      "every row lands in exactly one coverage band",
    );
    assert.equal(
      coverage.status.signalFound + coverage.status.noSignal + coverage.status.notChecked,
      coverage.total,
      "every row lands in exactly one status band",
    );
    assert.equal(coverage.coverage.full, 0, "no check fully covers a standard, and we say so");
  });

  it("does not count a partial row as not-automatable, or the reverse", () => {
    const coverage = standardsCoverage(rows());
    assert.ok(coverage.coverage.partial > 0, "there are partial rows");
    assert.ok(coverage.coverage.notAutomatable > 0, "there are not-automatable rows");
    assert.equal(coverage.total, rows().length);
  });
});

describe("the copy stays honest", () => {
  it("carries no certification or compliance claim", () => {
    assert.doesNotMatch(source, /\bcertified\b/i);
    assert.doesNotMatch(source, /\bis\s+compliant\b/i);
    assert.doesNotMatch(source, /\bguaranteed\b/i);
  });

  it("uses no em dash, en dash, ellipsis, or middle dot", () => {
    for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
      assert.doesNotMatch(source, character);
    }
  });
});
