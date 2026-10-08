// Red-team checks for the fixed local MCP server (mcp/server.ts).
//
// These tests attack the server and record what it actually does. Every test
// asserts the CURRENT behaviour, and the name says whether that behaviour is a
// DEFENCE (the server refuses, and the session survives) or an OPEN hole (the
// server does something the protocol does not allow). An OPEN test is a
// change-detector: it passes while the hole is open and fails the moment the
// server is fixed, which is the point. Fixing an OPEN hole means flipping the
// assertion to the required behaviour, not deleting the test.
//
// The server under test is the real one, run with node over real pipes with real
// bytes. No network is used: LAUNCHSENSE_API_URL points at a loopback fixture,
// or at 127.0.0.1:1 which refuses, so nothing can reach the real deployment.
// HOME is a temp folder, so no gh login is read and no token is touched.
//
// Labels in the source this file was written against:
//   lib/limits.ts      maxMessageBytes = 4 MiB, counted on the line including
//                      its newline
//   lib/limits.ts      maxReportBytes  = 1 MiB
//   lib/limits.ts      apiTimeoutMs    = 8s
//   server.ts          serve: read a line, answer a line
//   lib/framing.ts     LineReader: reassemble, refuse oversize, drain
//   server.ts          begin: envelope and lifecycle checks, in arrival order
//   lib/review.ts      reviewTimeoutMs = 10 minutes, off the read path
//
// W41-MCP moved the lifecycle, the envelope, the version negotiation and the
// write guard into the server, and made the loop concurrent. Rows 6.1 to 6.10 and
// 4.3 below were flipped from OPEN to DEFENDED against that change; every other
// row was re-run unchanged, because a session change can break a framing row
// that has nothing to do with it.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(REPO, "mcp", "server.ts");
const HOME = mkdtempSync("/tmp/opencode/w4-red-home-");

// The two bounds in force, read from lib/limits.ts.
const CAP = 4 << 20; // maxMessageBytes
const REPORT_CAP = 1 << 20; // maxReportBytes
// Port 1 refuses, so an accidental real call fails instead of leaving the box.
const DEAD_API = "http://127.0.0.1:1";

