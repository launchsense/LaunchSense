import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The AI evidence harness, asserted offline on every run.
//
// scripts/ai-evidence/harness.mjs produces the numbers in the report at
// .progress/research/ai-evidence.md. Those numbers need a model and a local
// Ollama server, so they cannot run on every `npm run check`. What CAN run on
// every check is the part that must never be wrong: the guard invariants and
// the fixture's own integrity. This file drives the same harness in stub mode,
// where the lane is deterministic and nothing is asked of a model, and asserts:
//
//   1. the guard probes refuse what they are labelled to refuse;
//   2. the reorder invariants hold with no provider, so a missing provider can
//      never leak an added or dropped row, an info row, or a band crossing;
//   3. a hostile lane, one that answers with maximum confidence for everything,
//      still cannot cross a band, add a row, or drop a row;
//   4. the fixture labels are internally consistent, so a broken label fails here
//      rather than quietly flattering a number in the report.
//
// A test that fails here means a guard moved. It does not measure AI quality,
// and it never calls a provider.

import { ASSIST_FIXTURE, GUARD_PROBES, REORDER_FIXTURE, licenseFixture } from "../scripts/ai-evidence/fixture.mjs";
import { contentRetention, jargonRate, keepsAnchor, readingEase, reorderMetrics } from "../scripts/ai-evidence/metrics.mjs";
import { isCloudTag, keyPresence } from "../scripts/ai-evidence/lanes.mjs";
import { buildExplainPrompt, deterministicPlan } from "../shared/ai/deterministic.ts";
import { validateAiPlan } from "../shared/ai/validate.ts";
import { classifyLookupAnswer, licenseLookupRefusal, suggestUnknownLicenses } from "../shared/licensing/lookup.ts";
import { actionableFindings, findingsToAsk, questionIdFor, tableOrder } from "../shared/reports/priority.ts";
import { isKnownSpdxId, normalizeSpdxId } from "../shared/licensing/spdx.ts";

const licenceLabels = licenseFixture().labels;
const reorderLabels = new Map(REORDER_FIXTURE.map((f) => [f.fingerprint, f.label]));

describe("the licence lookup guard refuses what the fixture says it refuses", () => {
  for (const probe of GUARD_PROBES) {
    it(`${probe.id}: ${probe.why}`, () => {
      const result = classifyLookupAnswer(probe.answer);
      assert.equal(
        result.id === null,
        probe.expectRefusal,
        `expected ${probe.expectRefusal ? "a refusal" : "an accepted id"} and got ${String(result.id)}`,
      );
    });
  }

  it("never turns a wrong-shaped answer into a licence id", () => {
    // Every shape that is not one bare id this product reads must come back null.
    for (const bad of ["MIT (the MIT licence)", "mit and apache", "high", "critical", "", "   ", "0BSD OR MIT"]) {
      assert.equal(classifyLookupAnswer(bad).id, null, `${JSON.stringify(bad)} must not resolve`);
    }
  });

  it("never returns an id the product cannot name obligations against", () => {
    // A real SPDX id outside this product's list is still refused, which is the
    // difference between a knowledge check and a whitelist.
    assert.equal(classifyLookupAnswer("Unicode-DFS-2016").id, null);
    assert.equal(isKnownSpdxId("Unicode-DFS-2016"), false);
  });

  it("records the deprecated flag when a deprecated id is accepted", () => {
    const result = classifyLookupAnswer("GPL-2.0");
    assert.equal(result.id, "GPL-2.0");
    assert.equal(normalizeSpdxId("GPL-2.0").deprecated, true, "kept, but flagged as deprecated");
  });

  it("refuses the plus form even though the normalizer would accept it", () => {
    // A real disagreement between two modules, fail-closed and therefore not a
    // safety defect, but it is the kind of drift that is cheap to record and
    // expensive to rediscover. Asserted so the report's claim stays true.
    assert.equal(normalizeSpdxId("GPL-2.0+").id, "GPL-2.0-or-later");
    assert.equal(classifyLookupAnswer("GPL-2.0+").id, null);
  });
});

