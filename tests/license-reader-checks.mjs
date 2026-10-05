import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLicenses, licenseUsage } from "../shared/analyzers/licenses.ts";

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

// WS-2: licence filenames that real repos use. `MIT-LICENSE` and `COPYING.md` were
// read and then thrown away, so those repos lost the licence signal and the finding
// fell back to a `(repo)` path. The mismatch sentence also named package.json on a
// Cargo-only or pyproject-only repo, which is not the file it read.

test("MIT-LICENSE is detected as a licence file and read", () => {
  const r = analyzeLicenses(
    ["MIT-LICENSE"],
    [F("MIT-LICENSE", "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy")],
    true,
  );
  assert.deepEqual(r.files, ["MIT-LICENSE"], "MIT-LICENSE must be reported as a licence file, not dropped");
  assert.equal(r.detected.includes("MIT"), true, "the MIT body in MIT-LICENSE must be read");
  assert.equal(r.policy, "Allowed");
});

test("COPYING.md is detected as a licence file and read", () => {
  const r = analyzeLicenses(
    ["COPYING.md"],
    [F("COPYING.md", "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007")],
    true,
  );
  assert.deepEqual(r.files, ["COPYING.md"], "COPYING.md must be reported as a licence file, not dropped");
  assert.equal(r.detected.includes("GPL-3.0"), true);
});

test("a root MIT-LICENSE counts as the root licence file", () => {
  const r = analyzeLicenses(
    ["MIT-LICENSE"],
    [F("MIT-LICENSE", "All rights reserved. This software is proprietary and may not be copied or distributed.")],
    true,
  );
  assert.deepEqual(r.files, ["MIT-LICENSE"]);
  assert.equal(r.policy, "Unknown", "an unrecognised root licence is Unknown, not Allowed");
});

test("a Cargo.toml licence mismatch names Cargo.toml, not package.json", () => {
  const r = analyzeLicenses(
    ["LICENSE", "Cargo.toml"],
    [
      F("LICENSE", "Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/"),
      F("Cargo.toml", '[package]\nname = "x"\nlicense = "MIT"\n'),
    ],
    true,
  );
  assert.match(r.note, /Cargo\.toml says MIT/, "the note must name the manifest it actually read");
  assert.doesNotMatch(r.note, /package\.json/, "there is no package.json in this read, so the note must not claim one");
});

test("a pyproject.toml licence mismatch names pyproject.toml, not package.json", () => {
  const r = analyzeLicenses(
    ["LICENSE", "pyproject.toml"],
    [
      F("LICENSE", "Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/"),
      F("pyproject.toml", '[project]\nname = "x"\nlicense = "ISC"\n'),
    ],
    true,
  );
  assert.match(r.note, /pyproject\.toml says ISC/);
  assert.doesNotMatch(r.note, /package\.json/);
});

test("an npm licence mismatch still names package.json", () => {
  const r = analyzeLicenses(
    ["LICENSE", "package.json"],
    [
      F("LICENSE", "Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/"),
      F("package.json", JSON.stringify({ license: "MIT" })),
    ],
    true,
  );
  assert.match(r.note, /package\.json says MIT/);
  assert.match(r.note, /Apache-2\.0/);
});

test("the no-signal note does not name only package.json", () => {
  const r = analyzeLicenses(["Cargo.toml"], [F("Cargo.toml", '[package]\nname = "x"\n')], true);
  assert.equal(r.policy, "Unknown");
  assert.doesNotMatch(r.note, /package\.json/, "the read covered a Cargo.toml, not a package.json");
});

test("a root proprietary COPYING.md plus a nested MIT-LICENSE stays Unknown", () => {
  const r = analyzeLicenses(
    ["COPYING.md", "vendor/thing/MIT-LICENSE"],
    [
      F("COPYING.md", "All rights reserved. This software is proprietary and may not be copied or distributed."),
      F("vendor/thing/MIT-LICENSE", "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy"),
    ],
    true,
  );
  assert.deepEqual(r.files.sort(), ["COPYING.md", "vendor/thing/MIT-LICENSE"]);
  assert.equal(r.policy, "Unknown", "the nested MIT must not set Allowed over a proprietary root");
  assert.match(r.note, /root/i);
  assert.match(r.note, /MIT/);
});

test("a root proprietary licence is not washed out by a nested MIT file", () => {
  const r = analyzeLicenses(
    ["LICENSE", "vendor/thing/LICENSE"],
    [
      F("LICENSE",
        "All rights reserved. This software is proprietary and may not be copied, used, " +
        "or distributed without a written grant from the owner."),
      F("vendor/thing/LICENSE",
        "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy"),
    ],
    true,
  );
  assert.equal(r.policy, "Unknown");
  assert.match(r.note, /root/i, "the note must name the root licence");
  assert.match(r.note, /unrecognised/, "the note must say the root licence is unrecognised");
  assert.match(r.note, /MIT/, "the nested MIT stays a separate fact in the note");
});

test("licenseUsage mirrors a permissive licence and references the rest", () => {
  assert.equal(licenseUsage("Allowed"), "mirror");
  assert.equal(licenseUsage("Review required"), "reference-only");
  assert.equal(licenseUsage("Not recommended"), "reference-only");
  assert.equal(licenseUsage("Unknown"), "reference-only");
  assert.equal(licenseUsage("Not checked"), "unknown");
});
