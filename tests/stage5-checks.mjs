import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAiPlan } from "../shared/ai/validate.ts";
import { deterministicPlan, buildExplainPrompt } from "../shared/ai/deterministic.ts";
import { extractJson } from "../convex/adapters/ai.ts";
import { buildNoAgentExport } from "../shared/reports/noAgentExport.ts";
import { buildStandards } from "../shared/reports/standards.ts";
import { buildReadiness, buildRepoDna } from "../shared/reports/repoDna.ts";
import { buildMissions } from "../shared/reports/missions.ts";

const FINDINGS = [
  { fingerprint: "fp-high", severity: "high", title: "Env tracked", why: "Anyone can read it." },
  { fingerprint: "fp-med", severity: "medium", title: "Debug left", why: "Leaks internals." },
  { fingerprint: "fp-info", severity: "info", title: "No readme", why: "Nobody can run it." },
];

describe("validateAiPlan", () => {
  it("accepts a plan that covers everything", () => {
    const result = validateAiPlan(
      {
        explanations: [
          { fingerprint: "fp-high", plain: "A .env file is committed. Rotate the values." },
          { fingerprint: "fp-med", plain: "A debugger statement is left in." },
        ],
        notActionable: [{ fingerprint: "fp-info", reason: "Advisory." }],
      },
      FINDINGS,
    );
    assert.equal(result.ok, true);
  });

  it("rejects a plan that drops an actionable finding", () => {
    const result = validateAiPlan(
      { explanations: [{ fingerprint: "fp-high", plain: "ok" }], notActionable: [] },
      FINDINGS,
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /dropped/);
  });

  it("rejects invented finding ids", () => {
    const result = validateAiPlan(
      { explanations: [{ fingerprint: "made-up", plain: "x" }], notActionable: [] },
      FINDINGS,
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /unknown finding/);
  });

  it("rejects claims we cannot support", () => {
    for (const plain of [
      "I scanned the whole repo and it is clean.",
      "This code is compliant with all standards.",
      "Guaranteed safe to publish.",
    ]) {
      const result = validateAiPlan(
        {
          explanations: [
            { fingerprint: "fp-high", plain },
            { fingerprint: "fp-med", plain: "debug" },
          ],
          notActionable: [{ fingerprint: "fp-info", reason: "advisory" }],
        },
        FINDINGS,
      );
      assert.equal(result.ok, false, plain);
    }
  });

  it("rejects malformed shapes", () => {
    assert.equal(validateAiPlan(null, FINDINGS).ok, false);
    assert.equal(validateAiPlan({ explanations: [] }, FINDINGS).ok, false);
    assert.equal(validateAiPlan("text", FINDINGS).ok, false);
  });
});

describe("deterministicPlan", () => {
  it("always covers every actionable finding", () => {
    const plan = deterministicPlan(FINDINGS);
    const covered = new Set([
      ...plan.explanations.map((e) => e.fingerprint),
      ...plan.notActionable.map((e) => e.fingerprint),
    ]);
    for (const f of FINDINGS) assert.ok(covered.has(f.fingerprint), f.fingerprint);
    const check = validateAiPlan(plan, FINDINGS);
    assert.equal(check.ok, true);
  });
});

describe("extractJson", () => {
  it("pulls JSON out of chatty model output", () => {
    const json = extractJson('Sure! Here you go:\n{"explanations":[],"notActionable":[]}\nHope that helps.');
    assert.deepEqual(json, { explanations: [], notActionable: [] });
  });

  it("returns null when there is no JSON", () => {
    assert.equal(extractJson("no json here"), null);
    assert.equal(extractJson('{"broken": '), null);
  });
});

describe("buildNoAgentExport", () => {
  it("includes steps, confirm list, and the not-checked list", () => {
    const text = buildNoAgentExport(
      "withkeshav/launchsense",
      "abc123",
      FINDINGS.map((f) => ({ ...f, path: "a.ts", line: 1, severity: f.severity })),
      { steps: [], notActionable: [] },
      ["binary files"],
    );
    assert.match(text, /withkeshav\/launchsense/);
    assert.match(text, /abc123/);
    assert.match(text, /binary files/);
  });
});

describe("buildStandards", () => {
  it("reports signal-found only where evidence exists and never claims certification", () => {
    const maps = buildStandards({
      findings: [
        { ruleId: "secret.tracked-env", severity: "high" },
        { ruleId: "secret.client-exposure", severity: "high" },
      ],
      analyzedFiles: 20,
      liveChecked: false,
    });
    const data = maps.find((m) => m.requirementId === "V8.1.1");
    assert.equal(data?.status, "signal-found");
    assert.equal(data?.evidenceCount, 2);
    const ui = maps.find((m) => m.requirementId === "V4.1.1");
    assert.equal(ui?.status, "not-checked");
    for (const m of maps) assert.equal(m.version, "OWASP ASVS 5.0.0");
  });
});

describe("buildReadiness", () => {
  it("is not-yet with a high finding and unknown on a partial clean scan", () => {
    const dna = buildRepoDna(
      ["a.ts", "b.ts"],
      ["a.ts", "b.ts"],
      { hasReadme: true, hasTests: true, hasCI: true, hasLicense: true, entryPoints: ["a.ts"], agentFiles: [], envUsages: [] },
    );
    const high = buildReadiness({
      dna,
      findings: [{ severity: "high", ruleId: "secret.tracked-env", bucket: "actionable" }],
      liveReaches: true,
      partial: false,
    });
    assert.equal(high.band, "not-yet");
    const unknown = buildReadiness({
      dna,
      findings: [],
      liveReaches: true,
      partial: true,
    });
    assert.equal(unknown.band, "unknown");
  });
});

describe("buildMissions", () => {
  it("locks later missions behind earlier ones and unlocks in order", () => {
    const facts = {
      scanRan: true,
      analyzed: true,
      highSecrets: 1,
      highOrMediumOpen: 2,
      hasReadme: false,
      hasTests: false,
      rescanRan: false,
      passportIssued: false,
      shareCreated: false,
      shareViewed: false,
      liveOk: true,
    };
    const first = buildMissions(facts);
    assert.equal(first.missions[0]?.done, true);
    assert.equal(first.missions[1]?.done, false);
    assert.equal(first.missions[4]?.blocked, "Finish the previous mission first.");
    assert.equal(first.currentMissionId, "secure-project");
    const all = buildMissions({
      ...facts,
      highSecrets: 0,
      highOrMediumOpen: 0,
      hasReadme: true,
      hasTests: true,
      rescanRan: true,
      passportIssued: true,
      shareCreated: true,
      shareViewed: true,
    });
    assert.equal(all.progress.done, all.progress.total);
    assert.ok(all.achievements.every((a) => a.earned));
  });
});

describe("buildExplainPrompt", () => {
  it("lists findings with their ids and forbids invented claims", () => {
    const prompt = buildExplainPrompt(FINDINGS);
    assert.match(prompt, /fingerprint=fp-high/);
    assert.match(prompt, /never claim a check ran/i);
    assert.ok(prompt.length < 4000);
  });
});