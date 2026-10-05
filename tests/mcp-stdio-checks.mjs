// W4-MCP. Conformance tests for the local Go MCP server, driven the way an MCP
// client drives it: one JSON message per line on stdin, one JSON message per
// line on stdout.
//
// The server under test is the built binary, not a mock, so a framing mistake
// cannot hide behind a helper that agrees with it. Every session writes real
// MCP bytes: `JSON.stringify(message) + "\n"`, no headers, which is what the
// MCP stdio transport specifies and what the official SDK writes.
//
// No network is used. LAUNCHSENSE_API_URL points at a port nothing listens on,
// so a tool that reached the API would fail loudly instead of answering from
// the real deployment. HOME is a temp folder, so no local config is read.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILT = mkdtempSync("/tmp/opencode/w4-mcp-");
const GO_SERVER = join(BUILT, "launchsense-mcp");
const HOME = mkdtempSync("/tmp/opencode/w4-home-");
// Port 1 refuses, so an accidental API call fails instead of leaving the
// machine.
const DEAD_API = "http://127.0.0.1:1";

let goStatus = "not built";

/** One stdio session. `input` is written raw, so a test can send bad bytes. */
function session(input, { env = {}, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(GO_SERVER, [], {
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
  before(() => {
    const go = spawnSync("sh", ["-c", "command -v go"], { encoding: "utf8" });
    if (go.status !== 0) {
      goStatus = "go is not on PATH";
      return;
    }
    const build = spawnSync("go", ["build", "-o", GO_SERVER, "."], {
      cwd: join(REPO, "mcp"),
      encoding: "utf8",
      env: {
        ...process.env,
        GOPROXY: "off",
        GOFLAGS: "-mod=readonly",
        GOCACHE: process.env.GOCACHE ?? join("/tmp/opencode", "w4-mcp-gocache"),
      },
      timeout: 300_000,
    });
    goStatus =
      build.status === 0
        ? "built"
        : `build failed: ${(build.stderr || "").slice(0, 200)}`;
    if (build.status !== 0) return;
    return () => rmSync(BUILT, { recursive: true, force: true });
  });

  it("[transport] a newline message gets a newline answer, with no Content-Length header anywhere", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
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

  it("[transport] two messages written in one write are answered in order", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const result = await session(
      frames(request(1, "initialize", {}), request(2, "tools/list")),
    );
    assert.deepEqual(
      result.replies.map((r) => r.id),
      [1, 2],
      `each message is answered; got: ${result.stdout}`,
    );
    assert.ok(Array.isArray(result.replies[1].result.tools), "tools/list answers with tools");
  });

  it("[transport] a blank line is ignored and invents no reply", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const result = await session(`\n\n${frame(request(7, "ping"))}\n`);
    assert.equal(result.lines.length, 1, `only the ping is answered; got: ${result.stdout}`);
    assert.equal(result.replies[0].id, 7);
  });

  it("[parse error] malformed JSON answers -32700 with id null, and the session survives", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const result = await session(`{not json at all\n${frame(request(3, "ping"))}\n`);
    assert.equal(result.replies.length, 2, `the bad line and the ping both answer; got: ${result.stdout}`);
    const first = result.replies[0];
    assert.equal(first.error.code, -32700, "a JSON parse failure is -32700 Parse error");
    assert.equal(first.id, null, "the id is null, because no id could be read");
    assert.ok(!("result" in first), "a parse error is not a result");
    assert.equal(result.replies[1].id, 3, "the session keeps serving after a parse error");
    assert.match(result.stderr, /parse error/i, "one line goes to stderr, so stdout stays protocol only");
    assert.equal(result.code, 0, "the server does not exit over one bad line");
  });

  it("[size limit] a line over the cap is refused with a JSON-RPC error, no crash, session survives", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const oversized = { ...request(4, "ping"), pad: "a".repeat(5 * 1024 * 1024) };
    const result = await session(`${frame(oversized)}${frame(request(5, "ping"))}`);
    assert.equal(result.replies.length, 2, `the oversize line is answered, not dropped; got ${result.stdout.slice(0, 200)}`);
    assert.equal(result.replies[0].error.code, -32600, "an unusable message is Invalid Request");
    assert.match(result.replies[0].error.message, /4 MiB/, "the cap is named in the answer");
    assert.equal(result.replies[1].id, 5, "the next message still answers, so the stream did not desync");
    assert.equal(result.code, 0, `no out of memory and no exit; stderr: ${result.stderr.slice(0, 300)}`);
    assert.ok(
      !/out of memory/i.test(result.stderr),
      `an oversize line must not crash the process; stderr: ${result.stderr.slice(0, 300)}`,
    );
  });

  it("[tool names] no local tool claims the hosted public-repo scan", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const result = await session(frames(request(1, "initialize", {}), request(2, "tools/list")));
    const tools = result.replies[1].result.tools;
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
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const result = await session(frames(request(1, "tools/list")));
    for (const tool of result.replies[0].result.tools) {
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} must reject an undeclared argument, not ignore it`,
      );
    }
  });

  it("[arguments] an unknown tool is a protocol error, not a result with isError", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const result = await session(
      frames(request(9, "tools/call", { name: "launchsense_nope", arguments: {} })),
    );
    const reply = result.replies[0];
    assert.equal(reply.error.code, -32602, "an unknown tool is Invalid params");
    assert.match(reply.error.message, /launchsense_nope/, "and the name is echoed back");
    assert.ok(!("result" in reply), "isError is for a tool that ran and failed, not for a tool that does not exist");
  });

  it("[arguments] a missing required field, a wrong type, and an undeclared field are three different errors", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const missing = await session(
      frames(request(1, "tools/call", { name: "launchsense_report", arguments: {} })),
    );
    assert.equal(missing.replies[0].error.code, -32602);
    assert.match(
      missing.replies[0].error.message,
      /scanId is required/,
      `a missing field says which field; got: ${missing.replies[0].error.message}`,
    );

    const wrongType = await session(
      frames(request(2, "tools/call", { name: "launchsense_report", arguments: { scanId: 42 } })),
    );
    assert.equal(wrongType.replies[0].error.code, -32602);
    assert.match(
      wrongType.replies[0].error.message,
      /scanId must be a string, got number/,
      `a wrong type is a type error, not a missing field; got: ${wrongType.replies[0].error.message}`,
    );

    const undeclared = await session(
      frames(request(3, "tools/call", { name: "launchsense_scan_repo", arguments: { repoUrl: "https://github.com/octocat/Hello-World" } })),
    );
    assert.equal(undeclared.replies[0].error.code, -32602);
    assert.match(
      undeclared.replies[0].error.message,
      /repoUrl/,
      `an argument the tool dropped is named, not silently ignored; got: ${undeclared.replies[0].error.message}`,
    );
  });

  it("[truncation] a report body over 1 MiB comes back as partial, never as a whole report", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const body = "R".repeat(2 * 1024 * 1024);
    const host = await fixture((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    try {
      const result = await session(
        frames(request(1, "tools/call", { name: "launchsense_report", arguments: { scanId: "fixture" } })),
        { env: { LAUNCHSENSE_API_URL: host.url }, timeoutMs: 30_000 },
      );
      const text = result.replies[0].result.content[0].text;
      assert.equal(result.replies[0].result.isError, true, `a clipped body is an error; got isError false with ${text.length} characters`);
      assert.match(text, /partial/i, `the answer says it is partial; got: ${text.slice(0, 200)}`);
      assert.ok(text.length < body.length, "the clipped text is not passed off as the whole body");
    } finally {
      await host.close();
    }
  });

  it("[timeout] an endpoint that accepts and never answers is abandoned, and the next call still works", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    // This one really waits for the client timeout, so the test budget is wide.
    const host = await fixture(() => {
      // Accepted, then nothing. Never ends the response.
    });
    try {
      const started = Date.now();
      const result = await session(
        frames(
          request(1, "tools/call", { name: "launchsense_report", arguments: { scanId: "hangs" } }),
          request(2, "ping"),
        ),
        { env: { LAUNCHSENSE_API_URL: host.url }, timeoutMs: 40_000 },
      );
      const waited = Date.now() - started;
      assert.equal(result.replies.length, 2, `both messages answer; got: ${result.stdout.slice(0, 200)}`);
      assert.equal(result.replies[0].result.isError, true, "the hung call is an error");
      assert.match(
        result.replies[0].result.content[0].text,
        /timeout|deadline/i,
        `the answer names the timeout; got: ${result.replies[0].result.content[0].text.slice(0, 200)}`,
      );
      assert.equal(result.replies[1].id, 2, "a hung endpoint does not take ping down with it");
      assert.ok(waited < 30_000, `the call gave up in ${waited}ms instead of hanging`);
    } finally {
      await host.close();
    }
  });
});