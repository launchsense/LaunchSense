import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fingerprintFinding,
  redactedSnippet,
  sharedRedact,
} from "../shared/redaction.ts";
import { ANALYZER_VERSION } from "../shared/analyzers/version.ts";
import { scanSecrets } from "../shared/analyzers/secrets.ts";
import { parseManifests } from "../shared/analyzers/deps.ts";
import { analyzeLicenses } from "../shared/analyzers/licenses.ts";
import { buildFixPlan } from "../shared/reports/fixPlan.ts";
import { severityFor } from "../shared/policies/severity.ts";
import { buildMissions } from "../shared/reports/missions.ts";

// Synthetic canaries only. They are built by concatenation so these exact
// strings never appear as literals in source (avoids tripping secret
// scanners and push protection). None of them is a real credential.
const AWS_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE";
const GHP_EXAMPLE = "ghp_" + "abcdefghij1234567890";
const KEY_BEGIN = "-----BEGIN RSA PRIVATE " + "KEY-----";
const KEY_END = "-----END RSA PRIVATE " + "KEY-----";

const CANARIES = [
  AWS_EXAMPLE,
  GHP_EXAMPLE,
  "github_pat_" + "abcdefghij1234567890",
  `${KEY_BEGIN}\nMIIB\n${KEY_END}`,
  'api_key = "super-secret-value"',
  "password: hunter2hunter",
];

describe("sharedRedact", () => {
  it("masks every planted secret and keeps no raw substring", () => {
    for (const secret of CANARIES) {
      const out = sharedRedact(`prefix ${secret} suffix`);
      assert.ok(out.includes("[REDACTED]"), secret);
    }
    assert.ok(!sharedRedact(AWS_EXAMPLE).includes(AWS_EXAMPLE));
    assert.ok(!sharedRedact(GHP_EXAMPLE).includes(GHP_EXAMPLE));
    assert.ok(!sharedRedact('api_key = "super-secret-value"').includes("super-secret-value"));
    assert.ok(!sharedRedact("password: hunter2hunter").includes("hunter2hunter"));
    const keyBlock = sharedRedact(`${KEY_BEGIN}\nMIIB\n${KEY_END}`);
    assert.ok(!keyBlock.includes("MIIB"));
  });

  it("redactedSnippet caps length after redaction", () => {
    const out = redactedSnippet(`token ${GHP_EXAMPLE} ${"x".repeat(500)}`, 200);
    assert.ok(out.length <= 201);
    assert.ok(!out.includes(GHP_EXAMPLE));
  });
});

describe("fingerprintFinding", () => {
  it("is stable across line shifts and never contains raw values", () => {
    const a = fingerprintFinding("secret.aws-key", ANALYZER_VERSION, "src/a.ts", "[REDACTED]");
    const b = fingerprintFinding("secret.aws-key", ANALYZER_VERSION, "src/a.ts", "[REDACTED]");
    assert.equal(a, b);
    const c = fingerprintFinding("secret.aws-key", ANALYZER_VERSION, "src/a.ts", "other hint");
    assert.notEqual(a, c);
    assert.ok(!a.includes("AKIA"));
  });
});

