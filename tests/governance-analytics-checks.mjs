import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diagnosticPayload,
  emptyGovOutcome,
} from "../shared/review/diagnostics.ts";

// Governance analytics: five signals, no PII.
//
// A gitignored file is invisible to the hosted fold, so adoption is measured
// only from opted-in local diagnostics. The signals are a detected boolean, a
// closed refusal reason, a stale boolean, suppressed counts by match level,
// and an ignored count. No path and no reason text ever lands.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

describe("governance signals are counts and a closed enum", () => {
  it("starts absent with nothing suppressed", () => {
    assert.deepEqual(emptyGovOutcome(), {
      detected: false,
      refused: "none",
      stale: false,
      suppressedFingerprint: 0,
      suppressedRulePath: 0,
      suppressedRule: 0,
      ignored: 0,
      sandbag: false,
    });
  });

  it("keeps the signals through the payload with bounds", () => {
    const out = diagnosticPayload({
      stage: "alpha",
      tier: "alpha",
      harness: "local",
      version: "alpha",
      durationMs: 10,
      orderSource: "local",
      ruleCounts: {},
      govDetected: true,
      govRefused: "accept_wildcard",
      govStale: true,
      govSuppressedFingerprint: 2,
      govSuppressedRulePath: 1,
      govSuppressedRule: 3,
      govIgnored: 1,
      govSandbag: false,
    });
    assert.equal(out.govDetected, true);
    assert.equal(out.govRefused, "accept_wildcard");
    assert.equal(out.govStale, true);
    assert.equal(out.govSuppressedFingerprint, 2);
    assert.equal(out.govSuppressedRulePath, 1);
    assert.equal(out.govSuppressedRule, 3);
    assert.equal(out.govIgnored, 1);
  });

  it("normalizes a free text refusal to none, never storing it", () => {
    const out = diagnosticPayload({
      stage: "alpha",
      tier: "alpha",
      harness: "local",
      version: "alpha",
      durationMs: 10,
      orderSource: "local",
      ruleCounts: {},
      govDetected: true,
      govRefused: "ada@example.com",
      govStale: false,
      govSuppressedFingerprint: 0,
      govSuppressedRulePath: 0,
      govSuppressedRule: 0,
      govIgnored: 0,
      govSandbag: false,
    });
    assert.equal(out.govRefused, "none");
  });

  it("caps counts rather than storing them raw", () => {
    const out = diagnosticPayload({
      stage: "alpha",
      tier: "alpha",
      harness: "local",
      version: "alpha",
      durationMs: 10,
      orderSource: "local",
      ruleCounts: {},
      govDetected: true,
      govRefused: "none",
      govStale: false,
      govSuppressedFingerprint: 999999999,
      govSuppressedRulePath: -1,
      govSuppressedRule: 1.5,
      govIgnored: 4,
      govSandbag: false,
    });
    assert.equal(out.govSuppressedFingerprint, 100000);
    assert.equal(out.govSuppressedRulePath, 0);
    assert.equal(out.govSuppressedRule, 0);
  });
});

describe("the inventory classifies the governance columns with no PII", () => {
  it("lists eight governance columns on usageDiagnostics, all technical", () => {
    const inv = read("convex", "analytics", "inventory.ts");
    for (const name of [
      "govDetected",
      "govRefused",
      "govStale",
      "govSuppressedFingerprint",
      "govSuppressedRulePath",
      "govSuppressedRule",
      "govIgnored",
      "govSandbag",
    ]) {
      assert.ok(inv.includes(`field: "${name}"`), `${name} must be classified in inventory.ts`);
    }
    assert.ok(!/klass: "pii"/.test(inv), "no column may be classified PII");
    const refusedAt = inv.indexOf('field: "govRefused"');
    assert.notEqual(refusedAt, -1);
    const refusedBlock = inv.slice(refusedAt, refusedAt + 600);
    assert.ok(refusedBlock.includes("boundedBy"), "govRefused needs a bound");
  });
});

describe("the local review sends the outcome with the counts", () => {
  it("applies the file and forwards counts, not paths", () => {
    const entry = read("mcp", "review-entry.ts");
    assert.match(entry, /applyGovernanceFile\(root, report, filesReadAcknowledged\(config\)\)/);
    assert.match(entry, /sendDiagnostics\(report, config, started, quoted\?\.id \?\? null, gov\)/);
    assert.doesNotMatch(entry, /govPath|govReasonText/);
  });

  it("states the honest note on privacy, page, and llms", () => {
    const flat = (s) => s.replace(/\s+/g, " ");
    for (const [name, text] of [
      ["docs/PRIVACY.md", read("docs", "PRIVACY.md")],
      ["src/pages/Privacy.tsx", read("src", "pages", "Privacy.tsx")],
      ["llms.txt", read("llms.txt")],
    ]) {
      const body = flat(text);
      assert.ok(body.includes("gitignored"), `${name} must name the gitignored file`);
      assert.ok(
        body.includes("Adoption is measured only from opted-in local diagnostics"),
        `${name} must carry the honest adoption note`,
      );
    }
  });
});
