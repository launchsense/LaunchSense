import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Hosted MCP protocol is archived. The server exposes health only.
// The check runs on your machine through the local MCP server.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

describe("hosted MCP protocol is archived", () => {
  it("mcpHttp module is deleted", () => {
    assert.equal(existsSync(join(repo, "convex", "mcpHttp.ts")), false);
  });

  it("http exposes health only, no hosted routes", () => {
    const http = read("convex", "http.ts");
    assert.match(http, /\/api\/health/);
    assert.doesNotMatch(http, /launchsense_scan_public/);
    assert.doesNotMatch(http, /\/mcp/);
    assert.doesNotMatch(http, /\/api\/mcp\/scan/);
  });

  it("the connect page shows local setup and the home page tells people to clone", () => {
    const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");
    const connect = readFileSync(new URL("../src/pages/Connect.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(connect, /https:\/\/harmless-chihuahua-667\.convex\.site\/mcp/);
    assert.match(connect, /git clone https:\/\/github\.com\/launchsense\/LaunchSense/);
    assert.match(connect, /install\.sh/);
    assert.match(home, /href="\/connect"/);
    assert.match(home, /SETUP_PROMPT/);
  });
});
