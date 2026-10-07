import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorklist, maskLine, readRow, isForbidden, setForbidden } from "../scripts/grade-findings.mjs";

// The grading pass judges the scanner's own output, so the harness that feeds it
// has to fail loudly on the three ways this work goes wrong quietly: a row that
// cannot be read treated as a row that was read, a row dropped from the totals,
// and a secret value carried into a file or a subagent prompt.

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), "grade-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

test("a real line is read back with its context", () => {
  const dir = scratch({ "src/app.ts": ["const a = 1;", 'const secret = "f9K2mQp7Zx4Lw8R";', "export default a;"].join("\n") });
  const row = readRow(dir, "src/app.ts", 2, 1);
  assert.equal(row.status, "ok");
  assert.deepEqual(row.before, ["const a = 1;"]);
  assert.deepEqual(row.after, ["export default a;"]);
  assert.match(row.text, /^const secret = /);
});

test("a secret-shaped literal is masked but its shape survives", () => {
  const dir = scratch({ "c.py": 'API_KEY = "f9K2mQp7Zx4Lw8Rt3"' });
  const row = readRow(dir, "c.py", 1, 0);
  assert.equal(row.status, "ok");
  assert.ok(!row.text.includes("f9K2mQp7Zx4Lw8Rt3"), "the value must not survive into the worklist");
  assert.match(row.text, /API_KEY/, "the identifier is what a grader needs");
  assert.match(row.text, /len=17/, "the length is part of the shape");
});

test("a placeholder word stays readable, because it is the verdict", () => {
  const masked = maskLine('const k = "change-me";');
  assert.match(masked, /change-me/, "a word-shaped literal is not a secret");
});

test("evidence that is quoted but not secret stays readable", () => {
  // Regression. An earlier version masked every quoted run of 13 or more
  // characters. Grading that copy turned 100 network-hint rows, 47 sql-pattern
  // rows and every child_process import into FALSE verdicts, because the text
  // the anchor check needed had been removed. A URL, a query and a module name
  // are quoted, long, and none of them are credentials.
  const url = 'source = "https://github.com/spf13/cobra/issues/new";';
  assert.ok(!/<str /.test(maskLine(url)), "a source URL is evidence, keep it");
  const sql = 'cursor.execute("SELECT id FROM users WHERE name = %s", (name,))';
  assert.ok(!/<str /.test(maskLine(sql)), "a query string is evidence, keep it");
  const mod = 'import { exec } from "child_process";';
  assert.ok(!/<str /.test(maskLine(mod)), "a module name is evidence, keep it");
  const header = '"Access-Control-Allow-Origin": "*",';
  assert.ok(!/<str /.test(maskLine(header)), "a header name is evidence, keep it");
});

test("a key-shaped literal is still masked when the line names a secret", () => {
  // The counter-case. A random key is shaped like an identifier, so a rule that
  // exempts identifiers would wave this through.
  const line = 'const apiKey = "f9K2mQp7Zx4Lw8Rt3";';
  assert.ok(!maskLine(line).includes("f9K2mQp7Zx4Lw8Rt3"), "must be masked");
  // High entropy with no secret name on the line is still masked.
  const bare = 'const v = "f9K2mQp7Zx4Lw8Rt3vB6yH";';
  assert.ok(!maskLine(bare).includes("f9K2mQp7Zx4Lw8Rt3vB6yH"), "entropy is enough on its own");
});

test("an unreadable row is reported as unreadable, never as a pass", () => {
  const dir = scratch({ "here.py": "a = 1\nb = 2\n" });
  assert.equal(readRow(dir, "gone.py", 1, 0).status, "file-missing");
  // Past the end of file is its own status. Treating it as an empty line would
  // let a stale line number grade as if the line had been read.
  assert.equal(readRow(dir, "here.py", 99, 0).status, "line-out-of-range");
});

