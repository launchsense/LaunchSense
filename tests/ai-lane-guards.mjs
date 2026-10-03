import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Guards the two provider bugs found by live probing on 2026-10-03.
// Both silently pushed scans to the plain wording fallback instead of failing loudly.

const adapterSource = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../convex/adapters/ai.ts", import.meta.url), "utf8"),
);

describe("AI lane provider guards", () => {
  it("does not use the retired gemini-2.0-flash model", () => {
    assert.equal(
      adapterSource.includes("gemini-2.0-flash:generateContent"),
      false,
      "gemini-2.0-flash is retired and answers 404, which kills the whole AI lane",
    );
  });

  it("turns off Gemini thinking so the output budget is not spent on reasoning", () => {
    assert.match(
      adapterSource,
      /thinkingConfig:\s*\{\s*thinkingBudget:\s*0\s*\}/,
      "without thinkingBudget 0, Gemini consumes maxOutputTokens on reasoning and returns no JSON",
    );
  });

  it("gives the Ollama lane a ceiling longer than its measured latency", () => {
    const match = adapterSource.match(/OLLAMA_TIMEOUT_MS\s*=\s*(\d+)/);
    assert.ok(match, "OLLAMA_TIMEOUT_MS must be defined");
    const timeout = Number(match[1]);
    // Ollama measured around 78000ms on a real findings prompt.
    assert.ok(
      timeout >= 90000,
      `OLLAMA_TIMEOUT_MS is ${timeout}ms but the lane measured about 78000ms, so it would always be cut off`,
    );
  });

  it("keeps Gemini as the first provider tried", () => {
    // Compare the request call sites, not the constant declarations, because the
    // base URL constant is declared near the top of the file regardless of order.
    const gemini = adapterSource.indexOf(
      "`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`",
    );
    const ollama = adapterSource.indexOf("`${OLLAMA_BASE_URL}/chat/completions`");
    assert.ok(gemini !== -1, "the Gemini request call site must be present");
    assert.ok(ollama !== -1, "the Ollama request call site must be present");
    assert.ok(gemini < ollama, "Gemini is measured far faster, so it must be attempted first");
  });
});