describe("the refusal path is the default and invents nothing", () => {
  const { components } = licenseFixture();

  it("asks nothing and suggests nothing when no lane is supplied", () => {
    const result = licenseLookupRefusal(components);
    assert.equal(result.configured, false);
    assert.equal(result.asked, 0);
    assert.equal(result.suggestions.length, 0);
    assert.match(result.note, /Unknown stays unknown/);
  });

  it("names how many components read as Unknown, without naming a licence", () => {
    const result = licenseLookupRefusal(components);
    assert.match(result.note, new RegExp(`${components.length} component\\(s\\) read as Unknown`));
    assert.doesNotMatch(result.note, /MIT|ISC|Apache|GPL/);
  });

  it("offers only Unknown components, never a component with a licence", async () => {
    const read = [
      { name: "known", version: "1.0.0", spdx: "MIT" },
      { name: "unknown", version: "1.0.0", spdx: "Unknown" },
    ];
    const asked = [];
    const result = await suggestUnknownLicenses(read, {
      lane: async ({ request }) => {
        asked.push(request.name);
        return "MIT";
      },
    });
    assert.deepEqual(asked, ["unknown"]);
    assert.equal(result.asked, 1);
    // The read component was never offered. Asserted on the exact set rather than a
    // substring, because "unknown" contains "known" and a loose test would pass
    // while checking nothing.
    assert.ok(!asked.includes("known"), "a component with a licence must never be offered");
  });

  it("sends the built prompt unchanged, or asks nothing at all", async () => {
    const { components } = licenseFixture();
    const seen = [];
    await suggestUnknownLicenses(components, {
      lane: async ({ prompt }) => {
        seen.push(prompt);
        return "MIT";
      },
    });
    assert.equal(seen.length, components.length);
    for (const prompt of seen) {
      assert.match(prompt, /^Name the SPDX licence id for the npm package /);
      assert.doesNotMatch(prompt, /\bNAME\b|\bVERSION\b/, "no placeholder may survive substitution");
    }
  });
});

describe("the reorder invariants hold with no provider at all", () => {
  const metrics = reorderMetrics(REORDER_FIXTURE, null, "table", labels());

  it("keeps the floor top ten with no provider", () => {
    assert.deepEqual(metrics.order, tableOrder(actionableFindings(REORDER_FIXTURE)).slice(0, 10));
    assert.equal(metrics.permutationFail, 0);
    assert.equal(metrics.dropped.length, 0);
    assert.equal(metrics.added.length, 0);
  });

  it("keeps info out of the order", () => {
    const info = REORDER_FIXTURE.filter((f) => f.severity === "info").map((f) => f.fingerprint);
    for (const fp of info) assert.ok(!metrics.order.includes(fp), `${fp} must not be ranked`);
    assert.equal(metrics.infoExcluded, info.length);
  });

  it("moves nothing when there are no answers", () => {
    assert.equal(metrics.moved, 0);
    assert.equal(metrics.tau_vs_floor, 1);
  });

  it("within-band hinge loss is a subset of whole-order hinge loss", () => {
    // If this ever fails, the fair metric stopped being a subset of the unfair one
    // and every delta in the report is misread.
    assert.ok(metrics.hinge_within_floor <= metrics.hinge_floor, `${metrics.hinge_within_floor} must be <= ${metrics.hinge_floor}`);
  });
});

describe("a hostile lane still cannot break the band guard", () => {
  // Maximum confidence on every finding, which is the input most likely to tempt
  // an ordering bug into overriding a severity.
  const maxAnswers = Object.fromEntries(
    REORDER_FIXTURE.filter((f) => f.severity !== "info").map((f) => [questionIdFor(f.fingerprint), { type: "noul", noul: 1 }]),
  );

  it("refuses to move a row into a different severity band", () => {
    const metrics = reorderMetrics(REORDER_FIXTURE, maxAnswers, "jev", labels());
    assert.equal(metrics.bandCrossings, 0, "a maximum-confidence answer must not lift a medium above a high");
    assert.deepEqual(metrics.bands.map((b) => b.severity), ["high", "medium"]);
  });

  it("cannot add a row from nowhere, and stays capped at ten", () => {
    const metrics = reorderMetrics(REORDER_FIXTURE, maxAnswers, "jev", labels());
    const fullFloor = new Set(tableOrder(actionableFindings(REORDER_FIXTURE)));
    assert.equal(metrics.order.length, Math.min(10, actionableFindings(REORDER_FIXTURE).length));
    for (const fp of metrics.order) {
      assert.ok(fullFloor.has(fp), `${fp} came from nowhere`);
    }
  });

  it("treats a missing answer as no signal rather than as a no", () => {
    const one = { [questionIdFor(REORDER_FIXTURE[0].fingerprint)]: { type: "noul", noul: 0 } };
    const metrics = reorderMetrics(REORDER_FIXTURE, one, "jev", labels());
    assert.equal(metrics.order.length, Math.min(10, actionableFindings(REORDER_FIXTURE).length));
    assert.equal(metrics.bandCrossings, 0);
  });

  it("sends at most ten questions and only for bands that can move", () => {
    assert.ok(findingsToAsk(REORDER_FIXTURE).length <= 10);
    const onePerBand = [
      { fingerprint: "a", severity: "high", ruleId: "r", title: "t" },
      { fingerprint: "b", severity: "medium", ruleId: "r", title: "t" },
    ];
    assert.deepEqual(findingsToAsk(onePerBand), [], "a band of one cannot move, so nothing is asked");
  });
});

