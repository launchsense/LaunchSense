import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGovernance, applyGovernance } from "../shared/review/governance.ts";

// The governance file, `.ls/policy.yaml`. Three defect classes, one file of tests.
//
// 1. A file that is wrong must be refused WHOLE, and nothing suppressed. A file
//    that only half-parses is a file that hides what it misunderstood.
// 2. A file must not be able to silence everything. Wildcards, absent reasons,
//    and a suppress-everything ratio are each refused.
// 3. An acceptance names one finding. It must never hide a finding no acceptance
//    names, and never change a severity, a rule, or the set of rules that run.
//
// Pure functions imported directly. No filesystem, no network, no clock.

const GOOD = `version: 1
accepts:
  - fingerprint: "code.eval-use:stage3.1:src/a.ts:0f3a91c2"
    reason: "legacy, removed next sprint"
  - ruleId: "hygiene.no-ci"
    reason: "personal project, no CI by design"
licences:
  allow:
    - "MIT"
    - "Apache-2.0"
ignorePaths:
  - path: "docs/examples"
    reason: "documentation samples"
consent:
  noticeVersion: "2026-10-06"
`;

function parse(text) {
  const result = parseGovernance(text);
  assert.equal(result.ok, true, `expected a valid file: ${JSON.stringify(result)}`);
  return result.policy;
}

function refuse(text, reason) {
  const result = parseGovernance(text);
  assert.equal(result.ok, false, `expected a refusal, got: ${JSON.stringify(result)}`);
  assert.equal(result.reason, reason, `wrong refusal: ${JSON.stringify(result)}`);
}

describe("a valid file parses into what it says", () => {
  it("reads accepts, licences, ignorePaths, and consent", () => {
    const policy = parse(GOOD);
    assert.equal(policy.version, 1);
    assert.equal(policy.accepts.length, 2);
    assert.equal(policy.accepts[0].fingerprint, "code.eval-use:stage3.1:src/a.ts:0f3a91c2");
    assert.equal(policy.accepts[1].ruleId, "hygiene.no-ci");
    assert.deepEqual(policy.licenceAllow, ["MIT", "Apache-2.0"]);
    assert.equal(policy.ignorePaths[0].path, "docs/examples");
    assert.equal(policy.consentNoticeVersion, "2026-10-06");
  });

  it("treats a file with no accepts as valid and empty", () => {
    const policy = parse("version: 1\n");
    assert.deepEqual(policy.accepts, []);
  });
});

describe("a wrong file is refused whole", () => {
  it("refuses an unsupported version", () => refuse("version: 2\n", "unsupported_version"));
  it("refuses a key it does not define", () =>
    refuse("version: 1\nbanEverything: true\n", "unknown_key"));
  it("refuses a tab for indentation", () => refuse("version: 1\n\taccepts: []\n", "tab_indentation"));
  it("refuses anchors and aliases", () =>
    refuse("version: 1\naccepts: &all\n", "anchors_not_supported"));
  it("refuses a multi-document file", () =>
    refuse("---\nversion: 1\n", "multi_document_not_supported"));
});

describe("a file cannot silence everything", () => {
  it("refuses a wildcard rule", () =>
    refuse('version: 1\naccepts:\n  - ruleId: "*"\n    reason: "fine"\n', "accept_wildcard"));
  it("refuses a wildcard path", () =>
    refuse('version: 1\naccepts:\n  - ruleId: "hygiene.no-ci"\n    path: "**"\n    reason: "fine"\n', "accept_wildcard"));
  it("refuses an accept with no reason", () =>
    refuse('version: 1\naccepts:\n  - ruleId: "hygiene.no-ci"\n    reason: ""\n', "accept_without_reason"));
  it("refuses an accept with neither a fingerprint nor a rule", () =>
    refuse('version: 1\naccepts:\n  - path: "src/a.ts"\n    reason: "fine"\n', "accept_without_fingerprint_or_rule"));
  it("refuses a rule this product does not have", () =>
    refuse('version: 1\naccepts:\n  - ruleId: "made.up-rule"\n    reason: "fine"\n', "accept_unknown_rule"));
  it("refuses a malformed fingerprint", () =>
    refuse('version: 1\naccepts:\n  - fingerprint: "not-a-fingerprint"\n    reason: "fine"\n', "accept_malformed_fingerprint"));
  it("refuses ignoring the whole repo", () =>
    refuse('version: 1\nignorePaths:\n  - path: "**"\n    reason: "everything"\n', "ignore_all_paths"));
  it("refuses an ignored path with no reason", () =>
    refuse('version: 1\nignorePaths:\n  - path: "src/old"\n    reason: ""\n', "ignore_without_reason"));
});

describe("the guard covers ignored paths, not only acceptances", () => {
  it("flags a file that ignores most of the repo", () => {
    const policy = parse(
      'version: 1\nignorePaths:\n  - path: "src"\n    reason: "not ours"\n  - path: "convex"\n    reason: "not ours"\n',
    );
    const findings = [
      { ruleId: "code.eval-use", fingerprint: "a:stage3.1:src/a.ts:11112222", path: "src/a.ts" },
      { ruleId: "hygiene.no-ci", fingerprint: "b:stage3.1:convex/b.ts:33334444", path: "convex/b.ts" },
      { ruleId: "secret.credential-pattern", fingerprint: "c:stage3.1:mcp/c.ts:55556666", path: "mcp/c.ts" },
    ];
    assert.equal(applyGovernance(findings, policy).sandbag, true, "ignoring two of three is a sandbag");
  });
});

