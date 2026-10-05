import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// W9. The claim guard must fail on copy that asserts something the
// code does not back, including copy in a file the default scan did
// not used to read. The guard takes an opt-in extra file through the
// CLAIM_GUARD_EXTRA_FILE environment variable, so a synthetic
// violation can be checked the same way a real one in llms.txt is.

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GUARD = join(ROOT, "scripts", "check-claims.mjs");

function runGuard(extraRelativePath) {
  const env = { ...process.env };
  delete env.CLAIM_GUARD_EXTRA_FILE;
  if (extraRelativePath !== undefined) {
    env.CLAIM_GUARD_EXTRA_FILE = extraRelativePath;
  }
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf8",
    env,
    cwd: ROOT,
  });
}

// Write one temp file, run the body, always remove the file. The
// file lives outside the repo so the default scan never reads it.
function withTempFile(content, body) {
  const path = join(tmpdir(), `claim-guard-${process.pid}-${Date.now()}.md`);
  writeFileSync(path, content, "utf8");
  try {
    return body(path);
  } finally {
    rmSync(path, { force: true });
  }
}

describe("claim guard extra-file opt-in", () => {
  it("fails the guard on a synthetic unsupported claim and reports the file", () => {
    withTempFile("We fully scans every file in your repo.\n", (tempPath) => {
      const rel = relative(ROOT, tempPath);
      const result = runGuard(rel);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.notEqual(result.status, 0, "guard must exit non-zero on a banned phrase");
      assert.ok(
        output.includes(rel),
        `guard must report the extra file (${rel}); output was:\n${output}`,
      );
    });
  });

  it("does not scan the extra file without the opt-in variable", () => {
    withTempFile("We fully scans every file in your repo.\n", (tempPath) => {
      const rel = relative(ROOT, tempPath);
      const result = runGuard(undefined);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.ok(
        !output.includes(rel),
        `default run must not scan the extra file (${rel}); output was:\n${output}`,
      );
    });
  });

  it("fails a retention claim whose window no TTL constant matches", () => {
    withTempFile(
      "Snippet metadata is cached for 99 hours after it was written.\n",
      (tempPath) => {
        const rel = relative(ROOT, tempPath);
        const result = runGuard(rel);
        const output = `${result.stdout}\n${result.stderr}`;
        assert.notEqual(result.status, 0, "guard must exit non-zero on an unbacked window");
        assert.ok(
          output.includes(rel),
          `guard must report the extra file (${rel}); output was:\n${output}`,
        );
        assert.ok(
          output.includes("no TTL constant matches"),
          `guard must name the TTL mismatch; output was:\n${output}`,
        );
      },
    );
  });

  it("passes a retention claim backed by a purge bound to that window", () => {
    withTempFile(
      "Snippet metadata is cached for 24 hours after it was written.\n",
      (tempPath) => {
        const rel = relative(ROOT, tempPath);
        const result = runGuard(rel);
        const output = `${result.stdout}\n${result.stderr}`;
        // 24 hours matches CONTENT_CACHE_TTL_MS, and purgeStaleContents
        // is invoked with beforeMs: Date.now() - CONTENT_CACHE_TTL_MS.
        // The claim is backed, so this file must not be reported. Other
        // files in the repo may still fail; that is not this test's claim.
        assert.ok(
          !output.includes(rel),
          `backed retention claim must not be reported (${rel}); output was:\n${output}`,
        );
      },
    );
  });
});

describe("claim guard scope", () => {
  it("reads llms.txt, the agent file a harness reads first", () => {
    const guard = readFileSync(GUARD, "utf8");
    assert.ok(
      guard.includes('"llms.txt"'),
      "COPY_GLOBS must include llms.txt so stale claims there are scanned",
    );
  });

  it("retention check requires a purge bound to a TTL window, not any delete", () => {
    const guard = readFileSync(GUARD, "utf8");
    // The old check was a tautology: any delete( anywhere plus any TTL
    // anywhere passed every retention claim. It must be gone.
    assert.ok(
      !guard.includes('return /\\b(delete|purge|remove)\\w*\\s*\\(/i.test(readAllSource())'),
      "guard must not use the old any-delete-plus-any-TTL tautology",
    );
    // The replacement requires a purge, sweep, or expire routine that
    // deletes rows, and a call to it with a cutoff derived from a TTL
    // constant. Both are structural, so a claim with no bound purge
    // fails closed.
    assert.ok(
      guard.includes("export const \\w*(?:purge|sweep|expire)\\w*"),
      "guard must require a purge routine that deletes rows",
    );
    assert.ok(
      guard.includes("beforeMs|sinceMs|olderThan"),
      "guard must require a TTL-derived cutoff in the purge call",
    );
  });
});
