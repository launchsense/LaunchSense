import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAiPlan } from "../shared/ai/validate.ts";
import { deterministicPlan, buildExplainPrompt } from "../shared/ai/deterministic.ts";
import { extractJson, extractOllamaText, extractOllamaUsage } from "../convex/adapters/ai.ts";
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

describe("ollama cloud response parsing", () => {
  it("reads the assistant message content", () => {
    const text = extractOllamaText({
      choices: [{ message: { content: '{"explanations":[],"notActionable":[]}' } }],
    });
    assert.equal(text, '{"explanations":[],"notActionable":[]}');
  });

  it("returns null on shapes it cannot trust", () => {
    assert.equal(extractOllamaText(null), null);
    assert.equal(extractOllamaText({ choices: [] }), null);
    assert.equal(extractOllamaText({ choices: [{ message: {} }] }), null);
    assert.equal(extractOllamaText({ choices: [{ message: { content: "" } }] }), null);
  });

  it("reads token usage when present and stays null when absent", () => {
    assert.deepEqual(extractOllamaUsage({ usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }), {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    });
    assert.deepEqual(extractOllamaUsage({}), {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    assert.deepEqual(extractOllamaUsage("nope"), {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });
});

describe("buildNoAgentExport", () => {
  it("includes steps, confirm list, and the not-checked list", () => {
    const text = buildNoAgentExport(
      "withkeshav/LaunchSense",
      "abc123",
      FINDINGS.map((f) => ({ ...f, path: "a.ts", line: 1, severity: f.severity })),
      { steps: [], notActionable: [] },
      ["binary files"],
    );
    assert.match(text, /withkeshav\/LaunchSense/);
    assert.match(text, /abc123/);
    assert.match(text, /binary files/);
  });
});

describe("buildStandards", () => {
  const banned = /certified|compliant|guaranteed|full audit/i;

  it("reports signal-found only where evidence exists and never claims certification", () => {
    const maps = buildStandards({
      findings: [
        { ruleId: "secret.tracked-env", severity: "high" },
        { ruleId: "secret.client-exposure", severity: "high" },
      ],
      analyzedFiles: 20,
      liveChecked: false,
      coverageNote: "OSV checked 4 packages, 0 unknown",
    });
    const data = maps.find((m) => m.requirementId === "V8.1.1");
    assert.equal(data?.status, "signal-found");
    assert.equal(data?.evidenceCount, 2);
    const ui = maps.find((m) => m.requirementId === "V4.1.1");
    assert.equal(ui?.status, "not-checked");
    for (const m of maps.filter((row) => row.version.startsWith("OWASP ASVS"))) {
      assert.equal(m.version, "OWASP ASVS 5.0.0");
    }
    for (const m of maps) {
      assert.ok(m.version.length > 0);
      assert.ok(m.requirementId.length > 0);
      assert.ok(m.coverage.length > 0);
      assert.ok(m.status.length > 0);
      assert.ok(m.caveat.length > 0);
      assert.match(m.source, /^https:\/\//);
      assert.equal(banned.test(`${m.title} ${m.caveat}`), false);
    }
  });

  it("keeps unqueried families not-checked even when other findings exist", () => {
    const maps = buildStandards({
      findings: [
        { ruleId: "secret.tracked-env", severity: "high" },
        { ruleId: "deps.install-script", severity: "high" },
      ],
      analyzedFiles: 20,
      liveChecked: false,
      coverageNote: "OSV checked 4 packages, 2 unknown",
    });
    for (const id of ["deps.dev", "Scorecard", "A01:2025", "A06:2025", "A07:2025", "A09:2025", "A10:2025"]) {
      assert.equal(maps.find((m) => m.requirementId === id)?.status, "not-checked", id);
    }
    assert.equal(maps.find((m) => m.requirementId === "query")?.status, "not-checked");
    assert.equal(maps.find((m) => m.requirementId === "A03:2025")?.status, "signal-found");
  });

  it("marks OSV signal-found only when a vulnerability finding exists", () => {
    const quiet = buildStandards({
      findings: [],
      analyzedFiles: 10,
      liveChecked: false,
      coverageNote: "OSV checked 3 packages, 0 unknown",
    });
    assert.equal(quiet.find((m) => m.requirementId === "query")?.status, "no-signal");
    const hit = buildStandards({
      findings: [{ ruleId: "deps.vulnerability", severity: "high" }],
      analyzedFiles: 10,
      liveChecked: false,
      coverageNote: "OSV checked 3 packages, 1 unknown",
    });
    assert.equal(hit.find((m) => m.requirementId === "query")?.status, "signal-found");
    const unknown = buildStandards({
      findings: [],
      analyzedFiles: 10,
      liveChecked: false,
      coverageNote: "OSV checked 3 packages, 1 unknown",
    });
    assert.equal(unknown.find((m) => m.requirementId === "query")?.status, "not-checked");
    assert.equal(unknown.find((m) => m.requirementId === "A03:2025")?.status, "not-checked");
  });
});

describe("buildReadiness", () => {
  it("reports real read coverage, not a restatement of severity", () => {
    const full = buildRepoDna(
      ["a.ts", "b.ts"],
      ["a.ts", "b.ts"],
      { hasReadme: true, hasTests: true, hasCI: true, hasLicense: true, entryPoints: ["a.ts"], agentFiles: [], envUsages: [] },
    );
    const read = buildReadiness({
      dna: full,
      findings: [{ severity: "info", ruleId: "hygiene.no-ci", bucket: "info" }],
      liveReaches: true,
      partial: false,
    });
    assert.equal(read.readCoverage, 1);
    assert.equal(read.filesRead, 2);
    assert.equal(read.filesInTree, 2);
    // Every finding info means nothing is actionable, and that is a mix measure.
    assert.equal(read.actionableShare, 0);

    const partialDna = buildRepoDna(
      ["a.ts", "b.ts", "c.ts", "d.ts"],
      ["a.ts"],
      { hasReadme: true, hasTests: true, hasCI: true, hasLicense: true, entryPoints: ["a.ts"], agentFiles: [], envUsages: [] },
    );
    const partialRead = buildReadiness({
      dna: partialDna,
      findings: [{ severity: "info", ruleId: "hygiene.no-ci", bucket: "info" }],
      liveReaches: true,
      partial: true,
    });
    assert.equal(partialRead.readCoverage, 0.25);
    assert.ok(partialRead.reasons.some((r) => r.includes("was read")));
  });

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
      highOpen: 2,
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
      highOpen: 0,
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