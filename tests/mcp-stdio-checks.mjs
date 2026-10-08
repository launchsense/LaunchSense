// W4-MCP. Conformance tests for the local Node MCP server, driven the way an
// MCP client drives it: one JSON message per line on stdin, one JSON message per
// line on stdout.
//
// The server under test is the real one, run with node, not a mock, so a framing
// mistake cannot hide behind a helper that agrees with it. Every session writes
// real MCP bytes: `JSON.stringify(message) + "\n"`, no headers, which is what the
// MCP stdio transport specifies and what the official SDK writes.
//
// No network is used. LAUNCHSENSE_API_URL points at a port nothing listens on,
// so a tool that reached the API would fail loudly instead of answering from
// the real deployment. HOME is a temp folder, so no local config is read.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(REPO, "mcp", "server.ts");
const HOME = mkdtempSync("/tmp/opencode/w4-home-");
// Port 1 refuses, so an accidental API call fails instead of leaving the
// machine.
const DEAD_API = "http://127.0.0.1:1";

after(() => rmSync(HOME, { recursive: true, force: true }));

/** One stdio session. `input` is written raw, so a test can send bad bytes. */
function session(input, { env = {}, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: join(REPO, "mcp"),
      env: { PATH: process.env.PATH, HOME, LAUNCHSENSE_API_URL: DEAD_API, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // A wedged server must fail the test, not hang it.
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const lines = stdout.split("\n").filter((line) => line.trim() !== "");
      resolve({
        code,
        signal,
        stdout,
        stderr,
        lines,
        replies: lines.map((line) => JSON.parse(line)),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** The MCP stdio framing: one JSON object per line, no length header. */
const frame = (object) => `${JSON.stringify(object)}\n`;
const frames = (...objects) => objects.map(frame).join("");

const request = (id, method, params) =>
  params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };

/** The handshake. The server holds session state, so anything but ping before
 *  initialize is refused with -32002 and no result comes back. Its id is 0 so the
 *  answer for the real request under test is never the handshake. */
const HELLO = frames(request(0, "initialize", { protocolVersion: "2025-06-18" }));

/** The answer carrying this JSON-RPC id. Answers are not in request order once
 *  requests are handled concurrently, so a test looks an answer up by id. */
function replyFor(result, id) {
  const found = result.replies.filter((r) => r.id === id);
  assert.equal(
    found.length,
    1,
    `exactly one answer carries id ${id}; got ids ${result.replies.map((r) => r.id).join(", ")}`,
  );
  return found[0];
}

/** A local HTTP fixture. Open sockets are destroyed on close, so a fixture that
 *  never answers its request still lets the test finish. */
function fixture(handler) {
  const server = createServer(handler);
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(done);
          }),
      });
    });
  });
}

