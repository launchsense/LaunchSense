import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
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

  // W41-MCP. The installer wrote LAUNCHSENSE_AUTH_REQUIRED=0 and no Go file read
  // it: the server reads three variables and that was not one of them. A key in
  // a shipped config that nothing reads is a promise the installer cannot keep,
  // and the reader of the config cannot tell a real switch from a dead one.
  it("writes only the environment variables the server actually reads", () => {
    withHome((home) => {
      const result = runInstaller(home);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 0, `installer must succeed; output was:\n${output}`);
      const env = readCursorConfig(home).mcpServers.launchsense.env ?? {};
      const names = Object.keys(env).sort();
      assert.deepEqual(
        names,
        ["LAUNCHSENSE_REVIEW", "LAUNCHSENSE_ROOT"],
        `the env block must hold exactly what the server reads; it held ${JSON.stringify(names)}`,
      );
      assert.ok(
        !("LAUNCHSENSE_AUTH_REQUIRED" in env),
        "no Go file reads LAUNCHSENSE_AUTH_REQUIRED, so it must not be written",
      );
    });
  });

  it("every key the installer writes is read by the Go server", () => {
    const go = readFileSync(join(ROOT, "mcp", "server.go"), "utf8") +
      readFileSync(join(ROOT, "mcp", "review_local.go"), "utf8");
    withHome((home) => {
      runInstaller(home);
      const env = readCursorConfig(home).mcpServers.launchsense.env ?? {};
      for (const name of Object.keys(env)) {
        assert.ok(
          go.includes(name),
          `install.sh writes ${name} but no Go file reads it: a dead key in a shipped config is a promise nothing keeps`,
        );
      }
    });
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

// CONSENT-FALSE. install.sh used to write "agreed": true and "diagnostics":
// "on" into ~/.config/launchsense/config.json before it asked anything. It
// printed the refusal instruction afterwards, which means the script asserted
// an agreement nobody gave and made the send path look like a switch the
// reader had to find. R2 section C replaces it with a question whose default
// is no, plus a versioned record of the answer. These tests run the real
// script against an isolated HOME in a temp dir and read what it wrote.
describe("install.sh asks before it records an agreement", () => {
  const CONFIG_PATH = ".config/launchsense/config.json";
  const LOG_PATH = ".config/launchsense/consent.jsonl";

  function run(home, { answer = null, env = {} } = {}) {
    const result = spawnSync("/bin/sh", [INSTALL], {
      encoding: "utf8",
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: home, LANG: process.env.LANG ?? "C", ...env },
      input: answer === null ? "" : `${answer}\n`,
    });
    assert.equal(result.status, 0, `installer must finish; output was:\n${result.stdout}\n${result.stderr}`);
    return `${result.stdout}\n${result.stderr}`;
  }

  function readConfig(home) {
    return JSON.parse(readFileSync(join(home, CONFIG_PATH), "utf8"));
  }

  function readLog(home) {
    const path = join(home, LOG_PATH);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  it("records no agreement when nobody answers the question", () => {
    withHome((home) => {
      run(home);
      const config = readConfig(home);
      assert.equal(
        config.agreed,
        false,
        "no answer means no agreement, so agreed must not be true",
      );
      assert.equal(config.diagnostics, "off", "usage counts must stay off without a yes");
      assert.equal(config.diagnosticsConsent.granted, false);
      assert.equal(config.diagnosticsConsent.grantedAt, null, "a refusal cannot carry a granted time");
    });
  });

  it("records the yes only after a real yes on standard input", () => {
    withHome((home) => {
      run(home, { answer: "yes" });
      const config = readConfig(home);
      assert.equal(config.agreed, true, "an explicit yes is the one thing that may set agreed");
      assert.equal(config.diagnostics, "on");
      assert.equal(config.diagnosticsConsent.granted, true);
      assert.match(
        config.diagnosticsConsent.grantedAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
        `grantedAt must be a real timestamp; it was ${config.diagnosticsConsent.grantedAt}`,
      );
      assert.equal(config.diagnosticsConsent.source, "prompt");
    });
  });

  it("keeps a refusal on record as well, because a refusal is evidence too", () => {
    withHome((home) => {
      run(home, { answer: "no" });
      const config = readConfig(home);
      assert.equal(config.agreed, false);
      const lines = readLog(home);
      assert.equal(lines.length, 1, `one line per decision; the log held ${lines.length}`);
      assert.equal(lines[0].granted, false);
      assert.equal(lines[0].source, "prompt");
      assert.ok(lines[0].noticeVersion, "the log must name the wording the person answered");
    });
  });

  it("writes no agreed:true and no diagnostics:on into the config before anything is asked", () => {
    // The defect in one assertion. A heredoc line that hard-codes either value
    // is a script that decides for the reader, whatever the prompt says later.
    const script = readFileSync(INSTALL, "utf8");
    const start = script.indexOf('cat > "$CONFIG" <<EOF');
    assert.notEqual(start, -1, "the installer must still write the local config");
    const end = script.indexOf("\nEOF", start);
    const configBlock = script.slice(start, end);
    assert.doesNotMatch(
      configBlock,
      /"agreed":\s*true/,
      `the config heredoc must not hard-code agreed:true; it wrote:\n${configBlock}`,
    );
    assert.doesNotMatch(
      configBlock,
      /"diagnostics":\s*"on"/,
      `the config heredoc must not hard-code diagnostics:on; it wrote:\n${configBlock}`,
    );
    assert.match(configBlock, /"agreed": \$/, "the agreed value must come from the decision");
    assert.doesNotMatch(
      script,
      /^DIAGNOSTICS=on$/m,
      "the default cannot be on: opt-out is not consent",
    );
  });

  it("asks the question in the agreed wording, with no as the default", () => {
    withHome((home) => {
      const output = run(home);
      for (const line of [
        "Send anonymous usage counts to LaunchSense?",
        "This sends rule id counts, the harness name, the version, how long the",
        "review took, and which order source ran.",
        "It does not send code, file paths, finding titles, or function names.",
        "The review reads files on this machine. It does not upload them.",
        "Type yes to send. Type no to keep it on this machine. Default is no.",
        "yes or no:",
      ]) {
        assert.ok(output.includes(line), `the question is missing a line: ${line}`);
      }
    });
  });

  it("treats anything that is not a yes as a no", () => {
    for (const answer of ["", "maybe", "y es", "no", "n"]) {
      withHome((home) => {
        run(home, { answer });
        assert.equal(
          readConfig(home).agreed,
          false,
          `the answer ${JSON.stringify(answer)} must not read as an agreement`,
        );
      });
    }
  });

  it("asks once, then remembers the answer for the same wording", () => {
    withHome((home) => {
      const first = run(home, { answer: "yes" });
      assert.ok(first.includes("Send anonymous usage counts to LaunchSense?"));
      const grantedAt = readConfig(home).diagnosticsConsent.grantedAt;
      const second = run(home, { answer: "yes" });
      assert.ok(
        !second.includes("Send anonymous usage counts to LaunchSense?"),
        `the question must not be asked twice for one wording; output was:\n${second}`,
      );
      assert.equal(readConfig(home).agreed, true, "the remembered answer must survive a second run");
      assert.equal(
        readConfig(home).diagnosticsConsent.grantedAt,
        grantedAt,
        "a repeated run must not move the time the person agreed",
      );
      assert.equal(readLog(home).length, 1, "a repeated run is not a new decision, so it adds no line");
    });
  });

  it("asks again when the wording changes, because the person agreed to old text", () => {
    withHome((home) => {
      run(home, { answer: "yes" });
      const config = readConfig(home);
      config.diagnosticsConsent.noticeVersion = "1999-01-01";
      writeFileSync(join(home, CONFIG_PATH), JSON.stringify(config));
      const second = run(home, { answer: "" });
      assert.ok(
        second.includes("Send anonymous usage counts to LaunchSense?"),
        "new wording must be asked again",
      );
      assert.equal(readConfig(home).agreed, false, "the new wording defaults to no");
    });
  });

  it("asks nothing and sends nothing on the enterprise tier, even on a yes", () => {
    withHome((home) => {
      const output = run(home, { answer: "yes", env: { LAUNCHSENSE_TIER: "enterprise" } });
      assert.ok(
        !output.includes("Send anonymous usage counts to LaunchSense?"),
        "the enterprise tier decides the answer itself, so there is nothing to ask",
      );
      const config = readConfig(home);
      assert.equal(config.tier, "enterprise");
      assert.equal(config.agreed, false, "enterprise must not record an agreement");
      assert.equal(config.diagnosticsConsent.source, "enterprise tier");
    });
  });

  it("keeps one line and one time for a forced decision that repeats", () => {
    // The comment at the ledger says a repeat of an answer already on record is
    // not a new decision. On 2026-10-05 three enterprise runs wrote three
    // identical lines, so the comment was false. This pins it true.
    withHome((home) => {
      run(home, { env: { LAUNCHSENSE_TIER: "enterprise" } });
      const at = readConfig(home).diagnosticsConsent.decidedAt;
      assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `a real timestamp; got ${at}`);
      run(home, { env: { LAUNCHSENSE_TIER: "enterprise" } });
      run(home, { env: { LAUNCHSENSE_TIER: "enterprise" } });
      assert.equal(
        readLog(home).length,
        1,
        `the same forced decision on the same wording is one line, not many; the log held ${readLog(home).length}`,
      );
      assert.equal(
        readConfig(home).diagnosticsConsent.decidedAt,
        at,
        "a repeated forced decision must not move the recorded time",
      );
    });
  });

  it("writes a new line when the answer changes, under the same wording", () => {
    // The dedupe must key on the answer, not only the wording. A no followed by
    // a yes is two decisions, and dropping either is dropping evidence.
    withHome((home) => {
      run(home, { answer: "no" });
      rmSync(join(home, CONFIG_PATH));
      run(home, { answer: "yes" });
      const lines = readLog(home);
      assert.equal(
        lines.length,
        2,
        `a changed answer is a new decision, so it adds a line; the log held ${lines.length}`,
      );
      assert.deepEqual(
        lines.map((line) => line.granted),
        [false, true],
        "both decisions must be on record, in the order they were given",
      );
    });
  });

  it("does not lend one forced decision's time to a different one", () => {
    // Two forced switches both refuse, but they are different decisions. The
    // second must not inherit the first one's time from the log.
    withHome((home) => {
      mkdirSync(join(home, ".config", "launchsense"), { recursive: true });
      writeFileSync(
        join(home, LOG_PATH),
        '{"noticeVersion":"2026-10-05","granted":false,"decidedAt":"2020-01-01T00:00:00Z","source":"enterprise tier"}\n',
      );
      run(home, { env: { LAUNCHSENSE_DIAGNOSTICS: "off" } });
      const lines = readLog(home);
      assert.equal(lines.length, 2, "a different forced switch is a new decision");
      const mine = lines.find((line) => line.source === "LAUNCHSENSE_DIAGNOSTICS=off");
      assert.ok(mine, "the new switch must write its own line");
      assert.notEqual(
        mine.decidedAt,
        "2020-01-01T00:00:00Z",
        "a different decision cannot inherit an older decision's time",
      );
      assert.match(mine.decidedAt, /^\d{4}-\d{2}-\d{2}T/, "the time must be this run's own");
    });
  });

  it("still finishes when standard input ends immediately, because the default is no", () => {
    withHome((home) => {
      const result = spawnSync("/bin/sh", [INSTALL], {
        encoding: "utf8",
        cwd: ROOT,
        env: { PATH: process.env.PATH, HOME: home },
        input: "",
      });
      assert.equal(result.status, 0, "an unanswered prompt must not fail the install");
      assert.equal(readConfig(home).agreed, false);
    });
  });

  it("names the same value the local review reads, so a granted yes is not a dead key", () => {
    // shared/review/diagnostics.ts is the only reader of this config. If that
    // reader changes its field, this test fails and points at the coupling.
    const diagnostics = readFileSync(join(ROOT, "shared", "review", "diagnostics.ts"), "utf8");
    assert.ok(
      /config\.agreed !== true/.test(diagnostics) && /config\.diagnostics === "off"/.test(diagnostics),
      "the reader reads agreed and diagnostics; install.sh must keep writing those two names",
    );
  });
});

// llms.txt is the file a harness reads first, and the rate caps it states are a
// claim about convex/mcpLimit.ts. The wave that raised those caps updated the
// sentence, but nothing stopped the next edit from drifting it again, while the
// privacy notice got a pin and this did not. These rules pin the numbers to the
// constants, so a wrong number fails the gate.
describe("llms.txt states the caps the code sets", () => {
  function limitConstant(name) {
    const source = readFileSync(join(ROOT, "convex", "mcpLimit.ts"), "utf8");
    const match = source.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
    assert.ok(match, `${name} must exist in convex/mcpLimit.ts`);
    return Number(match[1].replace(/_/g, ""));
  }

  const text = readFileSync(LLMS, "utf8");

  it("names the shared hosted cap and the lane cap the code sets", () => {
    const shared = limitConstant("CALLER_LIMIT");
    const lane = limitConstant("GLOBAL_LIMIT");
    assert.ok(
      text.includes(`${shared} scans an hour for the shared hosted bucket`),
      `llms.txt must state the shared hosted cap as ${shared}, the value the code sets`,
    );
    assert.ok(
      text.includes(`${lane} in total across the hosted lane`),
      `llms.txt must state the hosted lane cap as ${lane}, the value the code sets`,
    );
  });

  it("no longer names the retired per-caller caps", () => {
    assert.doesNotMatch(
      text,
      /Two scans an hour from one caller/,
      "the per-caller hosted cap is retired; the counter holds no caller",
    );
    assert.doesNotMatch(
      text,
      /eight an hour in total/i,
      "the old lane total is retired; llms.txt must state the current one",
    );
  });
});