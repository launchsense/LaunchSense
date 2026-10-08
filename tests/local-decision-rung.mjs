import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionRungs, LOCAL_DECISION_URL, LOCAL_DECISION_MODEL } from "../shared/adapters/decision.ts";

// The local decision rung is a development instrument. It must be OFF unless the
// environment asks for it, so a hosted deployment never tries to reach a
// developer's localhost and never presents a local answer as Jev or Perplexity.

test("local rung is absent unless explicitly enabled", () => {
  delete process.env["LAUNCHSENSE_LOCAL_DECISION"];
  const names = decisionRungs().map((r) => r.name);
  assert.equal(names.includes("local"), false);
  assert.deepEqual(names, ["jev", "perplexity"]);
});

test("local rung is first when enabled, hosted rungs stay behind it", () => {
  process.env["LAUNCHSENSE_LOCAL_DECISION"] = "1";
  try {
    const names = decisionRungs().map((r) => r.name);
    assert.deepEqual(names, ["local", "jev", "perplexity"]);
  } finally {
    delete process.env["LAUNCHSENSE_LOCAL_DECISION"];
  }
});

test("local rung points at an Ollama System One endpoint and needs no real key", () => {
  assert.match(LOCAL_DECISION_URL, /\/v1\/systemone$/);
  assert.equal(typeof LOCAL_DECISION_MODEL, "string");
  assert.ok(LOCAL_DECISION_MODEL.length > 0);
});
