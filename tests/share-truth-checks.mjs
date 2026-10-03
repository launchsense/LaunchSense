import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// W4 and W5. The share block moved out of ScanReport and now carries the
// permanence disclosure. These tests pin the ordering and the disclosure, and
// they assert that no copy claims expiry, revocation, or a deleted share,
// because none of those exist in the backend.

const guest = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../src/features/report/ScanReport.tsx", import.meta.url), "utf8");
const panels = readFileSync(new URL("../src/features/report/SignalPanels.tsx", import.meta.url), "utf8");
const sharePage = readFileSync(new URL("../src/pages/SharePage.tsx", import.meta.url), "utf8");
const passport = readFileSync(new URL("../src/pages/PassportPage.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8");

function indexOf(source, needle) {
  const i = source.indexOf(needle);
  assert.notEqual(i, -1, `expected to find ${needle}`);
  return i;
}

describe("W4 report order", () => {
  it("puts the fix list before the live panel so the top 3 sentence is not split", () => {
    const fix = indexOf(report, 'aria-label="Fix before you share"');
    const live = indexOf(report, 'aria-label="Live site check"');
    assert.ok(fix < live, "the rest-of-fix-list must come before the live panel");
  });

  it("keeps the live panel above the findings list", () => {
    const live = indexOf(report, 'aria-label="Live site check"');
    const findings = indexOf(report, 'aria-label="Findings"');
    assert.ok(live < findings, "the live panel belongs after the fix list and before findings");
  });

  it("moved the share block out of ScanReport", () => {
    assert.doesNotMatch(report, /aria-label="Share and passport"/);
    assert.doesNotMatch(report, /Create share link/);
    assert.match(guest, /aria-label="Share and passport"/);
    assert.match(guest, /Create share link/);
  });

  it("places share after the rescan block, not before it", () => {
    const rescan = indexOf(guest, 'aria-label="Rescan"');
    const share = indexOf(guest, 'aria-label="Share and passport"');
    assert.ok(rescan < share, "share must come after rescan so fix-then-rescan reads in order");
  });

  it("places share before the signal tabs", () => {
    const share = indexOf(guest, 'aria-label="Share and passport"');
    const tabs = indexOf(guest, "<Stage5Panels");
    assert.ok(share < tabs, "share stays above the framework signals");
  });

  it("no longer declares or passes share props in ScanReport", () => {
    for (const prop of [
      "onShare",
      "onPassport",
      "shareId",
      "passportId",
      "shareError",
      "shareViewed",
      "onConfirmShareViewed",
      "origin",
    ]) {
      assert.doesNotMatch(report, new RegExp(prop), `ScanReport still references ${prop}`);
    }
  });

  it("demotes the readiness label out of heading status", () => {
    assert.doesNotMatch(panels, /<h5>Share readiness:/);
    assert.match(panels, /Supporting signal: \{props\.readiness\.label\}/);
    // The data itself must survive the demotion.
    assert.match(panels, /props\.readiness\.reasons/);
    assert.match(panels, /props\.readiness\.readCoverage/);
  });

  it("fixes the grammar bug that wrapped across two lines", () => {
    assert.doesNotMatch(panels, /does not\s+decides/);
    assert.doesNotMatch(panels, /does not\s*\n\s*decides/);
  });
});

describe("W5 permanence disclosure", () => {
  it("states permanence before the create buttons", () => {
    const disclosure = indexOf(guest, 'aria-label="Before you create a link"');
    const button = indexOf(guest, "Create share link");
    assert.ok(disclosure < button, "the disclosure must be visible above the button");
  });

  it("says the link does not expire and cannot be taken back", () => {
    assert.match(guest, /The link does not expire\. There is no way to take it back\./);
  });

  it("names what the link does and does not contain", () => {
    assert.match(guest, /shows your repo name, the commit, finding counts, titles, and/);
    assert.match(guest, /never shows file paths, line numbers, code, or secret values/);
  });

  it("discloses permanence to the recipient on both public pages", () => {
    for (const [name, source] of [["SharePage", sharePage], ["PassportPage", passport]]) {
      assert.match(source, /stays live/, `${name} does not tell the recipient the link stays live`);
      assert.match(source, /cannot take it back|cannot be taken back/, `${name} omits permanence`);
    }
  });

  it("tells the recipient no sign in is needed", () => {
    assert.match(sharePage, /Anyone with this link can open it/);
    assert.match(passport, /Anyone with this link can open it/);
  });

  it("no longer claims the public pages show titles only", () => {
    // The share page renders step.why, and two why values are dynamic
    // (a dependency version and a licence identifier). "titles only" is false.
    assert.doesNotMatch(passport, /shows counts and titles only/);
    assert.match(sharePage, /counts, titles, and short explanations/);
    assert.match(passport, /finding counts, titles, and the scan status/);
  });
});

describe("no copy claims a capability the backend lacks", () => {
  const publicCopy = [guest, report, sharePage, passport].join("\n");

  it("never promises expiry or revocation", () => {
    for (const phrase of [
      /expires?\s+(in|after)\b/i,
      /you can revoke/i,
      /revoke (it|this|the link)/i,
      /take (it|this link) (down|offline)/i,
      /delete (the|your) (link|share)/i,
      /link can be turned off/i,
    ]) {
      assert.doesNotMatch(publicCopy, phrase, `copy promises a capability that does not exist: ${phrase}`);
    }
  });

  it("matches the schema, which has no expiry and no revoked flag", () => {
    const shareTable = schema.slice(schema.indexOf("shareArtifacts:"), schema.indexOf("passportArtifacts:"));
    assert.doesNotMatch(shareTable, /expiresAt|revoked/, "the schema must not gain a flag the copy does not describe");
    const passportTable = schema.slice(schema.indexOf("passportArtifacts:"), schema.indexOf("shareArtifacts:") + 4000);
    assert.doesNotMatch(passportTable.slice(0, 300), /expiresAt|revoked/);
  });
});