describe("the parser does not mis-read a legitimate file", () => {
  it("accepts a byte order mark", () => {
    const policy = parse("\uFEFFversion: 1\n");
    assert.equal(policy.version, 1);
  });

  it("strips an inline comment from a value", () => {
    const policy = parse(
      'version: 1\nignorePaths:\n  - path: src/examples # generated\n    reason: "samples"\n',
    );
    assert.equal(policy.ignorePaths[0].path, "src/examples", "the comment must not join the value");
  });

  it("keeps a hash inside a quoted value", () => {
    const policy = parse('version: 1\naccepts:\n  - ruleId: "hygiene.no-ci"\n    reason: "ticket #42"\n');
    assert.equal(policy.accepts[0].reason, "ticket #42");
  });

  it("reads an empty list", () => {
    assert.deepEqual(parse("version: 1\naccepts: []\n").accepts, []);
  });

  it("refuses a file with a line it could not read, rather than dropping it in silence", () => {
    // The accepts block is indented one level too far, so it does not attach to
    // the top-level key. Dropping it silently would leave a person believing an
    // acceptance is in force that the parser never saw.
    refuse("version: 1\n  accepts:\n    - ruleId: \"hygiene.no-ci\"\n      reason: \"x\"\n", "line_unreadable");
  });
});

describe("an acceptance names one finding and hides nothing else", () => {
  it("suppresses only the named finding and keeps the rest", () => {
    const policy = parse(GOOD);
    const findings = [
      { ruleId: "code.eval-use", fingerprint: "code.eval-use:stage3.1:src/a.ts:0f3a91c2", path: "src/a.ts" },
      { ruleId: "secret.credential-pattern", fingerprint: "secret.credential-pattern:stage3.1:src/b.ts:11112222", path: "src/b.ts" },
      { ruleId: "hygiene.no-ci", fingerprint: "hygiene.no-ci:stage3.1:README:abc12345", path: "README" },
    ];
    const applied = applyGovernance(findings, policy);
    assert.equal(applied.suppressed.length, 2, "the named eval finding and the named rule are suppressed");
    assert.equal(applied.kept.length, 1, "the credential is untouched");
    assert.equal(applied.kept[0].ruleId, "secret.credential-pattern");
  });

  it("does not suppress with the same rule under a different path when a path is named", () => {
    const policy = parse(
      'version: 1\naccepts:\n  - ruleId: "code.weak-crypto"\n    path: "src/legacy/hash.ts"\n    reason: "checksum only"\n',
    );
    const applied = applyGovernance(
      [
        { ruleId: "code.weak-crypto", fingerprint: "a:stage3.1:src/legacy/hash.ts:11112222", path: "src/legacy/hash.ts" },
        { ruleId: "code.weak-crypto", fingerprint: "a:stage3.1:src/auth/session.ts:33334444", path: "src/auth/session.ts" },
      ],
      policy,
    );
    assert.equal(applied.suppressed.length, 1);
    assert.equal(applied.kept.length, 1);
    assert.equal(applied.kept[0].path, "src/auth/session.ts");
  });

  it("flags a file that would silence more than four fifths", () => {
    const policy = parse(
      'version: 1\naccepts:\n  - ruleId: "hygiene.no-ci"\n    reason: "by design"\n',
    );
    const findings = [
      { ruleId: "hygiene.no-ci", fingerprint: "a:stage3.1:x:11112222", path: "x" },
      { ruleId: "hygiene.no-ci", fingerprint: "b:stage3.1:y:33334444", path: "y" },
      { ruleId: "secret.credential-pattern", fingerprint: "c:stage3.1:z:55556666", path: "z" },
    ];
    // Two of three findings is over the half-per-accept limit, so it is flagged.
    assert.equal(applyGovernance(findings, policy).sandbag, true, "two of three is over the per-accept limit");
  });

  it("does not flag a reasonable file", () => {
    const policy = parse(GOOD);
    const findings = [
      { ruleId: "code.eval-use", fingerprint: "code.eval-use:stage3.1:src/a.ts:0f3a91c2", path: "src/a.ts" },
      { ruleId: "secret.credential-pattern", fingerprint: "secret.credential-pattern:stage3.1:src/b.ts:11112222", path: "src/b.ts" },
      { ruleId: "hygiene.no-ci", fingerprint: "hygiene.no-ci:stage3.1:README:abc12345", path: "README" },
      { ruleId: "code.weak-crypto", fingerprint: "code.weak-crypto:stage3.1:src/c.ts:55556666", path: "src/c.ts" },
      { ruleId: "code.cors-wildcard", fingerprint: "code.cors-wildcard:stage3.1:src/d.ts:77778888", path: "src/d.ts" },
    ];
    assert.equal(applyGovernance(findings, policy).sandbag, false, "two of five is not a sandbag");
  });
});
