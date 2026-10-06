import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchCodePattern } from "../shared/analyzers/codePatterns.ts";
import { severityForFinding } from "../shared/policies/severity.ts";

// Four false positives, one file of tests. Each was found by an independent
// audit, not by the author, which is the point of the audit rule.
//
// 1. A comment raised a code finding, and a high one: a doc line saying
//    "do not use eval(x)" blocked the share gate. The gate now covers every
//    code rule, not only SQL.
// 2. A clean permissive licence shipped as a medium row on the local path
//    while the hosted path suppressed it. Both doors agree now.
// 3. An unknown advisory severity became medium locally and info hosted.
//    Unknown lands at info on both.
// 4. Test-path detection missed spec, __mocks__, e2e, and cypress layouts, so
//    test noise was scored as production.
//
// No network, no database, and no clock. Pure functions imported directly.

describe("a comment is not code", () => {
  it("raises nothing for a prose line that names a shape", () => {
    for (const line of [
      "// use eval(x) to parse this string",
      "/* call eval(input) here */",
      " * we avoid .innerHTML = usage everywhere",
      "# NOTE: createHash('md5') is insecure",
      "-- origin: '*' should never ship",
      "// uses execSync('ls') internally",
    ]) {
      assert.equal(matchCodePattern(line), null, `a comment raised a finding: ${line}`);
    }
  });

  it("still raises on the real shape in code", () => {
    assert.equal(matchCodePattern("const v = eval(input);")?.ruleId, "code.eval-use");
    assert.equal(matchCodePattern("el.innerHTML = userText;")?.ruleId, "code.inner-html");
    assert.equal(matchCodePattern("const h = createHash('md5');")?.ruleId, "code.weak-crypto");
    assert.equal(matchCodePattern("execSync('ls -la');")?.ruleId, "code.child-process");
    assert.equal(matchCodePattern("origin: '*'")?.ruleId, "code.cors-wildcard");
  });

  it("fires when a comment trails real code, because the line is code", () => {
    assert.equal(matchCodePattern("el.innerHTML = x; // note")?.ruleId, "code.inner-html");
  });
});

describe("test noise is demoted wherever it lives", () => {
  it("treats spec, mocks, e2e, and cypress layouts as test paths", () => {
    for (const path of [
      "spec/foo_spec.rb",
      "__mocks__/api.ts",
      "e2e/login.spec.ts",
      "cypress/checkout.test.ts",
      "tests/util.ts",
      "src/__tests__/thing.test.tsx",
    ]) {
      assert.equal(
        severityForFinding("code.debug-leftover", path),
        "info",
        `test noise was scored as production: ${path}`,
      );
    }
  });

  it("keeps a real key high even under a test path", () => {
    assert.equal(severityForFinding("secret.credential-pattern", "tests/thing.mjs"), "high");
  });
});
