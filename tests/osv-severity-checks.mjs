import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickSeverity } from "../shared/adapters/osv.ts";

// U5. Most OSV advisories carry a CVSS vector or a textual
// severity, not a numeric score. The old reader returned the
// raw vector text, and the caller turned anything it did not
// recognise into medium, so a critical advisory could be stored
// as medium. Severity is now derived from the advisory record,
// and an advisory with no readable severity stays unknown
// instead of becoming an invented medium.
describe("U5 OSV advisory severity", () => {
  it("reads a numeric base score", () => {
    assert.equal(pickSeverity({ severity: [{ type: "CVSS_V3", score: "9.8" }] }), "high");
    assert.equal(pickSeverity({ severity: [{ type: "CVSS_V3", score: "5.5" }] }), "medium");
    assert.equal(pickSeverity({ severity: [{ type: "CVSS_V3", score: "2.1" }] }), "low");
  });

  it("maps a textual severity in database_specific", () => {
    assert.equal(pickSeverity({ database_specific: { severity: "CRITICAL" } }), "high");
    assert.equal(pickSeverity({ database_specific: { severity: "HIGH" } }), "high");
    assert.equal(pickSeverity({ database_specific: { severity: "MODERATE" } }), "medium");
    assert.equal(pickSeverity({ database_specific: { severity: "MEDIUM" } }), "medium");
    assert.equal(pickSeverity({ database_specific: { severity: "LOW" } }), "low");
  });

  it("maps a textual severity in ecosystem_specific", () => {
    assert.equal(pickSeverity({ ecosystem_specific: { severity: "CRITICAL" } }), "high");
    assert.equal(pickSeverity({ ecosystem_specific: { severity: "MODERATE" } }), "medium");
    assert.equal(pickSeverity({ ecosystem_specific: { severity: "LOW" } }), "low");
  });

  it("computes the CVSS v3 base score from a vector", () => {
    // AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N: impact is 6.42 x 0.56
    // = 3.5952, exploitability is 8.22 x 0.85 x 0.77 x 0.85 x 0.85
    // = 3.887, so the base score is 7.482, which rounds up to 7.5.
    // 7.5 is high. The score is computed, not guessed.
    const vector = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N";
    assert.equal(pickSeverity({ severity: [{ type: "CVSS_V3", score: vector }] }), "high");
  });

  it("keeps a low-scoring vector low", () => {
    // AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:N/A:L: impact is 6.42 x 0.22
    // = 1.4124, exploitability is 8.22 x 0.85 x 0.44 x 0.85 x 0.62
    // = 1.62, so the base score is 3.03, which rounds up to 3.1.
    // 3.1 is low.
    const vector = "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:N/A:L";
    assert.equal(pickSeverity({ severity: [{ type: "CVSS_V3", score: vector }] }), "low");
  });

  it("returns unknown, never an invented medium, when nothing is readable", () => {
    const severity = pickSeverity({});
    assert.equal(severity, "unknown");
    assert.notEqual(severity, "medium");
  });

  it("returns unknown for a vector it cannot score", () => {
    // A CVSS v2 vector uses different metrics and is not scored
    // here. It stays unknown rather than becoming a guess.
    const vector = "CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P";
    const severity = pickSeverity({ severity: [{ type: "CVSS_V2", score: vector }] });
    assert.equal(severity, "unknown");
    assert.notEqual(severity, "medium");
  });
});
