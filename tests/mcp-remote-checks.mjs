import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatPublicScan,
  handleMcpMessage,
  wantsEventStream,
} from "../convex/mcpHttp.ts";

describe("hosted MCP protocol", () => {
  it("answers initialize with the client protocol version", async () => {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cursor", version: "1" } },
      },
      async () => ({ text: "unused", isError: false }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.result.protocolVersion, "2025-11-25");
    assert.equal(result.body.result.serverInfo.name, "launchsense");
  });

  it("lists the public tools and calls one", async () => {
    const listed = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      async () => ({ text: "unused", isError: false }),
    );
    const names = listed.body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ["launchsense_scan_public", "launchsense_get_report"]);

    const called = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "launchsense_scan_public", arguments: { repoUrl: "https://github.com/example/repo" } },
      },
      async (name, args) => {
        assert.equal(name, "launchsense_scan_public");
        assert.equal(args.repoUrl, "https://github.com/example/repo");
        return { text: "Scan abc\nStatus: partial\nA partial result is not a pass.", isError: false };
      },
    );
    assert.equal(called.body.result.isError, false);
    assert.match(called.body.result.content[0].text, /partial/);
  });

  it("accepts a notification without a result body", async () => {
    const result = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      async () => ({ text: "unused", isError: false }),
    );
    assert.equal(result.status, 202);
    assert.equal(result.body, null);
  });

  it("rejects an unknown method and a batch", async () => {
    const missing = await handleMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "resources/list" },
      async () => ({ text: "unused", isError: false }),
    );
    assert.equal(missing.body.error.code, -32601);
    const batch = await handleMcpMessage([], async () => ({ text: "unused", isError: false }));
    assert.equal(batch.status, 400);
  });

  it("keeps the coverage line in the scan text", () => {
    const text = formatPublicScan({
      scanId: "scan1",
      status: "partial",
      coverageNote: "Read 10 of 40 files.",
      findingCount: 0,
      findings: [],
    });
    assert.match(text, /Read 10 of 40 files/);
    assert.match(text, /Findings listed: 0/);
    assert.match(text, /A partial result is not a pass/);
    assert.equal(wantsEventStream("text/event-stream"), true);
    assert.equal(wantsEventStream("application/json, text/event-stream"), false);
  });

  it("the connect page shows the hosted address and the home page does not tell people to clone", () => {
    const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");
    const connect = readFileSync(new URL("../src/pages/Connect.tsx", import.meta.url), "utf8");
    assert.match(connect, /https:\/\/harmless-chihuahua-667\.convex\.site\/mcp/);
    assert.match(home, /href="\/connect"/);
    assert.doesNotMatch(home, /git clone/);
    assert.doesNotMatch(home, /install\.sh/);
  });
});
