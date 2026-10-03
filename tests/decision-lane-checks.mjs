import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  tableOrder,
  actionableFindings,
  questionIdFor,
  rankFromAnswers,
  rankState,
} from "../shared/reports/priority.ts";
import { looksLikeSecret, validateQuestions, decisionRungs } from "../convex/adapters/decision.ts";

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
    assert.equal(looksLikeSecret({ content: "const k = '"AKIA"+"IOSFODNN7EXAMPLE"'" }), "aws key");
  });

  it("refuses a github token, a bearer token, and a private key block", () => {
    assert.equal(looksLikeSecret(""ghp_"+"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789""), "github token");
    assert.equal(looksLikeSecret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"), "bearer token");
    assert.equal(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----"), "private key block");
  });

  it("allows ordinary finding text", () => {
    assert.equal(looksLikeSecret({ title: "lodash has a known prototype pollution fix" }), null);
    assert.equal(looksLikeSecret([{ severity: "high", ruleId: "dep:vuln:lodash" }]), null);
  });

  it("never returns the secret value itself, only a label", () => {
    const label = looksLikeSecret(""AKIA"+"IOSFODNN7EXAMPLE"");
    assert.equal(label, "aws key");
    assert.ok(!String(label).includes("AKIA"));
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
    // The adapter must SUPPORT the choice type, because that is the documented
    // contract. What matters is that OUR caller never uses it: a choice question in
    // rankScan would mean the lane is picking from a set of checks or tools.
    const action = readFileSync(new URL("../convex/scans/rankScan.ts", import.meta.url), "utf8");
    assert.match(action, /type: "noul"/, "the ranker asks a yes/no about fixing");
    assert.doesNotMatch(action, /type: "choice"/, "the lane must never pick from a set of work");
    assert.doesNotMatch(action, /type: "score"/, "the lane must not be asked to rank the work itself");
  });

  it("shared/ stays pure with no convex import", () => {
    assert.doesNotMatch(ranker, /from ".*convex\//, "shared must not import convex");
  });

  it("never substitutes a default answer when a provider fails", () => {
    assert.match(adapter, /no_provider_answered/);
    assert.doesNotMatch(adapter, /defaultAnswer|fallbackAnswer|assume/);
  });
});