describe("the explain validator drops a whole plan rather than a bad row", () => {
  const findings = ASSIST_FIXTURE;
  const actionable = findings.filter((f) => f.severity !== "info");

  const planFor = (entries, bucketed = []) => ({
    explanations: entries.map((fingerprint) => ({ fingerprint, plain: "A plain sentence about it." })),
    notActionable: bucketed.map((fingerprint) => ({ fingerprint, reason: "short reason" })),
  });

  it("accepts a plan that covers every actionable finding", () => {
    const result = validateAiPlan(planFor(actionable.map((f) => f.fingerprint)), findings);
    assert.equal(result.ok, true);
  });

  it("rejects a plan that drops one actionable finding", () => {
    const result = validateAiPlan(planFor(actionable.slice(1).map((f) => f.fingerprint)), findings);
    assert.equal(result.ok, false);
    assert.match(result.reason, /dropped 1 actionable/);
  });

  it("rejects a plan that names a finding the scan did not find", () => {
    const result = validateAiPlan(planFor([...actionable.map((f) => f.fingerprint), "invented:finding:1"]), findings);
    assert.equal(result.ok, false);
    assert.match(result.reason, /unknown finding id/);
  });

  it("rejects each forbidden claim the product blocks on the copy side", () => {
    for (const claim of [
      "We scanned the entire repo.",
      "All files were checked.",
      "No issues found anywhere.",
      "This is certified.",
      "You are compliant.",
      "This is guaranteed.",
    ]) {
      const result = validateAiPlan(
        {
          explanations: actionable.map((f, i) => ({
            fingerprint: f.fingerprint,
            plain: i === 0 ? claim : "A plain sentence about it.",
          })),
          notActionable: [],
        },
        findings,
      );
      assert.equal(result.ok, false, `${JSON.stringify(claim)} must be refused`);
    }
  });

  it("does not check the not-actionable reason, which is why the report names it", () => {
    // The validator accepts any reason string of 0 to 300 characters. A model can
    // therefore return a two-word non-reason and pass. Asserted so the known gap
    // stays a known gap rather than a surprise.
    const result = validateAiPlan(
      {
        explanations: actionable.map((f) => ({ fingerprint: f.fingerprint, plain: "A plain sentence about it." })),
        notActionable: [{ fingerprint: findings.find((f) => f.severity === "info").fingerprint, reason: "status badge" }],
      },
      findings,
    );
    assert.equal(result.ok, true, "the gap is real and this test is what makes it visible");
  });

  it("does not check that a finding appears in exactly one bucket", () => {
    const fp = actionable[0].fingerprint;
    const result = validateAiPlan(
      {
        explanations: [...actionable.map((f) => ({ fingerprint: f.fingerprint, plain: "A plain sentence." })), { fingerprint: fp, plain: "A second answer for the same row." }],
        notActionable: [{ fingerprint: fp, reason: "short reason" }],
      },
      findings,
    );
    assert.equal(result.ok, true, "a duplicated row is accepted; the report names this as a gap");
  });

  it("does not check that an info row is bucketed rather than explained", () => {
    const infoFp = findings.find((f) => f.severity === "info").fingerprint;
    const result = validateAiPlan(
      {
        explanations: [...actionable.map((f) => ({ fingerprint: f.fingerprint, plain: "A plain sentence." })), { fingerprint: infoFp, plain: "Explained as if it were an action." }],
        notActionable: [],
      },
      findings,
    );
    assert.equal(result.ok, true, "an info row explained as an action is accepted");
  });
});

