import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  tableOrder,
  actionableFindings,
  questionIdFor,
  rankFromAnswers,
  rankState,
  laneCanReorder,
  findingsToAsk,
} from "../shared/reports/priority.ts";
import { looksLikeSecret, validateQuestions, decisionRungs } from "../convex/adapters/decision.ts";
import * as FX from "./fixtures.mjs";

// The decision lane. Two things must hold:
//   1. It can only ORDER findings the checks already found. It never decides what
//      is a finding, and it can never override the severity the checks assigned.
//   2. It is fail-closed on secrets, because it sends finding text to a third party.

const F = (fingerprint, severity, ruleId, title) => ({ fingerprint, severity, ruleId, title });

const SAMPLE = [
  F("a1", "medium", "cfg:https_only_missing", "One route is served over plain HTTP"),
  F("a2", "high", "secret:github_token", "A GitHub token appears in a committed file"),
  F("a3", "low", "sec:headers", "Recommended browser headers are missing"),
  F("a4", "high", "dep:vuln:lodash", "lodash has a known prototype pollution fix"),
  F("a5", "info", "test:fixture_noise", "A secret pattern appears in a test fixture"),
];

describe("the floor table", () => {
  it("puts credentials first, then by severity", () => {
    const order = tableOrder(SAMPLE);
    assert.equal(order[0], "a2", "the credential should be first");
    assert.ok(order.indexOf("a4") < order.indexOf("a1"), "high before medium");
    assert.ok(order.indexOf("a1") < order.indexOf("a3"), "medium before low");
  });

  it("is stable across runs", () => {
    assert.deepEqual(tableOrder(SAMPLE), tableOrder([...SAMPLE].reverse()));
  });

  it("keeps every actionable finding and drops only info", () => {
    const order = tableOrder(actionableFindings(SAMPLE));
    assert.equal(order.length, 4, "info is not an action");
    assert.ok(!order.includes("a5"));
  });
});

describe("the lane can never override severity", () => {
  it("does not let a medium rise above a high even when it scores higher", () => {
    // The lane is very confident about the medium and very unsure about the high.
    // Severity still wins. This is the whole point of the guard.
    const answers = {
      [questionIdFor("a1")]: { type: "noul", noul: 1.0 },
      [questionIdFor("a2")]: { type: "noul", noul: 0.01 },
      [questionIdFor("a4")]: { type: "noul", noul: 0.01 },
      [questionIdFor("a3")]: { type: "noul", noul: 0.0 },
    };
    const result = rankFromAnswers(SAMPLE, answers, "jev");
    const iHigh = Math.min(result.order.indexOf("a2"), result.order.indexOf("a4"));
    const iMedium = result.order.indexOf("a1");
    assert.ok(iHigh < iMedium, "a high finding must stay above a medium one");
  });

  it("does reorder within one severity band", () => {
    const answers = {
      [questionIdFor("a2")]: { type: "noul", noul: 0.2 },
      [questionIdFor("a4")]: { type: "noul", noul: 0.99 },
      [questionIdFor("a1")]: { type: "noul", noul: 0.1 },
      [questionIdFor("a3")]: { type: "noul", noul: 0.1 },
    };
    const result = rankFromAnswers(SAMPLE, answers, "jev");
    // Both are high, so the lane may order them. a4 now beats a2.
    assert.ok(result.order.indexOf("a4") < result.order.indexOf("a2"));
    assert.equal(result.source, "jev");
  });

  it("treats a missing answer as no signal, never as a false", () => {
    const answers = { [questionIdFor("a2")]: { type: "noul", noul: 0.0 } };
    const result = rankFromAnswers(SAMPLE, answers, "jev");
    // a4 has no answer, so it is not demoted below a2 on the strength of nothing.
    assert.equal(result.order.length, 4);
    // And it still covers every actionable finding.
    for (const fp of ["a1", "a2", "a3", "a4"]) {
      assert.ok(result.order.includes(fp), `${fp} must still be in the order`);
    }
  });

  it("falls back to the table when no provider answered", () => {
    const result = rankFromAnswers(SAMPLE, null, "table");
    assert.deepEqual(result.order, tableOrder(actionableFindings(SAMPLE)));
    assert.equal(result.source, "table");
    assert.match(result.note, /severity and credential risk alone/);
    assert.match(result.note, /did not choose which findings exist/);
    assert.doesNotMatch(result.note, /jev|perplexity|chose a check|chose a finding|chooses which/i);
  });

  it("does not ask the model when no band can move", () => {
    const one = [F("only", "high", "secret.tracked-env", "A tracked env file")];
    assert.equal(laneCanReorder(one), false);
    assert.deepEqual(findingsToAsk(one), []);
  });

  it("says which rung answered, and that it did not choose the findings", () => {
    const answers = {
      [questionIdFor("a2")]: { type: "noul", noul: 0.2 },
      [questionIdFor("a4")]: { type: "noul", noul: 0.99 },
    };
    const result = rankFromAnswers(SAMPLE, answers, "jev");
    assert.match(result.note, /inside one severity band/);
    assert.match(result.note, /did not choose which findings exist/);
    assert.match(result.note, /Order source: jev/);
    assert.doesNotMatch(result.note, /chose a check|chose a finding|chooses which/i);
  });

  it("caps the ranked list at ten and says so", () => {
    const many = Array.from({ length: 12 }, (_, i) => F(`h${i}`, "high", `rule${i}`, `t${i}`));
    const answers = Object.fromEntries(many.slice(0, 10).map((f) => [questionIdFor(f.fingerprint), { noul: 0.5 }]));
    const result = rankFromAnswers(many, answers, "jev");
    assert.match(result.note, /past the first 10/);
    assert.equal(result.order.length, 10);
    assert.match(result.note, /capped at 10/);
  });

  it("produces the deterministic top ten with no provider key", () => {
    const many = Array.from({ length: 12 }, (_, i) => F(`h${i}`, "high", `rule${i}`, `t${i}`));
    const result = rankFromAnswers(many, null, "table");
    assert.equal(result.order.length, 10);
    assert.equal(result.source, "table");
    assert.match(result.note, /Order source: table/);
    assert.match(result.note, /capped at 10/);
  });

  it("always covers every actionable finding, in every branch", () => {
    const answers = { [questionIdFor("a1")]: { noul: 0.5 } };
    for (const [a, s] of [[null, "table"], [answers, "jev"], [{}, "perplexity"]]) {
      const result = rankFromAnswers(SAMPLE, a, s);
      for (const f of actionableFindings(SAMPLE)) {
        assert.ok(result.order.includes(f.fingerprint), `${f.fingerprint} missing`);
      }
    }
  });
});

