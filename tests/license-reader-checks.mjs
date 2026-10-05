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

// Wave 5: the gate was never read. Its only caller was the test above, so the
// licence decision that reaches a report did not say what it allowed. These read
// the note a report carries and require the gate's answer to be in it.

const USAGE_PHRASE = {
  mirror: /mirror is allowed/,
  "reference-only": /reference only: read it, do not copy it/,
  unknown: /An unchecked licence is not a licence to copy/,
};

// One read per policy, so every branch of licenseUsage is checked at the seam
// where the decision is presented, not only in the unit test above.
const POLICY_READS = [
  {
    policy: "Allowed",
    blobs: ["LICENSE", "package.json"],
    files: [
      F("LICENSE", "MIT License\n\nPermission is hereby granted, free of charge"),
      F("package.json", JSON.stringify({ license: "MIT" })),
    ],
    fetched: true,
  },
  {
    policy: "Review required",
    blobs: ["LICENSE", "NOTICE", "package.json"],
    files: [
      F("LICENSE", "MIT License\n\nPermission is hereby granted, free of charge"),
      F("NOTICE", "Apache-2.0"),
      F("package.json", JSON.stringify({ license: "MIT AND Apache-2.0" })),
    ],
    fetched: true,
  },
  {
    policy: "Not recommended",
    blobs: ["LICENSE"],
    files: [F("LICENSE", "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3")],
    fetched: true,
  },
  {
    policy: "Unknown",
    blobs: ["src/a.ts"],
    files: [F("src/a.ts", "x")],
    fetched: true,
  },
  {
    policy: "Not checked",
    blobs: [],
    files: [],
    fetched: false,
  },
];

test("every licence decision states what it allows, so the usage gate is not inert", () => {
  const seen = new Set();
  for (const read of POLICY_READS) {
    const r = analyzeLicenses(read.blobs, read.files, read.fetched);
    assert.equal(r.policy, read.policy, `${read.policy} fixture did not produce its policy`);
    seen.add(r.policy);
    assert.equal(r.usage, licenseUsage(r.policy), `${r.policy} must carry the gate's answer`);
    assert.match(r.note, USAGE_PHRASE[r.usage], `${r.policy} note does not state what it allows`);
  }
  assert.equal(seen.size, POLICY_READS.length, "one read per policy is required");
});

test("an unchecked licence stays unknown for use and says so", () => {
  const r = analyzeLicenses([], [], false);
  assert.equal(r.policy, "Not checked");
  assert.equal(r.usage, "unknown");
  assert.doesNotMatch(r.note, /mirror is allowed/, "an unchecked licence must not read as copyable");
  assert.match(r.note, /Signal, not legal advice/);
});

// Wave 5: SPDX AND and WITH were read as one opaque id. `MIT AND
// Apache-2.0` came out Allowed with no Apache obligation attached, because the
// string is not exactly "Apache-2.0" and the NOTICE sentence tests for that.
// `Apache-2.0 WITH LLVM-exception` produced one identical note whether a NOTICE
// file was in the read or not.

test("an AND expression is not Allowed, and it keeps the Apache NOTICE obligation", () => {
  const withNotice = analyzeLicenses(
    ["LICENSE", "NOTICE", "package.json"],
    [
      F("LICENSE", "MIT License\n\nPermission is hereby granted, free of charge"),
      F("NOTICE", "Apache License\nVersion 2.0"),
      F("package.json", JSON.stringify({ license: "MIT AND Apache-2.0" })),
    ],
    true,
  );
  assert.equal(withNotice.policy, "Review required", "two licences both apply, so this is not Allowed");
  assert.match(withNotice.note, /AND expression is every licence in it at once/);
  assert.ok(
    withNotice.detected.includes("Apache-2.0"),
    "the Apache base id is what carries the NOTICE obligation",
  );
  assert.match(withNotice.note, /Apache-2\.0 was found, and a NOTICE file was in this read/);
  assert.equal(withNotice.usage, "reference-only");
});

test("an AND expression with no NOTICE file says the NOTICE was not read", () => {
  const r = analyzeLicenses(
    ["LICENSE", "package.json"],
    [
      F("LICENSE", "MIT License\n\nPermission is hereby granted, free of charge"),
      F("package.json", JSON.stringify({ license: "MIT AND Apache-2.0" })),
    ],
    true,
  );
  assert.notEqual(r.policy, "Allowed");
  assert.match(r.note, /Apache-2\.0 was found\. No NOTICE file was in this read/);
  assert.match(r.note, /package\.json says MIT AND Apache-2\.0/, "the exact declaration is stated");
});

