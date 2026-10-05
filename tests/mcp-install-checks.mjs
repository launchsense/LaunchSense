import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// W3-INSTALL-FIX. install.sh used to write a Cursor server that could not
// start: {"command":"go","args":["run","./mcp"],"cwd":"$ROOT"}. There is no
// go.mod at the repo root, only mcp/go.mod, so that command fails. The
// working command is `go run .` with cwd mcp. llms.txt repeated the dead
// command. These tests run the real installer against an isolated HOME in a
// temp dir. They never touch the real HOME.

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALL = join(ROOT, "install.sh");
const LLMS = join(ROOT, "llms.txt");

// Run the installer with HOME pointed at a fresh temp dir. The installer
// only writes inside $HOME, so the real HOME is never read or written.
function runInstaller(home, extra = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    LANG: process.env.LANG ?? "C",
    ...extra,
  };
  return spawnSync("/bin/sh", [INSTALL], { encoding: "utf8", env, cwd: ROOT });
}

function withHome(body) {
  const home = mkdtempSync(join(tmpdir(), "mcp-install-home-"));
  try {
    return body(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// A PATH holding only the coreutils the installer needs, and no go. Used to
// prove the installer skips a server it cannot start.
function withoutGo(home) {
  const bin = join(home, "bin-without-go");
  mkdirSync(bin, { recursive: true });
  for (const tool of ["dirname", "mkdir", "cp", "cat"]) {
    symlinkSync(`/usr/bin/${tool}`, join(bin, tool));
  }
  return bin;
}

function readCursorConfig(home) {
  return JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
}

describe("install.sh writes a cursor server that can start", () => {
  it("sets cwd to the mcp folder and args to run the module in place", () => {
    withHome((home) => {
      const result = runInstaller(home);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 0, `installer must succeed; output was:\n${output}`);
      const server = readCursorConfig(home).mcpServers.launchsense;
      assert.equal(server.command, "go");
      assert.deepEqual(
        server.args,
        ["run", "."],
        `go run ./mcp fails: no go.mod at the repo root. args were ${JSON.stringify(server.args)}`,
      );
      assert.ok(
        server.cwd.endsWith("/mcp"),
        `cwd must be the mcp module folder; cwd was ${server.cwd}`,
      );
      assert.equal(server.cwd, join(ROOT, "mcp"));
    });
  });

  it("keeps the review script an absolute path, because cwd is now mcp", () => {
    withHome((home) => {
      const result = runInstaller(home);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 0, `installer must succeed; output was:\n${output}`);
      const server = readCursorConfig(home).mcpServers.launchsense;
      assert.equal(
        server.env.LAUNCHSENSE_REVIEW,
        join(ROOT, "mcp", "review-entry.ts"),
        "the review script must stay absolute, or it breaks once cwd is mcp",
      );
    });
  });

  it("prints no dead go run ./mcp command on the install or keep-both paths", () => {
    withHome((home) => {
      const fresh = runInstaller(home);
      const freshOut = `${fresh.stdout}\n${fresh.stderr}`;
      assert.equal(fresh.status, 0, `installer must succeed; output was:\n${freshOut}`);
      assert.ok(
        !freshOut.includes("go run ./mcp"),
        `installer must not print a command that cannot run; output was:\n${freshOut}`,
      );

      // Second run with a config already in place takes the other branch.
      const again = runInstaller(home);
      const againOut = `${again.stdout}\n${again.stderr}`;
      assert.equal(again.status, 0, `installer must succeed; output was:\n${againOut}`);
      assert.ok(
        !againOut.includes("go run ./mcp"),
        `keep-existing message must not print a command that cannot run; output was:\n${againOut}`,
      );
    });
  });

  it("writes no dead go run ./mcp argument list anywhere in the script", () => {
    const script = readFileSync(INSTALL, "utf8");
    assert.ok(
      !/\[\s*"run"\s*,\s*"\.\/mcp"\s*\]/.test(script),
      "install.sh must not write the args that fail with no root go.mod",
    );
  });
});

describe("install.sh skips a server it cannot start", () => {
  it("prints a clear line and writes no cursor config when go is not on PATH", () => {
    withHome((home) => {
      const result = runInstaller(home, { PATH: withoutGo(home) });
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 0, `installer must not fail; output was:\n${output}`);
      assert.ok(
        !existsSync(join(home, ".cursor", "mcp.json")),
        `installer must not write a config it cannot start; output was:\n${output}`,
      );
      assert.ok(
        /\bgo\b/.test(output) && /not (on |found on )?(your )?PATH/i.test(output),
        `installer must say plainly that go is missing; output was:\n${output}`,
      );
      // The skill and the alpha config still land, so only the server is skipped.
      assert.ok(existsSync(join(home, ".cursor", "skills", "launchsense", "SKILL.md")));
      assert.ok(existsSync(join(home, ".config", "launchsense", "config.json")));
    });
  });
});

