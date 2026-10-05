import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { severityFor, severityForFinding } from "../shared/policies/severity.ts";

// The test-path demotion used to hide every high finding under a test path. That
// dropped a genuinely committed provider key out of every actionable list, and it
// left a weak-hash assertion line stuck at medium, where it blocked the share gate.
// Only known noise rules are demoted now.
describe("severityForFinding under a test path", () => {
  it("keeps a real committed key high even under tests/", () => {
    assert.equal(severityForFinding("secret.credential-pattern", "tests/fixtures/creds.ts"), "high");
    assert.equal(severityForFinding("secret.github-token", "__tests__/a.ts"), "high");
    assert.equal(severityForFinding("secret.aws-key", "tests/a.ts"), "high");
    assert.equal(severityForFinding("secret.private-key", "spec/fixtures/key.pem.ts"), "high");
    assert.equal(severityForFinding("secret.tracked-env", "tests/a.ts"), "high");
  });

  it("keeps a real committed key high in a .spec. file too", () => {
    // The testLike regex has a second arm for *.test.* / *.spec.* files.
    assert.equal(severityForFinding("secret.credential-pattern", "src/thing.spec.ts"), "high");
  });

  it("demotes the noise rules that are expected inside a test path", () => {
    assert.equal(severityForFinding("code.weak-crypto", "tests/old.test.js"), "info");
    assert.equal(severityForFinding("code.debug-leftover", "tests/a.ts"), "info");
    assert.equal(severityForFinding("secret.debug-leftover", "fixtures/x.ts"), "info");
    assert.equal(severityForFinding("code.sql-pattern", "tests/db.test.ts"), "info");
    assert.equal(severityForFinding("secret.sql-pattern", "__tests__/db.ts"), "info");
  });

  it("leaves the same rules alone outside a test path", () => {
    assert.equal(severityForFinding("code.weak-crypto", "src/a.ts"), "medium");
    assert.equal(severityForFinding("code.debug-leftover", "src/a.ts"), "low");
    assert.equal(severityForFinding("secret.debug-leftover", "src/a.ts"), "low");
    assert.equal(severityForFinding("code.sql-pattern", "src/a.ts"), "low");
    assert.equal(severityForFinding("secret.credential-pattern", "src/a.ts"), "high");
  });

  it("stays high for code.eval-use under a test path", () => {
    // Chosen value: high. An eval in a test file is still a code path a reader
    // would want to see; it is not one of the noise rules, so it is not demoted.
    assert.equal(severityForFinding("code.eval-use", "tests/a.ts"), "high");
    assert.equal(severityFor("code.eval-use"), "high");
  });

  it("stays high for secret.eval-use and the other high code rules under a test path", () => {
    for (const ruleId of ["secret.eval-use", "code.child-process", "deps.vulnerability", "deps.install-script"]) {
      assert.equal(severityForFinding(ruleId, "tests/a.ts"), "high", ruleId);
    }
  });

  it("stays medium for a debugger statement under a test path", () => {
    // A live debugger halts whoever runs the file, test or not.
    assert.equal(severityForFinding("code.debugger-statement", "tests/a.ts"), "medium");
    assert.equal(severityForFinding("secret.debugger-statement", "tests/a.ts"), "medium");
  });

  it("does not demote an unknown rule under a test path either", () => {
    assert.equal(severityForFinding("hygiene.no-readme", "tests/a.ts"), "info");
    assert.equal(severityFor("hygiene.no-readme"), "info");
  });
});