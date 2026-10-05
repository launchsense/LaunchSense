import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// W3-HARNESS. The corpus counts must come from the archived JSON, and the diff must
// catch a planted change. Everything here runs offline against temp fixtures: two fake
// repos, no clones, no network.

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, "scripts", "corpus-regression.mjs");

function finding(ruleId, severity) {
  return { ruleId, severity, path: "src/x.ts", line: 1 };
}

// A minimal scan JSON: the harness reads findings only, so this is deliberately small.
function scan(findings) {
  return JSON.stringify({ stage: "alpha", status: "partial", filesRead: 3, findings });
}

function withCorpus(body) {
  const root = mkdtempSync(join(tmpdir(), "ls-corpus-"));
  try {
    const dir = join(root, "corpus");
    mkdirSync(join(dir, "wave-01"), { recursive: true });
    mkdirSync(join(dir, "wave-02"), { recursive: true });
    writeFileSync(
      join(dir, "wave-01", "alpha-repo.json"),
      scan([finding("code.eval-use", "high"), finding("code.eval-use", "high"), finding("code.dead-copy", "info")]),
    );
    writeFileSync(join(dir, "wave-02", "beta-repo.json"), scan([finding("secret.credential-pattern", "high")]));
    // Comparison artefacts the harness must ignore, so a planted drop in one of these
    // cannot look like a corpus regression.
    writeFileSync(join(dir, "wave-02", "beta-repo.preA.json"), scan([]));
    writeFileSync(join(dir, "wave-02", "beta-repo.pre-fix.json"), scan([]));
    writeFileSync(join(dir, "wave-02", "gamma-repo.baseline-53c5c5c.json"), scan([]));
    writeFileSync(join(dir, "wave-02", "baseline-1a0e40e.aggregate.json"), "{}");
    writeFileSync(join(dir, "wave-01", "beta-repo.clone.txt"), "sha\n");
    return body({ root, dir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function run(dir, args) {
  const result = spawnSync(process.execPath, [SCRIPT, "--dir", dir, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function writeLabels(dir, moves) {
  const path = join(dir, "expected-moves.json");
  writeFileSync(path, `${JSON.stringify({ note: "test fixture", moves }, null, 2)}\n`, "utf8");
  return path;
}

describe("corpus regression harness", () => {
  it("writes a counts-only baseline and skips comparison artefacts", () => {
    withCorpus(({ root, dir }) => {
      const out = join(root, "baseline.json");
      const result = run(dir, ["--write", out]);
      assert.equal(result.status, 0, result.output);
      const raw = readFileSync(out, "utf8");
      const baseline = JSON.parse(raw);
      assert.deepEqual(Object.keys(baseline.repos).sort(), ["alpha-repo", "beta-repo"]);
      assert.equal(baseline.repos["alpha-repo"].total, 3);
      assert.equal(baseline.repos["alpha-repo"].byRule["code.eval-use"], 2);
      assert.equal(baseline.repos["alpha-repo"].bySeverity.info, 1);
      assert.equal(baseline.repos["beta-repo"].total, 1);
      assert.equal(baseline.repoCount, 2);
      assert.equal(baseline.findingCount, 4);
      assert.equal(baseline.ruleCount, 3);
      // No path, line, snippet or value anywhere in a file kept in the tree.
      assert.ok(!/"path"|"line"|"why"|"fingerprint"/.test(raw));
    });
  });

  it("passes an unchanged corpus", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      const result = run(dir, ["--compare", out]);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /no unnamed moves/);
    });
  });

  it("catches a planted count change and exits non-zero", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      // One code.eval-use finding disappears from alpha-repo.
      writeFileSync(
        join(dir, "wave-01", "alpha-repo.json"),
        scan([finding("code.eval-use", "high"), finding("code.dead-copy", "info")]),
      );
      const result = run(dir, ["--compare", out]);
      assert.notEqual(result.status, 0, "a planted change must exit non-zero");
      assert.match(result.output, /REGRESSION alpha-repo code\.eval-use 2 -> 1 \(-1\)/);
    });
  });

  it("catches a planted new rule on an existing repo", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      writeFileSync(
        join(dir, "wave-02", "beta-repo.json"),
        scan([finding("secret.credential-pattern", "high"), finding("code.sql-pattern", "low")]),
      );
      const result = run(dir, ["--compare", out]);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /REGRESSION beta-repo code\.sql-pattern 0 -> 1 \(\+1\)/);
    });
  });

  it("ignores a changed pre-fix comparison file", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      writeFileSync(join(dir, "wave-02", "beta-repo.pre-fix.json"), scan([finding("code.eval-use", "high")]));
      writeFileSync(join(dir, "wave-02", "gamma-repo.baseline-53c5c5c.json"), scan([finding("code.eval-use", "high")]));
      writeFileSync(join(dir, "wave-01", "beta-repo.clone.txt"), "different\n");
      assert.equal(run(dir, ["--compare", out]).status, 0);
    });
  });

  it("accepts a named move in the right direction and reports it", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      writeLabels(dir, [
        { repo: "alpha-repo", rule: "code.eval-use", direction: "down", reason: "WS-1 config-style fix, test fixture" },
      ]);
      writeFileSync(
        join(dir, "wave-01", "alpha-repo.json"),
        scan([finding("code.eval-use", "high"), finding("code.dead-copy", "info")]),
      );
      const result = run(dir, ["--compare", out]);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /expected moves \(1\)/);
      assert.match(result.output, /expected\s+alpha-repo code\.eval-use 2 -> 1 \(-1\)/);
      assert.ok(!/REGRESSION/.test(result.output), `no regression expected; output was:\n${result.output}`);
    });
  });

  it("still flags a move that contradicts its own label", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      writeLabels(dir, [{ repo: "alpha-repo", rule: "code.eval-use", direction: "down", reason: "test fixture" }]);
      writeFileSync(
        join(dir, "wave-01", "alpha-repo.json"),
        scan([
          finding("code.eval-use", "high"),
          finding("code.eval-use", "high"),
          finding("code.eval-use", "high"),
          finding("code.dead-copy", "info"),
        ]),
      );
      const result = run(dir, ["--compare", out]);
      assert.notEqual(result.status, 0, "a rise labelled down is still unnamed");
      assert.match(result.output, /REGRESSION alpha-repo code\.eval-use 2 -> 3 \(\+1\)/);
    });
  });

  it("flags a dropped repo rather than reading it as a clean run", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "baseline.json");
      assert.equal(run(dir, ["--write", out]).status, 0);
      rmSync(join(dir, "wave-02", "beta-repo.json"));
      const result = run(dir, ["--compare", out]);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /repo-removed\s+beta-repo/);
    });
  });

  it("rejects a file that is not scan JSON instead of counting zero", () => {
    withCorpus(({ dir }) => {
      writeFileSync(join(dir, "wave-01", "delta-repo.json"), "{not json");
      const result = run(dir, ["--write", join(dir, "baseline.json")]);
      assert.notEqual(result.status, 0);
      assert.match(result.output, /delta-repo\.json is not JSON/);
    });
  });

  it("refuses to compare against a file that is not a baseline", () => {
    withCorpus(({ dir }) => {
      const out = join(dir, "not-a-baseline.json");
      writeFileSync(out, '{"findings":[]}\n');
      const result = run(dir, ["--compare", out]);
      assert.equal(result.status, 2, result.output);
      assert.match(result.output, /is not a baseline written by --write/);
    });
  });
});
