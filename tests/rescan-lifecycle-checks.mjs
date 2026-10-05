// W3-HARDEN-B. The rescan lifecycle in src/features/scan/GuestScan.tsx.
//
// There is no component test harness in this repo (no jsdom, no react test
// renderer), so the real onRescan body is executed against a small state stub
// instead of being read as text. The function is plain JavaScript, so it runs
// as it is, and every setX call writes to the same named field the component
// holds. A source regex would only prove the word "setProviderAnswered" appears;
// this proves the state the visitor ends up looking at.
//
// The hole this locks: onRescan swapped the scan id without clearing the
// provider's answer. A new scan then rendered with no "No AI provider answered
// this scan" line in the not-checked box, because the previous scan had a
// provider answer, and the plain-word explanations on screen belonged to the
// previous scan's findings.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const GUEST = join(REPO, "src", "features", "scan", "GuestScan.tsx");
const guest = readFileSync(GUEST, "utf8");

// Every setter onRescan may call. The stub writes state.<name minus set>, which
// is the field the component keeps in useState, so the assertions read the same
// values the screen is rendered from. A setter missing from this list makes the
// run throw a ReferenceError rather than pass quietly.
const SETTERS = [
  "setSubmitError",
  "setShareError",
  "setShareId",
  "setPassportId",
  "setWasCached",
  "setQueuedScan",
  "setPhase",
  "setScanId",
  "setComparePair",
  "setRescanRan",
  "setRescanNote",
  "setExplainNote",
  "setProviderAnswered",
  "setExplanations",
  "setNotActionable",
  "setQueueNote",
];

const ON_RESCAN = /async function onRescan\(\) \{[\s\S]*?\n  \}/.exec(guest);
if (ON_RESCAN === null) {
  throw new Error("onRescan was not found in src/features/scan/GuestScan.tsx");
}

/** setNotActionable writes state.notActionable, the field the component holds. */
function fieldOf(setter) {
  const name = setter.slice("set".length);
  return name[0].toLowerCase() + name.slice(1);
}

const runOnRescan = new Function(
  "state",
  "deps",
  [
    "const scanId = state.scanId;",
    "let phase = state.phase;",
    ...SETTERS.map(
      (name) => `const ${name} = (value) => { state.${fieldOf(name)} = value; };`,
    ),
    "const rescanScan = deps.rescanScan;",
    "const analyzeScan = deps.analyzeScan;",
    "const compareScans = deps.compareScans;",
    "const toUserError = (_error, fallback) => fallback;",
    ON_RESCAN[0],
    "return onRescan();",
  ].join("\n"),
);

/** The component state right after a visitor pressed Explain on scan-old. */
function afterExplain() {
  return {
    scanId: "scan-old",
    phase: "idle",
    providerAnswered: true,
    explanations: [{ fingerprint: "fp-old", plain: "Plain words for the old scan." }],
    notActionable: [{ fingerprint: "fp-old", reason: "informational" }],
    explainNote: "a model answered. Explained 1 item(s).",
    comparePair: null,
    rescanRan: false,
    rescanNote: "",
    submitError: "",
  };
}

const deps = (over = {}) => ({
  rescanScan: async () => ({ scanId: "scan-new", sameSha: false }),
  analyzeScan: async () => ({ status: "completed" }),
  compareScans: async () => ({}),
  ...over,
});

describe("a rescan that changes the scan id clears the previous scan's provider answer", () => {
  it("resets the structural boolean, the explanations and the not-actionable list", async () => {
    const state = afterExplain();
    await runOnRescan(state, deps());

    assert.equal(state.scanId, "scan-new", "the rescan swapped the scan on screen");
    assert.equal(
      state.providerAnswered,
      false,
      "the new scan has had no provider call, so the not-checked box must print the disclosure again",
    );
    assert.deepEqual(state.explanations, [], "the old scan's explanations must not stay on the new report");
    assert.deepEqual(
      state.notActionable,
      [],
      "the old scan's informational list must not stay on the new report",
    );
    assert.equal(state.explainNote, "", "the old scan's explain note describes findings that are not on screen");
  });

  it("leaves the previous answer alone when the sha is unchanged and the id does not move", async () => {
    const state = afterExplain();
    await runOnRescan(state, deps({ rescanScan: async () => ({ scanId: "scan-new", sameSha: true }) }));

    assert.equal(state.scanId, "scan-old", "no new commits means the same report is still on screen");
    assert.equal(
      state.providerAnswered,
      true,
      "the report on screen is the one the provider answered, so the disclosure stays suppressed",
    );
    assert.equal(state.explanations.length, 1, "its explanations still describe the report on screen");
    assert.match(state.rescanNote, /No new commits/);
  });

  it("keeps the previous answer when the rescan throws, because the scan did not change", async () => {
    const state = afterExplain();
    await runOnRescan(
      state,
      deps({
        rescanScan: async () => {
          throw new Error("nope");
        },
      }),
    );

    assert.equal(state.scanId, "scan-old");
    assert.equal(state.providerAnswered, true, "the failed press changed no scan, so nothing was cleared");
    assert.equal(state.explanations.length, 1);
    assert.equal(state.submitError, "Could not rescan. Try again.");
  });
});

describe("every path that swaps the scan on screen clears the provider answer", () => {
  for (const [name, setter] of [
    ["a rescan that found new commits", /async function onRescan\(\)[\s\S]*?\n  \}/],
    ["a fresh submit", /async function onSubmit\([\s\S]*?\n  \}/],
    ["an explain press", /async function onExplain\(\)[\s\S]*?\n  \}/],
  ]) {
    it(`${name} resets providerAnswered, the explanations and the not-actionable list`, () => {
      const block = setter.exec(guest)?.[0] ?? "";
      assert.ok(block.length > 0, `${name}: the function body must be found`);
      for (const call of [
        "setProviderAnswered(false)",
        "setExplanations([])",
        "setNotActionable([])",
      ]) {
        assert.ok(
          block.includes(call),
          `${name}: ${call} is missing, so the state from the previous scan survives on the new one`,
        );
      }
    });
  }
});
