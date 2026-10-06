import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canReadScan } from "../shared/reports/scanAccess.ts";

// The lite gate: anonymous visitors see a real lite result, signed-in users
// see the full report. One defect class, one file of tests.
//
// A gate that leaks the full list through another surface is not a gate, so
// the boundary is pinned on both sides: what is gated (full findings,
// compare details) and what stays open (rescan, share, feedback, tool card).
// The open side is the loop and the distribution, and closing it by accident
// would break the product while looking like a stricter gate.
//
// No network, no database, and no clock. Components are read as text, the
// ownership rule is imported directly because it is pure.

const guest = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");
const lite = readFileSync(new URL("../src/features/report/LiteReport.tsx", import.meta.url), "utf8");

describe("the full report waits behind sign-in", () => {
  it("renders the full report only when authenticated", () => {
    assert.match(guest, /isAuthenticated && \(\s*<ScanReport/);
  });

  it("renders lite instead for anonymous visitors", () => {
    assert.match(guest, /!isAuthenticated && scan !== null && \(\s*<LiteReport/);
  });

  it("gates the compare details the same way", () => {
    assert.match(guest, /comparePair !== null && isAuthenticated && \(\s*<CompareView/);
  });

  it("gates the detail panels and the explanations the same way", () => {
    assert.match(guest, /isAuthenticated && \(\s*<Stage5Panels/);
    assert.match(guest, /\{isAuthenticated && explanations\.length > 0/);
    assert.match(guest, /\{isAuthenticated && \(\s*<button[^>]*onClick=\{\(\) => void onExplain/);
  });

  it("keeps a signed-in viewer on their anonymous scan", () => {
    assert.equal(
      canReadScan({ signedIn: false, userId: null }, "some-credential-id"),
      true,
      "login must not lock a visitor out of the scan they just ran",
    );
    assert.equal(canReadScan({ signedIn: false }, null), true);
    assert.equal(
      canReadScan({ signedIn: true, userId: "a" }, "b"),
      false,
      "another account's signed-in scan stays closed",
    );
  });
});

describe("the loop stays open", () => {
  it("leaves rescan, share, feedback, and the tool card ungated", () => {
    assert.doesNotMatch(guest, /isAuthenticated && \(\s*<ToolCard/);
    assert.doesNotMatch(guest, /isAuthenticated && \(\s*<ReportFeedback/);
    assert.doesNotMatch(guest, /isAuthenticated && [^<]*onRescan/);
  });
});

describe("lite is a real result, not a blur", () => {
  it("shows counts, the top finding, coverage, and the named withheld count", () => {
    assert.match(lite, /Findings:/);
    assert.match(lite, /Start here:/);
    assert.match(lite, /coverageNote/);
    assert.match(lite, /The full report lists \{withheld\}/);
    assert.match(lite, /<AuthPanel scanId=\{props\.scanId\} \/>/);
  });

  it("never renders the full list", () => {
    assert.doesNotMatch(lite, /findings\.map/);
  });

  it("keeps the partial line on the lite view", () => {
    assert.match(lite, /A partial result is not a pass\./);
  });

  it("uses no gate pressure words and no em dashes", () => {
    for (const word of ["blur", "locked", "countdown", "premium", "upgrade", "paywall"]) {
      assert.doesNotMatch(lite.toLowerCase(), new RegExp(word), `lite copy pressures with ${word}`);
    }
    for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
      assert.doesNotMatch(lite, character);
      assert.doesNotMatch(guest, character);
    }
  });
});