test("Apache-2.0 WITH LLVM-exception is a licence plus an exception, not plain Apache-2.0", () => {
  const declared = JSON.stringify({ license: "Apache-2.0 WITH LLVM-exception" });
  const withNotice = analyzeLicenses(
    ["LICENSE", "NOTICE", "package.json"],
    [
      F("LICENSE", "Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/"),
      F("NOTICE", "Apache License\nVersion 2.0"),
      F("package.json", declared),
    ],
    true,
  );
  const withoutNotice = analyzeLicenses(
    ["LICENSE", "package.json"],
    [F("LICENSE", "Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/"), F("package.json", declared)],
    true,
  );

  for (const r of [withNotice, withoutNotice]) {
    assert.equal(r.policy, "Review required", "an exception changes the terms, so a person reads them");
    assert.match(r.note, /WITH expression is that licence plus its exception \(LLVM-exception\)/);
    assert.ok(
      r.detected.includes("Apache-2.0"),
      "the Apache base id is what carries the NOTICE obligation",
    );
    assert.ok(r.detected.includes("Apache-2.0 WITH LLVM-exception"), "the exact declaration is kept");
    assert.equal(r.usage, "reference-only");
  }
  // Before, both reads produced the same note, present or absent.
  assert.match(withNotice.note, /a NOTICE file was in this read/);
  assert.match(withoutNotice.note, /No NOTICE file was in this read/);
  assert.notEqual(withNotice.note, withoutNotice.note);

  // The manifest alone, no Apache licence file in the read. This is the read
  // where the NOTICE sentence used to be skipped outright, so the note was the
  // same whether a NOTICE file was there or not.
  const bareWith = analyzeLicenses(
    ["package.json", "NOTICE"],
    [F("package.json", declared), F("NOTICE", "This product includes work by Example.")],
    true,
  );
  const bareWithout = analyzeLicenses(["package.json"], [F("package.json", declared)], true);
  assert.match(bareWith.note, /a NOTICE file was in this read/);
  assert.match(bareWithout.note, /No NOTICE file was in this read/);
  assert.notEqual(bareWith.note, bareWithout.note, "a NOTICE file in the read must be stated");
});

test("an OR expression stays a choice and does not attach the licence not picked", () => {
  const r = analyzeLicenses(
    ["package.json"],
    [F("package.json", JSON.stringify({ license: "MIT OR Apache-2.0" }))],
    true,
  );
  assert.equal(r.policy, "Review required");
  assert.match(r.note, /OR expression is a choice, not both licenses at once/);
  assert.equal(
    r.detected.includes("Apache-2.0"),
    false,
    "an OR choice may settle on MIT, so the Apache NOTICE duty must not be asserted",
  );
});

// Wave 5: one manifest per family was read, chosen by array order. A
// monorepo read as licensed or unlicensed depending on which file the host
// listed first. Every manifest is read now, sorted by path.

const MONOREPO = [
  F("a/package.json", JSON.stringify({ license: "MIT" })),
  F("b/package.json", JSON.stringify({ license: "GPL-3.0-only" })),
];

test("two manifests that disagree read the same whichever order the files arrive in", () => {
  const forwards = analyzeLicenses(
    ["a/package.json", "b/package.json"],
    [MONOREPO[0], MONOREPO[1]],
    true,
  );
  const backwards = analyzeLicenses(
    ["b/package.json", "a/package.json"],
    [MONOREPO[1], MONOREPO[0]],
    true,
  );
  assert.equal(forwards.policy, backwards.policy, "file order must not decide the verdict");
  assert.equal(forwards.note, backwards.note, "the note must not depend on file order");
  assert.equal(forwards.usage, backwards.usage);
  assert.deepEqual([...forwards.detected].sort(), [...backwards.detected].sort());
  assert.equal(forwards.packageLicense, null, "two licences leave none to state as the one licence");
  assert.match(forwards.note, /do not agree on one licence/);
  assert.match(forwards.note, /a\/package\.json says MIT/);
  assert.match(forwards.note, /b\/package\.json says GPL-3\.0-only/);
});

test("two permissive manifests that disagree read as Unknown, not as the first one read", () => {
  const r = analyzeLicenses(
    ["packages/ui/package.json", "packages/api/package.json"],
    [
      F("packages/ui/package.json", JSON.stringify({ license: "MIT" })),
      F("packages/api/package.json", JSON.stringify({ license: "ISC" })),
    ],
    true,
  );
  assert.equal(r.policy, "Unknown", "no single licence can be stated for this repository");
  assert.equal(r.usage, "reference-only");
  assert.equal(r.packageLicense, null);
  assert.match(r.note, /declare more than one licence/);
});

test("two manifests that declare the same licence report it once and name both files", () => {
  const r = analyzeLicenses(
    ["a/package.json", "b/package.json"],
    [MONOREPO[0], F("b/package.json", JSON.stringify({ license: "MIT" }))],
    true,
  );
  assert.equal(r.policy, "Allowed");
  assert.equal(r.packageLicense, "MIT");
  assert.match(r.note, /MIT is declared in 2 manifests read: a\/package\.json, b\/package\.json/);
});

test("a package.json and a Cargo.toml are both read, and neither wins by position", () => {
  const files = [
    F("Cargo.toml", '[package]\nname = "x"\nlicense = "Apache-2.0"\n'),
    F("package.json", JSON.stringify({ license: "MIT" })),
  ];
  const forwards = analyzeLicenses(["Cargo.toml", "package.json"], files, true);
  const backwards = analyzeLicenses(["package.json", "Cargo.toml"], [files[1], files[0]], true);
  assert.equal(forwards.policy, backwards.policy);
  assert.equal(forwards.note, backwards.note);
  assert.equal(forwards.policy, "Unknown", "one repository declaring two licences is not one licence");
  assert.match(forwards.note, /Cargo\.toml says Apache-2\.0/);
  assert.match(forwards.note, /package\.json says MIT/);
});