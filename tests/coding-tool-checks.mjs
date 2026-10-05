import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codingToolsIn, toolCardSentence } from "../shared/reports/codingTool.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

describe("coding tool card", () => {
  it("names a tool only from a path marker", () => {
    assert.deepEqual(codingToolsIn(["src/App.tsx", ".cursor/rules.md"]), ["Cursor"]);
    assert.deepEqual(codingToolsIn(["CLAUDE.md"]), ["Claude"]);
    assert.deepEqual(codingToolsIn(["notes/.codex/config.toml"]), ["Codex"]);
    assert.deepEqual(codingToolsIn(["src/main.ts"]), []);
  });

  it("does not guess, and does not offer an install", () => {
    const none = toolCardSentence([]);
    assert.match(none, /your coding tool/);
    assert.doesNotMatch(none, /Install/);
    assert.match(toolCardSentence(["Cursor", "Claude"]), /Cursor and Claude/);
  });
});

// WS-3. The coding-tool entry point is a CLI a human runs from a terminal and a
// harness pipes into a file. Its output has to end on a line terminator, and the
// vendored-tree skip has to be disclosed rather than silent.
describe("local coding tool entry output", () => {
  function withTree(files, body) {
    const root = mkdtempSync(join(tmpdir(), "ls-ws3-cli-"));
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

  // Offline is forced and the outbound base url is removed, so nothing leaves
  // the machine.
  function run(root, extraArgs) {
    const env = { ...process.env, LAUNCHSENSE_OFFLINE: "1" };
    delete env.LAUNCHSENSE_API_URL;
    return spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "mcp", "review-entry.ts"), "--root", root, ...extraArgs],
      { encoding: "utf8", cwd: ROOT, env },
    );
  }

  it("ends the --json output with a newline and stays parseable", () => {
    withTree(
      { "package.json": JSON.stringify({ name: "demo", license: "MIT" }), README: "# demo\n" },
      (root) => {
        const result = run(root, ["--json"]);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(result.stdout.length > 0, "the entry wrote nothing");
        assert.ok(
          result.stdout.endsWith("\n"),
          `the --json output must end with a newline; last bytes were ${JSON.stringify(result.stdout.slice(-4))}`,
        );
        assert.doesNotThrow(() => JSON.parse(result.stdout));
      },
    );
  });

  it("ends the human report with a newline", () => {
    withTree(
      { "package.json": JSON.stringify({ name: "demo", license: "MIT" }), README: "# demo\n" },
      (root) => {
        const result = run(root, []);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(
          result.stdout.endsWith("\n"),
          `the report output must end with a newline; last bytes were ${JSON.stringify(result.stdout.slice(-4))}`,
        );
      },
    );
  });

  it("skips a vendored tree, discloses it, and keeps the not-checked list in the report", () => {
    withTree(
      {
        "package.json": JSON.stringify({ name: "demo", license: "MIT" }),
        README: "# demo\n",
        "3rdparty/lib/vendored.ts": "export const value = eval(\"2 + 2\");\n",
        "src/app.ts": "export const value = eval(\"2 + 2\");\n",
      },
      (root) => {
        const result = run(root, []);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(!/3rdparty\/lib\/vendored\.ts/.test(result.stdout), "a skipped vendored file appeared in the report");
        assert.ok(/src\/app\.ts/.test(result.stdout), "the same line outside the vendored tree must be reported");
        assert.match(result.stdout, /Not checked:/);
        assert.match(result.stdout, /3rdparty: Vendored tree was not read/);
      },
    );
  });
});