import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Two defects a real client hit on a Python project.
//
// 1. The review walked into .venv and read site-packages, so almost every
//    finding was a downloaded library file, and the venv ate the file cap so the
//    project's own code was listed as not checked.
// 2. The report opened with raw findings and buried the fix path, so it read as
//    a list of what is wrong, not a path to fixed.
//
// Both are pinned here. Read as text, no network, no database.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = readFileSync(join(repo, "mcp", "review-entry.ts"), "utf8");

describe("installed packages and caches are never read", () => {
  it("skips a Python virtualenv under any of its names", () => {
    for (const name of [".venv", "venv", "site-packages", ".tox", ".nox"]) {
      assert.ok(entry.includes(`"${name}"`), `the skip list must name ${name}`);
    }
  });

  it("skips the common tool caches that are not the project's code", () => {
    for (const name of [".mypy_cache", ".pytest_cache", ".ruff_cache", ".cache"]) {
      assert.ok(entry.includes(`"${name}"`), `the skip list must name ${name}`);
    }
  });

  it("still skips the names it always did", () => {
    for (const name of ["node_modules", "__pycache__", "vendor", "third_party", "dist", "build"]) {
      assert.ok(entry.includes(`"${name}"`), `the skip list must keep ${name}`);
    }
  });

  it("discloses the package-cache skip rather than hiding it", () => {
    assert.match(entry, /PACKAGE_CACHES\.has\(name\)/);
    assert.match(entry, /downloaded library files, not this project's code/);
  });
});

describe("the report leads with the solution", () => {
  it("opens with START HERE and the lead prompt, before any detail", () => {
    const startHere = entry.indexOf('"START HERE"');
    const plan = entry.indexOf('"PLAN"');
    const detail = entry.indexOf('"DETAIL"');
    assert.ok(startHere > 0, "the report must have a START HERE section");
    assert.ok(plan > startHere, "the PLAN must follow START HERE");
    assert.ok(detail > plan, "DETAIL must come last");
    // The body line order: the lead prompt is pushed inside START HERE.
    const startBlock = entry.slice(startHere, plan);
    assert.match(startBlock, /report\.lead/, "the lead prompt is the first thing under START HERE");
  });

  it("renders the ordered plan with files and a checklist", () => {
    assert.match(entry, /report\.plan/);
    assert.match(entry, /step\.checklist/);
    assert.match(entry, /step\.files/);
  });

  it("does not dump the notice into the report body", () => {
    assert.doesNotMatch(entry, /lines\.push\(declaration\.notice\)/);
    assert.match(entry, /next to this report/, "the report references the notice file instead");
  });

  it("shows every not-checked line, never the first thirty", () => {
    assert.doesNotMatch(entry, /notChecked\.slice\(0, 30\)/);
    assert.match(entry, /for \(const item of report\.notChecked\)/);
  });
});
