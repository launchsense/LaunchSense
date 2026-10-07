import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPublicScan, formatReport, standardsLine } from "../convex/mcpHttp.ts";
import { buildStandards, standardsCoverage } from "../shared/reports/standards.ts";

// The MCP text must carry the newest work: the licence suggestion and one
// standards summary line. Without this, a coding tool sees findings only, and
// the licence lane is invisible to the door most people use.

describe("the MCP text carries the licence suggestion", () => {
  it("names the pick and its source, and never calls it a fact", () => {
    const text = formatPublicScan({
      scanId: "s1",
      status: "completed",
      coverageNote: "Read 10 files.",
      errorMessage: null,
      findingCount: 0,
      findings: [],
      suggestedLicence: "MIT",
      suggestionSource: "jev",
      standards: null,
    });
    assert.match(text, /Licence suggestion: MIT \(source: jev\)/);
    assert.match(text, /A suggestion, not a licence fact\./);
  });

  it("says none when there is no suggestion, rather than staying silent", () => {
    const text = formatReport({
      scanId: "s1",
      sha: "abc1234",
      status: "completed",
      coverageNote: null,
      errorMessage: null,
      findingCount: 0,
      findings: [],
      suggestedLicence: null,
      suggestionSource: null,
      standards: null,
    });
    assert.match(text, /Licence suggestion: none \(source: none\)/);
  });
});

describe("the standards summary is one honest line", () => {
  it("counts two axes separately from real rows", () => {
    const rows = buildStandards({
      findings: [{ ruleId: "secret.tracked-env", severity: "high" }],
      analyzedFiles: 5,
      liveChecked: false,
      coverageNote: "OSV checked 3 packages, 0 unknown",
    });
    const coverage = standardsCoverage(rows);
    const line = standardsLine({
      partial: coverage.coverage.partial,
      notAutomatable: coverage.coverage.notAutomatable,
      signalFound: coverage.status.signalFound,
      noSignal: coverage.status.noSignal,
      notChecked: coverage.status.notChecked,
    });
    assert.match(line, /^Standards: \d+ checkable, \d+ not-automatable\./);
    assert.match(line, /This scan: \d+ signal, \d+ no-signal, \d+ not-checked\./);
    assert.match(line, /Two axes, never merged\./);
    // The numbers must come from the rows, not be invented.
    assert.ok(line.includes(`${coverage.coverage.partial} checkable`));
  });

  it("says not computed rather than a false zero", () => {
    assert.match(standardsLine(null), /not computed/i);
  });

  it("rides both formatters", () => {
    for (const text of [
      formatPublicScan({ scanId: "s", status: "completed", coverageNote: null, errorMessage: null, findingCount: 0, findings: [], standards: { partial: 1, notAutomatable: 2, signalFound: 0, noSignal: 1, notChecked: 2 } }),
      formatReport({ scanId: "s", sha: null, status: "completed", coverageNote: null, errorMessage: null, findingCount: 0, findings: [], standards: { partial: 1, notAutomatable: 2, signalFound: 0, noSignal: 1, notChecked: 2 } }),
    ]) {
      assert.match(text, /Standards: 1 checkable, 2 not-automatable\./);
      assert.match(text, /A partial result is not a pass\./);
    }
  });
});
