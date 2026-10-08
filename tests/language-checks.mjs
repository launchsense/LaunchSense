import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toUserError } from "../shared/userError.ts";

// W6. Every string here was a real overstatement in the app on 2026-10-03.
// Each fixture is verbatim from that version, so a rule cannot pass by matching
// nothing.

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css|html)$/.test(entry)) out.push(full);
  }
  return out;
}

// fileURLToPath, not URL.pathname: this checkout path contains spaces and the
// raw pathname keeps them percent encoded.
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const srcFiles = walk(join(repo, "src"));
const sharedFiles = walk(join(repo, "shared"));
const allSource = [...srcFiles, ...sharedFiles]
  .map((f) => ({ file: f.replace(repo, ""), text: readFileSync(f, "utf8") }));

describe("style rules", () => {
  it("uses no em or en dashes in user-facing source", () => {
    for (const { file, text } of allSource) {
      assert.doesNotMatch(text, /[\u2014\u2013]/, `${file} contains an em or en dash`);
    }
  });

  it("uses no single-character ellipsis in UI copy", () => {
    // The one allowed ellipsis is the redaction truncation mark in
    // shared/redaction.ts, which is data, not interface copy.
    for (const { file, text } of allSource) {
      if (file.endsWith("shared/redaction.ts")) continue;
      assert.doesNotMatch(text, /\u2026/, `${file} contains the ellipsis character`);
    }
  });

  it("uses no middle dot between facts, which is a named AI tell", () => {
    // frontend-design names "meta strings joined with middle dots (A, B, C)" as a
    // generic default. Removed from 8 sites on 2026-10-04. Use a comma, a slash, or
    // a parenthetical instead.
    for (const { file, text } of allSource) {
      assert.doesNotMatch(text, /\u00b7/, `${file} joins facts with a middle dot`);
    }
  });
});

describe("no overstatement survives", () => {
  const cases = [
    { name: "safe and cheap", pattern: /safe and cheap/i },
    { name: "Safe share heading", pattern: /<h3>Safe share<\/h3>/ },
    { name: "Secure Your Project", pattern: /Secure Your Project/ },
    { name: "Shared Safely", pattern: /Shared Safely/ },
    { name: "carried no secrets", pattern: /carried no secrets/i },
    { name: "Clean Compare", pattern: /Clean Compare/ },
    { name: "Share Ready", pattern: /title: "Share Ready"/ },
    { name: "Nothing flagged unqualified", pattern: /"Nothing flagged\./ },
    { name: "full report claim", pattern: /You produced a full report/ },
    { name: "nothing still broken", pattern: /nothing still broken/i },
  ];

  for (const c of cases) {
    it(`removed: ${c.name}`, () => {
      for (const { file, text } of allSource) {
        assert.doesNotMatch(text, c.pattern, `${file} still contains ${c.name}`);
      }
    });
  }
});

describe("error text never leaks raw backend messages", () => {
  it("does not render error.message directly in a component", () => {
    // shared/userError.ts is the single boundary that is allowed to read the raw
    // message, and it never returns it to the view. It lives outside src/, so
    // this scan over src/ files needs no skip for it.
    for (const { file, text } of allSource.filter((f) => f.file.startsWith("src/"))) {
      assert.doesNotMatch(text, /error\.message/, `${file} renders a raw error message`);
    }
  });

  it("keeps the detail out of the user-facing string", () => {
    const leaky = new Error("GitHub API 403 for owner/repo at /home/runner/work/secret");
    assert.equal(toUserError(leaky, "Could not run the scan. Try again."), "Could not run the scan. Try again.");
  });

  it("passes through our own deliberately user-facing throws", () => {
    const ours = new Error("File tree is missing. Fetch the tree first.");
    assert.equal(toUserError(ours, "fallback"), "File tree is missing. Fetch the tree first.");
  });

  it("does not leak a path even when the message looks harmless", () => {
    const ours = new Error("/var/lib/convex/store/scanQueue aborted");
    assert.equal(toUserError(ours, "Could not run the scan. Try again."), "Could not run the scan. Try again.");
  });

  it("survives a non-Error throw", () => {
    assert.equal(toUserError("just a string", "fallback"), "fallback");
    assert.equal(toUserError(null, "fallback"), "fallback");
  });
});

describe("no share links to describe", () => {
  it("Why names no share feature and claims no safety", () => {
    const why = readFileSync(join(repo, "src/pages/Why.tsx"), "utf8");
    assert.doesNotMatch(why, /without exposing secrets/i);
    assert.doesNotMatch(why, /share link/i);
    assert.doesNotMatch(why, /Links stay live once created/);
  });
});