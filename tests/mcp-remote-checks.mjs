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

  it("lists exactly one policy tool and nothing that scans", async () => {
    const listed = await handlePolicyMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ["launchsense_get_policy"]);
    assert.equal(policyToolDefs().length, 1);
    for (const name of names) {
      assert.doesNotMatch(name, /scan_public|get_report/i);
    }
  });

  it("returns the whole bundle in one call and refuses arguments", async () => {
    const called = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "launchsense_get_policy", arguments: {} },
    });
    assert.equal(called.body.result.isError, false);
    const text = called.body.result.content[0].text;
    for (const section of ["Policy bundle version", "SKILL", "RULES", "CHECKLIST", "AUDIT INSTRUCTIONS"]) {
      assert.ok(text.includes(section), `the one call must carry ${section}`);
    }
    assert.match(text, /not-checked list goes back/);
    const refused = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "launchsense_get_policy", arguments: { repoUrl: "https://github.com/x/y" } },
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

  it("version stamp matches the skill file, so staleness is checkable", async () => {
    const called = await handlePolicyMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "launchsense_get_policy", arguments: {} },
    });
    const text = called.body.result.content[0].text;
    assert.match(text, /Policy bundle version: \d{4}-\d{2}-\d{2}/);
    const skill = readFileSync(new URL("../skills/launchsense/SKILL.md", import.meta.url), "utf8");
    const stamp = skill.match(/^Skill version: (\d{4}-\d{2}-\d{2})\./m);
    assert.ok(stamp, "the skill must carry a Skill version stamp");
    assert.ok(text.includes(stamp[1]), "online bundle version and skill stamp must agree");
  });

  it("the bundle names the check families and never decides", () => {
    const text = policyToolText("launchsense_get_policy");
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

  it("the start page hands over one paste line and one setup prompt, with no commands in view", () => {
    const start = readFileSync(new URL("../src/pages/Start.tsx", import.meta.url), "utf8");
    assert.match(start, /PASTE_LINE/);
    assert.match(start, /SETUP_PROMPT/);
    assert.doesNotMatch(start, /git clone/);
    assert.doesNotMatch(start, /launchsense_scan_public/);
    const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");
    assert.match(home, /href="\/start"/);
    assert.doesNotMatch(home, /SETUP_PROMPT/);
  });
});
