// Red-team checks for the fixed local MCP server (mcp/server.go).
//
// These tests attack the server and record what it actually does. Every test
// asserts the CURRENT behaviour, and the name says whether that behaviour is a
// DEFENCE (the server refuses, and the session survives) or an OPEN hole (the
// server does something the protocol does not allow). An OPEN test is a
// change-detector: it passes while the hole is open and fails the moment the
// server is fixed, which is the point. Fixing an OPEN hole means flipping the
// assertion to the required behaviour, not deleting the test.
//
// The server under test is the built binary, driven over real pipes with real
// bytes. No network is used: LAUNCHSENSE_API_URL points at a loopback fixture,
// or at 127.0.0.1:1 which refuses, so nothing can reach the real deployment.
// HOME is a temp folder, so no gh login is read and no token is touched.
//
// Labels in the source this file was written against:
//   server.go:22       maxMessageBytes = 4 MiB, counted on the line including
//                      its newline
//   server.go:26       maxReportBytes  = 1 MiB
//   server.go:32       apiTimeout      = 8s
//   server.go:88-133   serve: read a line, answer a line, one at a time
//   server.go:139-163  readMessage: reassemble, refuse oversize, drain
//   server.go:165-204  handle: no session state, no envelope check
//   review_local.go:18 reviewTimeout  = 10 minutes, same single loop

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILT = mkdtempSync("/tmp/opencode/w4-red-checks-");
const HOME = mkdtempSync("/tmp/opencode/w4-red-home-");
const BIN = join(BUILT, "launchsense-mcp");

// The two bounds in force, read from the source constants above.
const CAP = 4 << 20; // maxMessageBytes
const REPORT_CAP = 1 << 20; // maxReportBytes
// Port 1 refuses, so an accidental real call fails instead of leaving the box.
const DEAD_API = "http://127.0.0.1:1";

let goStatus = "not built";

/**
 * One stdio session. `steps` is written in order, with a number meaning "wait
 * this many milliseconds first" and CLOSE meaning "close stdin now", so a test
 * can hold the pipe open, send half a message, finish it later, and then shut
 * the pipe so the server can exit. `keepOpen` is for the one test that must
 * hold the pipe open for ever, so a server waiting for more input can be told
 * apart from one that is wedged.
 */
function session(steps, { env = {}, killAfterMs = 60_000, keepOpen = false } = {}) {
  const input = Array.isArray(steps) ? steps : [steps];
  return new Promise((resolve) => {
    const child = spawn(BIN, [], {
      cwd: join(REPO, "mcp"),
      env: { PATH: process.env.PATH, HOME, LAUNCHSENSE_API_URL: DEAD_API, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // A wedged server fails the test instead of hanging it.
    const timer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const lines = stdout.split("\n").filter((line) => line !== "");
      resolve({
        code,
        signal,
        stdout,
        stderr,
        lines,
        // Every line on stdout must be one JSON message. A line that does not
        // parse is kept as a marker so a framing break shows up as a failure
        // rather than being quietly skipped.
        replies: lines.map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { NOT_JSON: line.slice(0, 160) };
          }
        }),
      });
    });
    child.stdin.on("error", () => {});
    (async () => {
      for (const step of input) {
        if (typeof step === "number") {
          await new Promise((done) => setTimeout(done, step));
        } else if (step === CLOSE) {
          child.stdin.end();
        } else {
          child.stdin.write(step);
        }
      }
      if (!keepOpen) child.stdin.end();
    })();
  });
}

const CLOSE = "CLOSE";

/** The MCP stdio framing: one JSON object per line, no length header. */
const frame = (object) => `${JSON.stringify(object)}\n`;
const frames = (...objects) => objects.map(frame).join("");

const request = (id, method, params) =>
  params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };

const callTool = (id, name, args) =>
  frame(request(id, "tools/call", { name, arguments: args }));

/** A ping we can always expect back, used to prove a session survived. */
const PING = frame(request(999, "ping"));

/** A loopback HTTP fixture. Open sockets are destroyed on close so a fixture
 *  that never answers still lets the test finish. */
async function fixture(handler) {
  const server = createServer(handler);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(done);
      }),
  };
}

/** A message of an exact byte length, newline included. */
function lineOfBytes(totalBytes, id, fill = "a") {
  const head = `{"jsonrpc":"2.0","id":${id},"method":"ping","pad":"`;
  const tail = '"}';
  const fillBytes = totalBytes - 1 - head.length - tail.length; // minus "\n"
  assert.ok(fillBytes > 0, `cannot build a ${totalBytes} byte line`);
  const line = head + fill.repeat(fillBytes) + tail + "\n";
  assert.equal(Buffer.byteLength(line), totalBytes, "the built line is the size asked for");
  return line;
}

/** Asserts the server is up, or skips the test with the reason. */
function needGo() {
  if (goStatus !== "built") throw new Error(`go build unavailable: ${goStatus}`);
}