describe("llms.txt names a command that can run", () => {
  it("does not tell an agent to run go run ./mcp", () => {
    const text = readFileSync(LLMS, "utf8");
    assert.ok(
      !text.includes("go run ./mcp"),
      "llms.txt must not document go run ./mcp: no go.mod at the repo root",
    );
  });

  it("names the command the installer writes", () => {
    const text = readFileSync(LLMS, "utf8");
    assert.ok(
      text.includes("cd mcp && go run ."),
      "llms.txt must name the runnable local command: cd mcp && go run .",
    );
  });
});

// W3-INSTALL-ROOT. cwd is the mcp module folder, so a server that took the
// process folder as the review root read mcp/ instead of the checkout. The
// server now reads LAUNCHSENSE_ROOT, and the installer must set it, or the
// shipped server is back to reviewing a handful of Go files.
describe("install.sh points the server at the checkout", () => {
  it("writes LAUNCHSENSE_ROOT as the repo root, not the mcp folder", () => {
    withHome((home) => {
      const result = runInstaller(home);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 0, `installer must succeed; output was:\n${output}`);
      const server = readCursorConfig(home).mcpServers.launchsense;
      assert.equal(
        server.env?.LAUNCHSENSE_ROOT,
        ROOT,
        `LAUNCHSENSE_ROOT must be the checkout root; it was ${JSON.stringify(server.env?.LAUNCHSENSE_ROOT)}`,
      );
      assert.ok(
        !String(server.env?.LAUNCHSENSE_ROOT).endsWith("/mcp"),
        "LAUNCHSENSE_ROOT must not be the module folder, or the review reads mcp/ again",
      );
    });
  });

  it("the server resolves the review root through LAUNCHSENSE_ROOT, not the process folder", () => {
    const server = readFileSync(join(ROOT, "mcp", "server.go"), "utf8");
    assert.ok(
      /LAUNCHSENSE_ROOT/.test(server) && /func reviewRoot\(\)/.test(server),
      "mcp/server.go must resolve the review root through reviewRoot() and LAUNCHSENSE_ROOT",
    );
    assert.ok(
      !/func \(s \*server\) scanRepo\(string\) \(string, error\) \{\s*root, err := os\.Getwd\(\)/.test(server),
      "scanRepo must not take the process folder as the review root; cwd is the mcp module",
    );
    const runner = readFileSync(join(ROOT, "mcp", "review_local.go"), "utf8");
    assert.ok(
      !/filepath\.Join\("mcp", "review-entry\.ts"\)/.test(runner),
      "the default review script must resolve against the review root, not the process folder",
    );
  });

  it("llms.txt says the server reviews LAUNCHSENSE_ROOT and that the installer sets it", () => {
    const text = readFileSync(LLMS, "utf8");
    assert.ok(
      text.includes("LAUNCHSENSE_ROOT"),
      "llms.txt must name the review-root variable, or an agent has to guess it",
    );
    assert.ok(
      /LAUNCHSENSE_ROOT[\s\S]{0,160}checkout root/.test(text),
      "llms.txt must say the installer sets LAUNCHSENSE_ROOT to the checkout root",
    );
  });
});