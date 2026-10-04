import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { codingToolsIn, toolCardSentence } from "../shared/reports/codingTool.ts";

describe("coding tool card", () => {
  it("names a tool only from a path marker", () => {
    assert.deepEqual(codingToolsIn(["src/App.tsx", ".cursor/rules.md"]), ["Cursor"]);
    assert.deepEqual(codingToolsIn(["CLAUDE.md"]), ["Claude"]);
    assert.deepEqual(codingToolsIn(["notes/.codex/config.toml"]), ["Codex"]);
    assert.deepEqual(codingToolsIn(["src/main.ts"]), []);
  });

  it("does not guess, and does not offer an install", () => {
    const none = toolCardSentence([]);
    assert.match(none, /your coding tool/);
    assert.doesNotMatch(none, /Install/);
    assert.match(toolCardSentence(["Cursor", "Claude"]), /Cursor and Claude/);
  });
});