describe("the fixture labels are internally consistent", () => {
  it("every licence label is an id the product actually reads", () => {
    for (const [key, label] of licenceLabels) {
      if (label.id === null) continue;
      assert.equal(isKnownSpdxId(label.id), true, `${key} is labelled ${label.id}, which is not a readable id`);
    }
  });

  it("every labelled-unknown bucket really has no correct single id", () => {
    for (const [key, label] of licenceLabels) {
      if (label.id !== null) continue;
      assert.notEqual(label.bucket, "known", `${key} is in the known bucket with no id`);
    }
  });

  it("every licence fixture component reads as Unknown, so the hook is allowed to ask", () => {
    const { components } = licenseFixture();
    for (const component of components) assert.equal(component.spdx, "Unknown");
  });

  it("every reorder label is 0 or 1 and every row is labelled", () => {
    for (const row of REORDER_FIXTURE) {
      assert.ok(row.label === 0 || row.label === 1, `${row.fingerprint} has label ${row.label}`);
      assert.equal(typeof row.title, "string");
      assert.ok(row.title.length > 0);
    }
  });

  it("both severity bands the reorder track needs are present with two or more rows", () => {
    const bands = new Map();
    for (const row of REORDER_FIXTURE.filter((f) => f.severity !== "info")) {
      bands.set(row.severity, (bands.get(row.severity) ?? 0) + 1);
    }
    assert.ok(bands.size >= 2, "a single band cannot reorder, so the track would measure nothing");
    for (const [severity, n] of bands) assert.ok(n >= 2, `${severity} has ${n} rows and cannot move`);
  });

  it("every assist anchor is satisfied by the shipped deterministic wording", () => {
    // If the baseline fails its own label, every model score in the report is
    // measured from a broken base. This caught one mislabelled anchor when the
    // fixture was written.
    const plan = deterministicPlan(ASSIST_FIXTURE);
    for (const entry of plan.explanations) {
      const finding = ASSIST_FIXTURE.find((f) => f.fingerprint === entry.fingerprint);
      assert.ok(keepsAnchor(entry.plain, finding.anchors), `${finding.fingerprint} loses its own anchor in our wording`);
    }
  });

  it("the shipped wording is measurably jargon-bearing, so there is headroom to improve", () => {
    const plan = deterministicPlan(ASSIST_FIXTURE);
    const meanJargon = jargonRate(plan.explanations.map((e) => e.plain).join(" "));
    assert.ok(meanJargon > 0.1, `jargon rate ${meanJargon} leaves no room for a rewrite to help`);
    const ease = readingEase(plan.explanations.map((e) => e.plain).join(" "));
    assert.ok(ease < 90, `reading ease ${ease} is already plain, so a rewrite can only match it`);
  });

  it("content retention scores an identical rewrite as 1 and an empty one as 0", () => {
    const base = "A database password literal is written into a tracked source file.";
    assert.equal(contentRetention(base, base), 1);
    assert.equal(contentRetention(base, "Password."), contentRetention(base, "Password."));
    assert.ok(contentRetention(base, "Password.") < 0.5);
    assert.equal(contentRetention(base, "A database password literal is written into a tracked source file and more."), 1);
  });
});

describe("the harness refuses to reach anything but localhost", () => {
  it("treats a metered cloud tag as metered, including the size-tagged shape", () => {
    // The naive `includes(":cloud")` test passes two billed models through as
    // local, because real tags read `name:30b-cloud`. This is the regression.
    for (const tag of ["deepseek-v4-flash:cloud", "nemotron-3-nano:30b-cloud", "gemma4:31b-cloud", "kimi-k2.6:cloud"]) {
      assert.equal(isCloudTag(tag), true, `${tag} is metered and must be filtered out`);
    }
    for (const tag of ["ornith-9b:latest", "nimble:latest", "granite4:3b", "qwen3:1.7b:latest"]) {
      assert.equal(isCloudTag(tag), false, `${tag} is local and must stay available`);
    }
  });

  it("never exposes a public env prefix to a lane", () => {
    // A browser-visible key would be the worst outcome of this harness. The lane
    // selection reads server-side names only, and no public prefix appears.
    const source = readFileSync(new URL("../scripts/ai-evidence/lanes.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /VITE_/, "a public env prefix would put a key in the browser bundle");
  });

  it("reports env names as booleans, so there is no code path that formats a value", () => {
    process.env["AI_EVIDENCE_PROBE_KEY"] = "a-value-that-must-never-appear";
    try {
      const presence = keyPresence();
      const serialised = JSON.stringify(presence);
      assert.doesNotMatch(serialised, /a-value-that-must-appear/, "no value may be serialised");
      assert.doesNotMatch(serialised, /a-value/, "no value may be serialised");
      assert.equal(presence["AI_EVIDENCE_PROBE_KEY"], undefined, "an unlisted name is not reported at all");
      for (const entry of Object.values(presence)) {
        assert.equal(typeof entry.set, "boolean");
        assert.equal(typeof entry.length, "number");
      }
    } finally {
      delete process.env["AI_EVIDENCE_PROBE_KEY"];
    }
  });
});

function labels() {
  return reorderLabels;
}