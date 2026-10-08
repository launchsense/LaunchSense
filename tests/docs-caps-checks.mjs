import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The public caps. `docs/LIMITS.md` states the hosted rate caps, and those are a
// claim about convex/mcpLimit.ts and convex/identity/quotaKey.ts. A wave raised
// those caps, and nothing stopped `docs/LIMITS.md` from keeping the retired
// numbers: it said "Two scans an hour from one caller, and eight an hour in
// total" long after the code changed. llms.txt was pinned; this file was not.
// These rules pin `docs/LIMITS.md` to the constants, so a wrong number fails.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

function constant(file, name) {
  const source = read(...file.split("/"));
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `${name} must exist in ${file}`);
  return Number(match[1].replace(/_/g, ""));
}

describe("docs/LIMITS.md states one lane", () => {
  it("names no hosted bucket and no hosted lane total", () => {
    const text = read("docs", "LIMITS.md");
    assert.doesNotMatch(text, /shared hosted bucket/);
    assert.doesNotMatch(text, /across the hosted lane/);
    assert.match(text, /no hourly limit/i);
  });
});

describe("the public docs that remain are the true ones", () => {
  it("states the two doors, so the local door is not described with hosted limits", () => {
    const local = read("docs", "LOCAL-MCP.md");
    assert.match(local, /no hourly limit/i, "the local door has no hourly limit");
    assert.match(local, /sends nothing to us/i, "the local door sends nothing");
  });

  it("the internal strategy doc is not on GitHub", () => {
    // docs/PRODUCT.md was public and carried the stale line "the auth slot is
    // empty". It moved local on 2026-10-07. A re-add would be a defect.
    const reader = read("tests", "consent-standards-checks.mjs");
    assert.doesNotMatch(
      reader,
      /docs\/PRODUCT\.md/,
      "the AI disclosure surfaces must not read a removed public doc",
    );
  });
});