test("the license placeholder path is named, not opened", () => {
  // license.policy emits "(repo)" line 1 for a repository level signal. There is
  // no file, so a grader must see that rather than a blank.
  assert.equal(readRow(".", "(repo)", 1, 0).status, "placeholder-path");
});

test("another project's folders are refused when the caller names them", () => {
  // The prefixes are the caller's, so the harness itself carries no project
  // name. A caller passes its own private folders as prefixes.
  setForbidden([".progress/private-one", "secrets/"]);
  assert.ok(isForbidden(".progress/private-one/notes.md"));
  assert.ok(isForbidden("secrets/keys.json"));
  assert.equal(readRow(".", "secrets/keys.json", 1, 0).status, "forbidden-path");
  assert.ok(!isForbidden("convex/auth.ts"));
  // The default guard is about reading source, not about one project: a read
  // under version control or an installed tree is refused with no settings.
  setForbidden([]);
  assert.ok(isForbidden(".git/config"));
  assert.ok(isForbidden("node_modules/left-pad/index.js"));
  assert.ok(!isForbidden("src/app.ts"));
});

test("every row in gets exactly one slot out, so the totals reconcile", () => {
  const repo = scratch({
    "a.py": "x = 1\n",
    "b.py": "y = 2\n",
  });
  const ev = mkdtempSync(join(tmpdir(), "grade-ev-"));
  // Three non-leak rows and one leak row. One of the three cannot be resolved.
  const scan = {
    findings: [
      { ruleId: "code.network-hint", path: "a.py", line: 1, severity: "info", title: "t", why: "w" },
      { ruleId: "code.network-hint", path: "b.py", line: 1, severity: "info", title: "t", why: "w" },
      { ruleId: "code.network-hint", path: "missing.py", line: 1, severity: "info", title: "t", why: "w" },
      { ruleId: "secret.credential-pattern", path: "a.py", line: 1, severity: "high", title: "t", why: "w" },
    ],
  };
  writeFileSync(join(ev, "s1.json"), JSON.stringify(scan));
  const wl = buildWorklist({ evidenceDir: ev, map: { s1: ["owner/repo", "abc1234"] }, reposDir: "/nonexistent", localDirs: { s1: repo } });

  assert.equal(wl.totals.nonLeakRows, 3, "the leak row is excluded from the grading set");
  assert.equal(wl.totals.leakRows, 1, "the leak row is still counted, never dropped");
  assert.equal(wl.rows.length, 3, "one slot per row, including the unreadable one");
  assert.equal(wl.totals.byStatus.ok, 2);
  assert.equal(wl.totals.byStatus["file-missing"], 1);
  const sum = Object.values(wl.totals.byFamily).reduce((a, b) => a + b, 0);
  assert.equal(sum, wl.totals.nonLeakRows, "family counts must add up to the row total");
});

test("a scan saved twice is counted once and the duplicate is named", () => {
  const repo = scratch({ "a.py": "x = 1\n" });
  const ev = mkdtempSync(join(tmpdir(), "grade-ev2-"));
  const scan = {
    findings: [{ ruleId: "code.network-hint", path: "a.py", line: 1, severity: "info", title: "t", why: "w" }],
  };
  writeFileSync(join(ev, "one.json"), JSON.stringify(scan));
  writeFileSync(join(ev, "two.json"), JSON.stringify(scan));
  const wl = buildWorklist({ evidenceDir: ev, map: {}, reposDir: "/nonexistent", localDirs: { one: repo, two: repo } });
  assert.equal(wl.totals.evidenceFiles, 2);
  assert.equal(wl.totals.distinctScans, 1, "the same scan saved twice is one scan");
  assert.equal(wl.totals.duplicateScans, 1);
  assert.deepEqual(wl.duplicates, [["one", "two"]]);
});

