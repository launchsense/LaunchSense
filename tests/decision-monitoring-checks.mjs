import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The decision-source reading. This query reports what the stored rows say and
// nothing more. The tests hold two lines: the reading never invents a metric it
// does not have, and it never grades a rung.

const raw = readFileSync(new URL("../convex/decisionMonitoring.ts", import.meta.url), "utf8");
// Comments say what the code must never do, so they are stripped before the
// assertions below look for that behaviour. Only executable code is checked.
const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("decision-source monitoring", () => {
  it("reads only stored fields: counts, a source name, and a duration", () => {
    assert.match(source, /usageDiagnostics/);
    assert.match(source, /orderSource/);
    assert.match(source, /durationMs/);
    // No file text, no repo name, no finding text leaves the table.
    assert.ok(!/fileText|snippet|repoUrl|filePath/.test(source), "the reading must not carry file content");
  });

  it("names the metrics it cannot produce instead of leaving them implied", () => {
    // These live in a returned string, so they are checked against the raw file.
    assert.match(raw, /notMeasured/);
    assert.match(raw, /Rung accuracy against the rule table/);
    assert.match(raw, /Swap consistency/);
    assert.match(raw, /Reorder counts/);
  });

  it("treats an unobserved rung as unobserved, not as a failing one", () => {
    // A source with no rows simply does not appear. Nothing maps absence to bad.
    assert.match(source, /\[...sources\.entries\(\)\]/);
    assert.ok(!/zero.*(fail|bad|broken)/i.test(raw), "absence must not be scored");
  });

  it("never reorders, promotes, or retires a rung", () => {
    for (const forbidden of [/\.sort\([^)]*source[^)]*(asc|<)/i, /retire|promote|reward/i]) {
      assert.ok(!forbidden.test(source), `the reading must not contain ${forbidden}`);
    }
  });

  it("bounds the window instead of reading the whole table", () => {
    assert.match(source, /Math\.min\(Math\.max\(args\.days \?\? 7, 1\), 90\)/);
  });

  it("counts a table answer as a fallback, not as a rung that won", () => {
    assert.match(source, /fallbackToTable/);
    assert.match(source, /row\.orderSource === "table"/);
  });

  it("is an internal query: the reading is not a public endpoint", () => {
    assert.match(source, /internalQuery\(/);
    assert.ok(!/export const \w+ = query\(/.test(source), "no public query for this reading");
  });
});
