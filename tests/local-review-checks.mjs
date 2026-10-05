import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchCodePattern } from "../shared/analyzers/codePatterns.ts";
import { generatedMarkers } from "../shared/review/extraChecks.ts";
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

describe("OSV honesty", () => {
  // A lockfile we read but did not query is a weaker claim than having no lockfile.
  // If these two ever read the same, the report overstates what was checked.
  it("says a lockfile was in hand and unchecked, not that there was nothing to check", () => {
    const lock = {
      path: "package-lock.json",
      content: JSON.stringify({ packages: { "": {}, "node_modules/leftpad": { version: "1.0.0" } } }),
    };
    const withLock = buildLocalReport(
      [{ path: "package.json", content: JSON.stringify({ license: "MIT" }) }, lock],
      [],
      null,
      null,
      lock,
    );
    const withoutLock = buildLocalReport(
      [{ path: "package.json", content: JSON.stringify({ license: "MIT" }) }],
      [],
      null,
      null,
      undefined,
    );
    const held = withLock.notChecked.find((item) => item.scope === "OSV")?.reason ?? "";
    const absent = withoutLock.notChecked.find((item) => item.scope === "OSV")?.reason ?? "";
    assert.match(held, /package-lock\.json was in the files read and its versions were not queried/);
    assert.match(absent, /No lockfile was in the files read/);
    assert.notEqual(held, absent);
  });

  it("keeps partial a partial: an unqueried lockfile never turns a scan complete", () => {
    const lock = {
      path: "package-lock.json",
      content: JSON.stringify({ packages: { "": {}, "node_modules/leftpad": { version: "1.0.0" } } }),
    };
    const report = buildLocalReport([lock], [], null, null, lock);
    assert.equal(report.status, "partial");
  });
});

describe("the local walk never enters the working notes folder", () => {
  const entry = readFileSync(new URL("../mcp/review-entry.ts", import.meta.url), "utf8");

  it("skips .progress by name in the skip set", () => {
    assert.match(entry, /const SKIP = new Set\(\[[\s\S]*"\.progress"/);
  });

  it("discloses the skip rather than hiding it", () => {
    assert.match(entry, /name === "\.progress"/);
    assert.match(entry, /Working notes folder\. Not read/);
  });

  it("does not name the private folders inside it", () => {
    // The skip reason describes the folder, never what is in it.
    assert.ok(!/StableSense|reserach-policy/.test(entry), "the entry must not name private folders");
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

  it("does not treat a mention or a Convex import as a live call", () => {
    assert.equal(matchCodePattern("Added innerHTML, child_process exec, weak crypto.")?.ruleId ?? null, null);
    assert.equal(matchCodePattern("import { api } from '../_generated/server';"), null);
    assert.equal(matchCodePattern('import { execSync } from "node:child_process"')?.ruleId, "code.child-process");
    assert.equal(matchCodePattern('crypto.createHash("md5")')?.ruleId, "code.weak-crypto");
    const large = `import { api } from "../_generated/api";\n${"x".repeat(20_000)}`;
    assert.equal(generatedMarkers([{ path: "convex/scans/analyze.ts", content: large }]).length, 0);
    const marked = `@generated\n${"x".repeat(20_000)}`;
    assert.equal(generatedMarkers([{ path: "out.ts", content: marked }]).length, 1);
  });

  it("flags Apache-2.0 under GPL-2.0-only as a review signal", () => {
    const signal = clashSignal("GPL-2.0-only", "Apache-2.0");
    assert.match(signal ?? "", /Signal, not legal advice/);
  });

  it("does not flag ordinary prose as a sql pattern", () => {
    assert.equal(matchCodePattern("Please select an option from the menu."), null);
    assert.equal(
      matchCodePattern('why: "The line matches SELECT ... FROM. That does not prove injection.",'),
      null,
    );
  });

  it("still flags uppercase sql with a table name", () => {
    assert.equal(
      matchCodePattern('const q = "SELECT id FROM users";')?.ruleId,
      "code.sql-pattern",
    );
  });

  it("flags a quoted or escaped table name, not only a bare identifier", () => {
    // A real query in a Grafana dashboard JSON is escaped: FROM \"table\". The
    // earlier rule required [A-Za-z_] straight after FROM and missed it (regression
    // found by corpus wave B9).
    assert.equal(matchCodePattern('SELECT a FROM "tbl"')?.ruleId, "code.sql-pattern");
    assert.equal(matchCodePattern('SELECT a FROM \\"tbl\\"')?.ruleId, "code.sql-pattern");
    assert.equal(matchCodePattern("SELECT a FROM `tbl`")?.ruleId, "code.sql-pattern");
    assert.equal(matchCodePattern("SELECT a FROM [tbl]")?.ruleId, "code.sql-pattern");
  });
});
