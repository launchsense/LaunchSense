import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LICENSE_RULE_IDS, licenseView } from "../shared/reports/licenseView.ts";

// The licence-only filter. It shows the licence rows of the same findings the
// full report holds and names how many it did not show. Pure function, no
// browser, no database.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

const declaration = {
  ruleId: "license.declaration",
  title: "Dependency licence declaration",
  why: "The committed lockfile declares 3 installed npm packages.",
  path: "package-lock.json",
  line: 0,
  severity: "info",
};
const component = {
  ruleId: "license.dependency",
  title: "leftpad@1.0.0 is MIT",
  why: "MIT: keep the copyright notice. Cited: LICENSE.",
  path: "package-lock.json",
  line: 0,
  severity: "low",
};
const secret = {
  ruleId: "secret.credential-pattern",
  title: "Hardcoded credential in source",
  why: "Passwords in source travel everywhere the code goes.",
  path: "src/a.ts",
  line: 4,
  severity: "high",
};

describe("the licence filter", () => {
  it("returns the declaration alone with nothing withheld", () => {
    const view = licenseView([declaration]);
    assert.equal(view.declaration?.ruleId, "license.declaration");
    assert.equal(view.withheldCount, 0);
    assert.equal(view.coverage, "licence_findings");
  });

  it("shows only licence rows and names the secrets count withheld", () => {
    const view = licenseView([secret, declaration, component]);
    assert.equal(view.components.length, 1);
    assert.equal(view.withheldCount, 1);
    assert.ok(!JSON.stringify(view.components).includes("secret.credential-pattern"));
  });

  it("never reports a negative withheld count", () => {
    assert.equal(licenseView([]).withheldCount, 0);
    assert.ok(licenseView([secret]).withheldCount >= 0);
  });

  it("keeps the cap-hit row and the unknown row verbatim", () => {
    const cap = {
      ruleId: "license.inventory",
      why: "dependency licence rows stop at 25; 3 more component(s) needing a decision are not named here",
    };
    const unknown = {
      ruleId: "license.inventory",
      why: "2 component(s) read as Unknown; unknown is not a permissive licence and gets no severity",
    };
    const view = licenseView([cap, unknown]);
    assert.deepEqual(view.inventoryLines, [cap.why, unknown.why]);
  });

  it("words an empty scan differently from a scan with no licence rows, and neither is a pass", () => {
    const empty = licenseView([]);
    const none = licenseView([secret]);
    assert.equal(empty.coverage, "empty");
    assert.equal(none.coverage, "no_licence_findings");
    assert.notEqual(empty.coverage, none.coverage);
  });
});

describe("the whitelist names only emitted rules", () => {
  it("every id is read from the lane that emits it", () => {
    const lane = read("shared", "licensing", "report.ts") + read("convex", "scans", "analyze.ts");
    for (const id of LICENSE_RULE_IDS) {
      assert.ok(lane.includes(`"${id}"`), `${id} is not emitted by the licence lane`);
    }
    assert.ok(!LICENSE_RULE_IDS.includes("license.signal"), "evidence-only rows must stay out");
  });
});
