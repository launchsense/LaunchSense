import { describe, it } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({ tools: [], scanId: "s1", findingCount: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

describe("MCP adapter", () => {
  it("calls the public API without sending tokens or secrets", async () => {
    const mod = await import("../scripts/mcp-server.mjs?test=1");
    const tools = await mod.listTools();
    const scan = await mod.scanPublicRepo("https://github.com/launchsense/LaunchSense");
    assert.deepEqual(tools.tools, []);
    assert.equal(scan.scanId, "s1");
    assert.equal(calls.length, 2);
    const serialized = JSON.stringify(calls);
    assert.ok(!serialized.includes("GITHUB_APP_PRIVATE_KEY"));
    assert.ok(!serialized.includes("AUTH_GITHUB_SECRET"));
  });

  it("does not pretend explain findings exists yet", async () => {
    const mod = await import("../scripts/mcp-server.mjs?test=1");
    await assert.rejects(() => mod.explainFindings("s1"), /not public through MCP yet/);
  });
});