describe("scanSecrets", () => {
  it("flags tracked env files but not .env.example, and maps client paths", () => {
    const matches = scanSecrets([
      { path: ".env", content: "KEY=1" },
      { path: ".env.example", content: "KEY=" },
      { path: "public/app.js", content: `const k = "${AWS_EXAMPLE}";` },
      { path: "src/a.ts", content: "eval(userInput)\ndebugger;\nconsole.log(x)" },
    ]);
    const rules = matches.map((m) => `${m.ruleId}:${m.path}`);
    assert.ok(rules.includes("secret.tracked-env:.env"));
    assert.ok(!rules.some((r) => r.endsWith(".env.example")));
    assert.ok(rules.includes("secret.client-exposure:public/app.js"));
    assert.ok(rules.includes("secret.eval-use:src/a.ts"));
    assert.ok(rules.includes("secret.debugger-statement:src/a.ts"));
    assert.ok(rules.includes("secret.debug-leftover:src/a.ts"));
  });

  it("reports console noise once per file, not once per line", () => {
    const noisy = Array.from({ length: 40 }, (_, i) => `console.log(${i});`).join("\n");
    const matches = scanSecrets([{ path: "src/noisy.ts", content: noisy }]);
    assert.equal(matches.filter((m) => m.ruleId === "secret.debug-leftover").length, 1);
    const twoFiles = scanSecrets([
      { path: "src/a.ts", content: "console.log(1)" },
      { path: "src/b.ts", content: "console.log(2)" },
    ]);
    assert.equal(twoFiles.filter((m) => m.ruleId === "secret.debug-leftover").length, 2);
  });

  it("keeps a debugger statement separate from console noise", () => {
    const matches = scanSecrets([
      { path: "src/a.ts", content: "debugger;\nconsole.log(1);" },
    ]);
    const byRule = new Map(matches.map((m) => [m.ruleId, m.line]));
    assert.equal(byRule.get("secret.debugger-statement"), 1);
    assert.equal(byRule.get("secret.debug-leftover"), 2);
    assert.equal(severityFor("secret.debugger-statement"), "medium");
    assert.equal(severityFor("secret.debug-leftover"), "low");
  });
});

describe("judge-ready gate", () => {
  const base = {
    scanRan: true,
    analyzed: true,
    hasReadme: true,
    hasTests: true,
    rescanRan: true,
    passportIssued: true,
    shareCreated: true,
    shareViewed: true,
    liveOk: true,
  };

  it("lets a repo with console noise but no high findings reach judge-ready", () => {
    const result = buildMissions({ ...base, highSecrets: 0, highOpen: 0 });
    assert.equal(result.missions.find((m) => m.id === "judge-ready")?.done, true);
    assert.equal(result.progress.done, result.progress.total);
  });

  it("still blocks on a single high finding", () => {
    const result = buildMissions({ ...base, highSecrets: 1, highOpen: 1 });
    assert.equal(result.missions.find((m) => m.id === "judge-ready")?.done, false);
  });
});

describe("parseManifests", () => {
  it("detects unpinned versions, duplicates, and install scripts", () => {
    const pkg = JSON.stringify({
      dependencies: { leftpad: "^1.0.0", pinned: "1.2.3" },
      devDependencies: { leftpad: "2.0.0" },
      scripts: { postinstall: "node setup.js" },
    });
    const result = parseManifests([{ path: "package.json", content: pkg }]);
    assert.ok(result.deps.some((d) => d.name === "leftpad" && !d.pinned));
    assert.ok(result.deps.some((d) => d.name === "pinned" && d.pinned));
    assert.ok(result.duplicates.some((d) => d.startsWith("leftpad")));
    assert.ok(result.installScripts.some((s) => s.script === "postinstall"));
  });
});

describe("analyzeLicenses", () => {
  it("maps MIT to Allowed and missing to Unknown", () => {
    const mit = analyzeLicenses(
      ["LICENSE", "package.json"],
      [
        { path: "LICENSE", content: "MIT License\nPermission is hereby granted" },
        { path: "package.json", content: JSON.stringify({ license: "MIT" }) },
      ],
      true,
    );
    assert.equal(mit.policy, "Allowed");
    const missing = analyzeLicenses(["src/a.ts"], [{ path: "src/a.ts", content: "x" }], true);
    assert.equal(missing.policy, "Unknown");
    const unchecked = analyzeLicenses([], [], false);
    assert.equal(unchecked.policy, "Not checked");
  });
});

describe("buildFixPlan", () => {
  it("covers every finding exactly once", () => {
    const findings = [
      { ruleId: "secret.tracked-env", path: ".env", severity: "high", title: "t" },
      { ruleId: "hygiene.no-readme", path: "(repo)", severity: "info", title: "t" },
    ];
    const plan = buildFixPlan(findings);
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0]?.ruleId, "secret.tracked-env");
    assert.equal(plan.notActionable.length, 1);
  });
});
