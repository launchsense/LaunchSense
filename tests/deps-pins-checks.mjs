import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseManifests } from "../shared/analyzers/deps.ts";
import { buildLocalReport } from "../shared/review/buildReport.ts";

const PKG = JSON.stringify({ dependencies: { leftpad: "^1.0.0" } });
const LOCK = JSON.stringify({
  packages: {
    "": { dependencies: { leftpad: "^1.0.0" } },
    "node_modules/leftpad": { version: "1.3.0" },
  },
});

describe("parseManifests parses every package.json before any lockfile", () => {
  // U15. parsePackageLock only rewrites deps already in the list, so a lockfile
  // parsed first is ignored. The result must not depend on caller order.
  it("gives the same pinned set with the lockfile first or last", () => {
    const manifestFirst = parseManifests([
      { path: "package.json", content: PKG },
      { path: "package-lock.json", content: LOCK },
    ]);
    const lockFirst = parseManifests([
      { path: "package-lock.json", content: LOCK },
      { path: "package.json", content: PKG },
    ]);
    const a = manifestFirst.deps.find((d) => d.name === "leftpad");
    const b = lockFirst.deps.find((d) => d.name === "leftpad");
    assert.equal(a?.version, "1.3.0");
    assert.equal(a?.pinned, true);
    assert.deepEqual(b, a, "lockfile-first must resolve to the installed version too");
  });
});

describe("isPinnedNpm understands alias and workspace specifiers", () => {
  const pinned = (spec) => {
    const result = parseManifests([
      { path: "package.json", content: JSON.stringify({ dependencies: { pkg: spec } }) },
    ]);
    return result.deps.find((d) => d.name === "pkg")?.pinned;
  };

  // U16. `npm:<pkg>@<version>` is a pin only when the inner version is exact.
  it("treats an exact alias specifier as pinned", () => {
    assert.equal(pinned("npm:bar@1.2.3"), true);
    assert.equal(pinned("npm:@scope/bar@2.0.0"), true);
  });

  it("treats a ranged alias specifier as floating", () => {
    assert.equal(pinned("npm:bar@^1.2.3"), false);
    assert.equal(pinned("npm:typescript@^7.0.2"), false);
  });

  it("treats workspace refs by their inner version", () => {
    assert.equal(pinned("workspace:1.2.3"), true);
    assert.equal(pinned("workspace:^1.2.3"), false);
    assert.equal(pinned("workspace:*"), false);
  });
});

describe("local review uses plain titles for secret.* rules", () => {
  const clientSecret = "const clientKey = \"sk_live_" + "abcdefghij1234567890\";";

  // U17. buildLocalReport fell back to match.ruleId when TEXT[ruleId] was missing,
  // and TEXT held only code.* ids, so secret.* showed as a raw id in the local review.
  it("shows the plain title for a client-path secret, not the raw rule id", () => {
    const report = buildLocalReport(
      [{ path: "public/app.js", content: `${clientSecret}\n` }],
      [],
      null,
    );
    const hit = report.findings.find((item) => item.ruleId === "secret.client-exposure");
    assert.ok(hit, "the client-path secret must be flagged");
    assert.equal(hit.title, "Secret shipped in a public file");
    assert.notEqual(hit.title, hit.ruleId);
  });

  it("has a plain title for every secret.* rule the analyzer can emit", () => {
    const cases = [
      { path: ".env", content: "API_KEY=\"aB3dEfGh1Jk2LmNo4\"" },
      { path: "src/key.pem.ts", content: "-----BEGIN RSA PRIVATE " + "KEY-----\nMIIB\n" },
      { path: "src/tok.ts", content: "const t = \"ghp_" + "abcdefghij1234567890\";" },
      { path: "src/aws.ts", content: "const k = \"AKIA" + "IOSFODNN7EXAMPLE\";" },
      { path: "src/cred.ts", content: "const dbPassword = \"zQ7xW2mV9pL4nR8t\";" },
      { path: "public/app.js", content: `${clientSecret}\n` },
    ];
    const report = buildLocalReport(cases, [], null);
    const secretFindings = report.findings.filter((item) => item.ruleId.startsWith("secret."));
    const rules = new Set(secretFindings.map((item) => item.ruleId));
    assert.ok(rules.has("secret.tracked-env"));
    assert.ok(rules.has("secret.private-key"));
    assert.ok(rules.has("secret.github-token"));
    assert.ok(rules.has("secret.aws-key"));
    assert.ok(rules.has("secret.credential-pattern"));
    assert.ok(rules.has("secret.client-exposure"));
    for (const item of secretFindings) {
      assert.notEqual(item.title, item.ruleId, `${item.ruleId} must have a plain title`);
    }
  });
});
