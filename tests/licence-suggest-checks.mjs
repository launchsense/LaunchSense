import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  orderSuggestions,
  suggestProjectLicence,
  suggestionQuestionId,
  suggestionState,
  SUGGESTION_NOTE,
} from "../shared/licensing/suggest.ts";

// The licence suggestion. Three things must hold:
//   1. It is a suggestion, never a licence fact, a finding, or a severity.
//   2. Copyleft and proprietary terms decline, because they need a person.
//   3. The lane may order the candidates but never flip the decline, and the
//      state it is asked about carries licence ids and counts only.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

describe("the suggestion floor", () => {
  it("picks the declared project licence when it is permissive", () => {
    const out = suggestProjectLicence({
      project: "MIT",
      mix: [
        { id: "MIT", count: 3 },
        { id: "ISC", count: 1 },
      ],
      allowed: ["MIT"],
    });
    assert.equal(out.pick, "MIT");
    assert.match(out.note, /not legal advice/);
    assert.equal(out.source, "table");
  });

  it("falls back to an allowlisted id when the repo declares none", () => {
    const out = suggestProjectLicence({
      project: null,
      mix: [
        { id: "Apache-2.0", count: 1 },
        { id: "MIT", count: 5 },
      ],
      allowed: ["Apache-2.0"],
    });
    assert.equal(out.pick, "Apache-2.0", "the allowlist outranks the raw count");
    assert.match(out.candidates[0].why, /allowlist/);
  });

  it("declines when copyleft or proprietary terms are in the mix", () => {
    for (const id of ["GPL-3.0-only", "AGPL-3.0-only", "LGPL-3.0-only", "LicenseRef-Proprietary-UNLICENSED"]) {
      const out = suggestProjectLicence({ project: id, mix: [{ id, count: 2 }], allowed: [] });
      assert.equal(out.pick, null, `${id} must decline`);
      assert.match(out.note, /need a person/);
    }
  });

  it("declines when there is nothing to suggest from", () => {
    const out = suggestProjectLicence({ project: null, mix: [], allowed: [] });
    assert.equal(out.pick, null);
    assert.match(out.note, /No licence signal/);
  });

  it("keeps Unknown out of the candidates", () => {
    const out = suggestProjectLicence({
      project: null,
      mix: [
        { id: "Unknown", count: 9 },
        { id: "MIT", count: 1 },
      ],
      allowed: [],
    });
    assert.ok(!out.candidates.some((candidate) => candidate.id === "Unknown"));
  });
});

describe("the lane may order, never decide", () => {
  it("reorders candidates by answer but keeps the pick a suggestion", () => {
    const floor = suggestProjectLicence({
      project: null,
      mix: [
        { id: "MIT", count: 5 },
        { id: "Apache-2.0", count: 1 },
      ],
      allowed: [],
    });
    const answers = {
      [suggestionQuestionId("Apache-2.0")]: { type: "noul", noul: 1 },
      [suggestionQuestionId("MIT")]: { type: "noul", noul: 0 },
    };
    const out = orderSuggestions(floor, answers, "jev");
    assert.equal(out.source, "jev");
    assert.equal(out.candidates[0].id, "Apache-2.0");
    assert.equal(out.pick, "Apache-2.0");
    assert.match(out.note, /not a licence fact/);
  });

  it("treats a missing answer as no signal, not a no", () => {
    const floor = suggestProjectLicence({ project: "MIT", mix: [{ id: "MIT", count: 1 }], allowed: [] });
    const out = orderSuggestions(floor, { [suggestionQuestionId("MIT")]: { type: "noul" } }, "perplexity");
    assert.equal(out.pick, floor.pick);
  });

  it("a lane cannot flip a decline into a pick", () => {
    const floor = suggestProjectLicence({
      project: "GPL-3.0-only",
      mix: [{ id: "GPL-3.0-only", count: 1 }],
      allowed: [],
    });
    const answers = { [suggestionQuestionId("GPL-3.0-only")]: { type: "noul", noul: 1 } };
    const out = orderSuggestions(floor, answers, "jev");
    assert.equal(out.pick, null);
  });
});

describe("the lane state carries licence ids and counts only", () => {
  it("sends no name, path, or file text", () => {
    const state = suggestionState({
      project: "MIT",
      mix: [
        { id: "MIT", count: 2 },
        { id: "Unknown", count: 1 },
      ],
      allowed: ["MIT"],
    });
    assert.deepEqual(Object.keys(state).sort(), ["allowedMatches", "candidates", "counts", "projectPresent"]);
    assert.ok(!JSON.stringify(state).includes("Unknown"));
    assert.ok(!JSON.stringify(state).includes("/"));
  });

  it("names the not-legal-advice line in the source constant", () => {
    assert.match(SUGGESTION_NOTE, /not legal advice/);
    assert.match(read("shared", "licensing", "suggest.ts"), /suggestion, not a licence fact/);
  });
});

describe("the surfaces show it as a suggestion", () => {
  it("stores a pick, a source, and a template line on the scan", () => {
    const schema = read("convex", "schema.ts");
    assert.match(schema, /suggestedLicence:/);
    assert.match(schema, /suggestionSource:/);
    assert.match(schema, /suggestionNote:/);
  });

  it("local review suggests, hosted scan is gone", () => {
    assert.equal(existsSync(join(repo, "convex", "scans", "analyze.ts")), false);
    assert.match(read("mcp", "review-entry.ts"), /suggestProjectLicence|licenseSuggestion/);
  });
});