test("a duplicate is graded through the copy that has a checkout", () => {
  // The real corpus keeps golden-air.json as a copy of the w3-air.json scan, and
  // "golden-air" sorts first. Keeping the first name kept the copy with no
  // checkout entry and turned 37 readable rows into no-checkout. The survivor
  // has to be the one that can be opened.
  const repo = scratch({ "w3-air/a.py": "x = 1\n" });
  const ev = mkdtempSync(join(tmpdir(), "grade-ev2b-"));
  const scan = {
    findings: [{ ruleId: "code.network-hint", path: "a.py", line: 1, severity: "info", title: "t", why: "w" }],
  };
  writeFileSync(join(ev, "golden-air.json"), JSON.stringify(scan));
  writeFileSync(join(ev, "w3-air.json"), JSON.stringify(scan));
  const map = { "w3-air": ["air-verse/air", "71ea1de"] };
  // golden-air has no map entry, so it resolves to nothing. w3-air resolves to a
  // real directory. The survivor must be w3-air even though it sorts second.
  const wl = buildWorklist({ evidenceDir: ev, map, reposDir: repo, localDirs: {} });
  assert.equal(wl.rows.length, 1);
  assert.equal(wl.rows[0].scan, "w3-air", "the readable copy is the one that survives");
  assert.equal(wl.rows[0].status, "ok", "so the row is graded, not written off");
  assert.equal(wl.totals.distinctScans, 1);
  assert.deepEqual(wl.duplicates, [["w3-air", "golden-air"]]);
});

test("a clone named in the map but absent on disk is not the repo's fault", () => {
  // The wave sheets name a repo that has since 404d. Reporting its rows as
  // file-missing would read as "the scanner pointed at a file that was never
  // there", when the truth is "this machine has no checkout to read".
  const ev = mkdtempSync(join(tmpdir(), "grade-ev2c-"));
  writeFileSync(
    join(ev, "gone.json"),
    JSON.stringify({ findings: [{ ruleId: "code.network-hint", path: "a.py", line: 1, severity: "info", title: "t", why: "w" }] }),
  );
  const wl = buildWorklist({ evidenceDir: ev, map: { gone: ["owner/gone", "abc1234"] }, reposDir: "/nonexistent-dir" });
  assert.equal(wl.rows[0].status, "no-checkout");
  assert.equal(wl.totals.byStatus["file-missing"], undefined, "an absent clone is not a missing file");
});

test("an empty clone directory is not a checkout", () => {
  // A fetch that failed leaves the directory behind, present and empty. Reading
  // it would report every row in that repo as file-missing, which blames the
  // repo for this machine's network.
  const root = mkdtempSync(join(tmpdir(), "grade-empty-"));
  mkdirSync(join(root, "ghost")); // created, never fetched
  const ev = mkdtempSync(join(tmpdir(), "grade-ev2d-"));
  writeFileSync(
    join(ev, "ghost.json"),
    JSON.stringify({ findings: [{ ruleId: "code.network-hint", path: "a.py", line: 1, severity: "info", title: "t", why: "w" }] }),
  );
  const wl = buildWorklist({ evidenceDir: ev, map: { ghost: ["owner/ghost", "abc1234"] }, reposDir: root });
  assert.equal(wl.rows[0].status, "no-checkout");
  assert.equal(wl.totals.byStatus["file-missing"], undefined);
});

test("a scan with no checkout on this machine is marked, not guessed", () => {
  const ev = mkdtempSync(join(tmpdir(), "grade-ev3-"));
  writeFileSync(
    join(ev, "s.json"),
    JSON.stringify({ findings: [{ ruleId: "code.eval-use", path: "a.py", line: 1, severity: "high", title: "t", why: "w" }] }),
  );
  const wl = buildWorklist({ evidenceDir: ev, map: {}, reposDir: "/nonexistent" });
  assert.equal(wl.rows[0].status, "no-checkout");
  assert.equal(wl.rows[0].text, "", "no line is invented for a repo that is not here");
});