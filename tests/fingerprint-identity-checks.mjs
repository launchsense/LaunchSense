import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { baseFingerprint, fingerprintFinding } from "../shared/redaction.ts";
import { compareFindings } from "../shared/reports/compare.ts";

// Two identical findings in one file, and what a rescan says about them.
//
// The occurrence number in a fingerprint is a running count, so it depends on
// position: delete the first of two identical findings and the second is
// renumbered. Comparing by the full fingerprint then reported the deleted one as
// still present and the survivor as gone, and a stored acceptance stopped
// matching a finding that never moved. The comparison now pairs the group by the
// shared base and lets the counts decide, so two before and one after is one
// fixed and one still broken, whatever the order.
//
// No network, no database, and no clock. Pure functions imported directly.

const RULE = "secret.credential-pattern";
const VERSION = "stage3.1";
const PATH = "src/a.ts";
const SNIPPET = "sha";
const OTHER = "bbb";

function finding(fp, line) {
  return {
    ruleId: RULE,
    fingerprint: fp,
    path: PATH,
    line,
    severity: "high",
    title: "t",
    why: "w",
  };
}

function opts(over = {}) {
  return {
    oldAnalyzer: VERSION,
    newAnalyzer: VERSION,
    oldFetched: new Set([PATH]),
    newFetched: new Set([PATH]),
    oldContents: new Map(),
    newContents: new Map(),
    previouslyFixed: new Set(),
    depOf: () => null,
    ...over,
  };
}

describe("baseFingerprint strips only a real occurrence", () => {
  it("returns a plain fingerprint unchanged", () => {
    const fp = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 0);
    assert.equal(baseFingerprint(fp), fp);
  });

  it("strips the occurrence from a repeated finding", () => {
    const base = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 0);
    const dup = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 1);
    assert.notEqual(dup, base);
    assert.equal(baseFingerprint(dup), base);
  });

  it("does not mistake an all-digit hash for an occurrence", () => {
    // A base fingerprint ends at the hash. If the hash happens to be all digits
    // it must still survive untouched.
    const fake = `${RULE}:${VERSION}:${PATH}:12345678`;
    assert.equal(baseFingerprint(fake), fake);
  });
});

describe("a duplicate removed does not become a false fixed and a false new", () => {
  it("reports one fixed and one still broken when two identical findings become one", () => {
    const base = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 0);
    const dup = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 1);
    const oldList = [finding(base, 10), finding(dup, 20)];
    // The first line is removed, so the survivor is renumbered to occurrence 0.
    const newList = [finding(base, 20)];
    const transitions = compareFindings(oldList, newList, opts());
    const states = transitions.map((t) => t.state).sort();
    assert.deepEqual(
      states,
      ["fixed", "still_broken"],
      `two identical findings that become one must not read as two changes: ${JSON.stringify(transitions)}`,
    );
    assert.equal(
      transitions.filter((t) => t.state === "new").length,
      0,
      "a renumbered survivor is not a new finding",
    );
  });

  it("keeps both still broken when nothing was removed", () => {
    const base = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 0);
    const dup = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 1);
    const transitions = compareFindings(
      [finding(base, 10), finding(dup, 20)],
      [finding(base, 10), finding(dup, 20)],
      opts(),
    );
    assert.deepEqual(transitions.map((t) => t.state), ["still_broken", "still_broken"]);
  });

  it("treats a second distinct finding as fixed and keeps the first", () => {
    const base = fingerprintFinding(RULE, VERSION, PATH, SNIPPET, 0);
    const other = fingerprintFinding(RULE, VERSION, PATH, OTHER, 0);
    const transitions = compareFindings(
      [finding(base, 10), finding(other, 30)],
      [finding(base, 10)],
      opts(),
    );
    const states = transitions.map((t) => t.state).sort();
    assert.deepEqual(states, ["fixed", "still_broken"]);
  });
});
