import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLicenses } from "../shared/analyzers/licenses.ts";

const F = (path, content) => ({ path, content });

// Draft 4 fixes: read non-npm manifests, detect licence body text, keep the
// or-later suffix, do not emit two BSD ids for one BSD-3 text.

test("BSD-3 body text without a header is detected as BSD-3, not unknown", () => {
  const r = analyzeLicenses(["LICENSE"], [F("LICENSE",
    "Redistribution and use in source and binary forms, with or without modification.\n" +
    "3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse.")], true);
  assert.deepEqual(r.detected, ["BSD-3-Clause"]);
  assert.equal(r.policy, "Allowed");
});

test("Cargo.toml license field is read, so a Rust crate is not 'unlicensed'", () => {
  const r = analyzeLicenses(["Cargo.toml"], [F("Cargo.toml", '[package]\nname = "x"\nlicense = "MPL-2.0"\n')], true);
  assert.equal(r.detected.includes("MPL-2.0"), true);
  assert.notEqual(r.policy, "Unknown");
});

test("or-later suffix survives on a GPL declaration", () => {
  const r = analyzeLicenses(["Cargo.toml"], [F("Cargo.toml", 'license = "GPL-3.0-or-later"\n')], true);
  assert.equal(r.detected.includes("GPL-3.0-or-later"), true);
  assert.match(r.note, /or-later/);
});

test("MIT full body text is detected without a heading", () => {
  const r = analyzeLicenses(["LICENSE"], [F("LICENSE",
    "Permission is hereby granted, free of charge, to any person obtaining a copy")], true);
  assert.equal(r.detected.includes("MIT"), true);
});

test("no licence file and no manifest field stays Unknown, honestly", () => {
  const r = analyzeLicenses([], [], true);
  assert.equal(r.policy, "Unknown");
  assert.deepEqual(r.detected, []);
});
