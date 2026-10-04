import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasTestsIn, hasLicenseIn, hasCIIn, hasReadmeIn } from "../shared/analyzers/projectSignals.ts";
import { scanSecrets } from "../shared/analyzers/secrets.ts";
import { parseManifests } from "../shared/analyzers/deps.ts";

// Built by concatenation so these literals never appear in source.
const AWS = "AKIA" + "IOSFODNN7EXAMPLE";
const GHP = "ghp_" + "abcdefghij1234567890";

describe("projectSignals", () => {
  it("detects tests across runner configs and layouts", () => {
    for (const paths of [
      ["vitest.config.ts"],
      ["__tests__/helpers.ts"],
      ["pytest.ini"],
      ["playwright.config.ts"],
      ["tests/e2e/home.ts"],
      ["src/a.test.tsx"],
      ["a_test.go"],
    ]) {
      assert.equal(hasTestsIn(paths), true, paths.join(","));
    }
  });

  it("does not mistake data files or plain source for tests", () => {
    for (const paths of [["app/main.py"], ["src/app.ts"], ["src/latest.test.data.json"], ["package.json"]]) {
      assert.equal(hasTestsIn(paths), false, paths.join(","));
    }
  });

  it("detects readme, license, and CI", () => {
    assert.equal(hasReadmeIn(["docs/README.md"]), true);
    assert.equal(hasLicenseIn(["LICENSE.txt"]), true);
    assert.equal(hasLicenseIn(["COPYING"]), true);
    assert.equal(hasCIIn([".github/workflows/ci.yml"]), true);
    assert.equal(hasCIIn(["src/ci.ts"]), false);
  });
});

describe("debugger rule precision", () => {
  it("flags a real statement and ignores the word in prose", () => {
    const matches = scanSecrets([
      { path: "src/prose.ts", content: "// A debugger statement halts execution.\nconst r = 'secret.debugger-statement';" },
      { path: "src/real.ts", content: "function f() {\n  debugger;\n}" },
    ]);
    const hits = matches.filter((m) => m.ruleId === "code.debugger-statement");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "src/real.ts");
  });
});

describe("duplicate dependencies", () => {
  it("flags the same package at two versions across manifests", () => {
    const result = parseManifests([
      { path: "package.json", content: JSON.stringify({ dependencies: { lodash: "4.0.0" } }) },
      { path: "api/package.json", content: JSON.stringify({ dependencies: { lodash: "3.0.0" } }) },
    ]);
    assert.deepEqual(result.duplicates, ["lodash (3.0.0 vs 4.0.0)"]);
  });

  it("does not flag the same package at one version in deps and devDeps", () => {
    const result = parseManifests([
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { lodash: "4.0.0" },
          devDependencies: { lodash: "4.0.0" },
        }),
      },
    ]);
    assert.deepEqual(result.duplicates, []);
  });
});

describe("secret detection survives a repeat scan", () => {
  it("reports the same secrets from raw content every time", () => {
    const files = [
      { path: "src/aws.ts", content: `const k = "${AWS}";` },
      { path: "src/tok.ts", content: `const t = "${GHP}";` },
    ];
    const cold = scanSecrets(files);
    // What a cached (redacted) body would produce if it were ever fed back in.
    const warm = scanSecrets(
      files.map((f) => ({ path: f.path, content: f.content.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]").replace(/ghp_[A-Za-z0-9]{20,}/g, "[REDACTED]") })),
    );
    assert.ok(cold.some((m) => m.ruleId === "secret.aws-key"));
    assert.ok(cold.some((m) => m.ruleId === "secret.github-token"));
    assert.ok(!warm.some((m) => m.ruleId === "secret.aws-key"));
    assert.ok(!warm.some((m) => m.ruleId === "secret.github-token"));
  });
});