describe("fail-closed on secrets", () => {
  it("refuses a state carrying an AWS key", () => {
    assert.equal(looksLikeSecret({ content: `const k = '${FX.FAKE_AWS}'` }), "aws key");
  });

  it("refuses a github token, a bearer token, and a private key block", () => {
    assert.equal(looksLikeSecret(`ghp_${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"}`), "github token");
    assert.equal(looksLikeSecret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"), "bearer token");
    assert.equal(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----"), "private key block");
  });

  it("allows ordinary finding text", () => {
    assert.equal(looksLikeSecret({ title: "lodash has a known prototype pollution fix" }), null);
    assert.equal(looksLikeSecret([{ severity: "high", ruleId: "dep:vuln:lodash" }]), null);
  });

  it("never returns the secret value itself, only a label", () => {
    const label = looksLikeSecret(FX.FAKE_AWS);
    assert.equal(label, "aws key");
    assert.ok(!String(label).includes(FX.FAKE_AWS.slice(0, 4)));
  });
});

describe("questions are validated before any call", () => {
  it("rejects an empty question set", () => {
    assert.ok(validateQuestions({}).length > 0);
  });

  it("rejects an unknown question type", () => {
    const problems = validateQuestions({ q: { type: "chat", instructions: "hi" } });
    assert.ok(problems.some((p) => p.includes("type must be")));
  });

  it("rejects a choice with fewer than two options", () => {
    const problems = validateQuestions({
      q: { type: "choice", instructions: "pick", criteria: { only: null } },
    });
    assert.ok(problems.some((p) => p.includes("at least 2 options")));
  });

  it("rejects a score with more than ten levels", () => {
    const problems = validateQuestions({
      q: { type: "score", instructions: "rate", criteria: Array.from({ length: 11 }, (_, i) => `L${i}`) },
    });
    assert.ok(problems.some((p) => p.includes("at most 10")));
  });

  it("accepts a well formed question set", () => {
    assert.deepEqual(
      validateQuestions({
        q: { type: "noul", instructions: "is it worth fixing" },
      }),
      [],
    );
  });
});

describe("the rung order matches the operator decision", () => {
  it("is Jev first, then Perplexity, and no local rung", () => {
    const rungs = decisionRungs().map((r) => r.name);
    assert.deepEqual(rungs, ["jev", "perplexity"]);
    assert.ok(!rungs.includes("ollama"), "a hosted product cannot reach a developer localhost");
  });

  it("reads only server-side env vars", () => {
    const source = readFileSync(new URL("../convex/adapters/decision.ts", import.meta.url), "utf8");
    for (const key of ["TYPESAFE_API_KEY", "PERPLEXITY_API_KEY"]) {
      assert.ok(source.includes(key), `must read ${key}`);
    }
    assert.ok(!source.includes("VITE_"), "no key may ever be exposed to the browser");
  });
});

describe("the state sent to the lane is minimal", () => {
  it("carries title, severity, and ruleId only", () => {
    const state = rankState(SAMPLE);
    for (const item of state) {
      assert.deepEqual(Object.keys(item).sort(), ["ruleId", "severity", "title"]);
    }
    assert.ok(!JSON.stringify(state).includes("path"), "never send a file path");
    assert.ok(!JSON.stringify(state).includes("/"), "never send a path separator");
  });

  it("sends at most ten findings", () => {
    const many = Array.from({ length: 30 }, (_, i) => F(`f${i}`, "high", `rule${i}`, `t${i}`));
    assert.ok(rankState(many).length <= 10);
  });
});

describe("the product promise is enforced, not intended", () => {
  const adapter = readFileSync(new URL("../convex/adapters/decision.ts", import.meta.url), "utf8");
  const ranker = readFileSync(new URL("../shared/reports/priority.ts", import.meta.url), "utf8");

  it("never lets the lane choose the work that runs", () => {
    // Archived rankScan went with the web scan. Local review orders with noul
    // only. Choice appears once, for the licence suggestion quote, never for findings.
    const local = readFileSync(new URL("../mcp/review-entry.ts", import.meta.url), "utf8");
    assert.match(local, /type: "noul"/, "the local review asks a yes/no about fixing");
    assert.match(local, /unknownNext/, "the only choice is the licence suggestion quote");
    assert.equal(existsSync(new URL("../convex/scans/rankScan.ts", import.meta.url)), false);
  });

  it("shared/ stays pure with no convex import", () => {
    assert.doesNotMatch(ranker, /from ".*convex\//, "shared must not import convex");
  });

  it("never substitutes a default answer when a provider fails", () => {
    assert.match(adapter, /no_provider_answered/);
    assert.doesNotMatch(adapter, /defaultAnswer|fallbackAnswer|assume/);
  });
});