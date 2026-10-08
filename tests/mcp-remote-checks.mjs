import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handlePolicyMessage,
  negotiatePolicyProtocol,
  policyToolDefs,
  policyToolText,
} from "../convex/mcpPolicy.ts";

// Online policy source. Static coaching material only, no code processed.
// Local reads the files. Online serves the policies.

describe("online policy source", () => {
  it("answers initialize with the negotiated protocol version", async () => {
    const result = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.result.protocolVersion, "2025-11-25");
    assert.equal(result.body.result.serverInfo.name, "launchsense-policy");
    assert.equal(negotiatePolicyProtocol("2099-01-01"), "2025-03-26");
  });

  it("lists exactly the four policy tools and nothing that scans", async () => {
    const listed = await handlePolicyMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "launchsense_get_skill",
      "launchsense_get_rules",
      "launchsense_get_checklist",
      "launchsense_get_audit_instructions",
    ]);
    assert.equal(policyToolDefs().length, 4);
    for (const name of names) {
      assert.doesNotMatch(name, /scan_public|get_report/i);
    }
  });

  it("calls one tool with static text and refuses arguments", async () => {
    const called = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "launchsense_get_skill", arguments: {} },
    });
    assert.equal(called.body.result.isError, false);
    assert.match(called.body.result.content[0].text, /not-checked list goes back/);
    const refused = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "launchsense_get_skill", arguments: { repoUrl: "https://github.com/x/y" } },
    });
    assert.equal(refused.body.error.code, -32602);
    const unknown = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "launchsense_scan_public", arguments: {} },
    });
    assert.equal(unknown.body.error.code, -32602);
  });

  it("rules text names the check families and never decides", () => {
    const text = policyToolText("launchsense_get_rules");
    assert.match(text, /secrets, risky code, dependencies, licenses/);
    assert.match(text, /never decides a finding/);
    assert.doesNotMatch(text, /repoUrl/);
  });

  it("http keeps health and the policy route, nothing that scans", () => {
    const http = readFileSync(new URL("../convex/http.ts", import.meta.url), "utf8");
    assert.match(http, /\/api\/health/);
    assert.match(http, /path: "\/mcp"/);
    assert.match(http, /mcpPolicy/);
    assert.doesNotMatch(http, /launchsense_scan_public/);
    assert.doesNotMatch(http, /\/api\/mcp\/scan/);
  });

  it("the connect page shows both doors and the home page tells people to clone", () => {
    const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");
    const connect = readFileSync(new URL("../src/pages/Connect.tsx", import.meta.url), "utf8");
    assert.match(connect, /https:\/\/harmless-chihuahua-667\.convex\.site\/mcp/);
    assert.match(connect, /Two addresses, two jobs/);
    assert.match(connect, /launchsense_get_skill/);
    assert.match(connect, /git clone https:\/\/github\.com\/launchsense\/LaunchSense/);
    assert.match(connect, /install\.sh/);
    assert.match(home, /href="\/connect"/);
    assert.match(home, /SETUP_PROMPT/);
  });
});