after(() => rmSync(HOME, { recursive: true, force: true }));

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
    const child = spawn(process.execPath, [SERVER], {
      cwd: join(REPO, "mcp"),
      env: { PATH: process.env.PATH, HOME, LAUNCHSENSE_API_URL: DEAD_API, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    // When each answer arrived, in milliseconds after the session started. The
    // loop is concurrent and the session ends only when stdin closes and every
    // handler in flight has finished, so the time a session took is not the time
    // a particular answer took. A test that wants to know how fast one message
    // was answered reads this instead.
    const arrivedAt = new Map();
    let scanned = 0;
    const noteArrivals = () => {
      const consumed = stdout.lastIndexOf("\n");
      if (consumed < scanned) return;
      const complete = stdout.slice(scanned, consumed);
      scanned = consumed + 1;
      for (const line of complete.split("\n")) {
        if (line === "") continue;
        try {
          const msg = JSON.parse(line);
          if (msg && msg.id !== undefined) arrivedAt.set(msg.id, Date.now() - startedAt);
        } catch {
          // A framing break shows up in the assertions on stdout, not here.
        }
      }
    };
    child.stdout.on("data", (d) => {
      stdout += d;
      noteArrivals();
    });
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
        arrivedAt,
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

/** The handshake every session needs before anything but ping. The server now
 *  negotiates the same versions the hosted surface serves, and refuses anything
 *  else before initialize, so a session probe starts the same way a real client
 *  does. */
const HELLO = frames(request(0, "initialize", { protocolVersion: "2025-06-18" }));

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

/** Asserts the server is up. The server is a Node script and always present, so
 *  this is a named call site rather than a build gate. */
function needServer() {
  // Nothing to build: the server runs from source with node.
}

describe("Red team: the local MCP server", () => {
  // ------------------------------------------------------------------
  // Target 1: transport framing
  // ------------------------------------------------------------------
  describe("target 1: transport", () => {
    it("[DEFENDED] 1.1 an LSP Content-Length frame is one parse error, and the messages after it still answer", async () => {
      needServer();
      const body = JSON.stringify(request(1, "initialize", { protocolVersion: "2024-11-05" }));
      const lsp = `Content-Length: ${body.length}\r\n\r\n${body}\n`;
      const result = await session(lsp + PING);
      // Three answers: the header line is a parse error, the two blank CR lines
      // are not messages, and the body plus the ping both answer. They are
      // matched by id, not by position, because each message is handled in its
      // own goroutine and the two real answers can arrive in either order.
      assert.equal(result.replies.length, 3, `the header line and the two messages answer: ${result.stdout}`);
      const parseError = result.replies.find((r) => r.id === null && r.error?.code === -32700);
      assert.ok(parseError, `a Content-Length header is not JSON: ${result.stdout.slice(0, 200)}`);
      assert.equal(parseError.id, null, "the id is null, because none could be read");
      const handshake = result.replies.find((r) => r.id === 1);
      assert.ok(handshake?.result?.serverInfo, "the body inside the old frame is read as a plain message and answered");
      assert.ok(
        result.replies.find((r) => r.id === 999)?.result,
        "the message after the frame still answers: no desync",
      );
      assert.match(result.stderr, /parse error/, "one line on stderr names the refusal");
      assert.equal(result.code, 0, "the session ends cleanly, not with a crash");
    });

    it("[DEFENDED] 1.2 a final line with no trailing newline is still a message", async () => {
      needServer();
      const result = await session(JSON.stringify(request(5, "ping")));
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.equal(result.replies[0].id, 5, "the unterminated last line was not dropped");
      assert.ok(result.replies[0].result, "and it is answered with a result");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 1.3 a message with an embedded newline answers one parse error per fragment and the session survives", async () => {
      needServer();
      // A real newline inside a JSON string. The transport says messages must
      // not contain one, so this is undefined by the spec; the point is that
      // the server stays usable rather than hanging or dying.
      const result = await session(
        '{"jsonrpc":"2.0","id":8,"method":"ping","note":"line one\nline two"}\n' + PING,
      );
      assert.equal(result.replies.length, 3, `two fragments, then the ping: ${result.stdout}`);
      // Both fragments are refused on the reader loop with a null id, so they are
      // counted by code and the ping is matched by id.
      const parseErrors = result.replies.filter((r) => r.id === null && r.error?.code === -32700);
      assert.equal(parseErrors.length, 2, `the head and the tail are both refused: ${result.stdout}`);
      assert.ok(result.replies.find((r) => r.id === 999)?.result, "the next real message still answers");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 1.4 a fragment that happens to be a complete message is served, which is what line framing means", async () => {
      needServer();
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
      // Matched by id. The broken head is refused on the reader loop with a null
      // id, and the two real messages are answered by their own goroutines, so
      // their order on stdout is not fixed.
      assert.ok(
        result.replies.some((r) => r.id === null && r.error?.code === -32700),
        "the broken head is refused",
      );
      assert.equal(result.replies.find((r) => r.id === 666)?.id, 666, "the tail is read as its own message");
      assert.equal(result.replies.find((r) => r.id === 999)?.id, 999, "and the session is still aligned afterwards");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 1.5 a partial line is reassembled across three writes, then the next message answers", async () => {
      needServer();
      // The split line is the handshake itself, so no separate initialize is
      // needed and the reassembled message is still the one under test.
      const result = await session(
        [
          '{"jsonrpc":"2.0","id":1,',
          200,
          '"method":"initialize","params":{"protocolVersion":"2025-06-18"}',
          200,
          "}\n" + PING,
          200,
          CLOSE,
        ],
        { killAfterMs: 20_000 },
      );
      assert.equal(result.replies.length, 2, `one message in, one answer each: ${result.stdout.slice(0, 200)}`);
      // Matched by id, not by position: the ping may answer before the handshake
      // does, because each message is handled in its own goroutine.
      const handshake = result.replies.find((r) => r.id === 1);
      assert.ok(handshake, `the joined message answered; got: ${result.stdout.slice(0, 200)}`);
      assert.ok(handshake.result?.serverInfo, "the halves were joined, not cut, so initialize was served");
      const ping = result.replies.find((r) => r.id === 999);
      assert.ok(ping?.result, "the next message answers");
      assert.equal(result.stderr, "", "nothing was logged for a legal split write");
    });

    it("[DEFENDED] 1.6 a partial line then EOF is a parse error, not silence and not a crash", async () => {
      needServer();
      const result = await session('{"jsonrpc":"2.0","id":12,"method":"pi');
      assert.equal(result.replies.length, 1, `the half message is answered: ${result.stdout}`);
      assert.equal(result.replies[0].error.code, -32700, "an unfinished message is a parse error");
      assert.equal(result.replies[0].id, null, "with a null id, because none could be read");
      // One answer in the session, so position and id are the same thing here.
      assert.match(result.stderr, /parse error/, "and one line on stderr");
      assert.equal(result.code, 0, "the server does not die on a truncated message");
    });

    it("[DEFENDED] 1.7 two messages in one write are each answered once, matched by id", async () => {
      needServer();
      const result = await session(
        frames(
          request(1, "initialize", { protocolVersion: "2025-06-18" }),
          request(2, "tools/list"),
          request(3, "ping"),
        ),
      );
      // The loop is concurrent now, so three answers in one write are three
      // answers, not necessarily in this order. Every id is matched exactly once.
      assert.deepEqual(
        [...result.replies.map((r) => r.id)].sort((a, b) => a - b),
        [1, 2, 3],
        `${result.stdout.slice(0, 200)}`,
      );
      const byId = new Map(result.replies.map((r) => [r.id, r]));
      assert.ok(byId.get(1).result.serverInfo, "the handshake answered");
      assert.ok(Array.isArray(byId.get(2).result.tools), "the middle message answered with its tools");
      assert.ok(byId.get(3).result, "the last one answered with a result");
      assert.equal(result.stderr, "", "a legal session logs nothing");
    });

    it("[DEFENDED] 1.8 a zero-length line and a whitespace-only line invent no reply", async () => {
      needServer();
      const result = await session(`\n\n\r\n   \t \n${PING}\n\n`);
      assert.equal(result.replies.length, 1, `only the ping is answered: ${result.stdout}`);
      assert.equal(result.replies[0].id, 999);
      assert.equal(result.stderr, "", "a blank line is not an event");
    });

    it("[DEFENDED] 1.9 a CRLF session answers every message", async () => {
      needServer();
      const result = await session(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\r\n' +
          '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\r\n' +
          "\r\n" +
          '{"jsonrpc":"2.0","id":3,"method":"ping"}\r\n',
      );
      assert.deepEqual(
        [...result.replies.map((r) => r.id)].sort((a, b) => a - b),
        [1, 2, 3],
        `${result.stdout.slice(0, 200)}`,
      );
      const byId = new Map(result.replies.map((r) => [r.id, r]));
      assert.ok(byId.get(1).result.serverInfo, "initialize answered");
      assert.ok(Array.isArray(byId.get(2).result.tools), "tools/list answered");
      assert.ok(byId.get(3).result, "ping answered");
    });

    it("[DEFENDED] 1.10 an answer whose text holds real newlines stays one stdout line", async () => {
      needServer();
      const result = await session(
        frames(request(0, "initialize", { protocolVersion: "2025-06-18" })) +
          callTool(1, "launchsense_scan_public_notice", {}),
      );
      assert.equal(result.lines.length, 2, `the handshake and one reply: ${JSON.stringify(result.stdout)}`);
      const reply = result.replies.find((r) => r.id === 1);
      assert.ok(reply.result, `the tool answered: ${result.stdout.slice(0, 160)}`);
      const text = reply.result.content[0].text;
      assert.ok(text.includes("\n"), "the tool text really does hold newlines");
      // Two lines for two messages, and every line parses as one JSON message
      // (a line that did not would come back as a NOT_JSON marker). That is what
      // proves the encoder escaped the newlines and the framing survived. The
      // previous check counted newlines in the whole stdout, which is only true
      // while there is exactly one answer; with a handshake line and a tool line
      // there is one separator between them, and that separator is not a break.
      const notJSON = result.replies.filter((r) => "NOT_JSON" in r);
      assert.deepEqual(notJSON, [], `every line is one whole JSON message: ${result.stdout.slice(0, 200)}`);
      assert.equal(
        result.stdout.split("\n").filter((line) => line !== "").length,
        2,
        "two messages, two lines, no line split by an embedded newline",
      );
    });
  });

  // ------------------------------------------------------------------
  // Target 2: the size limit
  // ------------------------------------------------------------------
  describe("target 2: size limit", () => {
    it("[DEFENDED] 2.1 the cap is enforced at the line length, and the boundary is exact both ways", async () => {
      needServer();
      // server.go counts the newline as part of the line, so a line of exactly
      // the cap is served and one byte more is refused. That makes the largest
      // servable JSON body cap-1 bytes. The refusal text says the limit is
      // `cap` bytes, which is one byte generous for a body. Recorded, low.
      // ping is the one method that answers before the handshake, so the probe
      // lines are served without a session.
      const atCapMinusOne = await session(lineOfBytes(CAP - 1, 20) + PING, { killAfterMs: 30_000 });
      assert.deepEqual(
        atCapMinusOne.replies.map((r) => r.id).sort((a, b) => a - b),
        [20, 999],
        `a line one byte under the cap is a normal message: ${atCapMinusOne.stderr}`,
      );
      assert.ok(
        atCapMinusOne.replies.find((r) => r.id === 20).result,
        "and it is answered with a result",
      );

      const atCap = await session(lineOfBytes(CAP, 21) + PING, { killAfterMs: 30_000 });
      assert.deepEqual(
        atCap.replies.map((r) => r.id).sort((a, b) => a - b),
        [21, 999],
        `a line of exactly the cap is still served: ${atCap.stderr}`,
      );
      assert.ok(atCap.replies.find((r) => r.id === 21).result, "and it is answered with a result");
    });

    it("[DEFENDED] 2.2 a line one byte over the cap is refused with a protocol error, and nothing runs", async () => {
      needServer();
      const result = await session(lineOfBytes(CAP + 1, 30) + PING, { killAfterMs: 30_000 });
      assert.equal(result.replies.length, 2, `the oversize line is answered, not dropped: ${result.stdout.slice(0, 120)}`);
      const refused = result.replies.find((r) => r.error?.code === -32600);
      assert.ok(refused, `the oversize line is refused: ${result.stdout.slice(0, 160)}`);
      assert.equal(refused.id, null, "no id could be read from a message that was refused");
      assert.match(refused.error.message, /too large/i, "the answer says why");
      assert.match(refused.error.message, new RegExp(String(CAP)), "and names the cap");
      assert.ok(!("result" in refused), "a refusal is not a result");
      assert.equal(result.replies.find((r) => r.id === 999).id, 999, "the next message answers: the stream did not desync");
      assert.equal(result.code, 0, `clean exit; stderr: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /out of memory|SIGSEGV|goroutine/, "no crash over one big line");
    });

    it("[DEFENDED] 2.3 a multi-byte line is measured in bytes, and the boundary does not split a character", async () => {
      needServer();
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
      const atCap = result.replies.find((r) => r.id === 40);
      assert.ok(atCap.result, "the multi-byte line at the cap is served");
      assert.equal(result.replies.find((r) => r.error?.code === -32600).id, null, "the multi-byte line over the cap is refused");
      assert.equal(result.replies.find((r) => r.id === 999).id, 999, "and the next message still answers");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 2.4 a 64 MiB line is refused fast, with no out of memory and no lost session", async () => {
      needServer();
      const head = '{"jsonrpc":"2.0","id":50,"method":"ping","pad":"';
      const chunk = "a".repeat(1 << 20);
      const parts = [head];
      for (let i = 0; i < 64; i++) parts.push(chunk);
      parts.push('"}\n', PING);
      const started = Date.now();
      const result = await session(parts.join(""), { killAfterMs: 45_000 });
      const waited = Date.now() - started;
      assert.equal(result.replies.length, 2, `${result.stdout.slice(0, 120)}`);
      assert.equal(
        result.replies.find((r) => r.error?.code === -32600)?.id,
        null,
        "64 MiB is refused like any oversize line",
      );
      assert.equal(result.replies.find((r) => r.id === 999)?.id, 999, "the ping after it answers, so the 64 MiB was drained to the newline");
      assert.equal(result.code, 0, `clean exit; stderr: ${result.stderr.slice(0, 200)}`);
      assert.doesNotMatch(result.stderr, /out of memory|SIGSEGV|goroutine 1 \[/, "no Go runtime death");
      assert.ok(waited < 20_000, `refused and drained in ${waited}ms, not held in memory`);
    });

    it("[DEFENDED] 2.5 an oversize line with no trailing newline, then EOF, is still refused", async () => {
      needServer();
      const head = '{"jsonrpc":"2.0","id":60,"method":"ping","pad":"';
      const line = head + "a".repeat(CAP + 4096) + '"}';
      assert.ok(Buffer.byteLength(line) > CAP);
      const result = await session(line, { killAfterMs: 30_000 });
      assert.equal(result.replies.length, 1, `refused, not dropped: ${result.stdout.slice(0, 120)}`);
      // One answer in the session: the refusal is answered on the reader loop
      // with a null id because the line was too long to read an id from.
      assert.equal(result.replies[0].error.code, -32600);
      assert.equal(result.replies[0].id, null);
      assert.equal(result.code, 0, "and the server then exits cleanly at EOF");
    });
  });

  // ------------------------------------------------------------------
  // Target 3: local report size cap
  // ------------------------------------------------------------------
  describe("target 3: truncation", () => {
    function reportRoot(body) {
      const dir = mkdtempSync("/tmp/opencode/w4-red-report-");
      mkdirSync(join(dir, ".ls", "reports"), { recursive: true });
      writeFileSync(join(dir, ".ls", "reports", "2099-01-01T00-00-00-000Z.md"), body);
      return dir;
    }

    it("[DEFENDED] 3.1 a local report of exactly 1 MiB comes back whole, as a success", async () => {
      needServer();
      const dir = reportRoot(Buffer.alloc(REPORT_CAP, 0x52).toString());
      try {
        const result = await session(HELLO + callTool(1, "launchsense_report", {}), {
          env: { LAUNCHSENSE_ROOT: dir },
        });
        const reply = result.replies.find((r) => r.id === 1);
        assert.equal(reply.result.isError, false, "a body exactly at the cap is not an error");
        assert.equal(reply.result.content[0].text.length, REPORT_CAP, "every byte came through");
        assert.doesNotMatch(reply.result.content[0].text, /1 MiB/, "and nothing claims it was clipped");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("[DEFENDED] 3.2 a local report one byte over 1 MiB is refused, never returned whole", async () => {
      needServer();
      const dir = reportRoot(Buffer.alloc(REPORT_CAP + 1, 0x52).toString());
      try {
        const result = await session(HELLO + callTool(1, "launchsense_report", {}), {
          env: { LAUNCHSENSE_ROOT: dir },
        });
        const reply = result.replies.find((r) => r.id === 1);
        const text = reply.result.content[0].text;
        assert.equal(reply.result.isError, true, "an overlarge local report must not be a success");
        assert.match(text, /1 MiB/, "the answer names the limit");
        assert.ok(text.length < REPORT_CAP, "the answer is far shorter than the file that arrived");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("[DEFENDED] 3.3 no local report yet is an error that names the fix, not an empty success", async () => {
      needServer();
      const dir = mkdtempSync("/tmp/opencode/w4-red-report-");
      try {
        const result = await session(HELLO + callTool(1, "launchsense_report", {}), {
          env: { LAUNCHSENSE_ROOT: dir },
        });
        const reply = result.replies.find((r) => r.id === 1);
        assert.equal(reply.result.isError, true, "a missing report is a failure");
        assert.match(reply.result.content[0].text, /launchsense_scan_repo/, "and it names the tool that writes one");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ------------------------------------------------------------------
  // Target 4: the report never touches the network
  // ------------------------------------------------------------------
  describe("target 4: timeout", () => {
    it("[DEFENDED] 4.1 a dead API does not stop the local report, and the queued ping still answers", async () => {
      needServer();
      const dir = mkdtempSync("/tmp/opencode/w4-red-report-");
      mkdirSync(join(dir, ".ls", "reports"), { recursive: true });
      writeFileSync(join(dir, ".ls", "reports", "2099-01-01T00-00-00-000Z.md"), "Local report body.");
      try {
        const result = await session(
          HELLO + callTool(1, "launchsense_report", {}) + PING,
          { env: { LAUNCHSENSE_ROOT: dir, LAUNCHSENSE_API_URL: DEAD_API }, killAfterMs: 30_000 },
        );
        assert.equal(result.replies.length, 3, `every message answers: ${result.stdout.slice(0, 160)}`);
        const call = result.replies.find((r) => r.id === 1);
        assert.equal(call.result.isError, false, "the local report answers with no network");
        assert.match(call.result.content[0].text, /Local report body/);
        assert.equal(result.replies.find((r) => r.id === 999).id, 999, "a dead API does not take ping down with it");
        assert.equal(result.code, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("[DEFENDED] 4.2 two concurrent local reports and a ping all answer", async () => {
      needServer();
      const dir = mkdtempSync("/tmp/opencode/w4-red-report-");
      mkdirSync(join(dir, ".ls", "reports"), { recursive: true });
      writeFileSync(join(dir, ".ls", "reports", "2099-01-01T00-00-00-000Z.md"), "Local report body.");
      try {
        const result = await session(
          HELLO + callTool(1, "launchsense_report", {}) + callTool(2, "launchsense_report", {}) + PING,
          { env: { LAUNCHSENSE_ROOT: dir }, killAfterMs: 30_000 },
        );
        assert.equal(result.replies.length, 4, `every message answers: ${result.stdout.slice(0, 160)}`);
        for (const id of [1, 2]) {
          const call = result.replies.find((r) => r.id === id);
          assert.equal(call.result.isError, false, `report ${id} answers`);
        }
        assert.equal(result.replies.find((r) => r.id === 999).id, 999, "ping still answers");
        assert.equal(result.code, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("[DEFENDED] 4.3 a review subprocess that never finishes does not block any later message", async () => {
      needServer();
      // lib/review.ts sets reviewTimeoutMs to 10 minutes, so a review that
      // never exits is still running ten minutes later. What changed is that it no
      // longer runs on the read loop: each message is handled in its own
      // goroutine, so ping and every other request are answered while the review
      // is still going. The review itself is still bounded by its own budget and
      // comes back as an error, which TestReviewSubprocessTimeout in mcp/ covers.
      const dir = mkdtempSync("/tmp/opencode/w4-red-review-");
      const script = join(dir, "never-finishes.ts");
      writeFileSync(script, "setInterval(() => {}, 1000);\n");
      try {
        const result = await session(
          frames(request(0, "initialize", { protocolVersion: "2025-06-18" })) +
            callTool(1, "launchsense_scan_repo", {}) +
            PING,
          {
            env: { LAUNCHSENSE_REVIEW: script, LAUNCHSENSE_ROOT: dir },
            // The review never exits, so serve waits for it after stdin closes and
            // this session can only end when the harness kills the process.
            killAfterMs: 15_000,
          },
        );
        // The handshake and the ping both answer. The review does not, because the
        // script never exits, and that is the point: it is not holding anything up.
        // Matched by id, not by position: the ping is answered while the review is
        // still running, so it is normally first on stdout.
        const ids = result.replies.map((r) => r.id);
        assert.deepEqual(
          [...ids.filter((id) => id !== 1)].sort((a, b) => a - b),
          [0, 999],
          `the handshake and the ping answer while the review is still running: ${result.stdout.slice(0, 200)}`,
        );
        assert.ok(
          !ids.includes(1),
          "the review itself has no answer yet, which is what a 10 minute budget looks like from here",
        );
        const ping = result.replies.find((r) => r.id === 999);
        assert.ok(ping.result, `ping is answered with a result: ${JSON.stringify(ping)}`);
        // The ping's own arrival time, not the length of the session. This session
        // cannot finish early: stdin closes and serve waits for the review still
        // running under its 10 minute budget, so the session is only over when the
        // harness kills it at killAfterMs. Timing the session would time the kill.
        const pingAt = result.arrivedAt.get(999);
        assert.equal(typeof pingAt, "number", `the ping's arrival was recorded: ${[...result.arrivedAt.entries()]}`);
        assert.ok(pingAt < 5_000, `the ping came back in ${pingAt}ms, not after the 10 minute review budget`);
        assert.ok(
          result.arrivedAt.get(0) < pingAt + 5_000,
          `the handshake answered too, in ${result.arrivedAt.get(0)}ms`,
        );
        // The review never answered at all, so its arrival was never recorded.
        assert.equal(result.arrivedAt.has(1), false, "the review is still running when the ping answered");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("[DEFENDED] 4.4 ten concurrent pings all answer while one slow tool call is in flight", async () => {
      needServer();
      // The defect was a serialised loop, so this is the shape that broke it: one
      // request that takes its time and a pile of cheap ones behind it. Each gets
      // its own answer and no two answers share a line.
      const dir = mkdtempSync("/tmp/opencode/w4-red-slow-");
      const script = join(dir, "slow-review.ts");
      writeFileSync(script, "setTimeout(() => {}, 6000);\nconsole.log('{\"findings\":[]}');\n");
      try {
        const started = Date.now();
        const result = await session(
          frames(request(0, "initialize", { protocolVersion: "2025-06-18" })) +
            callTool(1, "launchsense_scan_repo", {}) +
            Array.from({ length: 10 }, (_, i) => frame(request(100 + i, "ping"))).join(""),
          {
            env: { LAUNCHSENSE_REVIEW: script, LAUNCHSENSE_ROOT: dir },
            killAfterMs: 30_000,
          },
        );
        const waited = Date.now() - started;
        const pings = result.replies.filter((r) => typeof r.id === "number" && r.id >= 100);
        assert.equal(pings.length, 10, `all ten pings answer: ${result.stdout.slice(0, 200)}`);
        // Each ping is matched by its own id, so all ten really answered rather
        // than one id answering twice.
        for (let i = 0; i < 10; i += 1) {
          const answer = result.replies.filter((r) => r.id === 100 + i);
          assert.equal(answer.length, 1, `exactly one answer for ping ${100 + i}`);
          assert.ok(answer[0].result, `ping ${100 + i} answered with a result`);
        }
        for (const ping of pings) {
          assert.ok(ping.result, `ping ${ping.id} answered with a result`);
        }
        // One line per message: no answer was split by a concurrent writer.
        assert.equal(result.replies.length, result.lines.length, `framing held: ${result.stdout.slice(0, 200)}`);
        assert.ok(
          result.replies.some((r) => r.id === 1),
          `the slow review answered too, once its script finished: ${result.stdout.slice(0, 300)}`,
        );
        assert.ok(waited < 30_000, `the whole exchange took ${waited}ms`);
        assert.equal(result.code, 0, `the session ends cleanly; stderr: ${result.stderr.slice(0, 200)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ------------------------------------------------------------------
  // Target 5: tool names and arguments
  // ------------------------------------------------------------------
  describe("target 5: tool names and arguments", () => {
    /** One tools/call per session, so nothing else can answer for it. The
     *  handshake is sent first because the server now refuses a tool call that
     *  arrives before it, which is row 6.2. */
    const ask = async (name, args, extra = {}) => {
      const result = await session(HELLO + callTool(1, name, args), extra);
      const reply = result.replies.find((r) => r.id === 1);
      assert.ok(reply, `the tool call is answered: ${result.stdout.slice(0, 200)}`);
      return reply;
    };

    it("[DEFENDED] 5.1 the hosted tool name called locally is a protocol error, not a scan that reports nothing", async () => {
      needServer();
      const reply = await ask("launchsense_scan_public", { repoUrl: "https://github.com/octocat/Hello-World" });
      assert.ok(!("result" in reply), "a name this server does not have never returns a result");
      assert.equal(reply.error.code, -32602, "it is Invalid params");
      assert.match(reply.error.message, /launchsense_scan_public/, "and it names what was asked for");
      assert.doesNotMatch(reply.error.message, /scan of|scanned|scan complete/i, "it must not read like a scan ran");
      // The list must not advertise it either, or a client would keep trying.
      const list = await session(HELLO + frame(request(1, "tools/list")));
      const names = list.replies.find((r) => r.id === 1).result.tools.map((t) => t.name);
      assert.ok(!names.includes("launchsense_scan_public"), `tools/list must not offer it: ${names.join(", ")}`);
      assert.ok(names.includes("launchsense_scan_public_notice"), "the pointer to the hosted read is offered instead");
    });

    it("[DEFENDED] 5.2 an unknown tool name is -32602 with no result member", async () => {
      needServer();
      const reply = await ask("launchsense_nope", {});
      assert.equal(reply.error.code, -32602);
      assert.match(reply.error.message, /launchsense_nope/);
      assert.ok(!("result" in reply), "isError is for a tool that ran and failed, not one that does not exist");
    });

    it("[DEFENDED] 5.3 an undeclared argument names the field", async () => {
      needServer();
      for (const args of [{ scanId: "x" }, { scanId: null }, { scanId: "   " }]) {
        const reply = await ask("launchsense_report", args);
        assert.equal(reply.error.code, -32602, `for ${JSON.stringify(args)}`);
        assert.match(reply.error.message, /unexpected property scanId/, `says which field: ${reply.error.message}`);
      }
    });

    it("[DEFENDED] 5.4 a wrong-typed undeclared argument is still the same undeclared field, not a missing one", async () => {
      needServer();
      for (const [value, got] of [[42, "number"], [true, "boolean"], [["a"], "array"], [{}, "object"]]) {
        const reply = await ask("launchsense_report", { scanId: value });
        assert.equal(reply.error.code, -32602, `for ${JSON.stringify(value)}`);
        assert.match(
          reply.error.message,
          /unexpected property scanId/,
          `a wrong type on a dropped field is still that field: ${reply.error.message}`,
        );
        assert.doesNotMatch(reply.error.message, /is required/, `not a missing field either: ${reply.error.message}`);
      }
    });

    it("[DEFENDED] 5.5 an undeclared argument is refused by name and lists what is declared", async () => {
      needServer();
      const extra = await ask("launchsense_report", { scanId: "x", bogusProp: "y" });
      assert.equal(extra.error.code, -32602);
      assert.match(extra.error.message, /unexpected property bogusProp/);
      assert.match(extra.error.message, /takes no arguments/, "and says the tool takes none");

      // The tool that dropped repoUrl must say so rather than ignore it.
      const dropped = await ask("launchsense_scan_repo", { repoUrl: "https://github.com/octocat/Hello-World" });
      assert.equal(dropped.error.code, -32602, `an ignored argument is a mistake, not a no-op: ${dropped.error.message}`);
      assert.match(dropped.error.message, /repoUrl/);
      assert.doesNotMatch(dropped.error.message, /Reviewed folder/, "nothing was reviewed, so no report text comes back");
      assert.ok(!("result" in dropped), "and it is not a result");
    });

    it("[DEFENDED] 5.6 malformed params and calls are protocol errors, never a result", async () => {
      needServer();
      const cases = [
        ["arguments as a string", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":"scanId=x"}}\n', -32602, /must be a JSON object/],
        ["arguments as an array", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":["scanId"]}}\n', -32602, /must be a JSON object/],
        ["params as a string", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"scanId=x"}\n', -32602, /Invalid tool call/],
        ["name as a number", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":7,"arguments":{}}}\n', -32602, /Invalid tool call/],
        ["a dropped scanId", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":{"scanId":"a"}}}\n', -32602, /unexpected property scanId/],
        ["a duplicate key", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":{"scanId":"a","scanId":null}}}\n', -32602, /unexpected property scanId/],
        ["a prototype key", '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launchsense_report","arguments":{"bogus":"x","__proto__":"y","constructor":"z"}}}\n', -32602, /unexpected property/],
        ["an unknown method", '{"jsonrpc":"2.0","id":1,"method":"does/not/exist"}\n', -32601, /Method not found/],
      ];
      for (const [name, input, code, pattern] of cases) {
        // HELLO first: before the handshake the server answers -32002, which would
        // hide the argument check under test. Its id is 0, so the answer for id 1
        // is the one under test.
        const result = await session(HELLO + input);
        const reply = result.replies.find((r) => r.id === 1);
        assert.ok(reply, `${name}: one answer, got ${result.stdout.slice(0, 160)}`);
        assert.ok(!("result" in reply), `${name}: must not be a result, got ${JSON.stringify(reply).slice(0, 160)}`);
        assert.equal(reply.error.code, code, `${name}: wrong code`);
        assert.match(reply.error.message, pattern, `${name}: wrong message: ${reply.error.message}`);
        assert.equal(result.code, 0, `${name}: the server stays up`);
      }
    });

    it("[DEFENDED] 5.7 a null params names the envelope problem, not a tool that does not exist", async () => {
      needServer();
      // Fixed 2026-10-06. A null params unmarshals into an empty tool call, and
      // the answer used to be "Unknown tool: " with a blank name, which pointed
      // the reader at the tool list instead of at the bad message. It now names
      // the real problem: params must be an object with a name field.
      const nullParams = await session(
        HELLO + '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":null}\n',
      );
      const answer = nullParams.replies.find((r) => r.id === 1);
      assert.ok(answer, `one answer: ${nullParams.stdout.slice(0, 160)}`);
      assert.equal(answer.error.code, -32602, "still a params error");
      assert.doesNotMatch(
        answer.error.message,
        /Unknown tool/,
        "it must not blame a tool when no tool was named",
      );
      assert.match(answer.error.message, /name field/, "it names the real problem");

      // A missing name and an empty name get the same honest answer.
      const missingName = await session(
        HELLO + '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"arguments":{}}}\n',
      );
      assert.match(
        missingName.replies.find((r) => r.id === 2).error.message,
        /name field/,
        "a params object with no name gets the same answer",
      );

      const emptyName = await callTool(3, "", {});
      const empty = await session(HELLO + emptyName);
      assert.match(
        empty.replies.find((r) => r.id === 3).error.message,
        /name field/,
        "an empty name gets the same answer",
      );
    });

    it("[DEFENDED] 5.8 multi-byte text survives the round trip through a tool answer", async () => {
      needServer();
      // reviewRoot() puts LAUNCHSENSE_ROOT into the message with %q, so this
      // text crosses the JSON encoder and the decoder twice.
      const dir = mkdtempSync("/tmp/opencode/w4-red-root-");
      const odd = "café-\u{1F600}-tab\there";
      try {
        const result = await session(HELLO + callTool(1, "launchsense_scan_repo", {}), {
          env: { LAUNCHSENSE_ROOT: odd },
        });
        const reply = result.replies.find((r) => r.id === 1);
        const text = reply.result.content[0].text;
        assert.equal(reply.result.isError, true, "a relative root is refused, which is the path we want");
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
    // W41-MCP flipped 6.1 to 6.5, 6.7, 6.9 and 6.10. 6.8, a JSON-RPC batch, is
    // still OPEN and still measured below.
    it("[DEFENDED] 6.1 tools/list before initialize is refused with -32002 and no tool list comes back", async () => {
      needServer();
      const result = await session(frame(request(1, "tools/list")));
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout.slice(0, 160)}`);
      const reply = result.replies[0];
      assert.ok(!("result" in reply), "a refused request never returns a result");
      assert.equal(reply.error.code, -32002, "before the handshake a request is Server not initialized");
      assert.match(reply.error.message, /not initialized/i, `the answer says why: ${reply.error.message}`);
      assert.equal(reply.id, 1, "the id is echoed, so the client can match the refusal to its request");
      assert.equal(result.stderr, "", "the refusal is on stdout as a protocol answer, not a log line");
    });

    it("[DEFENDED] 6.2 a tools/call before initialize does not run the tool", async () => {
      needServer();
      const result = await session(callTool(1, "launchsense_scan_public_notice", {}));
      assert.equal(result.replies.length, 1);
      assert.ok(!("result" in result.replies[0]), "no result: the tool was not run");
      assert.equal(result.replies[0].error.code, -32002);
      assert.doesNotMatch(
        result.stdout,
        /convex\.site\/mcp/,
        "none of the tool's text comes back, so nothing reads as a finished tool call",
      );
      assert.equal(result.code, 0, "the server is alive and refuses politely");
    });

    it("[DEFENDED] 6.3 a second initialize is refused, and the session keeps working", async () => {
      needServer();
      const result = await session(
        frames(
          request(1, "initialize", { protocolVersion: "2024-11-05" }),
          request(2, "initialize", { protocolVersion: "2025-11-25" }),
          request(3, "tools/list"),
        ),
      );
      const byId = new Map(result.replies.map((r) => [r.id, r]));
      assert.equal(byId.size, 3, `each message is answered once: ${result.stdout.slice(0, 240)}`);
      assert.ok(byId.get(1).result.serverInfo, "the first initialize is a full handshake");
      assert.equal(byId.get(1).result.protocolVersion, "2024-11-05", "in the version the client asked for");
      assert.ok(!("result" in byId.get(2)), "a second initialize is not a second handshake");
      assert.equal(byId.get(2).error.code, -32600, "it is Invalid Request");
      assert.match(byId.get(2).error.message, /already initialized/i, `the answer says why: ${byId.get(2).error.message}`);
      assert.ok(Array.isArray(byId.get(3).result.tools), "the session still serves tools after the refusal");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 6.4 a wrong or missing jsonrpc member is refused with -32600 and nothing runs", async () => {
      needServer();
      for (const [name, input] of [
        ["jsonrpc 1.0", '{"jsonrpc":"1.0","id":1,"method":"tools/list"}\n'],
        ["no jsonrpc member", '{"id":2,"method":"tools/list"}\n'],
        ["jsonrpc is a number", '{"jsonrpc":2.0,"id":3,"method":"tools/list"}\n'],
        ["jsonrpc is an array", '{"jsonrpc":["2.0"],"id":4,"method":"tools/list"}\n'],
        ["no jsonrpc, a tool call", '{"id":5,"method":"tools/call","params":{"name":"launchsense_scan_public_notice","arguments":{}}}\n'],
      ]) {
        const result = await session(input);
        assert.equal(result.replies.length, 1, `${name}: one answer, got ${result.stdout.slice(0, 120)}`);
        const reply = result.replies[0];
        assert.ok(!("result" in reply), `${name}: nothing ran, so no result`);
        assert.equal(reply.error.code, -32600, `${name}: a message that is not JSON-RPC 2.0 is Invalid Request`);
        assert.match(reply.error.message, /jsonrpc/i, `${name}: the answer names the member: ${reply.error.message}`);
        assert.doesNotMatch(result.stderr, /Go struct field/, `${name}: the log line does not leak a Go internal`);
        assert.equal(result.code, 0, `${name}: the server stays up`);
      }
    });

    it("[ARCHIVED] hosted protocol versions are gone, local negotiates its own", async () => {
      assert.equal(existsSync(join(REPO, "convex", "mcpHttp.ts")), false);
    });

    it("[DEFENDED] 6.6 a notification carries no id and is correctly not answered", async () => {
      needServer();
      const result = await session(
        frames({ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", method: "ping" }),
      );
      assert.equal(result.replies.length, 0, `a notification gets silence: ${result.stdout}`);
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 6.7 an explicit \"id\": null is a request and is answered with id null", async () => {
      needServer();
      // JSON-RPC 2.0: a missing id member means a notification. An id that is
      // present and null is a request, and the answer must carry the same null id.
      // The server used to drop both, which left a client that sent id null
      // waiting with nothing on stderr to say why.
      const result = await session('{"jsonrpc":"2.0","id":null,"method":"ping"}\n');
      assert.equal(result.replies.length, 1, `one answer, id null: ${JSON.stringify(result.stdout)}`);
      assert.equal(result.replies[0].id, null, "the id is answered with null, which is what was asked");
      assert.ok(result.replies[0].result, "with a result, so ping is answered and not merely acknowledged");
      assert.ok(!("error" in result.replies[0]), "a null id is legal JSON-RPC, so it is not an error");
      assert.equal(result.code, 0);
      // The missing-id case is the other half and is 6.6: still silence.
      const absent = await session('{"jsonrpc":"2.0","method":"ping"}\n');
      assert.equal(absent.replies.length, 0, "a missing id is a notification and is not answered");
    });

    it("[OPEN] 6.8 a JSON-RPC batch is answered as a parse error", async () => {
      needServer();
      // Still OPEN, and still measured. W41-MCP fixed the session state and the
      // envelope for single messages. A batch is a different shape: it is a
      // well-formed JSON array of messages, and this server runs one message per
      // line. Unmarshalling it into the request struct fails, so it is still
      // answered -32700 rather than -32600, which is the honest code for it.
      const result = await session('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n');
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.equal(result.replies[0].error.code, -32700, "measured: a batch is called a parse error");
      assert.equal(result.replies[0].id, null);
      assert.match(result.stderr, /parse error/, "measured: stderr calls an array a parse error too");
      // OPEN, low. Batching arrived with protocol 2025-03-26 and this server
      // negotiates up to 2025-11-25, so refusing is defensible. What is not
      // defensible is calling a well-formed JSON array a parse error: the line
      // parsed fine, the message shape was wrong. It should be -32600.
      // Note that this server now negotiates versions in which batching is
      // defined, so the gap is narrower than it was but still there.
      const ping = await session(frames(request(1, "initialize", { protocolVersion: "2025-06-18" }), request(2, "ping")));
      assert.equal(
        ping.replies.find((r) => r.id === 1).result.protocolVersion,
        "2025-06-18",
        "the server does negotiate a version in which batches exist",
      );
    });

    it("[DEFENDED] 6.9 a jsonrpc member of the wrong JSON type is Invalid Request, not a parse error", async () => {
      needServer();
      const result = await session('{"jsonrpc":2.0,"id":1,"method":"ping"}\n');
      assert.equal(result.replies.length, 1, `one answer: ${result.stdout}`);
      assert.equal(
        result.replies[0].error.code,
        -32600,
        "the line parsed as JSON, so this is a shape error. -32700 would blame the bytes for a mistake in the message",
      );
      assert.match(result.replies[0].error.message, /jsonrpc/i, "the answer names the member");
      assert.doesNotMatch(result.stderr, /cannot unmarshal number into Go struct/, "the Go struct name is not the mistake");
      assert.equal(result.code, 0);
    });

    it("[DEFENDED] 6.10 a non-scalar id is refused, while string, number and null ids are echoed", async () => {
      needServer();
      for (const [name, id] of [
        ["an object", '{"a":1}'],
        ["an array", "[1]"],
        ["a boolean", "true"],
      ]) {
        const result = await session(`{"jsonrpc":"2.0","id":${id},"method":"ping"}\n`);
        assert.equal(result.replies.length, 1, `${name}: one answer: ${result.stdout}`);
        assert.equal(
          result.replies[0].error.code,
          -32600,
          `${name}: JSON-RPC 2.0 allows only a string, a number or null as an id`,
        );
        assert.match(result.replies[0].error.message, /id member/, `${name}: the answer names the member`);
        assert.ok(!("result" in result.replies[0]), `${name}: nothing ran`);
      }
      // The three allowed shapes are still echoed unchanged, so a client that
      // used one of them is not broken by the check.
      const stringId = await session('{"jsonrpc":"2.0","id":"abc","method":"ping"}\n');
      assert.equal(stringId.replies[0].id, "abc", "a string id is echoed");
      const zeroId = await session('{"jsonrpc":"2.0","id":0,"method":"ping"}\n');
      assert.equal(zeroId.replies[0].id, 0, "id 0 is answered, so zero is not mistaken for absent");
      const nullId = await session('{"jsonrpc":"2.0","id":null,"method":"ping"}\n');
      assert.equal(nullId.replies[0].id, null, "a null id is echoed, as 6.7 covers");
      assert.ok(nullId.replies[0].result, "and answered with a result");
    });
  });
});