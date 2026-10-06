import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchCodePattern } from "../shared/analyzers/codePatterns.ts";
import { generatedMarkers } from "../shared/review/extraChecks.ts";
import { analyzeLicenses } from "../shared/analyzers/licenses.ts";
import { buildLocalReport } from "../shared/review/buildReport.ts";
import { quoteForChoice, suggestionOptions } from "../shared/review/unknownQuote.ts";
import { inventoryNpmLock } from "../shared/review/lockfile.ts";
import { clashSignal } from "../shared/review/clash.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Run the local review over a throwaway tree. Offline is forced and the
// outbound base url is removed, so nothing leaves the machine.
function runReview(root) {
  const env = { ...process.env, LAUNCHSENSE_OFFLINE: "1" };
  delete env.LAUNCHSENSE_API_URL;
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(ROOT, "mcp", "review-entry.ts"), "--root", root, "--json"],
    { encoding: "utf8", cwd: ROOT, env },
  );
}

function withTree(files, body) {
  const root = mkdtempSync(join(tmpdir(), "ls-ws3-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the local file read is gated on the acknowledgement", () => {
  function runWithHome(root, home) {
    const env = { ...process.env, LAUNCHSENSE_OFFLINE: "1", HOME: home };
    delete env.LAUNCHSENSE_API_URL;
    return spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "mcp", "review-entry.ts"), "--root", root, "--json"],
      { encoding: "utf8", cwd: ROOT, env },
    );
  }

  function configHome(acknowledged, noticeVersion) {
    const home = mkdtempSync(join(tmpdir(), "ls-home-"));
    mkdirSync(join(home, ".config", "launchsense"), { recursive: true });
    const filesConsent =
      acknowledged === undefined
        ? ""
        : `,"filesConsent":{"acknowledged":${acknowledged},"noticeVersion":"${noticeVersion}"}`;
    writeFileSync(
      join(home, ".config", "launchsense", "config.json"),
      `{"tier":"alpha","agreed":false,"diagnostics":"off"${filesConsent}}`,
      "utf8",
    );
    return home;
  }

  it("does not read agent instruction files when nothing is acknowledged", () => {
    withTree({ "AGENTS.md": "# rules\n", "src/a.ts": "export const x = 1;\n" }, (root) => {
      const home = configHome(undefined, undefined);
      try {
        const out = runWithHome(root, home);
        const report = JSON.parse(out.stdout);
        const listed = JSON.stringify(report.notChecked ?? []);
        assert.match(listed, /AGENTS\.md/, "an unacknowledged agent file must be listed as not checked");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  it("reads agent instruction files when acknowledged for the current wording", () => {
    withTree({ "AGENTS.md": "# rules\n", "src/a.ts": "export const x = 1;\n" }, (root) => {
      const home = configHome(true, "2026-10-06");
      try {
        const out = runWithHome(root, home);
        const report = JSON.parse(out.stdout);
        const listed = JSON.stringify(report.notChecked ?? []);
        assert.doesNotMatch(listed, /Agent instruction file\. Not read/, "an acknowledged agent file is read");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });

  it("does not read agent files when the acknowledgement is for an older wording", () => {
    withTree({ "AGENTS.md": "# rules\n" }, (root) => {
      const home = configHome(true, "1999-01-01");
      try {
        const out = runWithHome(root, home);
        const report = JSON.parse(out.stdout);
        const listed = JSON.stringify(report.notChecked ?? []);
        assert.match(listed, /AGENTS\.md/, "a stale acknowledgement does not cover the new wording");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });
});

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
    // An MIT repo is Allowed, so it carries no licence finding. A clean
    // permissive licence must not appear as a medium row that needs review.
    assert.ok(
      !report.findings.some((item) => item.ruleId === "license.policy"),
      "an Allowed licence must not raise a license.policy finding",
    );
  });

  it("still raises license.policy when the licence needs review", () => {
    const report = buildLocalReport(
      [
        { path: "package.json", content: JSON.stringify({ name: "demo", license: "GPL-3.0-only" }) },
        { path: "LICENSE", content: "GNU GENERAL PUBLIC LICENSE\nVersion 3" },
        { path: "src/app.ts", content: "export const ready = true;\n" },
      ],
      [],
      null,
    );
    const row = report.findings.find((item) => item.ruleId === "license.policy");
    assert.ok(row, "a licence that needs review must still be raised");
    assert.notEqual(row.severity, "info", "a review-required licence is not an info note");
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

// WAVE 2 / WS-3. The walk skips a vendored tree, and a skipped tree that is
// not named in the report is a silent gap. The finding under the vendored
// directory must not be reported, and the skip must be disclosed.
describe("vendored tree skip", () => {
  const EVAL = "export const value = eval(\"2 + 2\");\n";

  it("does not report a finding under 3rdparty and discloses the skip", () => {
    withTree(
      {
        "package.json": JSON.stringify({ name: "demo", license: "MIT" }),
        README: "# demo\n",
        "3rdparty/lib/vendored.ts": EVAL,
        "src/app.ts": EVAL,
      },
      (root) => {
        const run = runReview(root);
        assert.equal(run.status, 0, run.stderr);
        const report = JSON.parse(run.stdout);
        const paths = report.findings.map((item) => item.path);
        assert.ok(
          !paths.some((path) => path.startsWith("3rdparty/")),
          `a finding under a skipped vendored tree was reported: ${JSON.stringify(paths)}`,
        );
        assert.ok(
          paths.includes("src/app.ts"),
          `the same line outside the vendored tree must still be reported: ${JSON.stringify(paths)}`,
        );
        const skip = report.notChecked.find((item) => item.scope === "3rdparty");
        assert.ok(skip !== undefined, `the 3rdparty skip was not disclosed: ${JSON.stringify(report.notChecked)}`);
        assert.match(skip.reason, /Vendored tree was not read/);
      },
    );
  });

  it("skips deps and vendor by the same rule and discloses each one", () => {
    withTree(
      {
        "package.json": JSON.stringify({ name: "demo", license: "MIT" }),
        README: "# demo\n",
        "deps/lib/a.ts": EVAL,
        "vendor/lib/b.ts": EVAL,
        "3rdparty/lib/c.ts": EVAL,
      },
      (root) => {
        const report = JSON.parse(runReview(root).stdout);
        for (const scope of ["deps", "vendor", "3rdparty"]) {
          assert.ok(
            report.notChecked.some((item) => item.scope === scope && /Vendored tree/.test(item.reason)),
            `${scope} must be skipped and disclosed as a vendored tree`,
          );
        }
        assert.equal(report.findings.some((item) => item.path.startsWith("deps/")), false);
        assert.equal(report.findings.some((item) => item.path.startsWith("vendor/")), false);
        assert.equal(report.findings.some((item) => item.path.startsWith("3rdparty/")), false);
      },
    );
  });
});

// WS-3. The named-host list is capped. A cap that is not named reads as a
// complete list, so the report has to say it.
describe("named host cap disclosure", () => {
  function hostFiles(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({ path: `src/h${i}.ts`, content: `export const url = "https://host${i}.example.com/x";\n` });
    }
    return out;
  }

  it("names the 10 per-run cap when more files name a host than are listed", () => {
    const report = buildLocalReport(
      [{ path: "package.json", content: JSON.stringify({ license: "MIT" }) }, { path: "README.md", content: "# demo\n" }, ...hostFiles(14)],
      [],
      null,
    );
    const listed = report.findings.filter((item) => item.ruleId === "code.network-hint");
    assert.equal(listed.length, 10);
    const cap = report.notChecked.find((item) => item.scope === "named hosts");
    assert.ok(cap !== undefined, `the cap was not disclosed: ${JSON.stringify(report.notChecked)}`);
    assert.match(cap.reason, /10/);
    assert.match(cap.reason, /not listed|more files/i);
  });

  it("says nothing about a cap when every naming file was listed", () => {
    const report = buildLocalReport(
      [{ path: "package.json", content: JSON.stringify({ license: "MIT" }) }, { path: "README.md", content: "# demo\n" }, ...hostFiles(3)],
      [],
      null,
    );
    assert.equal(report.findings.filter((item) => item.ruleId === "code.network-hint").length, 3);
    assert.equal(report.notChecked.some((item) => item.scope === "named hosts"), false);
  });
});

// WS-3. --json output goes into a shell pipeline and a file. Without the
// trailing newline the last line has no terminator.
describe("local review cli output", () => {
  it("ends the --json output with a newline", () => {
    withTree(
      { "package.json": JSON.stringify({ name: "demo", license: "MIT" }), README: "# demo\n" },
      (root) => {
        const run = runReview(root);
        assert.equal(run.status, 0, run.stderr);
        assert.ok(run.stdout.length > 0);
        assert.ok(
          run.stdout.endsWith("\n"),
          `the --json output must end with a newline; last bytes were ${JSON.stringify(run.stdout.slice(-4))}`,
        );
        assert.doesNotThrow(() => JSON.parse(run.stdout));
      },
    );
  });
});

// WS-3. The lockfile disclosure is npm-only today, so a repo with a Cargo.lock
// is told no lockfile was in hand. That is a false statement about the read.
describe("lockfile disclosure matches what was read", () => {
  const CARGO_LOCK = [
    "# This file is automatically @generated by Cargo.",
    '[[package]]',
    'name = "serde"',
    'version = "1.0.0"',
    "",
  ].join("\n");

  it("does not claim no lockfile was in hand when a Cargo.lock was read", () => {
    const report = buildLocalReport(
      [
        { path: "Cargo.toml", content: '[package]\nname = "demo"\n' },
        { path: "Cargo.lock", content: CARGO_LOCK },
        { path: "README.md", content: "# demo\n" },
      ],
      [],
      null,
      null,
      undefined,
    );
    const osv = report.notChecked.find((item) => item.scope === "OSV")?.reason ?? "";
    assert.doesNotMatch(osv, /No lockfile was in the files read/);
    assert.match(osv, /Cargo\.lock/);
    assert.match(report.lockNote, /Cargo\.lock/);
    assert.equal(report.status, "partial");
  });

  it("still says so plainly when no lockfile of any kind was read", () => {
    const report = buildLocalReport(
      [{ path: "README.md", content: "# demo\n" }],
      [],
      null,
      null,
      undefined,
    );
    const osv = report.notChecked.find((item) => item.scope === "OSV")?.reason ?? "";
    assert.match(osv, /No lockfile was in the files read/);
  });

  it("names a checked npm lockfile as npm, not as the only lockfile", () => {
    const lock = {
      path: "package-lock.json",
      content: JSON.stringify({ packages: { "": {}, "node_modules/leftpad": { version: "1.0.0" } } }),
    };
    const report = buildLocalReport(
      [{ path: "package.json", content: JSON.stringify({ license: "MIT" }) }, { path: "README.md", content: "# demo\n" }, lock],
      [],
      [],
      { hits: [], queried: 1, skipped: 0, timedOut: false },
      lock,
    );
    assert.match(report.lockNote, /Lockfile lists 1 packages/);
    assert.equal(
      report.notChecked.some((item) => item.scope === "OSV"),
      false,
      "a queried lockfile is not an open gap",
    );
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
