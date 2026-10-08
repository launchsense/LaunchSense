import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression guards for W3, the sign-in contradiction, and the queue promise.
// Every rule below was written against a real string that existed in the app on
// 2026-10-03. Each fixture is a verbatim copy of that string, so a rule cannot
// pass by matching nothing.

const guardSource = readFileSync(new URL("../scripts/check-claims.mjs", import.meta.url), "utf8");

// Each entry: the regex that must exist in the guard, a string that existed and
// must still be caught, and the honest replacement that must pass.
// guardRules pulls every POSITIVE_CLAIMS regex literal out of the guard source,
// so these tests exercise the real guard behaviour rather than a copy of it. A
// test that duplicated the regexes would pass even if the guard were deleted.
function guardRules(source) {
  const block = source.slice(source.indexOf("const POSITIVE_CLAIMS"));
  const end = block.indexOf("\n];", block.indexOf("const POSITIVE_CLAIMS") === 0 ? 0 : 0);
  const section = end === -1 ? block : block.slice(0, end);
  const literals = section.match(/\{\s*phrase:\s*(\/(?:\\.|\[[^\]]*\]|[^/])+\/[a-z]*)\s*,/g) ?? [];
  return literals.map((entry) => {
    const literal = entry.match(/\/((?:\\.|\[[^\]]*\]|[^/])+)\/([a-z]*)/);
    return new RegExp(literal[1], literal[2] || "");
  });
}

const ALL_RULES = guardRules(guardSource);

const RULES = [
  {
    name: "deeper scan promise",
    catches: "Sign in with GitHub only when you want a deeper scan or saved history.",
    allows: "Signing in does not change your scan today.",
  },
  {
    name: "saved history promise",
    catches: "Sign in with GitHub only when you want a deeper scan or saved history.",
    allows: "Signing in does not change your scan today.",
  },
  {
    name: "queue place promise",
    catches: "Servers are busy. Your scan is saved and you can press Run scan again in a moment; you will not lose your place.",
    allows: "Servers are busy. Your scan did not run. Please wait a moment and press Run scan to join the queue again.",
  },
];

describe("sign-in copy never promises unbuilt capability", () => {
  it("guards against connected-scan promises that were proven to have zero callers", () => {
    const appTs = readFileSync(new URL("../convex/github/app.ts", import.meta.url), "utf8");
    const projectsTs = readFileSync(new URL("../convex/projects.ts", import.meta.url), "utf8");
    const entitlementsTs = readFileSync(new URL("../convex/entitlements.ts", import.meta.url), "utf8");

    // These three exist only as definitions. If one ever gains a real caller,
    // the copy can honestly change and this test should fail to remind us.
    const sourceFiles = [
      "src/features/scan/GuestScan.tsx",
      "src/features/report/ScanReport.tsx",
      "src/features/report/CapacityMeter.tsx",
      "src/features/report/SignalPanels.tsx",
      "src/features/report/Stage5Panels.tsx",
      "src/features/report/CompareView.tsx",
      "src/features/auth/AuthPanel.tsx",
      "src/features/auth/TopMenu.tsx",
      "src/pages/Home.tsx",
      "src/pages/SharePage.tsx",
      "src/pages/PassportPage.tsx",
    ];
    const ui = sourceFiles.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");

    for (const symbol of ["getInstallationToken", "listForUser", "getMyEntitlements"]) {
      assert.ok(
        !ui.includes(symbol),
        `${symbol} is now referenced from the UI, so it may have a real caller. Re-check whether the sign-in copy should now sell it.`,
      );
    }

    // Guard against a silent regression of the definitions themselves.
    assert.ok(appTs.includes("getInstallationToken"));
    assert.ok(projectsTs.includes("listForUser"));
    assert.ok(entitlementsTs.includes("getMyEntitlements"));
  });

  it("does not tell signed-in users they get a paid step that does not exist", () => {
    const authPanel = readFileSync(new URL("../src/features/auth/AuthPanel.tsx", import.meta.url), "utf8");
    assert.equal(
      /paid\s+step/i.test(authPanel),
      false,
      "no billing, price, or paywall exists, so 'paid step' is a false promise",
    );
    assert.equal(
      /is\s+being\s+built/i.test(authPanel),
      false,
      "the old copy said the connected scan 'is being built' directly under a home page promising it already",
    );
  });

  it("sign-in is archived and sells no install", () => {
    const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");
    const how = readFileSync(new URL("../src/pages/How.tsx", import.meta.url), "utf8");
    const topMenu = readFileSync(new URL("../src/features/auth/TopMenu.tsx", import.meta.url), "utf8");
    const siteFrame = readFileSync(new URL("../src/features/site/SiteFrame.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(home, /Sign in is optional/);
    assert.doesNotMatch(home, /<GuestScan/);
    assert.doesNotMatch(how, /SIGN_IN_POLICY/);
    assert.doesNotMatch(how, /Sign in with GitHub/);
    assert.doesNotMatch(topMenu, /isAuthenticated|useConvexAuth|signOut/);
    assert.doesNotMatch(siteFrame, /ConsentRecorder/);
    assert.doesNotMatch(app, /<SharePage|<PassportPage|<LicencePage/);
    assert.match(app, /<Archived \/>/);
  });

  it("uses no em dashes in the sign-in surface", () => {
    for (const f of ["src/pages/Home.tsx", "src/features/auth/AuthPanel.tsx", "src/features/auth/TopMenu.tsx"]) {
      const source = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      assert.equal(/[\u2014\u2013]/.test(source), false, `${f} contains an em or en dash`);
    }
  });
});

describe("claim guard rules for W3 exist and are proven", () => {
  it("the guard still defines its positive claim rules", () => {
    assert.ok(ALL_RULES.length >= 8, `expected the original 8 rules plus the new ones, found ${ALL_RULES.length}`);
  });

  for (const rule of RULES) {
    it(`guard catches the old string: ${rule.name}`, () => {
      // Proves the rule is not theoretical. The fixture is verbatim from the app.
      const hit = ALL_RULES.some((r) => r.test(rule.catches));
      assert.ok(hit, `no guard rule matches the real string it was written for: ${rule.catches}`);
    });

    it(`guard allows the honest replacement: ${rule.name}`, () => {
      const hit = ALL_RULES.some((r) => r.test(rule.allows));
      assert.equal(hit, false, `the honest replacement is blocked by the guard: ${rule.allows}`);
    });
  }

  it("does not block the word safe when it is about code, not the product", () => {
    // "Replace eval with a safe alternative" is a code recommendation, not a
    // product safety claim. A bare /safe/i rule would force a wrong fix.
    const rules = guardSource.match(/\{ phrase: \/[^\n]+/g) ?? [];
    const safeRules = rules.filter((r) => /safe/i.test(r));
    for (const rule of safeRules) {
      assert.ok(
        !/\/\s*safe\s*\\\\b\/i/.test(rule) && !/\/\\\\bsafe\\\\b\/i/.test(rule),
        "a bare safe rule would false-fire on code advice about eval",
      );
    }
  });
});