describe("Red team: the local MCP server", () => {
  before(() => {
    const go = spawnSync("sh", ["-c", "command -v go"], { encoding: "utf8" });
    if (go.status !== 0) {
      goStatus = "go is not on PATH";
      return;
    }
    const build = spawnSync("go", ["build", "-o", BIN, "."], {
      cwd: join(REPO, "mcp"),
      encoding: "utf8",
      env: {
        ...process.env,
        GOPROXY: "off",
        GOFLAGS: "-mod=readonly",
        GOCACHE: process.env.GOCACHE ?? join("/tmp/opencode", "w4-red-gocache"),
      },
      timeout: 300_000,
    });
    goStatus =
      build.status === 0 ? "built" : `build failed: ${(build.stderr || "").slice(0, 300)}`;
    if (build.status !== 0) return;
    return () => {
      rmSync(BUILT, { recursive: true, force: true });
      rmSync(HOME, { recursive: true, force: true });
    };
  });

  // ------------------------------------------------------------------
  // Target 1: transport framing
  // ------------------------------------------------------------------
  describe("target 1: transport", () => {
    it("[DEFENDED] 1.1 an LSP Content-Length frame is one parse error, and the messages after it still answer", async () => {
      needGo();
      const body = JSON.stringify(request(1, "initialize", {}));
      const lsp = `Content-Length: ${body.length}\r\n\r\n${body}\n`;
      const result = await session(lsp + PING);
      // Three answers: the header line is a parse error, the two blank CR lines
      // are not messages, and the body plus the ping both answer.
      assert.equal(result.replies.length, 3, `the header line and the two messages answer: ${result.stdout}`);
      assert.equal(result.replies[0].error.code, -32700, "a Content-Length header is not JSON");
      assert.equal(result.replies[0].id, null, "the id is null, because none could be read");
      assert.equal(result.replies[1].id, 1, "the body inside the old frame is read as a plain message");
      assert.ok(result.replies[1].result.serverInfo, "and answered with a result");
      assert.equal(result.replies[2].id, 999, "the message after the frame still answers: no desync");
      assert.ok(result.replies[2].result, "and it is answered with a result");
      assert.match(result.stderr, /parse error/, "one line on stderr names the refusal");
      assert.equal(result.code, 0, "the session ends cleanly, not with a crash");
    });

    it("[DEFENDED] 1.2 a final line with no trailing newline is still a message", async () => {
      needGo();
      const result = await session(JSON.stringify(request(5, "ping")));
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.equal(result.replies[0].id, 5, "the unterminated last line was not dropped");
      assert.ok(result.replies[0].result, "and it is answered with a result");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 1.3 a message with an embedded newline answers one parse error per fragment and the session survives", async () => {
      needGo();
      // A real newline inside a JSON string. The transport says messages must
      // not contain one, so this is undefined by the spec; the point is that
      // the server stays usable rather than hanging or dying.
      const result = await session(
        '{"jsonrpc":"2.0","id":8,"method":"ping","note":"line one\nline two"}\n' + PING,
      );
      assert.equal(result.replies.length, 3, `two fragments, then the ping: ${result.stdout}`);
      assert.equal(result.replies[0].error.code, -32700, "the head fragment is not JSON");
      assert.equal(result.replies[1].error.code, -32700, "the tail fragment is not JSON either");
      assert.equal(result.replies[2].id, 999, "the next real message still answers");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 1.4 a fragment that happens to be a complete message is served, which is what line framing means", async () => {
      needGo();
      // An unterminated string leaves a tail that is a whole valid request. The
      // server treats every line as a message, so the tail is answered. This is
      // inherent to newline framing, not a bypass: whoever writes those bytes
      // could have written the same message properly. It is pinned here so a
      // future change to the reader is visible.
      const result = await session(
        '{"jsonrpc":"2.0","id":10,"method":"ping","note":"oops\n' +
          '{"jsonrpc":"2.0","id":666,"method":"tools/list"}\n' +
          PING,
      );
      assert.equal(result.replies.length, 3, `${result.stdout.slice(0, 200)}`);
      assert.equal(result.replies[0].error.code, -32700, "the broken head is refused");
      assert.equal(result.replies[1].id, 666, "the tail is read as its own message");
      assert.equal(result.replies[2].id, 999, "and the session is still aligned afterwards");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 1.5 a partial line is reassembled across three writes, then the next message answers", async () => {
      needGo();
      const result = await session(
        ['{"jsonrpc":"2.0","id":1,', 200, '"method":"tools/list"', 200, "}\n" + PING, 200, CLOSE],
        { killAfterMs: 20_000 },
      );
      assert.equal(result.replies.length, 2, `one message in, one answer: ${result.stdout.slice(0, 200)}`);
      assert.equal(result.replies[0].id, 1, "the halves were joined, not cut");
      assert.ok(Array.isArray(result.replies[0].result.tools), "tools/list answered with tools");
      assert.equal(result.replies[1].id, 999, "the next message answers");
      assert.equal(result.stderr, "", "nothing was logged for a legal split write");
    });

    it("[DEFENDED] 1.6 a partial line then EOF is a parse error, not silence and not a crash", async () => {
      needGo();
      const result = await session('{"jsonrpc":"2.0","id":12,"method":"pi');
      assert.equal(result.replies.length, 1, `the half message is answered: ${result.stdout}`);
      assert.equal(result.replies[0].error.code, -32700, "an unfinished message is a parse error");
      assert.equal(result.replies[0].id, null, "with a null id, because none could be read");
      assert.match(result.stderr, /parse error/, "and one line on stderr");
      assert.equal(result.code, 0, "the server does not die on a truncated message");
    });

    it("[DEFENDED] 1.7 two messages in one write are answered in order", async () => {
      needGo();
      const result = await session(frames(request(1, "initialize", {}), request(2, "tools/list"), request(3, "ping")));
      assert.deepEqual(result.replies.map((r) => r.id), [1, 2, 3], `${result.stdout.slice(0, 200)}`);
      assert.ok(result.replies[1].result.tools, "the middle message answered with its tools");
      assert.ok(result.replies[2].result, "the last one answered with a result");
      assert.equal(result.stderr, "", "a legal session logs nothing");
    });

    it("[DEFENDED] 1.8 a zero-length line and a whitespace-only line invent no reply", async () => {
      needGo();
      const result = await session(`\n\n\r\n   \t \n${PING}\n\n`);
      assert.equal(result.replies.length, 1, `only the ping is answered: ${result.stdout}`);
      assert.equal(result.replies[0].id, 999);
      assert.equal(result.stderr, "", "a blank line is not an event");
    });

    it("[DEFENDED] 1.9 a CRLF session answers every message", async () => {
      needGo();
      const result = await session(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\r\n' +
          '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\r\n' +
          "\r\n" +
          '{"jsonrpc":"2.0","id":3,"method":"ping"}\r\n',
      );
      assert.deepEqual(result.replies.map((r) => r.id), [1, 2, 3], `${result.stdout.slice(0, 200)}`);
      assert.ok(result.replies[0].result.serverInfo, "initialize answered");
      assert.ok(result.replies[1].result.tools, "tools/list answered");
      assert.ok(result.replies[2].result, "ping answered");
    });

    it("[DEFENDED] 1.10 an answer whose text holds real newlines stays one stdout line", async () => {
      needGo();
      const result = await session(callTool(1, "launchsense_scan_public_notice", {}));
      assert.equal(result.lines.length, 1, `the reply is one line: ${JSON.stringify(result.stdout)}`);
      const text = result.replies[0].result.content[0].text;
      assert.ok(text.includes("\n"), "the tool text really does hold newlines");
      assert.ok(
        !result.stdout.slice(0, -1).includes("\n"),
        "so the JSON encoder escaped them and the framing survived",
      );
    });
  });

  // ------------------------------------------------------------------
  // Target 2: the size limit
  // ------------------------------------------------------------------
  describe("target 2: size limit", () => {
    it("[DEFENDED] 2.1 the cap is enforced at the line length, and the boundary is exact both ways", async () => {
      needGo();
      // server.go counts the newline as part of the line, so a line of exactly
      // the cap is served and one byte more is refused. That makes the largest
      // servable JSON body cap-1 bytes. The refusal text says the limit is
      // `cap` bytes, which is one byte generous for a body. Recorded, low.
      const atCapMinusOne = await session(lineOfBytes(CAP - 1, 20) + PING, { killAfterMs: 30_000 });
      assert.deepEqual(
        atCapMinusOne.replies.map((r) => r.id),
        [20, 999],
        `a line one byte under the cap is a normal message: ${atCapMinusOne.stderr}`,
      );
      assert.ok(atCapMinusOne.replies[0].result, "and it is answered with a result");

      const atCap = await session(lineOfBytes(CAP, 21) + PING, { killAfterMs: 30_000 });
      assert.deepEqual(
        atCap.replies.map((r) => r.id),
        [21, 999],
        `a line of exactly the cap is still served: ${atCap.stderr}`,
      );
      assert.ok(atCap.replies[0].result, "and it is answered with a result");
    });

    it("[DEFENDED] 2.2 a line one byte over the cap is refused with a protocol error, and nothing runs", async () => {
      needGo();
      const result = await session(lineOfBytes(CAP + 1, 30) + PING, { killAfterMs: 30_000 });
      assert.equal(result.replies.length, 2, `the oversize line is answered, not dropped: ${result.stdout.slice(0, 120)}`);
      assert.equal(result.replies[0].error.code, -32600, "an unusable message is Invalid Request");
      assert.equal(result.replies[0].id, null, "no id could be read from a message that was refused");
      assert.match(result.replies[0].error.message, /too large/i, "the answer says why");
      assert.match(result.replies[0].error.message, new RegExp(String(CAP)), "and names the cap");
      assert.ok(!("result" in result.replies[0]), "a refusal is not a result");
      assert.equal(result.replies[1].id, 999, "the next message answers: the stream did not desync");
      assert.equal(result.code, 0, `clean exit; stderr: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /out of memory|SIGSEGV|goroutine/, "no crash over one big line");
    });

    it("[DEFENDED] 2.3 a multi-byte line is measured in bytes, and the boundary does not split a character", async () => {
      needGo();
      // 3-byte characters, so a line at the byte cap is well under a third of
      // the cap in characters. If the server counted runes, or split a
      // character across its 64 KiB read buffer, this answer would not come
      // back clean.
      const head = '{"jsonrpc":"2.0","id":40,"method":"ping","pad":"';
      const tail = '"}';
      const budget = CAP - head.length - tail.length - 1;
      const euro = "€";
      const EURO_BYTES = 3; // U+20AC is three bytes in UTF-8, one JS character
      const count = Math.floor(budget / EURO_BYTES);
      const under = head + euro.repeat(count) + "a".repeat(budget - count * EURO_BYTES) + tail + "\n";
      assert.equal(Buffer.byteLength(under), CAP, "exactly at the cap, in bytes");
      assert.ok(under.length < CAP / 2, "and far under it in characters, so bytes really are the unit");

      const over = under.slice(0, -1) + 'b"}\n';
      assert.equal(Buffer.byteLength(over), CAP + 3, "three bytes over the cap");
      const result = await session(under + over + PING, { killAfterMs: 30_000 });
      assert.equal(result.replies.length, 3, `${result.stdout.slice(0, 120)}`);
      assert.ok(result.replies[0].result, "the multi-byte line at the cap is served");
      assert.equal(result.replies[0].id, 40);
      assert.equal(result.replies[1].error.code, -32600, "the multi-byte line over the cap is refused");
      assert.equal(result.replies[2].id, 999, "and the next message still answers");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 2.4 a 64 MiB line is refused fast, with no out of memory and no lost session", async () => {
      needGo();
      const head = '{"jsonrpc":"2.0","id":50,"method":"ping","pad":"';
      const chunk = "a".repeat(1 << 20);
      const parts = [head];
      for (let i = 0; i < 64; i++) parts.push(chunk);
      parts.push('"}\n', PING);
      const started = Date.now();
      const result = await session(parts.join(""), { killAfterMs: 45_000 });
      const waited = Date.now() - started;
      assert.equal(result.replies.length, 2, `${result.stdout.slice(0, 120)}`);
      assert.equal(result.replies[0].error.code, -32600, "64 MiB is refused like any oversize line");
      assert.equal(result.replies[1].id, 999, "the ping after it answers, so the 64 MiB was drained to the newline");
      assert.equal(result.code, 0, `clean exit; stderr: ${result.stderr.slice(0, 200)}`);
      assert.doesNotMatch(result.stderr, /out of memory|SIGSEGV|goroutine 1 \[/, "no Go runtime death");
      assert.ok(waited < 20_000, `refused and drained in ${waited}ms, not held in memory`);
    });

    it("[DEFENDED] 2.5 an oversize line with no trailing newline, then EOF, is still refused", async () => {
      needGo();
      const head = '{"jsonrpc":"2.0","id":60,"method":"ping","pad":"';
      const line = head + "a".repeat(CAP + 4096) + '"}';
      assert.ok(Buffer.byteLength(line) > CAP);
      const result = await session(line, { killAfterMs: 30_000 });
      assert.equal(result.replies.length, 1, `refused, not dropped: ${result.stdout.slice(0, 120)}`);
      assert.equal(result.replies[0].error.code, -32600);
      assert.equal(result.code, 0, "and the server then exits cleanly at EOF");
    });
  });

  // ------------------------------------------------------------------
  // Target 3: report body truncation
  // ------------------------------------------------------------------
  describe("target 3: truncation", () => {
    const R = "R";

    it("[DEFENDED] 3.1 a body of exactly 1 MiB comes back whole, as a success", async () => {
      needGo();
      const host = await fixture((req, res) => {
        const body = Buffer.alloc(REPORT_CAP, 0x52);
        res.writeHead(200, { "content-type": "application/json", "content-length": String(body.length) });
        res.end(body);
      });
      try {
        const result = await session(callTool(1, "launchsense_report", { scanId: "fixture" }), {
          env: { LAUNCHSENSE_API_URL: host.url },
        });
        const reply = result.replies[0];
        assert.equal(reply.result.isError, false, "a body exactly at the cap is not an error");
        assert.equal(reply.result.content[0].text.length, REPORT_CAP, "every byte came through");
        assert.doesNotMatch(reply.result.content[0].text, /partial/i, "and nothing claims it was clipped");
      } finally {
        await host.close();
      }
    });

    it("[DEFENDED] 3.2 a body one byte over 1 MiB comes back as partial, never as a clipped success", async () => {
      needGo();
      const host = await fixture((req, res) => {
        const body = Buffer.alloc(REPORT_CAP + 1, 0x52);
        res.writeHead(200, { "content-type": "application/json", "content-length": String(body.length) });
        res.end(body);
      });
      try {
        const result = await session(callTool(1, "launchsense_report", { scanId: "fixture" }), {
          env: { LAUNCHSENSE_API_URL: host.url },
        });
        const reply = result.replies[0];
        const text = reply.result.content[0].text;
        assert.equal(reply.result.isError, true, `a clipped body must not be a success; text was ${text.length} characters`);
        assert.match(text, /partial/i, `the answer says it is partial: ${text}`);
        assert.doesNotMatch(text, /RRRRR/, "and the clipped bytes are not passed off as a report");
        assert.ok(text.length < REPORT_CAP, "the answer is far shorter than the body that arrived");
      } finally {
        await host.close();
      }
    });

    it("[DEFENDED] 3.3 a chunked body of exactly 1 MiB is whole too, so the cap does not lean on content-length", async () => {
      needGo();
      const host = await fixture((req, res) => {
        res.writeHead(200, { "content-type": "application/json" }); // chunked, no length
        res.write(Buffer.alloc(REPORT_CAP, 0x52));
        res.end();
      });
      try {
        const result = await session(callTool(1, "launchsense_report", { scanId: "fixture" }), {
          env: { LAUNCHSENSE_API_URL: host.url },
        });
        assert.equal(result.replies[0].result.isError, false, "no content-length header, same result");
        assert.equal(result.replies[0].result.content[0].text.length, REPORT_CAP);
      } finally {
        await host.close();
      }
    });

    it("[DEFENDED] 3.4 an upstream that promises more than it sends is an error, not a short report", async () => {
      needGo();
      const host = await fixture((req, res) => {
        res.writeHead(200, { "content-type": "application/json", "content-length": String(4 * REPORT_CAP) });
        res.write(Buffer.alloc(REPORT_CAP, 0x52));
        res.socket.destroy(); // hang up mid-body
      });
      try {
        const result = await session(callTool(1, "launchsense_report", { scanId: "truncated" }), {
          env: { LAUNCHSENSE_API_URL: host.url },
        });
        const reply = result.replies[0];
        assert.equal(reply.result.isError, true, "a half-read body is a failure");
        const text = reply.result.content[0].text;
        assert.doesNotMatch(text, /RRRRR/, "the partial bytes are not handed over as a report");
        assert.ok(!text.includes(R.repeat(1000)), "not even a run of them");
      } finally {
        await host.close();
      }
    });
  });

  // ------------------------------------------------------------------
  // Target 4: a host that never answers
  // ------------------------------------------------------------------
  describe("target 4: timeout", () => {
    it("[DEFENDED] 4.1 a host that accepts and never answers is abandoned at about 8 s, and the queued ping still answers", async () => {
      needGo();
      const host = await fixture(() => {
        // Accepted, then nothing. Never ends the response.
      });
      try {
        const started = Date.now();
        const result = await session(
          callTool(1, "launchsense_report", { scanId: "hangs" }) + PING,
          { env: { LAUNCHSENSE_API_URL: host.url }, killAfterMs: 40_000 },
        );
        const waited = Date.now() - started;
        assert.equal(result.replies.length, 2, `both messages answer: ${result.stdout.slice(0, 160)}`);
        assert.equal(result.replies[0].result.isError, true, "the hung call is an error");
        assert.match(
          result.replies[0].result.content[0].text,
          /timeout|deadline/i,
          `and it names the timeout: ${result.replies[0].result.content[0].text}`,
        );
        assert.equal(result.replies[1].id, 999, "a hung endpoint does not take ping down with it");
        assert.ok(waited >= 7_000 && waited < 20_000, `gave up in ${waited}ms, not before the 8s budget and not forever`);
        assert.equal(result.code, 0);
      } finally {
        await host.close();
      }
    });

    it("[DEFENDED] 4.2 a host that sends headers then stalls the body is abandoned too", async () => {
      needGo();
      const host = await fixture((req, res) => {
        res.writeHead(200, { "content-type": "application/json", "content-length": String(2 * REPORT_CAP) });
        res.write(Buffer.alloc(16, 0x52));
        // Never ends the body.
      });
      try {
        const started = Date.now();
        const result = await session(
          callTool(1, "launchsense_report", { scanId: "stalls" }) + PING,
          { env: { LAUNCHSENSE_API_URL: host.url }, killAfterMs: 40_000 },
        );
        const waited = Date.now() - started;
        assert.equal(result.replies.length, 2, `both messages answer: ${result.stdout.slice(0, 160)}`);
        assert.equal(result.replies[0].result.isError, true, "a stalled body read is an error");
        assert.match(result.replies[0].result.content[0].text, /timeout|deadline|context/i);
        assert.equal(result.replies[1].id, 999, "ping still answers");
        assert.ok(waited < 20_000, `gave up in ${waited}ms`);
      } finally {
        await host.close();
      }
    });

    it("[OPEN] 4.3 a review subprocess that never finishes blocks every later message for the full 10 minute budget", async () => {
      needGo();
      // review_local.go:18 sets reviewTimeout to 10 minutes, and serve() answers
      // one message at a time. So a review that never exits takes ping, and
      // every other tool, down with it for ten minutes. The API path was given
      // an 8s budget; this path was not. OPEN until the loop stops being the
      // only thing standing between a stuck subprocess and the client.
      const dir = mkdtempSync("/tmp/opencode/w4-red-review-");
      const script = join(dir, "never-finishes.ts");
      writeFileSync(script, "setInterval(() => {}, 1000);\n");
      try {
        const started = Date.now();
        const result = await session(
          callTool(1, "launchsense_scan_repo", {}) + PING,
          {
            env: { LAUNCHSENSE_REVIEW: script, LAUNCHSENSE_ROOT: dir },
            killAfterMs: 25_000,
          },
        );
        const waited = Date.now() - started;
        assert.equal(
          result.replies.length,
          0,
          `a ping sent after a hung review got no answer at all in ${waited}ms: ${result.stdout.slice(0, 160)}`,
        );
        assert.equal(result.signal, "SIGKILL", "the server had to be killed, it never exited on its own");
        assert.equal(result.code, null);
        assert.ok(waited >= 25_000, `proved over ${waited}ms with no reply, which is the 10 minute budget showing through`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ------------------------------------------------------------------
  // Target 5: tool names and arguments
  // ------------------------------------------------------------------
  describe("target 5: tool names and arguments", () => {
    /** One tools/call per session, so nothing else can answer for it. */
    const ask = async (name, args, extra = {}) => {
      const result = await session(callTool(1, name, args), extra);
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout.slice(0, 200)}`);
      return result.replies[0];
    };

    it("[DEFENDED] 5.1 the hosted tool name called locally is a protocol error, not a scan that reports nothing", async () => {
      needGo();
      const reply = await ask("launchsense_scan_public", { repoUrl: "https://github.com/octocat/Hello-World" });
      assert.ok(!("result" in reply), "a name this server does not have never returns a result");
      assert.equal(reply.error.code, -32602, "it is Invalid params");
      assert.match(reply.error.message, /launchsense_scan_public/, "and it names what was asked for");
      assert.doesNotMatch(reply.error.message, /scan of|scanned|scan complete/i, "it must not read like a scan ran");
      // The list must not advertise it either, or a client would keep trying.
      const list = await session(frame(request(1, "tools/list")));
      const names = list.replies[0].result.tools.map((t) => t.name);
      assert.ok(!names.includes("launchsense_scan_public"), `tools/list must not offer it: ${names.join(", ")}`);
      assert.ok(names.includes("launchsense_scan_public_notice"), "the pointer to the hosted read is offered instead");
    });

    it("[DEFENDED] 5.2 an unknown tool name is -32602 with no result member", async () => {
      needGo();
      const reply = await ask("launchsense_nope", {});
      assert.equal(reply.error.code, -32602);
      assert.match(reply.error.message, /launchsense_nope/);
      assert.ok(!("result" in reply), "isError is for a tool that ran and failed, not one that does not exist");
    });

    it("[DEFENDED] 5.3 a missing required argument names the field", async () => {
      needGo();
      for (const args of [{}, { scanId: null }, { scanId: "   " }]) {
        const reply = await ask("launchsense_report", args);
        assert.equal(reply.error.code, -32602, `for ${JSON.stringify(args)}`);
        assert.match(reply.error.message, /scanId is required/, `says which field: ${reply.error.message}`);
        assert.match(reply.error.message, /launchsense_report/, "and which tool");
      }
    });

    it("[DEFENDED] 5.4 a wrong type is a type error, naming the field, the type wanted and the type given", async () => {
      needGo();
      for (const [value, got] of [[42, "number"], [true, "boolean"], [["a"], "array"], [{}, "object"]]) {
        const reply = await ask("launchsense_report", { scanId: value });
        assert.equal(reply.error.code, -32602, `for ${JSON.stringify(value)}`);
        assert.match(
          reply.error.message,
          new RegExp(`scanId must be a string, got ${got}`),
          `a wrong type is not reported as a missing field: ${reply.error.message}`,
        );
        assert.doesNotMatch(reply.error.message, /is required/, `not a missing field either: ${reply.error.message}`);
      }
    });

    it("[DEFENDED] 5.5 an undeclared argument is refused by name and lists what is declared", async () => {
      needGo();
      const extra = await ask("launchsense_report", { scanId: "x", bogusProp: "y" });
      assert.equal(extra.error.code, -32602);
      assert.match(extra.error.message, /unexpected property bogusProp/);
      assert.match(extra.error.message, /scanId/, "and lists the declared properties");

      // The tool that dropped repoUrl must say so rather than ignore it.
      const dropped = await ask("launchsense_scan_repo", { repoUrl: "https://github.com/octocat/Hello-World" });
      assert.equal(dropped.error.code, -32602, `an ignored argument is a mistake, not a no-op: ${dropped.error.message}`);
      assert.match(dropped.error.message, /repoUrl/);
      assert.doesNotMatch(dropped.error.message, /Reviewed folder/, "nothing was reviewed, so no report text comes back");
      assert.ok(!("result" in dropped), "and it is not a result");
    });

    it("[DEFENDED] 5.6 malformed params and calls are protocol errors, never a result", async () => {
      needGo();
      const cases = [
        ["arguments as a string", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":"scanId=x"}}\n', -32602, /must be a JSON object/],
        ["arguments as an array", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":["scanId"]}}\n', -32602, /must be a JSON object/],
        ["params as a string", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"scanId=x"}\n', -32602, /Invalid tool call/],
        ["name as a number", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":7,"arguments":{}}}\n', -32602, /Invalid tool call/],
        ["arguments missing", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report"}}\n', -32602, /scanId is required/],
        ["a duplicate key", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":{"scanId":"a","scanId":null}}}\n', -32602, /scanId is required/],
        ["a prototype key", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":{"scanId":"x","__proto__":"y","constructor":"z"}}}\n', -32602, /unexpected property/],
        ["an unknown method", '{"jsonrpc":"2.0","id":1,"method":"does/not/exist"}\n', -32601, /Method not found/],
      ];
      for (const [name, input, code, pattern] of cases) {
        const result = await session(input);
        assert.equal(result.replies.length, 1, `${name}: one answer, got ${result.stdout.slice(0, 160)}`);
        const reply = result.replies[0];
        assert.ok(!("result" in reply), `${name}: must not be a result, got ${JSON.stringify(reply).slice(0, 160)}`);
        assert.equal(reply.error.code, code, `${name}: wrong code`);
        assert.match(reply.error.message, pattern, `${name}: wrong message: ${reply.error.message}`);
        assert.equal(result.code, 0, `${name}: the server stays up`);
      }
    });

    it("[OPEN] 5.7 a null params is reported as an unknown tool with a blank name, which names a problem that does not exist", async () => {
      needGo();
      // The real mistake is the envelope: params was null, so there was no tool
      // call to name. The answer says "Unknown tool: " with nothing after it,
      // which points a reader at the tool list instead of at the bad message.
      const nullParams = await session('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":null}\n');
      assert.equal(nullParams.replies.length, 1);
      assert.equal(nullParams.replies[0].error.code, -32602, "measured: -32602");
      assert.match(
        nullParams.replies[0].error.message,
        /Unknown tool: $/,
        `measured: the name after the colon is empty, so the message names nothing: ${JSON.stringify(nullParams.replies[0].error.message)}`,
      );

      // The same blank name comes from a missing name and from an empty one.
      const missingName = await session('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"arguments":{}}}\n');
      assert.match(missingName.replies[0].error.message, /Unknown tool: $/, "measured: same blank name");

      const emptyName = await callTool(3, "", {});
      const empty = await session(emptyName);
      assert.match(empty.replies[0].error.message, /Unknown tool: $/, "measured: same blank name");
    });

    it("[DEFENDED] 5.8 multi-byte text survives the round trip through a tool answer", async () => {
      needGo();
      // reviewRoot() puts LAUNCHSENSE_ROOT into the message with %q, so this
      // text crosses the JSON encoder and the decoder twice.
      const dir = mkdtempSync("/tmp/opencode/w4-red-root-");
      const odd = "café-\u{1F600}-tab\there";
      try {
        const result = await session(callTool(1, "launchsense_scan_repo", {}), {
          env: { LAUNCHSENSE_ROOT: odd },
        });
        const text = result.replies[0].result.content[0].text;
        assert.equal(result.replies[0].result.isError, true, "a relative root is refused, which is the path we want");
        assert.ok(text.includes("café-\u{1F600}"), `multi-byte characters survive: ${text}`);
        assert.ok(!text.includes("\uFFFD"), "no replacement character, so nothing was mangled");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ------------------------------------------------------------------
  // Target 6: session and envelope
  // ------------------------------------------------------------------
  describe("target 6: session and envelope", () => {
    it("[OPEN] 6.1 tools/list before initialize is answered with the whole tool list", async () => {
      needGo();
      const result = await session(frame(request(1, "tools/list")));
      assert.equal(result.replies.length, 1, `answered before any initialize: ${result.stdout.slice(0, 160)}`);
      assert.ok(result.replies[0].result, "measured: a result, not an error");
      const tools = result.replies[0].result.tools;
      assert.ok(Array.isArray(tools) && tools.length > 0, `measured: ${tools?.length} tools served with no session`);
      assert.equal(result.stderr, "", "and nothing was logged about the missing handshake");
      // OPEN: the MCP lifecycle starts at initialize. A request before it is
      // answered by a server that keeps no session state at all.
    });

    it("[OPEN] 6.2 a tools/call before initialize does real work and reports success", async () => {
      needGo();
      const result = await session(callTool(1, "launchsense_scan_public_notice", {}));
      assert.equal(result.replies.length, 1);
      assert.ok(result.replies[0].result, "measured: a result");
      assert.equal(result.replies[0].result.isError, false, "measured: isError false, so the tool ran");
      assert.ok(
        result.replies[0].result.content[0].text.includes("convex.site/mcp"),
        "measured: the tool really produced its answer with no session",
      );
    });

    it("[OPEN] 6.3 a second initialize is answered as if it were the first", async () => {
      needGo();
      const result = await session(
        frames(
          request(1, "initialize", { protocolVersion: "2024-11-05" }),
          request(2, "initialize", { protocolVersion: "2025-11-25" }),
        ),
      );
      assert.deepEqual(result.replies.map((r) => r.id), [1, 2], `both answered: ${result.stdout.slice(0, 200)}`);
      assert.ok(result.replies[0].result.serverInfo, "measured: the first answered");
      assert.ok(result.replies[1].result.serverInfo, "measured: the second answered too, with no complaint");
      // OPEN: the lifecycle allows one initialize. A second one is a client
      // that restarted or raced, and the answer should say so rather than hand
      // out a second full handshake.
    });

    it("[OPEN] 6.4 jsonrpc 1.0, and a message with no jsonrpc member at all, are both served normally", async () => {
      needGo();
      for (const [name, input] of [
        ["jsonrpc 1.0", '{"jsonrpc":"1.0","id":1,"method":"tools/list"}\n'],
        ["no jsonrpc member", '{"id":2,"method":"tools/list"}\n'],
        ["no jsonrpc, a tool call", '{"id":3,"method":"tools/call","params":{"name":"launchsense_scan_public_notice","arguments":{}}}\n'],
      ]) {
        const result = await session(input);
        assert.equal(result.replies.length, 1, `${name}: one answer, got ${result.stdout.slice(0, 120)}`);
        const reply = result.replies[0];
        assert.ok(reply.result, `${name}: measured as served normally, result present`);
        assert.equal(reply.jsonrpc, "2.0", `${name}: the server always says 2.0 on the way out`);
        assert.ok(!("error" in reply), `${name}: no error was raised about the envelope`);
      }
      // OPEN, and this is the known one from the release QA (F8). The jsonrpc
      // member is never read, so a wrong version or no version at all is
      // indistinguishable from a correct client.
    });

    it("[OPEN] 6.5 protocolVersion on the way in is ignored, and every version gets 2024-11-05", async () => {
      needGo();
      for (const version of ["2025-06-18", "2025-11-25", "2099-01-01", 20250618, null]) {
        const result = await session(frame(request(1, "initialize", { protocolVersion: version })));
        assert.equal(result.replies.length, 1, `one answer for ${JSON.stringify(version)}`);
        assert.equal(
          result.replies[0].result.protocolVersion,
          "2024-11-05",
          `measured: ${JSON.stringify(version)} is answered with 2024-11-05`,
        );
      }
      const absent = await session(frame(request(1, "initialize")));
      assert.equal(absent.replies[0].result.protocolVersion, "2024-11-05", "measured: no version asked, one given");
      // OPEN: a version the server does not implement, and a version nobody
      // has heard of, are both accepted silently. Negotiation needs either an
      // error for an unsupported version or a stated policy.
    });

    it("[DEFENDED] 6.6 a notification carries no id and is correctly not answered", async () => {
      needGo();
      const result = await session(
        frames({ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", method: "ping" }),
      );
      assert.equal(result.replies.length, 0, `a notification gets silence: ${result.stdout}`);
      assert.equal(result.code, 0);
    });

    it("[OPEN] 6.7 an explicit \"id\": null is dropped like a notification, so a client that sends it waits forever", async () => {
      needGo();
      // JSON-RPC 2.0: a missing id means a notification. An id that is present
      // and null is a request, and it must be answered with id null. The
      // server treats both as a notification, so nothing comes back and
      // nothing says why.
      const result = await session('{"jsonrpc":"2.0","id":null,"method":"ping"}\n');
      assert.equal(result.replies.length, 0, `measured: no answer at all: ${JSON.stringify(result.stdout)}`);
      assert.equal(result.stderr, "", "measured: and nothing on stderr to explain the silence");
      assert.equal(result.code, 0, "the server is alive, it just never answered");
    });

    it("[OPEN] 6.8 a JSON-RPC batch is answered as a parse error", async () => {
      needGo();
      const result = await session('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n');
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.equal(result.replies[0].error.code, -32700, "measured: a batch is called a parse error");
      assert.equal(result.replies[0].id, null);
      assert.match(result.stderr, /parse error/, "measured: stderr calls an array a parse error too");
      // OPEN, low. Batching arrived with protocol 2025-03-26 and this server
      // only claims 2024-11-05, so refusing is defensible. What is not
      // defensible is calling a well-formed JSON array a parse error: the line
      // parsed fine, the message shape was wrong. It should be -32600.
    });

    it("[OPEN] 6.9 a jsonrpc member of the wrong JSON type is answered as a parse error", async () => {
      needGo();
      const result = await session('{"jsonrpc":2.0,"id":1,"method":"ping"}\n');
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.equal(
        result.replies[0].error.code,
        -32700,
        "measured: -32700, but the line was valid JSON, so this is a shape error (-32600)",
      );
      assert.match(result.stderr, /cannot unmarshal number into Go struct/, "measured: the Go error leaks the struct name");
    });

    it("[OPEN] 6.10 a non-scalar id is echoed back unchanged", async () => {
      needGo();
      const result = await session('{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}\n');
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.deepEqual(
        result.replies[0].id,
        { a: 1 },
        "measured: an object id is echoed. JSON-RPC 2.0 allows only a string, a number or null",
      );
      const stringId = await session('{"jsonrpc":"2.0","id":"abc","method":"ping"}\n');
      assert.equal(stringId.replies[0].id, "abc", "measured: a string id is echoed, which is allowed");
      const zeroId = await session('{"jsonrpc":"2.0","id":0,"method":"ping"}\n');
      assert.equal(zeroId.replies[0].id, 0, "measured: id 0 is answered, so zero is not mistaken for absent");
    });
  });
});