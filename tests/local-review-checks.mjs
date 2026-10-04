import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeLicenses } from "../shared/analyzers/licenses.ts";
import { buildLocalReport } from "../shared/review/buildReport.ts";
import { quoteForChoice, suggestionOptions } from "../shared/review/unknownQuote.ts";
import { inventoryNpmLock } from "../shared/review/lockfile.ts";
import { clashSignal } from "../shared/review/clash.ts";

describe("local review", () => {
  it("reads license text and does not call a missing lockfile complete", () => {
    const report = buildLocalReport(
      [
        { path: "package.json", content: JSON.stringify({ name: "demo", license: "MIT" }) },
        { path: "LICENSE", content: "MIT License\nPermission is hereby granted" },
        { path: "src/app.ts", content: "export const ready = true;\n" },
      ],
      [],
      null,
    );
    assert.equal(report.stage, "alpha");
    assert.equal(report.authRequired, false);
    assert.equal(report.status, "partial");
    assert.match(report.lockNote, /incomplete/);
    assert.ok(report.findings.some((item) => item.ruleId === "license.policy"));
  });
});

describe("unknown quote", () => {
  it("offers a next look and does not invent a license", () => {
    const options = suggestionOptions({
      findings: [{ ruleId: "license.policy", why: "No license signals in the files read. Signal, not legal advice." }],
      notChecked: [],
    });
    assert.ok(options !== null);
    assert.equal(quoteForChoice("look-spdx", options), options["look-spdx"]);
    assert.equal(quoteForChoice("made-up", options), null);
  });
});

describe("lockfile and clash", () => {
  it("splits direct and transitive packages", () => {
    const text = JSON.stringify({
      packages: {
        "": { version: "1.0.0" },
        "node_modules/leftpad": { version: "1.0.0" },
        "node_modules/leftpad/node_modules/nested": { version: "2.0.0" },
      },
    });
    const inventory = inventoryNpmLock(text, new Set(["leftpad"]));
    assert.equal(inventory.complete, true);
    const direct = inventory.packages.find((pkg) => pkg.name === "leftpad");
    const nested = inventory.packages.find((pkg) => pkg.name === "nested");
    assert.equal(direct?.depth, "direct");
    assert.equal(nested?.depth, "transitive");
  });

  it("lists a transitive advisory and the packages that were not queried", () => {
    const report = buildLocalReport(
      [
        { path: "package.json", content: JSON.stringify({ license: "MIT" }) },
        { path: "LICENSE", content: "MIT License\nPermission is hereby granted" },
        {
          path: "package-lock.json",
          content: JSON.stringify({ packages: { "": {}, "node_modules/leftpad": { version: "1.0.0" } } }),
        },
      ],
      [],
      [],
      {
        hits: [{
          name: "leftpad",
          version: "1.0.0",
          depth: "transitive",
          id: "GHSA-test",
          summary: "example",
          severity: "low",
        }],
        queried: 1,
        skipped: 4,
        timedOut: false,
      },
    );
    const hit = report.findings.find((item) => item.ruleId === "deps.vulnerability");
    assert.equal(hit?.severity, "low");
    assert.match(hit?.why ?? "", /not a statement that the app is exploitable/);
    assert.ok(report.notChecked.some((item) => item.scope === "OSV" && item.reason.includes("4")));
  });

  it("names a missing NOTICE and a package.json mismatch as two facts", () => {
    const result = analyzeLicenses(
      ["LICENSE", "package.json"],
      [
        { path: "LICENSE", content: "Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/" },
        { path: "package.json", content: JSON.stringify({ license: "MIT" }) },
      ],
      true,
    );
    assert.match(result.note, /No NOTICE file was in this read/);
    assert.match(result.note, /package.json says MIT/);
    assert.match(result.note, /Apache-2.0/);
    assert.match(result.note, /Signal, not legal advice/);
  });

  it("flags Apache-2.0 under GPL-2.0-only as a review signal", () => {
    const signal = clashSignal("GPL-2.0-only", "Apache-2.0");
    assert.match(signal ?? "", /Signal, not legal advice/);
  });
});