describe("W4-MCP: the local server speaks MCP on stdio", () => {
  it("[transport] a newline message gets a newline answer, with no Content-Length header anywhere", async function () {
    const result = await session(frames(request(1, "initialize", { protocolVersion: "2025-06-18" })));
    assert.equal(result.lines.length, 1, `one message in, one message out; got: ${result.stdout}`);
    assert.match(result.stdout, /\n$/, "the answer ends with a newline, so the next message can start");
    assert.doesNotMatch(result.stdout, /Content-Length/i, "LSP framing is not MCP framing");
    assert.doesNotMatch(result.stdout, /\r/, "no carriage returns on a newline-delimited transport");
    assert.equal(result.replies[0].jsonrpc, "2.0");
    assert.equal(result.replies[0].id, 1);
    assert.equal(result.replies[0].result.serverInfo.name, "launchsense");
    assert.equal(result.code, 0, `a clean session exits 0; stderr: ${result.stderr}`);
  });

  it("[transport] two messages written in one write are each answered once, matched by id", async function () {
    const result = await session(
      frames(
        request(1, "initialize", { protocolVersion: "2025-06-18" }),
        request(2, "tools/list"),
      ),
    );
    // The server handles each message in its own goroutine, so the two answers
    // are not in request order. That is legal: MCP identifies an answer by its
    // id. What has to hold is that both ids come back exactly once.
    assert.deepEqual(
      [...result.replies.map((r) => r.id)].sort((a, b) => a - b),
      [1, 2],
      `each message is answered exactly once; got: ${result.stdout}`,
    );
    const byId = new Map(result.replies.map((r) => [r.id, r]));
    assert.equal(byId.get(1).result.protocolVersion, "2025-06-18", "the handshake answers for id 1");
    assert.ok(byId.get(1).result.serverInfo, "with its serverInfo");
    assert.ok(Array.isArray(byId.get(2).result.tools), "tools/list answers for id 2 with tools");
  });

  it("[transport] a blank line is ignored and invents no reply", async function () {
    const result = await session(`\n\n${frame(request(7, "ping"))}\n`);
    assert.equal(result.lines.length, 1, `only the ping is answered; got: ${result.stdout}`);
    assert.equal(result.replies[0].id, 7);
  });

  it("[parse error] malformed JSON answers -32700 with id null, and the session survives", async function () {
    const result = await session(`{not json at all\n${frame(request(3, "ping"))}\n`);
    assert.equal(result.replies.length, 2, `the bad line and the ping both answer; got: ${result.stdout}`);
    // The parse error is answered on the reader loop with a null id, so it is
    // found by its shape rather than by id.
    const parseErrors = result.replies.filter((r) => r.id === null && r.error?.code === -32700);
    assert.equal(parseErrors.length, 1, `one parse error with a null id; got: ${result.stdout}`);
    assert.ok(!("result" in parseErrors[0]), "a parse error is not a result");
    assert.ok(replyFor(result, 3).result, "the session keeps serving after a parse error");
    assert.match(result.stderr, /parse error/i, "one line goes to stderr, so stdout stays protocol only");
    assert.equal(result.code, 0, "the server does not exit over one bad line");
  });

  it("[size limit] a line over the cap is refused with a JSON-RPC error, no crash, session survives", async function () {
    const oversized = { ...request(4, "ping"), pad: "a".repeat(5 * 1024 * 1024) };
    const result = await session(`${frame(oversized)}${frame(request(5, "ping"))}`);
    assert.equal(result.replies.length, 2, `the oversize line is answered, not dropped; got ${result.stdout.slice(0, 200)}`);
    const refused = result.replies.find((r) => r.id === null && r.error?.code === -32600);
    assert.ok(refused, `the oversize line is refused; got: ${result.stdout.slice(0, 200)}`);
    assert.match(refused.error.message, /4 MiB/, "the cap is named in the answer");
    assert.ok(replyFor(result, 5).result, "the next message still answers, so the stream did not desync");
    assert.equal(result.code, 0, `no out of memory and no exit; stderr: ${result.stderr.slice(0, 300)}`);
    assert.ok(
      !/out of memory/i.test(result.stderr),
      `an oversize line must not crash the process; stderr: ${result.stderr.slice(0, 300)}`,
    );
  });

  it("[tool names] no local tool claims the hosted public-repo scan", async function () {
    const result = await session(
      frames(
        request(1, "initialize", { protocolVersion: "2025-06-18" }),
        request(2, "tools/list"),
      ),
    );
    const tools = replyFor(result, 2).result.tools;
    const names = tools.map((t) => t.name);
    assert.ok(
      !names.includes("launchsense_scan_public"),
      `the hosted tool of that name really scans a public repo; the local one must not answer to it: ${names.join(", ")}`,
    );
    const notice = tools.find((t) => t.name.includes("scan_public"));
    assert.ok(notice, `the pointer to the hosted address is still offered; got: ${names.join(", ")}`);
    assert.doesNotMatch(
      notice.description,
      /\bscans?\b/i,
      `a notice must not read as a scan; description was: ${notice.description}`,
    );
    assert.deepEqual(
      notice.inputSchema.required ?? [],
      [],
      "a tool that scans nothing requires nothing",
    );
  });

  it("[tool names] every published schema closes its argument list", async function () {
    const result = await session(HELLO + frame(request(1, "tools/list")));
    for (const tool of replyFor(result, 1).result.tools) {
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} must reject an undeclared argument, not ignore it`,
      );
    }
  });

  it("[arguments] an unknown tool is a protocol error, not a result with isError", async function () {
    const result = await session(
      HELLO + frame(request(9, "tools/call", { name: "launchsense_nope", arguments: {} })),
    );
    const reply = replyFor(result, 9);
    assert.equal(reply.error.code, -32602, "an unknown tool is Invalid params");
    assert.match(reply.error.message, /launchsense_nope/, "and the name is echoed back");
    assert.ok(!("result" in reply), "isError is for a tool that ran and failed, not for a tool that does not exist");
  });

  it("[arguments] an unknown tool, an undeclared field, and malformed params are three different errors", async function () {
    const unknown = await session(
      HELLO + frame(request(1, "tools/call", { name: "launchsense_report", arguments: { scanId: "abc" } })),
    );
    assert.equal(replyFor(unknown, 1).error.code, -32602);
    assert.match(
      replyFor(unknown, 1).error.message,
      /unexpected property scanId/,
      `a field the tool dropped is named; got: ${replyFor(unknown, 1).error.message}`,
    );

    const undeclared = await session(
      HELLO + frame(request(2, "tools/call", { name: "launchsense_scan_repo", arguments: { repoUrl: "https://github.com/octocat/Hello-World" } })),
    );
    assert.equal(replyFor(undeclared, 2).error.code, -32602);
    assert.match(
      replyFor(undeclared, 2).error.message,
      /repoUrl/,
      `an argument the tool dropped is named, not silently ignored; got: ${replyFor(undeclared, 2).error.message}`,
    );

    const malformed = await session(HELLO + frame({ jsonrpc: "2.0", id: 3, method: "tools/call", params: 42 }));
    assert.equal(replyFor(malformed, 3).error.code, -32602);
    assert.match(
      replyFor(malformed, 3).error.message,
      /Invalid tool call/,
      `malformed params are a protocol error; got: ${replyFor(malformed, 3).error.message}`,
    );
  });

  it("[truncation] a local report over 1 MiB is refused, never returned whole", async function () {
    const root = mkdtempSync("/tmp/opencode/w4-report-");
    try {
      mkdirSync(join(root, ".ls", "reports"), { recursive: true });
      writeFileSync(join(root, ".ls", "reports", "2099-01-01T00-00-00-000Z.md"), "R".repeat(2 * 1024 * 1024));
      const result = await session(
        HELLO + frame(request(1, "tools/call", { name: "launchsense_report", arguments: {} })),
        { env: { LAUNCHSENSE_ROOT: root }, timeoutMs: 30_000 },
      );
      const reply = replyFor(result, 1);
      const text = reply.result.content[0].text;
      assert.equal(reply.result.isError, true, "an overlarge local report is an error");
      assert.match(text, /1 MiB/, `the answer says the limit; got: ${text.slice(0, 200)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("[report] the local report never touches the network", async function () {
    // LAUNCHSENSE_API_URL points at a dead port for every session here. The
    // report reads .ls/reports on this machine, so it answers anyway.
    const root = mkdtempSync("/tmp/opencode/w4-report-");
    try {
      mkdirSync(join(root, ".ls", "reports"), { recursive: true });
      writeFileSync(join(root, ".ls", "reports", "2099-01-01T00-00-00-000Z.md"), "Local report body.");
      const result = await session(
        HELLO +
          frames(
            request(1, "tools/call", { name: "launchsense_report", arguments: {} }),
            request(2, "ping"),
          ),
        { env: { LAUNCHSENSE_ROOT: root }, timeoutMs: 30_000 },
      );
      const call = replyFor(result, 1);
      assert.equal(call.result.isError, false);
      assert.match(call.result.content[0].text, /Local report body/);
      assert.ok(replyFor(result, 2).result, "ping still answers, so nothing hung");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});